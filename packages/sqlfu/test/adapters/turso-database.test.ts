import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {connect} from '@tursodatabase/database';
import {expect, test} from 'vitest';

import {createTursoDatabaseClient} from '../../src/client.js';

test('createTursoDatabaseClient works with a real @tursodatabase/database database', async () => {
  await using fixture = await createFixture();
  await fixture.client.sql.run`create table users (id integer primary key, email text not null)`;

  await fixture.client.sql.run`insert into users (email) values (${'ada@example.com'}), (${'grace@example.com'})`;

  expect(
    await fixture.client.all<{id: number; email: string}>({
      sql: 'select id, email from users where email = ?',
      args: ['ada@example.com'],
    }),
  ).toMatchObject([{id: 1, email: 'ada@example.com'}]);

  expect(
    await fixture.client.sql<{id: number; email: string}>`select id, email from users order by id`,
  ).toMatchObject([
    {id: 1, email: 'ada@example.com'},
    {id: 2, email: 'grace@example.com'},
  ]);

  const writeResult = await fixture.client.sql.run`insert into users (email) values (${'lin@example.com'})`;
  expect(writeResult.rowsAffected).toBe(1);
  expect(typeof writeResult.lastInsertRowid).toMatch(/^(bigint|number|string)$/);
});

test('createTursoDatabaseClient turns sqlite syntax errors into promise rejections', async () => {
  await using fixture = await createFixture();
  await fixture.client.sql.run`create table users (id integer primary key, email text not null)`;

  await expect(fixture.client.sql`selectTYPO from users`.catch(String)).resolves.toMatch(
    /syntax error|SQLITE_ERROR|unexpected token|SqliteError/,
  );
});

test('createTursoDatabaseClient iterates rows', async () => {
  await using fixture = await createFixture();
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

test('createTursoDatabaseClient.raw runs multiple statements', async () => {
  await using fixture = await createFixture();

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

test('createTursoDatabaseClient transaction commits and rolls back', async () => {
  await using fixture = await createFixture();
  await fixture.client.sql.run`create table counters (id integer primary key, n integer not null)`;
  await fixture.client.sql.run`insert into counters (id, n) values (1, 0)`;

  await fixture.client.transaction(async (tx) => {
    await tx.sql.run`update counters set n = n + 1 where id = 1`;
    await tx.sql.run`update counters set n = n + 1 where id = 1`;
  });

  expect(await fixture.client.sql<{n: number}>`select n from counters where id = 1`).toMatchObject([{n: 2}]);

  await expect(
    fixture.client.transaction(async (tx) => {
      await tx.sql.run`update counters set n = n + 10 where id = 1`;
      throw new Error('boom');
    }),
  ).rejects.toThrow('boom');

  expect(await fixture.client.sql<{n: number}>`select n from counters where id = 1`).toMatchObject([{n: 2}]);
});

async function createFixture() {
  const dbPath = path.join(
    os.tmpdir(),
    `sqlfu-turso-database-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  );
  const db = await connect(dbPath);
  return {
    client: createTursoDatabaseClient(db),
    async [Symbol.asyncDispose]() {
      await db.close();
      await fs.rm(dbPath, {force: true});
    },
  };
}
