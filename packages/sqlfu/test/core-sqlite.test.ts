import BetterSqlite3 from 'better-sqlite3';
import {expect, test} from 'vitest';

import {createBetterSqlite3Client} from '../src/index.js';
import {extractSchema, rawSqlWithSqlSplittingSync} from '../src/sqlite-text.js';

test('rawSqlWithSqlSplittingSync ignores comment-only sql', () => {
  let calls = 0;

  const result = rawSqlWithSqlSplittingSync(() => {
    calls += 1;
    return {};
  }, '-- write your schema here\n');

  expect(result).toMatchObject({});
  expect(calls).toBe(0);
});

test('extractSchema output can be replayed against an empty database', async () => {
  using source = createBetterSqlite3Fixture();
  source.client.raw(`
    create table t(id integer primary key);
    create index t_idx on t(id);
    create view t_view as select id from t;
    create trigger t_trg after insert on t begin select 1; end;
  `);

  const extracted = await extractSchema(source.client);

  using destination = createBetterSqlite3Fixture();
  expect(() => destination.client.raw(extracted)).not.toThrow();
});

function createBetterSqlite3Fixture() {
  const db = new BetterSqlite3(':memory:');
  return {
    client: createBetterSqlite3Client(db),
    [Symbol.dispose]() {
      db.close();
    },
  };
}
