import Database, {type Database as LibsqlDatabase} from 'libsql';
import {expect, test} from 'vitest';

import {createLibsqlSyncClient} from '../../src/index.js';
import {applySyncPrepareSuite} from './prepare-suite.js';

test('createLibsqlSyncClient works with a real libsql database', async () => {
  using fixture = createLibsqlFixture(new Database(':memory:'));
  fixture.client.sql.run`create table users (id integer primary key, email text not null)`;

  fixture.client.sql.run`insert into users (email) values (${'ada@example.com'})`;
  fixture.client.sql.run`insert into users (email) values (${'grace@example.com'})`;

  expect(
    fixture.client.all<{id: number; email: string}>({
      sql: 'select id, email from users where email = ?',
      args: ['ada@example.com'],
    }),
  ).toMatchObject([{id: 1, email: 'ada@example.com'}]);

  expect(fixture.client.sql.all<{id: number; email: string}>`select id, email from users order by id`).toMatchObject([
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

test('createLibsqlSyncClient turns real sqlite syntax errors into promise rejections for tagged sql', async () => {
  using fixture = createLibsqlFixture(new Database(':memory:'));
  fixture.client.sql.run`create table users (id integer primary key, email text not null)`;

  await expect(fixture.client.sql`selectTYPO from users`.catch(String)).resolves.toContain('syntax error');
});

test('createLibsqlSyncClient iterates rows', () => {
  using fixture = createLibsqlFixture(new Database(':memory:'));
  fixture.client.sql.run`create table users (id integer primary key, email text not null)`;
  fixture.client.sql.run`insert into users (email) values (${'ada@example.com'})`;
  fixture.client.sql.run`insert into users (email) values (${'grace@example.com'})`;

  expect([
    ...fixture.client.iterate<{id: number; email: string}>({sql: 'select id, email from users order by id', args: []}),
  ]).toMatchObject([
    {id: 1, email: 'ada@example.com'},
    {id: 2, email: 'grace@example.com'},
  ]);
});

test('createLibsqlSyncClient.raw runs multiple statements', () => {
  using fixture = createLibsqlFixture(new Database(':memory:'));

  fixture.client.raw(`
    create table users (id integer primary key, email text not null);
    insert into users (email) values ('ada@example.com');
    insert into users (email) values ('grace@example.com');
  `);

  expect(fixture.client.sql.all<{email: string}>`select email from users order by email`).toMatchObject([
    {email: 'ada@example.com'},
    {email: 'grace@example.com'},
  ]);
});

function createLibsqlFixture(db: LibsqlDatabase) {
  return {
    client: createLibsqlSyncClient(db),
    [Symbol.dispose]() {
      db.close();
    },
  };
}

applySyncPrepareSuite({
  label: 'libsql-sync',
  openClient: () => createLibsqlFixture(new Database(':memory:')),
});
