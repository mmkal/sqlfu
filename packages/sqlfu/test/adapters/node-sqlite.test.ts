import {DatabaseSync} from 'node:sqlite';

import {expect, test} from 'vitest';

import {createNodeSqliteClient} from '../../src/client.js';

test('createNodeSqliteClient works with a real node:sqlite database', async () => {
  using fixture = createNodeSqliteFixture(new DatabaseSync(':memory:'));
  fixture.client.sql.run`create table users (id integer primary key, email text not null)`;

  fixture.client.sql.run`insert into users (email) values (${'ada@example.com'})`;
  fixture.client.sql.run`insert into users (email) values (${'grace@example.com'})`;

  expect(
    fixture.client.all<{id: number; email: string}>({
      sql: 'select id, email from users where email = ?',
      args: ['ada@example.com'],
    }),
  ).toMatchObject([{id: 1, email: 'ada@example.com'}]);

  expect(
    fixture.client.sql.all<{id: number; email: string}>`select id, email from users order by id`,
  ).toMatchObject([
    {id: 1, email: 'ada@example.com'},
    {id: 2, email: 'grace@example.com'},
  ]);

  const writeResult = fixture.client.sql.run`insert into users (email) values (${'lin@example.com'})`;
  expect(writeResult.rowsAffected).toBe(1);
  expect(typeof writeResult.lastInsertRowid).toMatch(/^(bigint|number|string)$/);

  expect(
    fixture.client.all<{id: number; email: string}>({
      sql: 'select id, email from users where email = ?',
      args: ['lin@example.com'],
    }),
  ).toMatchObject([{id: 3, email: 'lin@example.com'}]);
});

test('createNodeSqliteClient turns real sqlite syntax errors into promise rejections for tagged sql', async () => {
  using fixture = createNodeSqliteFixture(new DatabaseSync(':memory:'));
  fixture.client.sql.run`create table users (id integer primary key, email text not null)`;

  await expect(
    fixture.client.sql`selectTYPO from users`.catch(String),
  ).resolves.toContain('syntax error');
});

test('createNodeSqliteClient iterates rows with native statement iteration', () => {
  using fixture = createNodeSqliteFixture(new DatabaseSync(':memory:'));
  fixture.client.sql.run`create table users (id integer primary key, email text not null)`;
  fixture.client.sql.run`insert into users (email) values (${'ada@example.com'}), (${'grace@example.com'})`;

  expect(
    [...fixture.client.iterate<{id: number; email: string}>({sql: 'select id, email from users order by id', args: []})],
  ).toMatchObject([
    {id: 1, email: 'ada@example.com'},
    {id: 2, email: 'grace@example.com'},
  ]);
});

function createNodeSqliteFixture(db: DatabaseSync) {
  return {
    client: createNodeSqliteClient(db),
    [Symbol.dispose]() {
      db.close();
    },
  };
}
