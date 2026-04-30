import dedent from 'dedent';
import fs from 'node:fs/promises';
import path from 'node:path';

import {describe, expect, test} from 'vitest';

import {extractSchema} from '../../src/sqlite-text.js';
import {createMigrationsFixture} from './fixture.js';

describe('draft edge cases', () => {
  test('drafts first migration when leading section comments precede table DDL with indexes', async () => {
    await using fixture = await createMigrationsFixture('draft-commented-table-with-index', {
      desiredSchema: dedent`
        -- generated schema section
        create table project(id integer primary key);
        create index project_id_idx on project(id);
      `,
    });

    await fixture.api.draft();

    expect(await fixture.readMigration('create_table_project')).toMatchInlineSnapshot(`
      "create table project(id integer primary key);
      create index project_id_idx on project(id);
      "
    `);
  });

  test('drafts destructive changes', async () => {
    await using fixture = await createMigrationsFixture('draft-destructive-change', {
      desiredSchema: `create table person(name text)`,
      migrations: {
        create_person: `create table person(name text)`,
        create_pet: `create table pet(name text)`,
      },
    });

    await fixture.api.draft();

    const draftedMigration = (await fixture.listMigrationFiles()).at(-1)!;

    expect(await fixture.readFile(draftedMigration)).toMatchInlineSnapshot(`
      "drop table pet;
      "
    `);
  });

  test('fails clearly when definitions.sql is missing', async () => {
    await using fixture = await createMigrationsFixture('draft-missing-definitions', {
      desiredSchema: `create table person(name text)`,
    });

    await fs.rm(path.join(fixture.root, 'definitions.sql'));

    await expect(fixture.api.draft()).rejects.toMatchInlineSnapshot(`
      [Error: definitions.sql not found]
    `);
  });
});

