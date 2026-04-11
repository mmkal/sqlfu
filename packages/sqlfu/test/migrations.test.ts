import dedent from 'dedent';
import fs from 'node:fs/promises';
import path from 'node:path';

import {createClient} from '@libsql/client';
import {createRouterClient} from '@orpc/server';
import {expect, test} from 'vitest';

import {getMigrationPrefix, router} from '../src/api.js';
import {createLibsqlClient} from '../src/client.js';
import {extractSchema, runSqlStatements} from '../src/core/sqlite.js';
import type {Client, SqlfuProjectConfig} from '../src/core/types.js';
import {createTempFixtureRoot, dumpFixtureFs, withTrailingNewline, writeFixtureFiles} from './fs-fixture.js';

type DisposableClient = {
  readonly client: Client;
  [Symbol.asyncDispose](): Promise<void>;
};

test('draft creates the first draft migration from definitions.sql when there is no migration history yet', async () => {
  await using fixture = await createMigrationsFixture('first-draft-from-empty-history', {
    definitionsSql: dedent`
      create table person(name text not null);
    `,
  });

  await fixture.client.draft({name: 'create_person'});

  expect(await fixture.dumpFs()).toMatchInlineSnapshot(`
    "definitions.sql
      create table person(name text not null);
    migrations/
      2026-04-10T00.00.00.000Z_create_person.sql
        -- status: draft
        create table person(name text not null);
    "
  `);
});

test('finalize validates the draft and flips only the metadata line in place', async () => {
  await using fixture = await createMigrationsFixture('finalize-in-place', {
    definitionsSql: dedent`
      create table person(name text not null);
    `,
    migrations: {
      create_person: dedent`
        -- status: draft
        create table person(name text not null);
      `,
    },
  });

  await fixture.client.finalize();

  expect(await fixture.dumpFs()).toMatchInlineSnapshot(`
    "definitions.sql
      create table person(name text not null);
    migrations/
      2026-04-10T00.00.00.000Z_create_person.sql
        -- status: final
        create table person(name text not null);
    "
  `);
});

test('draft appends new generated SQL to the existing draft without discarding manual edits', async () => {
  await using fixture = await createMigrationsFixture('append-to-existing-draft', {
    definitionsSql: dedent`
      create table person(name text not null);
      create table pet(name text not null);
      create index pet_name_idx on pet(name);
    `,
    migrations: {
      create_person: dedent`
        -- status: final
        create table person(name text not null);
      `,
      add_pet: dedent`
        -- status: draft
        create table pet(name text not null);
        insert into pet(name) values ('spot');
      `,
    },
  });

  await fixture.client.draft();

  expect(await fixture.dumpFs()).toMatchInlineSnapshot(`
    "definitions.sql
      create table person(name text not null);
      create table pet(name text not null);
      create index pet_name_idx on pet(name);
    migrations/
      2026-04-10T00.00.00.000Z_create_person.sql
        -- status: final
        create table person(name text not null);
      2026-04-10T01.00.00.000Z_add_pet.sql
        -- status: draft
        create table pet(name text not null);
        insert into pet(name) values ('spot');
        
        create index pet_name_idx on pet(name);
    "
  `);
});

test('draft is a no-op when the existing draft already matches definitions.sql', async () => {
  await using fixture = await createMigrationsFixture('draft-no-op', {
    definitionsSql: dedent`
      create table person(name text not null);
      create table pet(name text not null);
    `,
    migrations: {
      create_person: dedent`
        -- status: final
        create table person(name text not null);
      `,
      add_pet: dedent`
        -- status: draft
        create table pet(name text not null);
      `,
    },
  });

  const before = await fixture.readMigration('add_pet');

  await fixture.client.draft();

  expect(await fixture.readMigration('add_pet')).toBe(before);
});

