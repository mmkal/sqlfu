import BetterSqlite3 from 'better-sqlite3';
import {expect, test} from 'vitest';

import {sync} from '../src/api/sync.js';
import {createBetterSqlite3Client, sql} from '../src/index.js';

test('runtime sync handles index names that are substrings of table names', () => {
  using fixture = createRuntimeSyncFixture();

  sync(fixture.client, {
    definitions: `
      create table posts (
        id integer primary key,
        slug text not null
      );

      create index post on posts (slug);
    `,
  });

  expect(
    fixture.client.all<{name: string; tbl_name: string}>(sql`
      select name, tbl_name
      from sqlite_schema
      where type = 'index'
        and name = 'post'
    `),
  ).toMatchObject([{name: 'post', tbl_name: 'posts'}]);
});

test('scratch-db runtime sync builds desired indexes against the attached schema', () => {
  using fixture = createRuntimeSyncFixture();

  fixture.client.raw(`
    create table posts (
      id integer primary key,
      slug text not null
    );

    insert into posts (id, slug) values (1, 'hello-world');
  `);

  sync(fixture.client, {
    scratchSchema: 'scratch-db',
    definitions: `
      create table posts (
        id integer primary key,
        slug text not null,
        body text
      );

      create index posts_body on posts (body);
    `,
  });

  expect(
    fixture.client.all<{name: string}>(sql`
      select name from pragma_table_info('posts') order by cid
    `),
  ).toMatchObject([{name: 'id'}, {name: 'slug'}, {name: 'body'}]);

  expect(
    fixture.client.all<{name: string; tbl_name: string}>(sql`
      select name, tbl_name
      from sqlite_schema
      where type = 'index'
        and name = 'posts_body'
    `),
  ).toMatchObject([{name: 'posts_body', tbl_name: 'posts'}]);
});

test('runtime sync preserves migration bookkeeping tables outside inline definitions', () => {
  using fixture = createRuntimeSyncFixture();

  fixture.client.raw(`
    create table posts (
      id integer primary key
    );

    create table sqlfu_migrations (
      name text primary key check (name not like '%.sql'),
      checksum text not null,
      applied_at text not null
    );

    create table d1_migrations (
      id text primary key,
      name text not null,
      applied_at text not null
    );
  `);

  sync(fixture.client, {
    scratchSchema: 'scratch-db',
    definitions: `
      create table posts (
        id integer primary key
      );
    `,
  });

  sync(fixture.client, {
    scratchSchema: 'prefix',
    definitions: `
      create table posts (
        id integer primary key
      );
    `,
  });

  expect(
    fixture.client.all<{name: string}>(sql`
      select name
      from sqlite_schema
      where type = 'table'
        and name in ('d1_migrations', 'posts', 'sqlfu_migrations')
      order by name
    `),
  ).toMatchObject([{name: 'd1_migrations'}, {name: 'posts'}, {name: 'sqlfu_migrations'}]);
});

test('runtime sync cleanup only drops literal scratch-prefixed objects', () => {
  using fixture = createRuntimeSyncFixture();

  fixture.client.raw(`
    create table xxsqlfuxsyncxkeep (
      id integer primary key
    );

    insert into xxsqlfuxsyncxkeep (id) values (1);
  `);

  sync(fixture.client, {
    scratchSchema: 'prefix',
    definitions: `
      create table xxsqlfuxsyncxkeep (
        id integer primary key
      );

      create table posts (
        id integer primary key
      );
    `,
  });

  expect(
    fixture.client.all<{name: string}>(sql`
      select name
      from sqlite_schema
      where type = 'table'
        and name in ('posts', 'xxsqlfuxsyncxkeep')
      order by name
    `),
  ).toMatchObject([{name: 'posts'}, {name: 'xxsqlfuxsyncxkeep'}]);

  expect(
    fixture.client.all<{id: number}>(sql`
      select id
      from xxsqlfuxsyncxkeep
    `),
  ).toMatchObject([{id: 1}]);
});

test('runtime sync orders commented quoted create definitions by statement kind', () => {
  using fixture = createRuntimeSyncFixture();

  sync(fixture.client, {
    definitions: `
      /* index intentionally appears before its table */
      create /* before kind */ index "select_slug" on "select" (slug);

      -- quoted keyword identifier
      create /* before kind */ table "select" (
        slug text not null
      );
    `,
  });

  expect(
    fixture.client.all<{type: string; name: string; tbl_name: string}>(sql`
      select type, name, tbl_name
      from sqlite_schema
      where name in ('select', 'select_slug')
      order by type, name
    `),
  ).toMatchObject([
    {type: 'index', name: 'select_slug', tbl_name: 'select'},
    {type: 'table', name: 'select', tbl_name: 'select'},
  ]);
});

test('runtime sync rewrites bare identifiers that contain dollar signs', () => {
  using fixture = createRuntimeSyncFixture();

  sync(fixture.client, {
    definitions: `
      create table foo$bar (
        id integer primary key
      );
    `,
  });

  expect(
    fixture.client.all<{name: string}>(sql`
      select name
      from sqlite_schema
      where type = 'table'
        and name = 'foo$bar'
    `),
  ).toMatchObject([{name: 'foo$bar'}]);
});

test('scratch-db runtime sync rewrites schema-qualified create object names', () => {
  using fixture = createRuntimeSyncFixture();

  sync(fixture.client, {
    scratchSchema: 'scratch-db',
    definitions: `
      create table main.posts (
        id integer primary key,
        slug text not null
      );

      create index main.posts_slug on posts (slug);

      create trigger main.posts_ai after insert on posts begin
        select 1;
      end;
    `,
  });

  expect(
    fixture.client.all<{type: string; name: string; tbl_name: string}>(sql`
      select type, name, tbl_name
      from sqlite_schema
      where name in ('posts', 'posts_ai', 'posts_slug')
      order by type, name
    `),
  ).toMatchObject([
    {type: 'index', name: 'posts_slug', tbl_name: 'posts'},
    {type: 'table', name: 'posts', tbl_name: 'posts'},
    {type: 'trigger', name: 'posts_ai', tbl_name: 'posts'},
  ]);
});

function createRuntimeSyncFixture() {
  const db = new BetterSqlite3(':memory:');
  return {
    client: createBetterSqlite3Client(db),
    [Symbol.dispose]() {
      db.close();
    },
  };
}
