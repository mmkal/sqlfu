import BetterSqlite3 from 'better-sqlite3';
import {expect, test} from 'vitest';

import {createBetterSqlite3Client} from '../src/index.js';
import {extractSchema, inspectSchemaFingerprint, rawSqlWithSqlSplittingSync} from '../src/sqlite-text.js';

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

test('extractSchema and inspectSchemaFingerprint skip Cloudflare-reserved _cf_ tables', async () => {
  // Miniflare's persisted D1 carries internal bookkeeping tables like `_cf_METADATA`.
  // Workerd's D1 binding warns on any identifier matching `_cf_` case-insensitively,
  // so sqlfu must never surface them in introspection output.
  using source = createBetterSqlite3Fixture();
  source.client.raw(`
    create table visible(id integer primary key);
    create table _cf_METADATA(key text, value text);
    create table _CF_OTHER(id integer);
  `);

  const extracted = await extractSchema(source.client);
  expect(extracted).toContain('visible');
  expect(extracted.toLowerCase()).not.toContain('_cf_');

  const fingerprint = await inspectSchemaFingerprint(source.client);
  expect(fingerprint.tables.map((t) => t.name)).toEqual(['visible']);
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
