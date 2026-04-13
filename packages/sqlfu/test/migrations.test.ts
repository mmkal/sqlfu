import dedent from 'dedent';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

import {createRouterClient} from '@orpc/server';
import {describe, expect, test} from 'vitest';

import {getMigrationPrefix, router} from '../src/api.js';
import {createNodeSqliteClient} from '../src/client.js';
import {extractSchema, runSqlStatements} from '../src/core/sqlite.js';
import type {Client, SqlfuProjectConfig} from '../src/core/types.js';
import {createTempFixtureRoot, dumpFixtureFs, writeFixtureFiles} from './fs-fixture.js';

type DisposableClient = {
  readonly client: Client;
  [Symbol.asyncDispose](): Promise<void>;
};

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

    expect(await fixture.listMigrationFiles()).toEqual([
      'migrations/2026-04-10T00.00.00.000Z_add_people.sql',
    ]);
  });

  test('drafts destructive changes without enabling destructive apply', async () => {
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
      "-- Skipped: DROP TABLE "pet";
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

describe('migrate', () => {
  test('applies only newly added migrations on the second run', async () => {
    await using fixture = await createMigrationsFixture('migrate-replays-without-migrations-table');

    await fixture.writeMigration('add_person', `create table person(name text)`);

    await fixture.api.migrate();

    await fixture.writeMigration('add_pet', `create table pet(name text, species text)`);

    await fixture.api.migrate();

    expect(await extractSchema(fixture.db)).toMatchInlineSnapshot(`
      "create table person(name text);
      create table pet(name text, species text);"
    `);
  });

  test('fails when an applied migration was edited after apply', async () => {
    await using fixture = await createMigrationsFixture('migrate-edited-after-apply', {
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await fixture.api.migrate();
    await fixture.writeFile(await fixture.globOne('migrations/*create_person.sql'), `create table person(first_name text, last_name text)`);

    await expect(fixture.api.migrate()).rejects.toMatchInlineSnapshot(`
      [Error: edited applied migration: 2026-04-10T00.00.00.000Z_create_person]
    `);
  });

  test('fails when an applied migration file was deleted after apply', async () => {
    await using fixture = await createMigrationsFixture('migrate-deleted-after-apply', {
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await fixture.api.migrate();
    await fs.rm(path.join(fixture.root, await fixture.globOne('migrations/*create_person.sql')));

    await expect(fixture.api.migrate()).rejects.toMatchInlineSnapshot(`
      [Error: deleted applied migration: 2026-04-10T00.00.00.000Z_create_person]
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
    await using fixture = await createMigrationsFixture('migrate-filename-order');

    await fixture.writeFile('migrations/2026-04-10T01.00.00.000Z_insert_person.sql', `insert into person(name) values ('alice')`);
    await fixture.writeFile('migrations/2026-04-10T00.00.00.000Z_create_person.sql', `create table person(name text)`);

    await fixture.api.migrate();

    expect(await fixture.db.sql`select name from person order by name`).toMatchObject([
      {name: 'alice'},
    ]);
  });

  test('fails when a newly introduced migration sorts before the latest applied migration', async () => {
    await using fixture = await createMigrationsFixture('migrate-earlier-migration-added-later', {
      migrations: {
        create_person: `create table person(name text)`,
        create_pet: `create table pet(name text)`,
      },
    });

    await fixture.api.migrate();
    await fixture.writeFile('migrations/2026-04-10T00.30.00.000Z_create_toy.sql', `create table toy(name text)`);

    await expect(fixture.api.migrate()).rejects.toMatchInlineSnapshot(`
      [Error: migration history is not a prefix of migrations]
    `);
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

  test('recommends draft for repo drift only', async () => {
    await using fixture = await createMigrationsFixture('check-repo-drift-only', {
      desiredSchema: `create table person(name text)`,
    });

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: Repo Drift
      Desired Schema does not match Migrations.
      Recommendation: run \`sqlfu draft\`.]
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
      Recommendation: run \`sqlfu migrate\`.]
    `);
  });

  test('recommends baseline for schema drift when live schema already matches a known target', async () => {
    await using fixture = await createMigrationsFixture('check-schema-drift-only', {
      desiredSchema: `create table person(name text)`,
      migrations: {
        create_person: `create table person(name text)`,
      },
    });

    await runSqlStatements(fixture.db, `
      create table person(name text)
    `);

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: Schema Drift
      Live Schema does not match Migration History.
      Recommended Baseline Target: 2026-04-10T00.00.00.000Z_create_person
      Recommendation: run \`sqlfu baseline 2026-04-10T00.00.00.000Z_create_person\`.]
    `);
  });

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

    await runSqlStatements(fixture.db, `
      create table person(name text);
      create table toy(name text);
    `);

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: Repo Drift
      Desired Schema does not match Migrations.
      Recommendation: run \`sqlfu draft\`.]
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
    await runSqlStatements(fixture.db, `
      create table toy(name text);
    `);
    await fixture.writeFile(await fixture.globOne('migrations/*create_person.sql'), `create table person(first_name text, last_name text)`);

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: History Drift
      Migration History does not match Migrations.
      Edited applied migration: 2026-04-10T00.00.00.000Z_create_person
      Recommended Goto Target: 2026-04-10T00.00.00.000Z_create_person
      Recommendation: restore the original migration from git, or run \`sqlfu goto 2026-04-10T00.00.00.000Z_create_person\` if you want to reconcile this database to the current repo state.]
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
    await fixture.writeFile(await fixture.globOne('migrations/*create_person.sql'), `create table person(first_name text, last_name text)`);

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: History Drift
      Migration History does not match Migrations.
      Edited applied migration: 2026-04-10T00.00.00.000Z_create_person
      Recommended Goto Target: 2026-04-10T00.00.00.000Z_create_person
      Recommendation: restore the original migration from git, or run \`sqlfu goto 2026-04-10T00.00.00.000Z_create_person\` if you want to reconcile this database to the current repo state.]
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
    await runSqlStatements(fixture.db, dedent`
      update sqlfu_migrations
      set content = 'oops this is wrong'
    `);

    await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
      [Error: History Drift
      Migration History does not match Migrations.
      Edited applied migration: 2026-04-10T00.00.00.000Z_create_person
      Recommended Baseline Target: 2026-04-10T00.00.00.000Z_create_person
      Recommendation: restore the original migration from git, or run \`sqlfu baseline 2026-04-10T00.00.00.000Z_create_person\` if you want to keep the current live schema.]
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
      Recommendation: restore the missing migration from git.]
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

    await runSqlStatements(fixture.db, `
      create table person(name text)
    `);

    await fixture.api.baseline({target: '2026-04-10T00.00.00.000Z_create_person'});

    expect(await extractSchema(fixture.db)).toMatchInlineSnapshot(`
      "create table person(name text);"
    `);
    expect(await fixture.migrationNames()).toEqual([
      "create_person",
    ]);
  });

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

  test('truncates migration history to the requested earlier target', async () => {
    await using fixture = await createMigrationsFixture('baseline-truncates-history', {
      migrations: {
        create_person: `create table person(name text)`,
        create_pet: `create table pet(name text)`,
      },
    });

    await fixture.api.migrate();

    await fixture.api.baseline({target: '2026-04-10T00.00.00.000Z_create_person'});

    expect(await fixture.migrationNames()).toEqual([
      "create_person",
    ]);
  });

  test('does not change live schema when baselining to a later target', async () => {
    await using fixture = await createMigrationsFixture('baseline-does-not-touch-live-schema', {
      migrations: {
        create_person: `create table person(name text)`,
        create_pet: `create table pet(name text)`,
      },
    });

    await runSqlStatements(fixture.db, `
      create table person(name text)
    `);

    await fixture.api.baseline({target: '2026-04-10T01.00.00.000Z_create_pet'});

    expect(await extractSchema(fixture.db)).toMatchInlineSnapshot(`
      "create table person(name text);"
    `);
    expect(await fixture.migrationNames()).toEqual([
      "create_person",
      "create_pet",
    ]);
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

    await runSqlStatements(fixture.db, `
      create table person(name text);
      create table pet(name text);
      create table toy(name text);
      insert into person(name) values ('alice');
      insert into pet(name) values ('fido');
      insert into toy(name) values ('ball');
    `);

    await fixture.api.goto({target: path.parse(await fixture.globOne('*/*create_person*')).name});

    expect(await extractSchema(fixture.db)).toMatchInlineSnapshot(`
      "create table person(name text);"
    `);
    expect(await fixture.migrationNames()).toEqual([
      "create_person",
    ]);
    expect(await fixture.db.sql`select name from person order by name`).toMatchObject([
      {name: 'alice'},
    ]);

    await fixture.api.goto({target: path.parse(await fixture.globOne('*/*create_pet*')).name});

    expect(await extractSchema(fixture.db)).toMatchInlineSnapshot(`
      "create table person(name text);
      create table pet(name text);"
    `);
    expect(await fixture.migrationNames()).toEqual([
      "create_person",
      "create_pet",
    ]);
    expect(await fixture.db.sql`select name from person order by name`).toMatchObject([
      {name: 'alice'},
    ]);
    // original pets got dropped when we did goto person
    expect(await fixture.db.sql`select name from pet order by name`).toMatchObject([]);
  });

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

  test('preserves surviving data while other schema objects change', async () => {
    await using fixture = await createMigrationsFixture('goto-preserves-data-through-other-object-changes', {
      migrations: {
        create_person: `create table person(name text)`,
        add_person_name_idx: `create index person_name_idx on person(name)`,
      },
    });

    await runSqlStatements(fixture.db, `
      create table person(name text);
      create table toy(name text);
      insert into person(name) values ('alice');
      insert into toy(name) values ('ball');
    `);

    await fixture.api.goto({target: '2026-04-10T01.00.00.000Z_add_person_name_idx'});

    expect(await extractSchema(fixture.db)).toMatchInlineSnapshot(`
      "create index person_name_idx on person(name);
      create table person(name text);"
    `);
    expect(await fixture.db.sql`select name from person order by name`).toMatchObject([
      {name: 'alice'},
    ]);
  });
});

describe('sync', () => {
  test('applies a safe additive change', async () => {
    await using fixture = await createMigrationsFixture('sync-additive-change', {
      desiredSchema: `create table person(name text, nickname text)`,
    });

    await runSqlStatements(fixture.db, `
      create table person(name text);
      insert into person(name) values ('ada');
    `);

    await fixture.api.sync();

    expect(await extractSchema(fixture.db)).toMatchInlineSnapshot(`
      "create table person(name text, "nickname" text);"
    `);
    expect(await fixture.db.sql`select name, nickname from person order by name`).toMatchObject([
      {name: 'ada', nickname: null},
    ]);
  });

  test('fails for an unsafe semantic change and recommends draft plus migrate', async () => {
    await using fixture = await createMigrationsFixture('sync-semantic-failure', {
      desiredSchema: `create table person(id integer primary key, name text)`,
    });

    await runSqlStatements(fixture.db, `
      create table person(name text);
      insert into person(name) values ('Ada Lovelace');
    `);

    await expect(fixture.api.sync()).rejects.toMatchInlineSnapshot(`
      [Error: sync could not apply definitions.sql safely to the current database.
      Create a migration with \`sqlfu draft\`, edit it if needed, then run \`sqlfu migrate\`.

      Cause: Cannot add a NOT NULL column with default value NULL]
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
});

async function createMigrationsFixture(
  slug: string,
  input: {
    desiredSchema?: string;
    migrations?: Record<string, string>;
  } = {},
) {
  const root = await createTempFixtureRoot(slug);
  const dbPath = path.join(root, 'dev.db');
  const projectConfig: SqlfuProjectConfig = {
    projectRoot: root,
    db: dbPath,
    migrationsDir: path.join(root, 'migrations'),
    definitionsPath: path.join(root, 'definitions.sql'),
    sqlDir: path.join(root, 'sql'),
    generatedImportExtension: '.js',
  };

  let nowUsage = 0;
  const fakeNow = () => {
    const addHours = nowUsage++;
    return new Date(new Date('2026-04-10T00:00:00.000Z').getTime() + addHours * 60 * 60_000);
  };

  const migrations = Object.fromEntries(
    Object.entries(input.migrations ?? {}).map(([name, content]) => [
      `migrations/${getMigrationPrefix(fakeNow())}_${name}.sql`,
      content,
    ]),
  );

  await writeFixtureFiles(root, {
    'definitions.sql': input.desiredSchema || '',
    ...migrations,
  });

  const api = createRouterClient(router, {
    context: {
      config: projectConfig,
      now: fakeNow,
    },
  });
  const db = createNodeSqliteClient(new DatabaseSync(dbPath));

  return {
    root,
    api,
    db,
    async readFile(relativePath: string) {
      return fs.readFile(path.join(root, relativePath), 'utf8');
    },
    async writeFile(relativePath: string, contents: string) {
      const fullPath = path.join(root, relativePath);
      await fs.mkdir(path.dirname(fullPath), {recursive: true});
      await fs.writeFile(fullPath, contents);
    },
    async globOne(pattern: string) {
      const results = await Array.fromAsync(fs.glob(pattern, {cwd: root}));
      if (results.length !== 1) throw new Error(`expected 1 file for ${pattern}, got ${results.join(',') || 'none'}`);
      return results[0];
    },
    async readMigration(name: string) {
      return this.readFile(await this.globOne(`migrations/*${name}*`));
    },
    async listMigrationFiles() {
      return Array.fromAsync(fs.glob('migrations/*.sql', {cwd: root})).then((files) => files.sort());
    },
    async writeMigration(name: string, content: string) {
      await this.writeFile(`migrations/${getMigrationPrefix(fakeNow())}_${name}.sql`, content);
    },
    async dumpFs() {
      return dumpFixtureFs(root, {ignoredNames: ['dev.db', '.sqlfu']});
    },
    async readMigrationHistory() {
      return readMigrationHistory(dbPath);
    },
    async migrationNames() {
      const history = await this.readMigrationHistory();
      return history.map(m => m.name.split('Z_').pop());
    },
    async [Symbol.asyncDispose]() {
      await fs.rm(root, {recursive: true, force: true});
    },
  };
}

async function createNodeSqliteDatabase(dbPath: string): Promise<DisposableClient> {
  await fs.mkdir(path.dirname(dbPath), {recursive: true});
  const database = new DatabaseSync(dbPath);

  return {
    client: createNodeSqliteClient(database),
    async [Symbol.asyncDispose]() {
      database.close();
    },
  } satisfies DisposableClient;
}

async function readMigrationHistory(dbPath: string) {
  await using database = await createNodeSqliteDatabase(dbPath);
  try {
    return await database.client.all<{name: string; content: string}>({
      sql: `
        select name, content
        from sqlfu_migrations
        order by name
      `,
      args: [],
    });
  } catch (error: unknown) {
    if (String(error).includes('no such table')) {
      return [];
    }
    throw error;
  }
}
