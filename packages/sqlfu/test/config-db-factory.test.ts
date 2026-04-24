import BetterSqlite3 from 'better-sqlite3';
import path from 'node:path';
import {expect, test} from 'vitest';

import {applyMigrateSql, autoAcceptConfirm, getCheckMismatches} from '../src/api.js';
import {createBetterSqlite3Client} from '../src/index.js';
import {createNodeHost, openLocalSqliteFile} from '../src/node/host.js';
import type {SqlfuDbFactory, SqlfuProjectConfig} from '../src/types.js';
import {createTempFixtureRoot, writeFixtureFiles} from './fs-fixture.js';

test('config.db can be a factory — migrate and check operate on the factory-produced client', async () => {
  await using fixture = await createFactoryFixture({
    migrations: {
      '2026-04-01T00.00.00.000Z_create_person.sql': 'create table person(name text not null);',
    },
    definitionsSql: 'create table person(name text not null);',
  });

  await fixture.api.migrate();

  expect(fixture.factoryInvocations()).toBeGreaterThan(0);

  using inspector = fixture.inspectDatabase();
  const rows = inspector.client.all<{name: string}>({
    sql: `select name from sqlite_master where type = 'table' order by name`,
    args: [],
  });
  expect(rows.map((row) => row.name)).toEqual(['person', 'sqlfu_migrations']);

  const mismatches = await getCheckMismatches({config: fixture.config, host: fixture.host});
  expect(mismatches).toEqual([]);
});

test('config.db factory receives a disposal on every openDb call', async () => {
  await using fixture = await createFactoryFixture();

  const invocationsBeforeCheck = fixture.factoryInvocations();
  const disposalsBeforeCheck = fixture.factoryDisposals();

  await getCheckMismatches({config: fixture.config, host: fixture.host});

  expect(fixture.factoryInvocations()).toBeGreaterThan(invocationsBeforeCheck);
  expect(fixture.factoryDisposals()).toBe(fixture.factoryInvocations());
  expect(fixture.factoryDisposals()).toBeGreaterThan(disposalsBeforeCheck);
});

async function createFactoryFixture(
  input: {migrations?: Record<string, string>; definitionsSql?: string} = {},
) {
  const root = await createTempFixtureRoot('config-db-factory');
  const dbPath = path.join(root, 'app.db');

  let invocations = 0;
  let disposals = 0;
  const db: SqlfuDbFactory = async () => {
    invocations += 1;
    const inner = await openLocalSqliteFile(dbPath);
    return {
      client: inner.client,
      async [Symbol.asyncDispose]() {
        disposals += 1;
        await inner[Symbol.asyncDispose]();
      },
    };
  };

  const config: SqlfuProjectConfig = {
    projectRoot: root,
    db,
    migrations: {path: path.join(root, 'migrations'), prefix: 'iso', preset: 'sqlfu'},
    definitions: path.join(root, 'definitions.sql'),
    queries: path.join(root, 'sql'),
    generate: {validator: null, prettyErrors: true, sync: false, importExtension: '.js', authority: 'desired_schema'},
  };

  const host = await createNodeHost();

  await writeFixtureFiles(root, {
    'definitions.sql': input.definitionsSql ?? 'create table person(name text not null);',
    ...Object.fromEntries(
      Object.entries(input.migrations ?? {}).map(([fileName, content]) => [`migrations/${fileName}`, content]),
    ),
  });

  return {
    root,
    config,
    host,
    factoryInvocations: () => invocations,
    factoryDisposals: () => disposals,
    api: {
      async migrate() {
        await applyMigrateSql({config, host}, autoAcceptConfirm);
      },
    },
    inspectDatabase() {
      const database = new BetterSqlite3(dbPath);
      return {
        client: createBetterSqlite3Client(database),
        [Symbol.dispose]() {
          database.close();
        },
      };
    },
    async [Symbol.asyncDispose]() {
      const fs = await import('node:fs/promises');
      await fs.rm(root, {recursive: true, force: true});
    },
  };
}
