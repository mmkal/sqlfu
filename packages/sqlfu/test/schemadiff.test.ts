import {expect, test} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

import {createNodeSqliteClient} from '../src/client.js';
import {extractSchema} from '../src/core/sqlite.js';
import {applyMigrations} from '../src/migrations/index.js';
import {diffSchemaSql} from '../src/schemadiff/index.js';

test('diffSchemaSql includes a drop when destructive changes are allowed', async () => {
  const diff = await diffSchemaSql({
    projectRoot: process.cwd(),
    baselineSql: `
      create table a(x int);
      create table b(x int);
    `,
    desiredSql: `
      create table a(x int);
    `,
    allowDestructive: true,
  });

  expect(diff).toMatchInlineSnapshot(`
    [
      "DROP TABLE \"b\";",
    ]
  `);
});

test('diffSchemaSql still includes drops when the target schema also contains sqlfu_migrations', async () => {
  const diff = await diffSchemaSql({
    projectRoot: process.cwd(),
    baselineSql: `
      create table person(name text not null);
      create table pet(name text not null);
      create table toy(name text not null);
    `,
    desiredSql: `
      create table person(name text not null);
      create table sqlfu_migrations(
        name text primary key check(name not like '%.sql'),
        content text not null,
        applied_at text not null
      );
    `,
    allowDestructive: true,
  });

  expect(diff).toMatchInlineSnapshot(`
    [
      "create table sqlfu_migrations(",
      "name text primary key check(name not like '%.sql'),",
      "content text not null,",
      "applied_at text not null",
      ");",
      "DROP TABLE \"pet\";",
      "DROP TABLE \"toy\";",
    ]
  `);
});

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

    await applyMigrations(targetClient, {
      migrations: [
        {
          path: '2026-04-10T00.00.00.000Z_create_person.sql',
          content: 'create table person(name text not null);\n',
        },
      ],
    });

    const diff = await diffSchemaSql({
      projectRoot: process.cwd(),
      baselineSql: await extractSchema(liveClient),
      desiredSql: await extractSchema(targetClient),
      allowDestructive: true,
    });

    expect(diff).toMatchInlineSnapshot(`
      [
        "DROP TABLE \"pet\";",
        "DROP TABLE \"toy\";",
      ]
    `);

    await liveClient.raw(diff.join('\n'));

    expect(await extractSchema(liveClient)).toBe('create table person(name text not null);');
  } finally {
    liveDb.close();
    targetDb.close();
    await fs.rm(root, {recursive: true, force: true});
  }
});