test('draft fails when the existing draft cannot be replayed', async () => {
  await using fixture = await createMigrationsFixture('broken-draft', {
    definitionsSql: dedent`
      create table person(name text not null);
      create table pet(name text not null);
      create index pet_name_idx on pet(name);
    `,
    migrations: {
      create_person: dedent`
        -- status: final
        create table person(name text not null);
      `,
      add_pet: dedent`
        -- status: draft
        create table pet(name text not null);
        this is not valid sql;
      `,
    },
  });

  await expect(fixture.client.draft()).rejects.toMatchInlineSnapshot(`[Error: near "this": syntax error]`);
});

test('draft fails when migration metadata is malformed', async () => {
  await using fixture = await createMigrationsFixture('malformed-metadata', {
    definitionsSql: dedent`
      create table person(name text not null);
    `,
    migrations: {
      create_person: dedent`
        create table person(name text not null);
      `,
    },
  });

  await expect(fixture.client.draft()).rejects.toMatchInlineSnapshot(
    `[Error: migration metadata (looking like "-- status: final") must be on the first line]`,
  );
});

test('draft fails when migration status metadata is invalid', async () => {
  await using fixture = await createMigrationsFixture('invalid-status-metadata', {
    definitionsSql: dedent`
      create table person(name text not null);
    `,
    migrations: {
      create_person: dedent`
        -- status: maybe
        create table person(name text not null);
      `,
    },
  });

  await expect(fixture.client.draft()).rejects.toMatchInlineSnapshot(
    `[Error: migration metadata must include status: draft|final on the first line]`,
  );
});

test('draft fails when multiple draft migrations exist', async () => {
  await using fixture = await createMigrationsFixture('multiple-drafts', {
    definitionsSql: dedent`
      create table person(name text not null);
      create table pet(name text not null);
      create table toy(name text not null);
    `,
    migrations: {
      create_person: dedent`
        -- status: final
        create table person(name text not null);
      `,
      add_pet: dedent`
        -- status: draft
        create table pet(name text not null);
      `,
      add_toy: dedent`
        -- status: draft
        create table toy(name text not null);
      `,
    },
  });

  await expect(fixture.client.draft()).rejects.toMatchInlineSnapshot(`[Error: multiple draft migrations exist]`);
});

test('migrate requires explicit includeDraft while a draft exists and can include it when requested', async () => {
  await using fixture = await createMigrationsFixture('migrate-include-draft', {
    definitionsSql: dedent`
      create table person(name text not null);
      create table pet(name text not null);
    `,
    migrations: {
      create_person: dedent`
        -- status: final
        create table person(name text not null);
      `,
      add_pet: dedent`
        -- status: draft
        create table pet(name text not null);
      `,
    },
  });

  await expect(fixture.client.migrate({includeDraft: false})).rejects.toMatchInlineSnapshot(
    `[Error: draft migration exists]`,
  );
  expect(await fixture.dumpDbSchema()).toBe('');

  await fixture.client.migrate({includeDraft: true});

  expect(await fixture.dumpDbSchema()).toMatchInlineSnapshot(`
    "create table person(name text not null);
    create table pet(name text not null);"
  `);
});

test('migrate applies only newly added finalized migrations on the second run', async () => {
  await using fixture = await createMigrationsFixture('migrate-replays-without-migrations-table');

  await fixture.writeMigration('add_person', dedent`
    -- status: final
    create table person(name text not null);
  `);

  await fixture.client.migrate();

  await fixture.writeMigration('add_pet', dedent`
    -- status: final
    create table pet(name text not null, species text not null);
  `);

  await fixture.client.migrate();

  expect(await fixture.dumpDbSchema()).toMatchInlineSnapshot(`
    "create table person(name text not null);
    create table pet(name text not null, species text not null);"
  `);
});

test('sync applies definitions.sql into an empty database', async () => {
  await using fixture = await createMigrationsFixture('sync-empty-db', {
    definitionsSql: dedent`
      create table person(name text not null);
      create table pet(name text not null);
    `,
  });

  await fixture.client.sync();

  expect(await fixture.dumpDbSchema()).toMatchInlineSnapshot(`
    "create table person(name text not null);
    create table pet(name text not null);"
  `);
});

