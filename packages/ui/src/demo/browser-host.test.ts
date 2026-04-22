import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {expect, test} from 'vitest';

test('demo-mode sql runner binds named params using the UI form key names', async () => {
  const sqlite3 = await sqlite3InitModule();
  const db = new sqlite3.oo1.DB(':memory:');
  db.exec(`create table posts (id integer primary key, slug text)`);
  db.exec(`insert into posts (slug) values ('a'), ('b'), ('c')`);

  // The SQL runner form uses the bare name as the key (matches
  // detectNamedParameters in client.tsx and the labels rendered by
  // buildSqlRunnerParamsSchema), so the request body for `:limitt` looks
  // like { limitt: 2 }. browser-host.execAdHocSql must make that bind.
  const rows = db.exec({
    sql: `select * from posts limit :limitt`,
    bind: {limitt: 2},
    rowMode: 'object',
    returnValue: 'resultRows',
  });

  expect(rows).toHaveLength(2);
});
