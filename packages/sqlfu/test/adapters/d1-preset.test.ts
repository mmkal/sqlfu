import dedent from 'dedent';
import {Miniflare} from 'miniflare';
import {expect, test} from 'vitest';

import {createD1Client} from '../../src/adapters/d1.js';
import {applyMigrations, readMigrationHistory, type Migration} from '../../src/migrations/index.js';

// End-to-end: sqlfu's d1 preset against a real (miniflare) D1 binding.
//
// Complements the in-memory preset unit tests with the actual adapter path —
// sqlfu's SQL goes through `createD1Client`, which runs through miniflare's
// workerd-backed D1 implementation. Two flows:
//
//   1. Greenfield — empty D1, sqlfu creates `d1_migrations` itself.
//   2. Alchemy handoff — simulate alchemy having run first (by seeding
//      `d1_migrations` in its local/miniflare shape with the `type` column
//      and a pre-applied entry), then sqlfu takes over.
//
// Alchemy's runtime D1 migrator isn't imported directly: pulling it in would
// drag the whole cloudflare/alchemy module graph. Seeding the expected table
// state matches what alchemy would have left behind and keeps the test free
// of cross-package surface churn.

test('d1 preset applies migrations on an empty miniflare D1 (greenfield)', async () => {
  await using fixture = await openMiniflareD1();

  await applyMigrations(fixture.client, {migrations: createPostsAndBody(), preset: 'd1'});

  const history = await readMigrationHistory(fixture.client, {preset: 'd1'});
  expect(history).toMatchObject([
    {id: '00001', name: '0000_create_posts'},
    {id: '00002', name: '0001_add_body'},
  ]);

  // The migration content took effect: posts table exists with both columns.
  const columns = await fixture.client.all<{name: string}>({
    sql: `select name from pragma_table_info('posts') order by cid`,
    args: [],
  });
  expect(columns.map((c) => c.name)).toEqual(['id', 'slug', 'body']);
});

test('d1 preset picks up alchemy-era migrations and appends new ones (handoff)', async () => {
  await using fixture = await openMiniflareD1();

  // Simulate alchemy having already:
  //   - created `d1_migrations` in its local/miniflare shape (has `type` column)
  //   - applied migration 0000_init.sql and recorded it (alchemy stores names
  //     with the `.sql` suffix — see alchemy/src/cloudflare/d1-sql-file.ts)
  //   - left the `posts` table behind from that first migration
  await fixture.client.raw(dedent`
    create table d1_migrations (
      id integer primary key autoincrement,
      name text not null,
      applied_at timestamp default current_timestamp not null,
      type text not null
    );
    insert into d1_migrations (name, type) values ('0000_init.sql', 'migration');
    create table posts (id integer primary key, slug text not null);
  `);

  const migrations: Migration[] = [
    {
      path: 'migrations/0000_init.sql',
      content: 'create table posts (id integer primary key, slug text not null);',
    },
    {
      path: 'migrations/0001_add_body.sql',
      content: 'alter table posts add column body text;',
    },
  ];

  await applyMigrations(fixture.client, {migrations, preset: 'd1'});

  // Alchemy's row stayed put. Sqlfu skipped re-applying 0000_init (already in
  // history, matched by normalizing alchemy's `.sql`-suffixed name against
  // sqlfu's suffixless internal form) and applied 0001_add_body using the
  // local schema's `type` column.
  const rows = await fixture.client.all<{name: string; type: string | null}>({
    sql: `select name, type from d1_migrations order by id`,
    args: [],
  });
  expect(rows).toEqual([
    {name: '0000_init.sql', type: 'migration'},
    {name: '0001_add_body.sql', type: 'migration'},
  ]);

  const columns = await fixture.client.all<{name: string}>({
    sql: `select name from pragma_table_info('posts') order by cid`,
    args: [],
  });
  expect(columns.map((c) => c.name)).toEqual(['id', 'slug', 'body']);
});

function createPostsAndBody(): Migration[] {
  return [
    {
      path: 'migrations/0000_create_posts.sql',
      content: 'create table posts (id integer primary key, slug text not null);',
    },
    {
      path: 'migrations/0001_add_body.sql',
      content: 'alter table posts add column body text;',
    },
  ];
}

async function openMiniflareD1() {
  const miniflare = new Miniflare({
    modules: true,
    script: 'export default { async fetch() { return new Response("ok"); } }',
    d1Databases: ['DB'],
  });
  const database = await miniflare.getD1Database('DB');
  const client = createD1Client(database as Parameters<typeof createD1Client>[0]);

  return {
    client,
    async [Symbol.asyncDispose]() {
      await miniflare.dispose();
    },
  };
}