test('sync applies a safe additive change to a populated database', async () => {
  await using fixture = await createMigrationsFixture('sync-additive-change', {
    definitionsSql: dedent`
      create table person(name text not null, nickname text);
    `,
  });

  await fixture.writeDbSql(`
    create table person(name text not null);
    insert into person(name) values ('ada');
  `);

  await fixture.client.sync();

  expect(await fixture.dumpDbSchema()).toMatchInlineSnapshot(`
    "create table person(name text not null, "nickname" text);"
  `);
});

test('sync fails for a semantic/destructive transition that needs a real migration', async () => {
  await using fixture = await createMigrationsFixture('sync-semantic-failure', {
    definitionsSql: dedent`
      create table person(firstname text not null, lastname text not null);
    `,
  });

  await fixture.writeDbSql(`
    create table person(name text not null);
    insert into person(name) values ('Ada Lovelace');
  `);

  await expect(fixture.client.sync()).rejects.toMatchInlineSnapshot(`
    [Error: sync could not apply definitions.sql safely to the current database.
    Create or update a draft migration and test it with \`sqlfu migrate --include-draft\`.

    Cause: Cannot add a NOT NULL column with default value NULL]
  `);
});

test('draft can rewrite the existing draft in place', async () => {
  await using fixture = await createMigrationsFixture('draft-rewrite', {
    definitionsSql: dedent`
      create table person(name text not null);
      create table pet(name text not null);
      create index pet_name_idx on pet(name);
    `,
    migrations: {
      create_person: dedent`
        -- status: final
        create table person(name text not null);
      `,
      add_pet: dedent`
        -- status: draft
        create table pet(name text not null);
        insert into pet(name) values ('spot');
      `,
    },
  });

  await fixture.client.draft({name: 'ignored_by_rewrite', rewrite: true});

  expect(await fixture.dumpFs()).toMatchInlineSnapshot(`
    "definitions.sql
      create table person(name text not null);
      create table pet(name text not null);
      create index pet_name_idx on pet(name);
    migrations/
      2026-04-10T00.00.00.000Z_create_person.sql
        -- status: final
        create table person(name text not null);
      2026-04-10T01.00.00.000Z_add_pet.sql
        -- status: draft
        create table pet(name text not null);
        create index pet_name_idx on pet(name);
    "
  `);
});

test('draft fails when the draft migration is not lexically last', async () => {
  await using fixture = await createMigrationsFixture('draft-not-last', {
    definitionsSql: dedent`
      create table person(name text not null);
      create table pet(name text not null);
      create table toy(name text not null);
    `,
    migrations: {
      create_person: dedent`
        -- status: final
        create table person(name text not null);
      `,
      add_pet: dedent`
        -- status: draft
        create table pet(name text not null);
      `,
      add_toy: dedent`
        -- status: final
        create table toy(name text not null);
      `,
    },
  });

  await expect(fixture.client.draft()).rejects.toMatchInlineSnapshot(
    `[Error: draft migration must be lexically last; rerun with bumpTimestamp: true]`,
  );
});

test('draft can bump the existing draft timestamp to restore ordering', async () => {
  await using fixture = await createMigrationsFixture('draft-bump-timestamp', {
    definitionsSql: dedent`
      create table person(name text not null);
      create table pet(name text not null);
      create table toy(name text not null);
    `,
    migrations: {
      create_person: dedent`
        -- status: final
        create table person(name text not null);
      `,
      add_pet: dedent`
        -- status: draft
        create table pet(name text not null);
      `,
      add_toy: dedent`
        -- status: final
        create table toy(name text not null);
      `,
    },
  });

  await fixture.client.draft({bumpTimestamp: true});

  expect(await fixture.dumpFs()).toMatchInlineSnapshot(`
    "definitions.sql
      create table person(name text not null);
      create table pet(name text not null);
      create table toy(name text not null);
    migrations/
      2026-04-10T00.00.00.000Z_create_person.sql
        -- status: final
        create table person(name text not null);
      2026-04-10T02.00.00.000Z_add_toy.sql
        -- status: final
        create table toy(name text not null);
      2026-04-10T03.00.00.000Z_add_pet.sql
        -- status: draft
        create table pet(name text not null);
    "
  `);
});

