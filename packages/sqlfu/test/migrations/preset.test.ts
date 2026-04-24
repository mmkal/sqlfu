import dedent from 'dedent';
import {DatabaseSync} from 'node:sqlite';
import {expect, test} from 'vitest';

import {createNodeSqliteClient} from '../../src/index.js';
import {applyMigrations, readMigrationHistory, type Migration} from '../../src/migrations/index.js';
import {materializeMigrationsSchemaFor} from '../../src/materialize.js';
import {createNodeHost} from '../../src/node/host.js';

// Core preset behavior — bookkeeping SQL + checksum semantics — exercised
// directly against an in-memory node:sqlite database. The miniflare-backed
// integration test in test/adapters/d1-preset.test.ts covers the alchemy
// handoff flow on top of this.

test('sqlfu preset creates sqlfu_migrations table with checksum column', async () => {
  await using db = openMemoryDb();
  await applyMigrations(db.client, {migrations: migrationsFor('create-posts')});

  const history = await readMigrationHistory(db.client);
  expect(history).toMatchObject([{name: 'create-posts', checksum: expect.stringMatching(/^[0-9a-f]{64}$/u)}]);

  const columns = await db.client.all<{name: string}>({
    sql: `select name from pragma_table_info('sqlfu_migrations') order by cid`,
    args: [],
  });
  expect(columns.map((c) => c.name)).toEqual(['name', 'checksum', 'applied_at']);
});

test('d1 preset creates d1_migrations table in alchemy-compatible remote shape', async () => {
  await using db = openMemoryDb();
  await applyMigrations(db.client, {migrations: migrationsFor('create-posts'), preset: 'd1'});

  const history = await readMigrationHistory(db.client, {preset: 'd1'});
  expect(history).toMatchObject([{id: '00001', name: 'create-posts'}]);
  expect(history[0]).not.toHaveProperty('checksum');

  const columns = await db.client.all<{name: string}>({
    sql: `select name from pragma_table_info('d1_migrations') order by cid`,
    args: [],
  });
  expect(columns.map((c) => c.name)).toEqual(['id', 'name', 'applied_at']);
});

test('d1 preset id sequence increments across applies', async () => {
  await using db = openMemoryDb();
  await applyMigrations(db.client, {
    migrations: migrationsFor('create-posts', 'add-body', 'add-author'),
    preset: 'd1',
  });

  const history = await readMigrationHistory(db.client, {preset: 'd1'});
  expect(history.map((row) => row.id)).toEqual(['00001', '00002', '00003']);
});

test('d1 preset adopts pre-existing local/miniflare schema (with type column)', async () => {
  await using db = openMemoryDb();
  // Simulate alchemy having created the local-schema table and its first
  // migration. The corresponding `posts_legacy` table exists too — alchemy
  // would have applied the migration body before inserting the bookkeeping
  // row.
  await db.client.raw(dedent`
    create table d1_migrations (
      id integer primary key autoincrement,
      name text not null,
      applied_at timestamp default current_timestamp not null,
      type text not null
    );
    insert into d1_migrations (name, type) values ('0000_from_alchemy.sql', 'migration');
    create table posts_legacy (id integer primary key);
  `);

  // Sqlfu's migrations list includes both the alchemy-era entry (so the
  // history-is-prefix check passes) and the new one to apply. The alchemy
  // entry is already in history, so sqlfu skips it and only applies the new
  // one.
  const alchemyEra: Migration = {
    path: 'migrations/0000_from_alchemy.sql',
    content: 'create table posts_legacy (id integer primary key);',
  };
  const newMigration = migration('create-posts');
  await applyMigrations(db.client, {migrations: [alchemyEra, newMigration], preset: 'd1'});

  // Raw read: names are stored with `.sql` suffix to match alchemy's wire
  // format. readMigrationHistory() normalizes these back to sqlfu-native form.
  const rows = await db.client.all<{name: string; type: string}>({
    sql: `select name, type from d1_migrations order by id`,
    args: [],
  });
  expect(rows).toEqual([
    {name: '0000_from_alchemy.sql', type: 'migration'},
    {name: 'create-posts.sql', type: 'migration'},
  ]);
});

