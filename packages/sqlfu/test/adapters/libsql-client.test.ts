import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {createClient} from '@libsql/client';
import {expect, test} from 'vitest';

import {createLibsqlClient} from '../../src/client.js';

test('createLibsqlClient works with a real @libsql/client database', async () => {
  await using fixture = await createLibsqlFixture(createClient({url: getTmpDbUrl()}));
  await fixture.client.sql.run`create table users (id integer primary key, email text not null)`;

  await fixture.client.sql.run`insert into users (email) values (${'ada@example.com'}), (${'grace@example.com'})`;

  expect(
    await fixture.client.all<{id: number; email: string}>({
      sql: 'select id, email from users where email = ?',
      args: ['ada@example.com'],
    }),
  ).toMatchObject([{id: 1, email: 'ada@example.com'}]);

  expect(await fixture.client.sql<{id: number; email: string}>`select id, email from users order by id`).toMatchObject([
    {id: 1, email: 'ada@example.com'},
    {id: 2, email: 'grace@example.com'},
  ]);

  const writeResult = await fixture.client.sql.run`insert into users (email) values (${'lin@example.com'})`;
  expect(writeResult.rowsAffected).toBe(1);
  expect(typeof writeResult.lastInsertRowid).toMatch(/^(bigint|number|string)$/);

  expect(
    await fixture.client.all<{id: number; email: string}>({
      sql: 'select id, email from users where email = ?',
      args: ['lin@example.com'],
    }),
  ).toMatchObject([{id: 3, email: 'lin@example.com'}]);
});

test('createLibsqlClient turns real sqlite syntax errors into promise rejections for tagged sql', async () => {
  await using fixture = await createLibsqlFixture(createClient({url: getTmpDbUrl()}));
  await fixture.client.sql.run`create table users (id integer primary key, email text not null)`;

  await expect(fixture.client.sql`selectTYPO from users`.catch(String)).resolves.toContain('syntax error');
});

test('createLibsqlClient iterates rows', async () => {
  await using fixture = await createLibsqlFixture(createClient({url: getTmpDbUrl()}));
  await fixture.client.sql.run`create table users (id integer primary key, email text not null)`;
  await fixture.client.sql.run`insert into users (email) values (${'ada@example.com'}), (${'grace@example.com'})`;

  const rows = [];
  for await (const row of fixture.client.iterate<{id: number; email: string}>({
    sql: 'select id, email from users order by id',
    args: [],
  })) {
    rows.push(row);
  }

  expect(rows).toMatchObject([
    {id: 1, email: 'ada@example.com'},
    {id: 2, email: 'grace@example.com'},
  ]);
});

test('createLibsqlClient.raw runs multiple statements', async () => {
  await using fixture = await createLibsqlFixture(createClient({url: getTmpDbUrl()}));

  await fixture.client.raw(`
    create table users (id integer primary key, email text not null);
    insert into users (email) values ('ada@example.com');
    insert into users (email) values ('grace@example.com');
  `);

  expect(await fixture.client.sql.all<{email: string}>`select email from users order by email`).toMatchObject([
    {email: 'ada@example.com'},
    {email: 'grace@example.com'},
  ]);
});

async function createLibsqlFixture(raw: ReturnType<typeof createClient>) {
  const dbPath = await getDbPath(raw);
  return {
    client: createLibsqlClient(raw),
    async [Symbol.asyncDispose]() {
      raw.close();
      await fs.rm(dbPath, {force: true});
    },
  };
}

function getTmpDbUrl() {
  const dbPath = path.join(
    os.tmpdir(),
    `sqlfu-libsql-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  );
  return `file:${dbPath}`;
}

async function getDbPath(raw: ReturnType<typeof createClient>) {
  const result = await raw.execute('pragma database_list');
  const row = result.rows[0] as {file?: string} | undefined;
  if (!row?.file) throw new Error('expected pragma database_list to return the backing file path');
  return row.file;
}