test('check.all throws when a draft is the only remaining blocker', async () => {
  await using fixture = await createMigrationsFixture('check-ready-to-finalize', {
    definitionsSql: dedent`
      create table person(name text not null);
      create table pet(name text not null);
    `,
    migrations: {
      create_person: dedent`
        -- status: final
        create table person(name text not null);
      `,
      add_pet: dedent`
        -- status: draft
        create table pet(name text not null);
      `,
    },
  });

  await expect(fixture.client.check.all()).rejects.toMatchInlineSnapshot(`[Error: draft migration exists]`);
});

test('check.migrationsMatchDefinitions throws a replay failure when migrations cannot be replayed', async () => {
  await using fixture = await createMigrationsFixture('check-replay-failure', {
    definitionsSql: dedent`
      create table person(name text not null);
      create table pet(name text not null);
    `,
    migrations: {
      create_person: dedent`
        -- status: final
        create table person(name text not null);
      `,
      add_pet: dedent`
        -- status: draft
        this is not valid sql;
      `,
    },
  });

  await expect(fixture.client.check.migrationsMatchDefinitions()).rejects.toMatchInlineSnapshot(
    `[Error: migration replay failed: near "this": syntax error]`,
  );
});

test('check.migrationsMatchDefinitions throws a schema mismatch when replay succeeds but definitions differ', async () => {
  await using fixture = await createMigrationsFixture('check-schema-mismatch', {
    definitionsSql: dedent`
      create table person(name text not null);
      create table pet(name text not null);
    `,
    migrations: {
      create_person: dedent`
        -- status: final
        create table person(name text not null);
      `,
    },
  });

  await expect(fixture.client.check.migrationsMatchDefinitions()).rejects.toMatchInlineSnapshot(
    `[Error: replayed migrations do not match definitions.sql]`,
  );
});

test('finalize fails when replay succeeds but the resulting schema still differs from definitions.sql', async () => {
  await using fixture = await createMigrationsFixture('finalize-mismatch', {
    definitionsSql: dedent`
      create table person(name text not null);
      create table pet(name text not null);
      create index pet_name_idx on pet(name);
    `,
    migrations: {
      create_person: dedent`
        -- status: final
        create table person(name text not null);
      `,
      add_pet: dedent`
        -- status: draft
        create table pet(name text not null);
      `,
    },
  });

  await expect(fixture.client.finalize()).rejects.toMatchInlineSnapshot(
    `[Error: draft migration does not match definitions.sql]`,
  );
});

test('check.noDraft succeeds when no draft exists', async () => {
  await using fixture = await createMigrationsFixture('check-one-subcheck', {
    definitionsSql: dedent`
      create table person(name text not null);
    `,
    migrations: {
      create_person: dedent`
        -- status: final
        create table person(name text not null);
      `,
    },
  });

  await expect(fixture.client.check.noDraft()).resolves.toBeUndefined();
});

test('check.migrationMetadata throws when status metadata is invalid', async () => {
  await using fixture = await createMigrationsFixture('check-invalid-status', {
    definitionsSql: dedent`
      create table person(name text not null);
    `,
    migrations: {
      create_person: dedent`
        -- status: maybe
        create table person(name text not null);
      `,
    },
  });

  await expect(fixture.client.check.migrationMetadata()).rejects.toMatchInlineSnapshot(
    `[Error: migration metadata must include status: draft|final on the first line]`,
  );
});