test('d1 preset ignores alchemy-applied `type = import` rows', async () => {
  await using db = openMemoryDb();
  // Alchemy's local/miniflare schema uses the same table for migrations and
  // data imports. Sqlfu should treat imports as out-of-scope bookkeeping.
  await db.client.raw(dedent`
    create table d1_migrations (
      id integer primary key autoincrement,
      name text not null,
      applied_at timestamp default current_timestamp not null,
      type text not null
    );
    insert into d1_migrations (name, type) values ('seed-data.sql', 'import');
  `);

  const history = await readMigrationHistory(db.client, {preset: 'd1'});
  expect(history).toEqual([]);
});

test('sqlfu preset rejects edits to an applied migration via checksum check', async () => {
  await using db = openMemoryDb();
  const original = migration('create-posts');
  await applyMigrations(db.client, {migrations: [original]});

  const edited = {...original, content: `${original.content}-- edited after apply`};
  // node:sqlite is a sync driver so applyMigrations throws synchronously here;
  // using `expect(() => ...).toThrow` rather than `.rejects.toThrow`.
  expect(() => applyMigrations(db.client, {migrations: [edited]})).toThrow(
    /applied migration checksum mismatch/u,
  );
});

test('d1 preset silently accepts edits to an applied migration (no checksum column)', async () => {
  await using db = openMemoryDb();
  const original = migration('create-posts');
  await applyMigrations(db.client, {migrations: [original], preset: 'd1'});

  const edited = {...original, content: `${original.content}-- edited after apply`};
  // Under d1, there's no checksum column so the "edited after apply" check
  // can't run. Documented downgrade of alchemy compatibility.
  await applyMigrations(db.client, {migrations: [edited], preset: 'd1'});

  const history = await readMigrationHistory(db.client, {preset: 'd1'});
  expect(history).toHaveLength(1);
});

test('materializeMigrationsSchemaFor does not leak sqlfu_migrations into the baseline under preset: d1', async () => {
  // Regression: sqlfu draft was emitting `drop table sqlfu_migrations` when a
  // user had configured `preset: 'd1'`. The scratch DB in materialize was
  // defaulting to the sqlfu preset (creating sqlfu_migrations), while the
  // excludedTables list came from the user config (['d1_migrations']). The
  // mismatch left sqlfu_migrations visible in the baseline schema, and the
  // diff engine naturally concluded it should be dropped.
  const host = await createNodeHost();
  const baseline = await materializeMigrationsSchemaFor(
    host,
    [
      {
        path: 'migrations/0000_posts.sql',
        content: 'create table posts (id integer primary key, slug text not null);',
      },
    ],
    {excludedTables: ['d1_migrations'], preset: 'd1'},
  );

  expect(baseline.toLowerCase()).not.toContain('sqlfu_migrations');
  expect(baseline.toLowerCase()).not.toContain('d1_migrations');
  // The user's actual schema still comes through.
  expect(baseline.toLowerCase()).toContain('create table posts');
});

test('materializeMigrationsSchemaFor excludes sqlfu_migrations under preset: sqlfu (default)', async () => {
  const host = await createNodeHost();
  const baseline = await materializeMigrationsSchemaFor(
    host,
    [
      {
        path: 'migrations/0000_posts.sql',
        content: 'create table posts (id integer primary key, slug text not null);',
      },
    ],
    {excludedTables: ['sqlfu_migrations']},
  );

  expect(baseline.toLowerCase()).not.toContain('sqlfu_migrations');
  expect(baseline.toLowerCase()).toContain('create table posts');
});

function openMemoryDb() {
  const database = new DatabaseSync(':memory:');
  const client = createNodeSqliteClient(database);
  return {
    client,
    [Symbol.dispose]: () => database.close(),
  };
}

function migration(name: string): Migration {
  // Each migration name gets a distinct CREATE so replays produce different DDL.
  return {path: `migrations/${name}.sql`, content: `create table ${name.replaceAll('-', '_')} (id integer primary key);`};
}

function migrationsFor(...names: string[]): Migration[] {
  return names.map((name) => migration(name));
}
