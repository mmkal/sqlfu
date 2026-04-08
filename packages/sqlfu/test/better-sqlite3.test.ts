import BetterSqlite3 from 'better-sqlite3';
import {expect, test} from 'vitest';

import {createBetterSqlite3Client} from '../src/client.js';

test('createBetterSqlite3Client works with a real better-sqlite3 database', async () => {
  using fixture = createBetterSqlite3Fixture(new BetterSqlite3(':memory:'));
  fixture.client.sql.exec`create table users (id integer primary key, email text not null)`;

  fixture.client.sql.exec`insert into users (email) values (${'ada@example.com'})`;
  fixture.client.sql.exec`insert into users (email) values (${'grace@example.com'})`;

  expect(
    fixture.client.query<{id: number; email: string}>({
      sql: 'select id, email from users where email = ?',
      args: ['ada@example.com'],
    }),
  ).toMatchObject([{id: 1, email: 'ada@example.com'}]);

  expect(
    fixture.client.sql.exec<{id: number; email: string}>`select id, email from users order by id`,
  ).toMatchObject([
    {id: 1, email: 'ada@example.com'},
    {id: 2, email: 'grace@example.com'},
  ]);

  const writeResult = fixture.client.sql.exec`insert into users (email) values (${'lin@example.com'})`;
  expect(writeResult.length).toBe(0);
  expect(writeResult.rowsAffected).toBe(1);
  expect(typeof writeResult.lastInsertRowid).toMatch(/^(bigint|number|string)$/);

  expect(
    fixture.client.query<{id: number; email: string}>({
      sql: 'select id, email from users where email = ?',
      args: ['lin@example.com'],
    }),
  ).toMatchObject([{id: 3, email: 'lin@example.com'}]);
});

test('createBetterSqlite3Client turns real sqlite syntax errors into promise rejections for tagged sql', async () => {
  using fixture = createBetterSqlite3Fixture(new BetterSqlite3(':memory:'));
  fixture.client.sql.exec`create table users (id integer primary key, email text not null)`;

  await expect(
    fixture.client.sql`selectTYPO from users`.catch(String),
  ).resolves.toContain('syntax error');
});

function createBetterSqlite3Fixture(db: InstanceType<typeof BetterSqlite3>) {
  return {
    db,
    client: createBetterSqlite3Client(db),
    [Symbol.dispose]() {
      db.close();
    },
  };
}
