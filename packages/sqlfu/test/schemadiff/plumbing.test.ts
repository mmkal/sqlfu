import {expect, test} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

import {createNodeSqliteClient} from '../../src/client.js';
import {createNodeHost, createAsyncNodeSqliteClient} from '../../src/core/node-host.js';
import {extractSchema} from '../../src/core/sqlite.js';
import {applyMigrations} from '../../src/migrations/index.js';
import {diffSchemaSql} from '../../src/schemadiff/index.js';
import {parseSchemadiffFixture, runFixtureCase} from './fixture-helpers.js';

const sharedHost = await createNodeHost();

test('the goto shape works when destructive drops are explicitly enabled', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-old-goto-'));
  const liveDbPath = path.join(root, 'live.db');
  const targetDbPath = path.join(root, 'target.db');

  const liveDb = new DatabaseSync(liveDbPath);
  const targetDb = new DatabaseSync(targetDbPath);

  try {
    const liveClient = createNodeSqliteClient(liveDb);
    const targetClient = createNodeSqliteClient(targetDb);

    await liveClient.raw(`
      create table person(name text not null);
      create table pet(name text not null);
      create table toy(name text not null);
    `);

    await applyMigrations(sharedHost, createAsyncNodeSqliteClient(targetDb), {
      migrations: [
        {
          path: '2026-04-10T00.00.00.000Z_create_person.sql',
          content: 'create table person(name text not null);\n',
        },
      ],
    });

    const diff = await diffSchemaSql(sharedHost, {
      baselineSql: await extractSchema(liveClient, 'main', {excludedTables: ['sqlfu_migrations']}),
      desiredSql: await extractSchema(targetClient, 'main', {excludedTables: ['sqlfu_migrations']}),
      allowDestructive: true,
    });

    expect(diff).toMatchInlineSnapshot(`
      [
        "drop table pet;",
        "drop table toy;",
      ]
    `);

    await liveClient.raw(diff.join('\n'));

    expect(await extractSchema(liveClient, 'main', {excludedTables: ['sqlfu_migrations']})).toBe('create table person(name text not null);');
  } finally {
    liveDb.close();
    targetDb.close();
    await fs.rm(root, {recursive: true, force: true});
  }
});

test('diffSchemaSql rebuilds a table when sqlite needs semantic constraint changes while preserving data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-schemadiff-rebuild-'));
  const liveDbPath = path.join(root, 'live.db');
  const targetDbPath = path.join(root, 'target.db');

  const liveDb = new DatabaseSync(liveDbPath);
  const targetDb = new DatabaseSync(targetDbPath);

  try {
    const liveClient = createNodeSqliteClient(liveDb);
    const targetClient = createNodeSqliteClient(targetDb);

    await liveClient.raw(`
      create table a(b text);
      insert into a(b) values ('alpha');
    `);
    await targetClient.raw(`create table a(b text not null unique);`);

    const diff = await diffSchemaSql(sharedHost, {
      baselineSql: await extractSchema(liveClient),
      desiredSql: await extractSchema(targetClient),
      allowDestructive: true,
    });

    expect(diff).not.toEqual([]);

    await liveClient.raw(diff.join('\n'));

    expect(await extractSchema(liveClient)).toBe(await extractSchema(targetClient));
    await expect(liveClient.sql`select b from a`).resolves.toMatchObject([{b: 'alpha'}]);
  } finally {
    liveDb.close();
    targetDb.close();
    await fs.rm(root, {recursive: true, force: true});
  }
});

const migraEquivalentFixturePath = path.join(import.meta.dirname, 'fixtures', 'migra-equivalents.sql');
const migraEquivalentFixtureCases = parseSchemadiffFixture(await fs.readFile(migraEquivalentFixturePath, 'utf8'));

for (const fixtureCase of migraEquivalentFixtureCases) {
  test(`${fixtureCase.name} can be applied to reach the desired schema`, async () => {
    const diffSql = await runFixtureCase(fixtureCase);
    const diffLines = diffSql ? diffSql.split('\n') : [];

    const root = await fs.mkdtemp(path.join(os.tmpdir(), `sqlfu-schemadiff-${fixtureCase.name.replaceAll(/\W+/g, '-')}-`));
    const baselineDbPath = path.join(root, 'baseline.db');
    const desiredDbPath = path.join(root, 'desired.db');
    const baselineDb = new DatabaseSync(baselineDbPath);
    const desiredDb = new DatabaseSync(desiredDbPath);

    try {
      const baselineClient = createNodeSqliteClient(baselineDb);
      const desiredClient = createNodeSqliteClient(desiredDb);

      if (fixtureCase.baselineSql.trim()) {
        await baselineClient.raw(fixtureCase.baselineSql);
      }

      if (fixtureCase.desiredSql.trim()) {
        await desiredClient.raw(fixtureCase.desiredSql);
      }

      if (diffLines.length > 0) {
        await baselineClient.raw(diffLines.join('\n'));
      }

      const [baselineSchema, desiredSchema] = await Promise.all([
        extractSchema(baselineClient),
        extractSchema(desiredClient),
      ]);

      const [baselineToDesired, desiredToBaseline] = await Promise.all([
        diffSchemaSql(sharedHost, {
          baselineSql: baselineSchema,
          desiredSql: desiredSchema,
          allowDestructive: true,
        }),
        diffSchemaSql(sharedHost, {
          baselineSql: desiredSchema,
          desiredSql: baselineSchema,
          allowDestructive: true,
        }),
      ]);

      expect(baselineToDesired).toEqual([]);
      expect(desiredToBaseline).toEqual([]);
    } finally {
      baselineDb.close();
      desiredDb.close();
      await fs.rm(root, {recursive: true, force: true});
    }
  });
}