describe('migrate edge cases', () => {
  test('refuses to migrate when an applied migration was edited after apply', async () => {
    await using fixture = await createMigrationsFixture('migrate-edited-after-apply', {
      desiredSchema: `create table person(first_name text, last_name text)`,
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await fixture.api.migrate();
    await fixture.writeFile(
      await fixture.globOne('migrations/*create_person.sql'),
      `create table person(first_name text, last_name text)`,
    );

    await expect(fixture.api.migrate()).rejects.toMatchInlineSnapshot(`
      [Error: Cannot migrate from current database state.

      History Drift
      Migration History does not match Migrations.
      Applied migration checksum mismatch: 2026-04-10T00.00.00.000Z_create_person

      Recommended next actions
      - Restore the original migration from version control.]
    `);
  });

  test('refuses to migrate when an applied migration file was deleted after apply', async () => {
    await using fixture = await createMigrationsFixture('migrate-deleted-after-apply', {
      desiredSchema: ``,
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await fixture.api.migrate();
    await fs.rm(path.join(fixture.root, await fixture.globOne('migrations/*create_person.sql')));

    await expect(fixture.api.migrate()).rejects.toMatchInlineSnapshot(`
      [Error: Cannot migrate from current database state.

      History Drift
      Migration History does not match Migrations.
      Deleted applied migration: 2026-04-10T00.00.00.000Z_create_person

      Recommended next actions
      - Restore the missing migration from version control.]
    `);
  });

  test('refuses to migrate when a newly introduced migration sorts before the latest applied migration', async () => {
    await using fixture = await createMigrationsFixture('migrate-earlier-migration-added-later', {
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
    // someone later slips a migration file between the two already-applied ones
    await fixture.writeFile('migrations/2026-04-10T00.30.00.000Z_create_toy.sql', `create table toy(name text)`);
    await fixture.writeFile(
      'definitions.sql',
      dedent`
      create table person(name text);
      create table pet(name text);
      create table toy(name text);
    `,
    );

    await expect(fixture.api.migrate()).rejects.toMatchInlineSnapshot(`
      [Error: Cannot migrate from current database state.

      History Drift
      Migration History does not match Migrations.
      New migration sorts before applied migration: 2026-04-10T01.00.00.000Z_create_pet

      Recommended next actions
      - \`sqlfu goto 2026-04-10T01.00.00.000Z_create_pet\` Move the database to the selected migration target.]
    `);
  });
});

describe('check recommendation edge cases', () => {
  test('prefers repo drift recommendations over downstream mismatches', async () => {
    await using fixture = await createMigrationsFixture('check-repo-drift-wins', {
      desiredSchema: dedent`
        create table person(name text);
        create table pet(name text);
      `,
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await fixture.db.raw(`
      create table person(name text);
      create table toy(name text);
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
      - \`sqlfu sync\` Update the database from Desired Schema, useful while iterating locally. (Addresses Sync Drift)]
    `);
  });

  test('recommends draft only when live schema already matches desired schema', async () => {
    await using fixture = await createMigrationsFixture('check-repo-drift-live-already-synced', {
      desiredSchema: dedent`
        create table person(name text);
        create table pet(name text);
      `,
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await fixture.api.migrate();
    await fixture.db.raw(`create table pet(name text);`);

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: Repo Drift
      Desired Schema does not match Migrations.

      Schema Drift
      Live Schema matches Desired Schema, but not Migration History.

      Recommended next actions
      - \`sqlfu draft\` Create a reviewable migration.]
    `);
  });

  test('still recommends sync when the remaining difference is safely syncable', async () => {
    await using fixture = await createMigrationsFixture('check-repo-drift-sync-viable', {
      desiredSchema: dedent`
        create table posts (
          id integer primary key,
          slug text not null unique,
          title text not null,
          body text not null,
          published integer not null
        );

        create table foo(id int, a int);

        create view post_cards as
        select id, slug, title, published
        from posts;
      `,
    });

    await fixture.db.raw(dedent`
      create table foo(id int);
      create table posts (
        id integer primary key,
        slug text not null unique,
        title text not null,
        body text not null,
        published integer not null
      );
      create view post_cards as
      select id, slug, title, published
      from posts;
    `);

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: Repo Drift
      Desired Schema does not match Migrations.

      Schema Drift
      Live Schema exists, but Migration History is empty.

      Sync Drift
      Desired Schema does not match Live Schema.

      Recommended next actions
      - \`sqlfu draft\` Create a reviewable migration. (Addresses Repo Drift)
      - \`sqlfu sync\` Update the database from Desired Schema, useful while iterating locally. (Addresses Sync Drift)]
    `);
  });

  test('recommends sync when the remaining difference requires destructive sync work', async () => {
    await using fixture = await createMigrationsFixture('check-sync-drift-skipped-drop', {
      desiredSchema: dedent`
        create table foo(id int);
        create table posts(name text);
      `,
      migrations: {
        create_posts: `create table posts(name text)`,
        create_foo: `create table foo(id int)`,
      },
    });

    await fixture.api.migrate();
    await fixture.db.raw(`alter table foo add column a int`);

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: Schema Drift
      Live Schema does not match Migration History.

      Sync Drift
      Desired Schema does not match Live Schema.

      Recommended next actions
      - \`sqlfu goto 2026-04-10T01.00.00.000Z_create_foo\` Move the database to the selected migration target.]
    `);
  });

  test('prefers history drift recommendations over pending migrations and schema drift', async () => {
    await using fixture = await createMigrationsFixture('check-history-drift-wins', {
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
    await fixture.db.raw(`create table toy(name text);`);
    await fixture.writeFile(
      await fixture.globOne('migrations/*create_person.sql'),
      `create table person(first_name text, last_name text)`,
    );

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: History Drift
      Migration History does not match Migrations.
      Applied migration checksum mismatch: 2026-04-10T00.00.00.000Z_create_person

      Repo Drift
      Desired Schema does not match Migrations.

      Sync Drift
      Desired Schema does not match Live Schema.

      Recommended next actions
      - Restore the original migration from version control. (Addresses History Drift)
      - \`sqlfu goto 2026-04-10T00.00.00.000Z_create_person\` Reconcile the database to the current repo state. (Addresses Schema Drift)
      - \`sqlfu draft\` Create a reviewable migration. (Addresses Repo Drift)]
    `);
  });

  test('fails clearly when definitions.sql is missing', async () => {
    await using fixture = await createMigrationsFixture('check-missing-definitions', {
      desiredSchema: `create table person(name text)`,
    });

    await fs.rm(path.join(fixture.root, 'definitions.sql'));

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: definitions.sql not found]
    `);
  });
});

describe('history drift recommendations', () => {
  test('pinpoints the applied migration that was edited after apply', async () => {
    await using fixture = await createMigrationsFixture('check-history-drift-edited-migration', {
      desiredSchema: `create table person(first_name text, last_name text)`,
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await fixture.api.migrate();
    await fixture.writeFile(
      await fixture.globOne('migrations/*create_person.sql'),
      `create table person(first_name text, last_name text)`,
    );

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: History Drift
      Migration History does not match Migrations.
      Applied migration checksum mismatch: 2026-04-10T00.00.00.000Z_create_person

      Sync Drift
      Desired Schema does not match Live Schema.

      Recommended next actions
      - Restore the original migration from version control. (Addresses History Drift)
      - \`sqlfu goto 2026-04-10T00.00.00.000Z_create_person\` Reconcile the database to the current repo state. (Addresses Schema Drift)]
    `);
  });

  test('recommends baseline only when history drift exists but live schema already matches a current target', async () => {
    await using fixture = await createMigrationsFixture('check-history-drift-baseline-only', {
      desiredSchema: `create table person(name text)`,
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await fixture.api.migrate();
    await fixture.db.raw(dedent`
      update sqlfu_migrations
      set checksum = 'oops this is wrong'
    `);

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: History Drift
      Migration History does not match Migrations.
      Applied migration checksum mismatch: 2026-04-10T00.00.00.000Z_create_person

      Recommended next actions
      - Restore the original migration from version control. (Addresses History Drift)
      - \`sqlfu baseline 2026-04-10T00.00.00.000Z_create_person\` Keep the current live schema. (Addresses Schema Drift)]
    `);
  });

  test('pinpoints an applied migration file that has been deleted', async () => {
    await using fixture = await createMigrationsFixture('check-history-drift-deleted-migration', {
      desiredSchema: `create table person(name text)`,
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await fixture.api.migrate();
    await fs.rm(path.join(fixture.root, await fixture.globOne('migrations/*create_person.sql')));

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: History Drift
      Migration History does not match Migrations.
      Deleted applied migration: 2026-04-10T00.00.00.000Z_create_person

      Repo Drift
      Desired Schema does not match Migrations.

      Recommended next actions
      - Restore the missing migration from version control. (Addresses History Drift)
      - \`sqlfu draft\` Create a reviewable migration. (Addresses Repo Drift)]
    `);
  });
});

describe('baseline edge cases', () => {
  test('rejects an unknown exact target', async () => {
    await using fixture = await createMigrationsFixture('baseline-unknown-target', {
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await expect(fixture.api.baseline({target: 'does_not_exist'})).rejects.toMatchInlineSnapshot(`
      [Error: migration does_not_exist not found]
    `);
  });

  test('does not change live schema when baselining to a later target', async () => {
    await using fixture = await createMigrationsFixture('baseline-does-not-touch-live-schema', {
      migrations: {
        create_person: `create table person(name text)`,
        create_pet: `create table pet(name text)`,
      },
    });

    await fixture.db.raw(`create table person(name text)`);

    await fixture.api.baseline({target: '2026-04-10T01.00.00.000Z_create_pet'});

    expect(await extractSchema(fixture.db, 'main', {excludedTables: ['sqlfu_migrations']})).toMatchInlineSnapshot(`
      "create table person(name text);"
    `);
    expect(await fixture.migrationNames()).toEqual(['create_person', 'create_pet']);
  });

  test('rolls back history changes if baseline fails halfway through', async () => {
    await using fixture = await createMigrationsFixture('baseline-transaction', {
      migrations: {
        create_person: `create table person(name text)`,
        create_pet: `create table pet(name text)`,
      },
    });

    await fixture.db.raw(`
      create table sqlfu_migrations(
        name text primary key check(name = '2026-04-10T00.00.00.000Z_create_person'),
        checksum text not null,
        applied_at text not null
      );
      insert into sqlfu_migrations(name, checksum, applied_at)
      values ('2026-04-10T00.00.00.000Z_create_person', 'original checksum', '2026-04-10T00:00:00.000Z');
    `);

    await expect(fixture.api.baseline({target: '2026-04-10T01.00.00.000Z_create_pet'})).rejects.toMatchInlineSnapshot(`
      [Error: CHECK constraint failed: name = '2026-04-10T00.00.00.000Z_create_person']
    `);
    await expect(fixture.readMigrationHistory()).resolves.toMatchObject([
      {
        name: '2026-04-10T00.00.00.000Z_create_person',
        checksum: 'original checksum',
      },
    ]);
  });
});

describe('goto edge cases', () => {
  test('rejects an unknown exact target', async () => {
    await using fixture = await createMigrationsFixture('goto-unknown-target', {
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await expect(fixture.api.goto({target: 'does_not_exist'})).rejects.toMatchInlineSnapshot(`
      [Error: migration does_not_exist not found]
    `);
  });

  test('fails clearly when it cannot produce a valid transition to the target', async () => {
    await using fixture = await createMigrationsFixture('goto-impossible-transition', {
      migrations: {
        broken_target: `this is not valid sql`,
      },
    });

    await expect(fixture.api.goto({target: '2026-04-10T00.00.00.000Z_broken_target'})).rejects.toMatchInlineSnapshot(`
      [Error: near "this": syntax error]
    `);
  });

  test('rolls back live schema and history if goto fails partway through', async () => {
    await using fixture = await createMigrationsFixture('goto-transaction', {
      migrations: {
        upgrade_person: `create table person(name text, nickname text, birthdate text not null)`,
      },
    });

    await fixture.db.raw(`
      create table person(name text);
      insert into person(name) values ('alice');
    `);

    await expect(fixture.api.goto({target: '2026-04-10T00.00.00.000Z_upgrade_person'})).rejects.toMatchInlineSnapshot(`
      [Error: Cannot add a NOT NULL column with default value NULL]
    `);
    await expect(extractSchema(fixture.db)).resolves.toMatchInlineSnapshot(`
      "create table person(name text);"
    `);
    await expect(fixture.readMigrationHistory()).resolves.toMatchObject([]);
  });
});

describe('sync edge cases', () => {
  test('syncs empty database when leading section comments precede table DDL with indexes', async () => {
    await using fixture = await createMigrationsFixture('sync-commented-table-with-index', {
      desiredSchema: dedent`
        -- generated schema section
        create table project(id integer primary key);
        create index project_id_idx on project(id);
      `,
    });

    await fixture.api.sync();

    await expect(extractSchema(fixture.db)).resolves.toMatchInlineSnapshot(`
      "create table project(id integer primary key);
      create index project_id_idx on project(id);"
    `);
  });

  test('rolls back live schema changes if sync fails partway through', async () => {
    await using fixture = await createMigrationsFixture('sync-transaction', {
      desiredSchema: `create table person(name text, nickname text, birthdate text not null)`,
    });

    await fixture.db.raw(`
      create table person(name text);
      insert into person(name) values ('alice');
    `);

    await expect(fixture.api.sync()).rejects.toMatchInlineSnapshot(`
      [Error: sync could not apply definitions.sql safely to the current database.
      Create a migration with \`sqlfu draft\`, edit it if needed, then run \`sqlfu migrate\`.

      Cause: Cannot add a NOT NULL column with default value NULL]
    `);
    await expect(extractSchema(fixture.db)).resolves.toMatchInlineSnapshot(`
      "create table person(name text);"
    `);
  });

  test('fails clearly when definitions.sql is missing', async () => {
    await using fixture = await createMigrationsFixture('sync-missing-definitions', {
      desiredSchema: `create table person(name text)`,
    });

    await fs.rm(path.join(fixture.root, 'definitions.sql'));

    await expect(fixture.api.sync()).rejects.toMatchInlineSnapshot(`
      [Error: definitions.sql not found]
    `);
  });

  test('applies destructive changes when syncing to definitions.sql', async () => {
    await using fixture = await createMigrationsFixture('sync-skipped-drop-only', {
      desiredSchema: `create table foo(id int)`,
    });

    await fixture.db.raw(`
      create table foo(id int, a int);
      insert into foo(id, a) values (1, 2);
    `);

    await fixture.api.sync();
    await expect(extractSchema(fixture.db)).resolves.toMatchInlineSnapshot(`
      "create table foo(id int);"
    `);
    await expect(fixture.db.sql`select id from foo order by id`).resolves.toMatchObject([{id: 1}]);
  });
});

describe('viewing migrations', () => {
  test('lists pending migrations in filename order', async () => {
    await using fixture = await createMigrationsFixture('pending-migrations', {
      migrations: {
        create_person: `create table person(name text)`,
        create_pet: `create table pet(name text)`,
      },
    });

    await fixture.api.baseline({target: '2026-04-10T00.00.00.000Z_create_person'});

    await expect(fixture.api.pending()).resolves.toMatchObject(['2026-04-10T01.00.00.000Z_create_pet']);
  });

  test('lists applied migrations in filename order', async () => {
    await using fixture = await createMigrationsFixture('applied-migrations', {
      migrations: {
        create_person: `create table person(name text)`,
        create_pet: `create table pet(name text)`,
      },
    });

    await fixture.api.migrate();

    await expect(fixture.api.applied()).resolves.toMatchObject([
      '2026-04-10T00.00.00.000Z_create_person',
      '2026-04-10T01.00.00.000Z_create_pet',
    ]);
  });

  test('finds migrations by substring and marks whether they are applied', async () => {
    await using fixture = await createMigrationsFixture('find-migrations', {
      migrations: {
        create_person: `create table person(name text)`,
        create_pet: `create table pet(name text)`,
        create_person_audit: `create table person_audit(name text)`,
      },
    });

    await fixture.api.baseline({target: '2026-04-10T00.00.00.000Z_create_person'});

    await expect(fixture.api.find({text: 'person'})).resolves.toMatchObject([
      {name: '2026-04-10T00.00.00.000Z_create_person', applied: true},
      {name: '2026-04-10T02.00.00.000Z_create_person_audit', applied: false},
    ]);
  });
});
