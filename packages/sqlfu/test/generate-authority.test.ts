import BetterSqlite3 from 'better-sqlite3';
import path from 'node:path';
import {expect, test} from 'vitest';

import {applyMigrateSql, autoAcceptConfirm} from '../src/api.js';
import {createBetterSqlite3Client} from '../src/index.js';
import {createNodeHost, openLocalSqliteFile} from '../src/node/host.js';
import {generateQueryTypesForConfig} from '../src/typegen/index.js';
import type {SqlfuAuthority, SqlfuDbFactory, SqlfuProjectConfig} from '../src/types.js';
import {createTempFixtureRoot, writeFixtureFiles} from './fs-fixture.js';

test("authority 'desired_schema' is the default — generate reads definitions.sql with no DB", async () => {
  await using fixture = await createAuthorityFixture({
    definitionsSql: `create table person(name text not null);`,
    migrations: {},
    omitDb: true,
  });

  await generateQueryTypesForConfig(fixture.config);

  expect(fixture.factoryInvocations()).toBe(0);
  expect(await fixture.typegenDbTables()).toEqual(['person']);
});

test("authority 'migrations' replays migration files into a scratch DB, no live DB needed", async () => {
  await using fixture = await createAuthorityFixture({
    authority: 'migrations',
    omitDb: true,
    definitionsSql: `create table person(name text not null);`,
    migrations: {
      '01_init.sql': `create table person(name text not null);`,
      '02_add_pets.sql': `create table pet(name text not null);`,
    },
  });

  await generateQueryTypesForConfig(fixture.config);

  expect(fixture.factoryInvocations()).toBe(0);
  expect(await fixture.typegenDbTables()).toEqual(['person', 'pet']);
});

test("authority 'live_schema' opens the factory-provided DB and extracts its schema", async () => {
  await using fixture = await createAuthorityFixture({
    authority: 'live_schema',
    definitionsSql: `create table person(name text not null);`,
    migrations: {
      '01_init.sql': `create table person(name text not null);`,
    },
  });

  await applyMigrateSql({config: fixture.config, host: fixture.host}, autoAcceptConfirm);

  const invocationsAfterMigrate = fixture.factoryInvocations();
  await generateQueryTypesForConfig(fixture.config);

  expect(fixture.factoryInvocations()).toBeGreaterThan(invocationsAfterMigrate);
  expect(await fixture.typegenDbTables()).toEqual(['person']);
});

test("authority 'migration_history' replays only applied migrations recorded in sqlfu_migrations", async () => {
  await using fixture = await createAuthorityFixture({
    authority: 'migration_history',
    definitionsSql: `create table person(name text not null); create table pet(name text not null);`,
    migrations: {
      '01_init.sql': `create table person(name text not null);`,
      '02_add_pets.sql': `create table pet(name text not null);`,
    },
  });

  await applyMigrateSql({config: fixture.config, host: fixture.host}, autoAcceptConfirm);

  await generateQueryTypesForConfig(fixture.config);
  expect(await fixture.typegenDbTables()).toEqual(['person', 'pet']);

  // delete the second migration file so it's no longer on disk but is still in sqlfu_migrations
  const fs = await import('node:fs/promises');
  await fs.rm(path.join(fixture.root, 'migrations', '02_add_pets.sql'));

  await expect(generateQueryTypesForConfig(fixture.config)).rejects.toThrow(
    /recorded migration "02_add_pets" is missing/,
  );
});

test("authority 'live_schema' without a `db` throws a clear error at generate time", async () => {
  await using fixture = await createAuthorityFixture({
    authority: 'live_schema',
    omitDb: true,
    definitionsSql: `create table person(name text not null);`,
    migrations: {},
  });

  await expect(generateQueryTypesForConfig(fixture.config)).rejects.toThrow(
    /needs a live database.*`db` is not set/,
  );
});

async function createAuthorityFixture(input: {
  authority?: SqlfuAuthority;
  omitDb?: boolean;
  definitionsSql: string;
  migrations: Record<string, string>;
}) {
  const root = await createTempFixtureRoot('generate-authority');
  const dbPath = path.join(root, 'app.db');

  let invocations = 0;
  const db: SqlfuDbFactory = async () => {
    invocations += 1;
    return openLocalSqliteFile(dbPath);
  };

  const config: SqlfuProjectConfig = {
    projectRoot: root,
    db: input.omitDb ? undefined : db,
    migrations: {path: path.join(root, 'migrations'), prefix: 'iso'},
    definitions: path.join(root, 'definitions.sql'),
    queries: path.join(root, 'sql'),
    generate: {
      validator: null,
      prettyErrors: true,
      sync: false,
      importExtension: '.js',
      authority: input.authority ?? 'desired_schema',
    },
  };

  await writeFixtureFiles(root, {
    'definitions.sql': input.definitionsSql,
    'sql/.gitkeep': '',
    ...Object.fromEntries(
      Object.entries(input.migrations).map(([fileName, content]) => [`migrations/${fileName}`, content]),
    ),
  });

  const host = await createNodeHost();

  return {
    root,
    config,
    host,
    factoryInvocations: () => invocations,
    async typegenDbTables(): Promise<string[]> {
      const typegenPath = path.join(root, '.sqlfu', 'typegen.db');
      const database = new BetterSqlite3(typegenPath);
      try {
        const client = createBetterSqlite3Client(database);
        const rows = client.all<{name: string}>({
          sql: `select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by rowid`,
          args: [],
        });
        return rows.map((row) => row.name);
      } finally {
        database.close();
      }
    },
    async [Symbol.asyncDispose]() {
      const fs = await import('node:fs/promises');
      await fs.rm(root, {recursive: true, force: true});
    },
  };
}