test('check.draftIsLast throws when the draft is not lexically last', async () => {
  await using fixture = await createMigrationsFixture('check-draft-not-last', {
    definitionsSql: dedent`
      create table person(name text not null);
      create table pet(name text not null);
      create table toy(name text not null);
    `,
    migrations: {
      add_pet: dedent`
        -- status: final
        create table person(name text not null);
      `,
      add_toy: dedent`
        -- status: draft
        create table pet(name text not null);
      `,
      create_person: dedent`
        -- status: final
        create table toy(name text not null);
      `,
    },
  });

  await expect(fixture.client.check.draftIsLast()).rejects.toMatchInlineSnapshot(
    `[Error: draft migration must be lexically last]`,
  );
});

test('check.draftCount throws when multiple drafts exist', async () => {
  await using fixture = await createMigrationsFixture('check-multiple-drafts', {
    definitionsSql: dedent`
      create table person(name text not null);
      create table pet(name text not null);
      create table toy(name text not null);
    `,
    migrations: {
      add_pet: dedent`
        -- status: final
        create table person(name text not null);
      `,
      add_toy: dedent`
        -- status: draft
        create table pet(name text not null);
      `,
      create_person: dedent`
        -- status: draft
        create table toy(name text not null);
      `,
    },
  });

  await expect(fixture.client.check.draftCount()).rejects.toMatchInlineSnapshot(
    `[Error: multiple draft migrations exist]`,
  );
});

test('check.all joins multiple failures together', async () => {
  await using fixture = await createMigrationsFixture('check-multiple-failures', {
    definitionsSql: dedent`
      create table person(name text not null);
      create table pet(name text not null);
      create table toy(name text not null);
    `,
    migrations: {
      add_pet: dedent`
        -- status: final
        create table person(name text not null);
      `,
      add_toy: dedent`
        -- status: draft
        create table pet(name text not null);
      `,
      create_person: dedent`
        -- status: draft
        create table toy(name text not null);
      `,
    },
  });

  await expect(fixture.client.check.all()).rejects.toMatchInlineSnapshot(`
    [Error: multiple draft migrations exist
    draft migration must be lexically last
    draft migration exists]
  `);
});

async function createMigrationsFixture(
  slug: string,
  input: {
    definitionsSql?: string;
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
    const addHours = nowUsage++
    return new Date(new Date(`2026-04-10T00:00:00.000Z`).getTime() + addHours * 60 * 60_000)
  }

  const migrations = Object.fromEntries(
    Object.entries(input.migrations ?? {}).map(([name, content]) => [
      `migrations/${getMigrationPrefix(fakeNow())}_${name}.sql`,
      content,
    ]),
  );

  await writeFixtureFiles(root, {
    'definitions.sql': input.definitionsSql || '',
    ...migrations,
  });

  const client = createRouterClient(router, {
    context: {
      config: projectConfig,
      now: fakeNow,
    },
  });

  return {
    root,
    projectConfig,
    client,
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
    async writeMigration(name: string, content: string) {
      await this.writeFile(`migrations/${getMigrationPrefix(fakeNow())}_${name}.sql`, content);
    },
    async dumpFs() {
      return dumpFixtureFs(root, {ignoredNames: ['dev.db', '.sqlfu']});
    },
    async dumpDbSchema() {
      return exportDatabaseSchema(dbPath);
    },
    async writeDbSql(sql: string) {
      await executeDatabaseSql(dbPath, sql);
    },
    async [Symbol.asyncDispose]() {
      await fs.rm(root, {recursive: true, force: true});
    },
  };
}

async function createLibsqlDatabase(dbPath: string): Promise<DisposableClient> {
  await fs.mkdir(path.dirname(dbPath), {recursive: true});
  const client = createClient({url: `file:${dbPath}`});
  const sqlfuClient = createLibsqlClient(client);

  return {
    client: sqlfuClient,
    async [Symbol.asyncDispose]() {
      client.close();
    },
  } satisfies DisposableClient;
}

async function exportDatabaseSchema(dbPath: string) {
  await using database = await createLibsqlDatabase(dbPath);
  return extractSchema(database.client);
}

async function executeDatabaseSql(dbPath: string, sql: string) {
  await using database = await createLibsqlDatabase(dbPath);
  await runSqlStatements(database.client, dedent(sql));
}
