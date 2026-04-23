import dedent from 'dedent';
import path from 'node:path';

import {describe, expect, test} from 'vitest';

import {extractSchema} from '../../src/sqlite-text.js';
import {createMigrationsFixture} from './fixture.js';

describe('draft', () => {
  test('creates the first migration from definitions.sql when there is no migration history yet', async () => {
    await using fixture = await createMigrationsFixture('first-migration-from-empty-history', {
      desiredSchema: `create table person(name text)`,
    });

    await fixture.api.draft();

    expect(await fixture.dumpFs()).toMatchInlineSnapshot(`
      "definitions.sql
        create table person(name text)
      migrations/
        2026-04-10T00.00.00.000Z_create_table_person.sql
          create table person(name text);
      "
    `);
  });

  test('creates the next migration from the replayed baseline', async () => {
    await using fixture = await createMigrationsFixture('next-migration-from-baseline', {
      desiredSchema: dedent`
        create table person(name text);
        create table pet(name text);
      `,
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await fixture.api.draft();

    expect(await fixture.dumpFs()).toMatchInlineSnapshot(`
      "definitions.sql
        create table person(name text);
        create table pet(name text);
      migrations/
        2026-04-10T00.00.00.000Z_create_person.sql
          create table person(name text)
        2026-04-10T01.00.00.000Z_create_table_pet.sql
          create table pet(name text);
      "
    `);
  });

  test('is a no-op when replayed migrations already match definitions.sql', async () => {
    await using fixture = await createMigrationsFixture('draft-no-op', {
      desiredSchema: `create table person(name text)`,
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    const before = await fixture.listMigrationFiles();

    await fixture.api.draft();

    expect(await fixture.listMigrationFiles()).toEqual(before);
  });

  test('uses an explicit name override when provided', async () => {
    await using fixture = await createMigrationsFixture('draft-explicit-name', {
      desiredSchema: `create table person(name text)`,
    });

    await fixture.api.draft({name: 'add people'});

    expect(await fixture.listMigrationFiles()).toEqual(['migrations/2026-04-10T00.00.00.000Z_add_people.sql']);
  });
});

describe('migrate', () => {
  test('applies only newly added migrations on the second run', async () => {
    await using fixture = await createMigrationsFixture('migrate-replays-without-migrations-table', {
      desiredSchema: `create table person(name text)`,
    });

    await fixture.writeMigration('add_person', `create table person(name text)`);

    await fixture.api.migrate();

    await fixture.writeFile(
      'definitions.sql',
      dedent`
      create table person(name text);
      create table pet(name text, species text);
    `,
    );
    await fixture.writeMigration('add_pet', `create table pet(name text, species text)`);

    await fixture.api.migrate();

    expect(await extractSchema(fixture.db, 'main', {excludedTables: ['sqlfu_migrations']})).toMatchInlineSnapshot(`
      "create table person(name text);
      create table pet(name text, species text);"
    `);
  });

  test('is a no-op when there are no pending migrations', async () => {
    await using fixture = await createMigrationsFixture('migrate-no-op', {
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await fixture.api.migrate();
    const before = await fixture.readMigrationHistory();

    await fixture.api.migrate();

    expect(await fixture.readMigrationHistory()).toMatchObject(before);
  });

  test('applies migrations in filename order', async () => {
    await using fixture = await createMigrationsFixture('migrate-filename-order', {
      desiredSchema: `create table person(name text)`,
    });

    await fixture.writeFile(
      'migrations/2026-04-10T01.00.00.000Z_insert_person.sql',
      `insert into person(name) values ('alice')`,
    );
    await fixture.writeFile('migrations/2026-04-10T00.00.00.000Z_create_person.sql', `create table person(name text)`);

    await fixture.api.migrate();

    expect(await fixture.db.sql`select name from person order by name`).toMatchObject([{name: 'alice'}]);
  });

  test('refuses to run from an unhealthy baseline even when pending migrations exist', async () => {
    await using fixture = await createMigrationsFixture('migrate-preflight-blocks-when-pending', {
      migrations: {
        create_person: `create table person(name text)`,
        create_pet: `create table pet(name text)`,
      },
    });

    await fixture.api.migrate();
    await fixture.api.baseline({target: '2026-04-10T00.00.00.000Z_create_person'});
    // forcibly drift live schema so it no longer matches history
    await fixture.db.raw(`drop table person`);
    await fixture.db.raw(`create table person(name text, extra text)`);

    await expect(fixture.api.migrate()).rejects.toMatchInlineSnapshot(`
      [Error: Cannot migrate from current database state.

      Schema Drift
      Live Schema does not match Migration History.

      Recommended next actions
      - \`sqlfu goto 2026-04-10T00.00.00.000Z_create_person\` Move the database to the selected migration target.]
    `);
  });

  test('refuses to run from an unhealthy baseline even when there are zero pending migrations', async () => {
    await using fixture = await createMigrationsFixture('migrate-preflight-blocks-no-pending', {
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await fixture.api.migrate();
    // forcibly drift the live schema after all migrations have already been applied
    await fixture.db.raw(`drop table person`);

    await expect(fixture.api.migrate()).rejects.toMatchInlineSnapshot(`
      [Error: Cannot migrate from current database state.

      Schema Drift
      Live Schema does not match Migration History.

      Recommended next actions
      - \`sqlfu goto 2026-04-10T00.00.00.000Z_create_person\` Move the database to the selected migration target.]
    `);
  });

  test('reports safe-to-retry when a failed migration rolls back cleanly', async () => {
    await using fixture = await createMigrationsFixture('migrate-failure-clean-rollback', {
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await fixture.api.migrate();
    await fixture.writeMigration(
      'add_pet_and_fail',
      dedent`
      create table pet(name text);
      this is not valid sql;
    `,
    );

    await expect(fixture.api.migrate()).rejects.toMatchInlineSnapshot(`
      [Error: Migration 2026-04-10T01.00.00.000Z_add_pet_and_fail failed: near "this": syntax error

      The database is still healthy for migrate. Fix the migration and retry.]
    `);
    // the failed migration must not be in history
    expect(await fixture.migrationNames()).toEqual(['create_person']);
    // and its partial schema must not be present
    await expect(fixture.db.sql`select name from sqlite_schema where name = 'pet'`).resolves.toMatchObject([]);
  });

  test('reports reconciliation required when a failed migration leaves the database unhealthy', async () => {
    await using fixture = await createMigrationsFixture('migrate-failure-unhealthy-state', {
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await fixture.api.migrate();
    // a real-world user typo: `commit;` ends the migration transaction early, so the
    // `create table pet` is persisted and the subsequent syntax error cannot be rolled back
    await fixture.writeMigration(
      'commit_then_fail',
      dedent`
      create table pet(name text);
      commit;
      this is not valid sql;
    `,
    );

    await expect(fixture.api.migrate()).rejects.toMatchInlineSnapshot(`
      [Error: Migration 2026-04-10T01.00.00.000Z_commit_then_fail failed: near "this": syntax error

      The database is no longer healthy for migrate. Reconcile before retrying.

      Schema Drift
      Live Schema does not match Migration History.

      Recommended next actions
      - \`sqlfu goto 2026-04-10T00.00.00.000Z_create_person\` Move the database to the selected migration target.]
    `);
    // the failed migration must not be recorded as applied
    expect(await fixture.migrationNames()).toEqual(['create_person']);
  });
});

describe('check recommendations', () => {
  test('passes when desired schema, migrations, migration history, and live schema all agree', async () => {
    await using fixture = await createMigrationsFixture('check-happy-path', {
      desiredSchema: `create table person(name text)`,
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await fixture.api.migrate();

    await expect(fixture.api.check.all()).resolves.toBeUndefined();
  });

  test('passes when live schema quotes a simple identifier that desired schema leaves unquoted', async () => {
    await using fixture = await createMigrationsFixture('check-quoted-identifier-happy-path', {
      desiredSchema: `create table foo(id int, a int)`,
      migrations: {
        create_foo: `create table foo(id int, a int)`,
      },
    });

    await fixture.db.raw(`create table foo(id int, "a" int)`);
    await fixture.api.baseline({target: '2026-04-10T00.00.00.000Z_create_foo'});

    await expect(fixture.api.check.all()).resolves.toBeUndefined();
  });

  test('detects stricter live column constraints as schema drift without recommending sync', async () => {
    await using fixture = await createMigrationsFixture('check-live-has-stricter-column-constraints', {
      desiredSchema: `create table a(b text)`,
      migrations: {
        create_a: `create table a(b text)`,
      },
    });

    await fixture.db.raw(`create table a(b text not null unique)`);
    await fixture.api.baseline({target: '2026-04-10T00.00.00.000Z_create_a'});

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: Schema Drift
      Live Schema does not match Migration History.

      Sync Drift
      Desired Schema does not match Live Schema.

      Recommended next actions
      - \`sqlfu goto 2026-04-10T00.00.00.000Z_create_a\` Move the database to the selected migration target.]
    `);
  });

  test('recommends draft for repo drift only', async () => {
    await using fixture = await createMigrationsFixture('check-repo-drift-only', {
      desiredSchema: `create table person(name text)`,
    });

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: Repo Drift
      Desired Schema does not match Migrations.

      Sync Drift
      Desired Schema does not match Live Schema.

      Recommended next actions
      - \`sqlfu draft\` Create a reviewable migration. (Addresses Repo Drift)
      - \`sqlfu sync\` Update the database from Desired Schema, useful while iterating locally. (Addresses Sync Drift)]
    `);
  });

  test('recommends migrate for pending migrations only', async () => {
    await using fixture = await createMigrationsFixture('check-pending-migrations-only', {
      desiredSchema: `create table person(name text)`,
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: Pending Migrations
      Migration History is behind Migrations.

      Sync Drift
      Live Schema is behind Desired Schema. Applying pending migrations would resolve this.

      Recommended next actions
      - \`sqlfu migrate\` Apply pending migrations to the database.]
    `);
  });

  test('recommends baseline for schema drift when live schema already matches a known target', async () => {
    await using fixture = await createMigrationsFixture('check-schema-drift-only', {
      desiredSchema: `create table person(name text)`,
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await fixture.db.raw(`create table person(name text)`);

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: Pending Migrations
      Migration History is behind Migrations.

      Schema Drift
      Live Schema exists, but Migration History is empty.

      Recommended next actions
      - \`sqlfu baseline 2026-04-10T00.00.00.000Z_create_person\` Record the current schema as already applied.]
    `);
  });

  test('recommends the matching intermediate baseline target, not the latest migration', async () => {
    await using fixture = await createMigrationsFixture('check-schema-drift-intermediate-target', {
      desiredSchema: dedent`
        create table person(name text);
        create table pet(name text);
        create table toy(name text);
      `,
      migrations: {
        create_person: `create table person(name text)`,
        create_pet: `create table pet(name text)`,
        create_toy: `create table toy(name text)`,
      },
    });

    await fixture.db.raw(`
      create table person(name text);
      create table pet(name text);
    `);

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: Pending Migrations
      Migration History is behind Migrations.

      Schema Drift
      Live Schema exists, but Migration History is empty.

      Sync Drift
      Desired Schema does not match Live Schema.

      Recommended next actions
      - \`sqlfu baseline 2026-04-10T01.00.00.000Z_create_pet\` Record the current schema as already applied.]
    `);
  });

  test('reports all mismatches but only the non-conflicting next actions for repo drift over a live schema prefix', async () => {
    await using fixture = await createMigrationsFixture('check-dev-project-follow-up-shape', {
      desiredSchema: dedent`
        create table a(aa text);
        create table b(bb text);
        create table c(cc text);
        create table d(dd text);
      `,
      migrations: {
        create_abc: dedent`
          create table a(aa text);
          create table b(bb text);
          create table c(cc text);
        `,
      },
    });

    await fixture.db.raw(`
      create table a(aa text);
      create table b(bb text);
      create table c(cc text);
    `);

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: Repo Drift
      Desired Schema does not match Migrations.

      Pending Migrations
      Migration History is behind Migrations.

      Schema Drift
      Live Schema exists, but Migration History is empty.

      Sync Drift
      Desired Schema does not match Live Schema.

      Recommended next actions
      - \`sqlfu draft\` Create a reviewable migration. (Addresses Repo Drift)
      - \`sqlfu baseline 2026-04-10T00.00.00.000Z_create_abc\` Record the current schema as already applied. (Addresses Schema Drift)
      - \`sqlfu sync\` Update the database from Desired Schema, useful while iterating locally. (Addresses Sync Drift)]
    `);
  });

  test('recommends goto repo head when repo and history agree but live schema matches no migration prefix', async () => {
    await using fixture = await createMigrationsFixture('check-schema-drift-goto-repo-head', {
      desiredSchema: dedent`
        create table person(name text);
        create table pet(name text);
      `,
      migrations: {
        create_person: `create table person(name text)`,
        create_pet: `create table pet(name text)`,
      },
    });

    await fixture.api.migrate();
    await fixture.db.raw(`
      drop table person;
      drop table pet;
    `);

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: Schema Drift
      Live Schema does not match Migration History.

      Sync Drift
      Desired Schema does not match Live Schema.

      Recommended next actions
      - \`sqlfu goto 2026-04-10T01.00.00.000Z_create_pet\` Move the database to the selected migration target.]
    `);
  });

  test('recommends goto repo head when pending migrations exist and live schema matches no migration prefix', async () => {
    await using fixture = await createMigrationsFixture('check-pending-schema-drift-goto-repo-head', {
      desiredSchema: `create table a(done text)`,
      migrations: {
        create_a: `create table a(start text)`,
        rename_a: `alter table a rename column start to done`,
      },
    });

    await fixture.db.raw(`create table a(rogue text)`);
    await fixture.api.baseline({target: '2026-04-10T00.00.00.000Z_create_a'});

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: Pending Migrations
      Migration History is behind Migrations.

      Schema Drift
      Live Schema does not match Migration History.

      Sync Drift
      Desired Schema does not match Live Schema.

      Recommended next actions
      - \`sqlfu goto 2026-04-10T01.00.00.000Z_rename_a\` Move the database to the selected migration target.]
    `);
  });

  test('recommends migrate when migrations are pending but live schema still matches migration history', async () => {
    await using fixture = await createMigrationsFixture('check-pending-migrations-without-schema-drift', {
      desiredSchema: dedent`
        create table person(name text);
        create table pet(name text);
      `,
      migrations: {
        create_person: `create table person(name text)`,
        create_pet: `create table pet(name text)`,
      },
    });

    await fixture.db.raw(`create table person(name text)`);
    await fixture.api.baseline({target: '2026-04-10T00.00.00.000Z_create_person'});

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: Pending Migrations
      Migration History is behind Migrations.

      Sync Drift
      Live Schema is behind Desired Schema. Applying pending migrations would resolve this.

      Recommended next actions
      - \`sqlfu migrate\` Apply pending migrations to the database.]
    `);
  });
});

describe('baseline', () => {
  test('updates migration history only for the exact target', async () => {
    await using fixture = await createMigrationsFixture('baseline-exact-target', {
      desiredSchema: `create table person(name text)`,
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await fixture.db.raw(`create table person(name text)`);

    await fixture.api.baseline({target: '2026-04-10T00.00.00.000Z_create_person'});

    expect(await extractSchema(fixture.db, 'main', {excludedTables: ['sqlfu_migrations']})).toMatchInlineSnapshot(`
      "create table person(name text);"
    `);
    expect(await fixture.migrationNames()).toEqual(['create_person']);
  });

  test('truncates migration history to the requested earlier target', async () => {
    await using fixture = await createMigrationsFixture('baseline-truncates-history', {
      migrations: {
        create_person: `create table person(name text)`,
        create_pet: `create table pet(name text)`,
      },
    });

    await fixture.api.migrate();

    await fixture.api.baseline({target: '2026-04-10T00.00.00.000Z_create_person'});

    expect(await fixture.migrationNames()).toEqual(['create_person']);
  });
});

describe('goto', () => {
  test('updates live schema and migration history to the exact target', async () => {
    await using fixture = await createMigrationsFixture('goto-exact-target', {
      migrations: {
        create_person: `create table person(name text)`,
        create_pet: `create table pet(name text)`,
      },
    });

    await fixture.db.raw(`
      create table person(name text);
      create table pet(name text);
      create table toy(name text);
      insert into person(name) values ('alice');
      insert into pet(name) values ('fido');
      insert into toy(name) values ('ball');
    `);

    await fixture.api.goto({target: path.parse(await fixture.globOne('*/*create_person*')).name});

    expect(await extractSchema(fixture.db, 'main', {excludedTables: ['sqlfu_migrations']})).toMatchInlineSnapshot(`
      "create table person(name text);"
    `);
    expect(await fixture.migrationNames()).toEqual(['create_person']);
    expect(await fixture.db.sql`select name from person order by name`).toMatchObject([{name: 'alice'}]);

    await fixture.api.goto({target: path.parse(await fixture.globOne('*/*create_pet*')).name});

    expect(await extractSchema(fixture.db, 'main', {excludedTables: ['sqlfu_migrations']})).toMatchInlineSnapshot(`
      "create table person(name text);
      create table pet(name text);"
    `);
    expect(await fixture.migrationNames()).toEqual(['create_person', 'create_pet']);
    expect(await fixture.db.sql`select name from person order by name`).toMatchObject([{name: 'alice'}]);
    expect(await fixture.db.sql`select name from pet order by name`).toMatchObject([]);
  });

  test('preserves surviving data while other schema objects change', async () => {
    await using fixture = await createMigrationsFixture('goto-preserves-data-through-other-object-changes', {
      migrations: {
        create_person: `create table person(name text)`,
        add_person_name_idx: `create index person_name_idx on person(name)`,
      },
    });

    await fixture.db.raw(`
      create table person(name text);
      create table toy(name text);
      insert into person(name) values ('alice');
      insert into toy(name) values ('ball');
    `);

    await fixture.api.goto({target: '2026-04-10T01.00.00.000Z_add_person_name_idx'});

    expect(await extractSchema(fixture.db, 'main', {excludedTables: ['sqlfu_migrations']})).toMatchInlineSnapshot(`
      "create table person(name text);
      create index person_name_idx on person(name);"
    `);
    expect(await fixture.db.sql`select name from person order by name`).toMatchObject([{name: 'alice'}]);
  });
});

describe('sync', () => {
  test('applies a safe additive change', async () => {
    await using fixture = await createMigrationsFixture('sync-additive-change', {
      desiredSchema: `create table person(name text, nickname text)`,
    });

    await fixture.db.raw(`
      create table person(name text);
      insert into person(name) values ('ada');
    `);

    await fixture.api.sync();

    expect(await extractSchema(fixture.db)).toMatchInlineSnapshot(`
      "create table person(name text, nickname text);"
    `);
    expect(await fixture.db.sql`select name, nickname from person order by name`).toMatchObject([
      {name: 'ada', nickname: null},
    ]);
  });

  test('applies a semantic table rebuild when existing data already satisfies the stronger shape', async () => {
    await using fixture = await createMigrationsFixture('sync-semantic-rebuild', {
      desiredSchema: `create table person(name text not null unique)`,
    });

    await fixture.db.raw(`
      create table person(name text);
      insert into person(name) values ('ada');
    `);

    await fixture.api.sync();

    expect(await extractSchema(fixture.db)).toMatchInlineSnapshot(`
      "create table person(name text not null unique);"
    `);
    await expect(fixture.db.sql`select name from person order by name`).resolves.toMatchObject([{name: 'ada'}]);
  });

  test('fails for an unsafe semantic change and recommends draft plus migrate', async () => {
    await using fixture = await createMigrationsFixture('sync-semantic-failure', {
      desiredSchema: `create table person(id integer primary key, name text)`,
    });

    await fixture.db.raw(`
      create table person(name text);
      insert into person(name) values ('Ada Lovelace');
    `);

    await expect(fixture.api.sync()).rejects.toMatchInlineSnapshot(`
      [Error: sync could not apply definitions.sql safely to the current database.
      Create a migration with \`sqlfu draft\`, edit it if needed, then run \`sqlfu migrate\`.

      Cause: automatic table rebuild for person would invent values for new primary key columns: id]
    `);
  });
});
