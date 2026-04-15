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
      "drop table \"b\";",
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
      "drop table \"pet\";",
      "drop table \"toy\";",
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
        "drop table \"pet\";",
        "drop table \"toy\";",
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

test('diffSchemaSql rebuilds a table when sqlite needs semantic constraint changes', async () => {
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

    const diff = await diffSchemaSql({
      projectRoot: process.cwd(),
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

test('diffSchemaSql creates a sqlite trigger when it is added', async () => {
  const diff = await diffSchemaSql({
    projectRoot: process.cwd(),
    baselineSql: `
      create table person(name text);
      create table audit_log(name text);
    `,
    desiredSql: `
      create table person(name text);
      create table audit_log(name text);
      create trigger person_insert_log after insert on person begin
        insert into audit_log(name) values (new.name);
      end;
    `,
    allowDestructive: true,
  });

  expect(diff).toMatchInlineSnapshot(`
    [
      "create trigger person_insert_log after insert on person begin",
      "insert into audit_log(name) values (new.name);",
      "end;",
    ]
  `);
});

test('diffSchemaSql recreates a sqlite trigger when its body changes', async () => {
  const diff = await diffSchemaSql({
    projectRoot: process.cwd(),
    baselineSql: `
      create table person(name text);
      create table audit_log(name text);
      create trigger person_insert_log after insert on person begin
        insert into audit_log(name) values (new.name);
      end;
    `,
    desiredSql: `
      create table person(name text);
      create table audit_log(name text);
      create trigger person_insert_log after insert on person begin
        insert into audit_log(name) values ('prefix:' || new.name);
      end;
    `,
    allowDestructive: true,
  });

  expect(diff).toMatchInlineSnapshot(`
    [
      "drop trigger "person_insert_log";",
      "create trigger person_insert_log after insert on person begin",
      "insert into audit_log(name) values ('prefix:' || new.name);",
      "end;",
    ]
  `);
});

test('diffSchemaSql rebuilds a table when sqlite column collations change', async () => {
  const diff = await diffSchemaSql({
    projectRoot: process.cwd(),
    baselineSql: `create table person(name text collate nocase);`,
    desiredSql: `create table person(name text collate rtrim, nickname text collate rtrim);`,
    allowDestructive: true,
  });

  expect(diff).toMatchInlineSnapshot(`
    [
      "alter table person rename to __sqlfu_old_person;",
      "create table person(name text collate rtrim, nickname text collate rtrim);",
      "insert into person("name") select "name" from __sqlfu_old_person;",
      "drop table __sqlfu_old_person;",
    ]
  `);
});
