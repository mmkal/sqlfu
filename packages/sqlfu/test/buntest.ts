import {expect, test} from 'bun:test';
import {Database} from 'bun:sqlite';

import {createBunClient} from '../src/client.js';

test('createBunClient works with a real bun:sqlite database', async () => {
  using fixture = createBunFixture(new Database(':memory:'));
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

  let error: unknown;
  try {
    await fixture.client.sql`selectTYPO from users`;
  } catch (caught) {
    error = caught;
  }

  expect(String(error)).toContain('syntax error');
});

function createBunFixture(db: InstanceType<typeof Database>) {
  return {
    db,
    client: createBunClient(db),
    [Symbol.dispose]() {
      db.close();
    },
  };
}
