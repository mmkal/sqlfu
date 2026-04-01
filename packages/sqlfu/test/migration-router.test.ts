import dedent from 'dedent';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createClient} from '@libsql/client';
import {createRouterClient} from '@orpc/server';
import {expect, test} from 'vitest';

import {sqlfuRouter} from '../src/api.js';
import type {SqlfuProjectConfig} from '../src/core/types.js';

test('draft creates the single mutable migration from finalized history to definitions.sql', async () => {
  await using project = await createProjectFixture({
    definitionsSql: dedent`
      create table users (id int, email text, nickname text);
      create table posts (id int, slug text);
    `,
    snapshotSql: dedent`
      create table users (id int, email text);
    `,
    migrations: {
      'migrations/20260331090000_create_users.sql': finalMigration(`
        create table users (id int, email text);
      `),
    },
  });

  await project.db.applySchema(`
    create table users (id int, email text);
  `);

  await project.caller.draft({name: 'add_posts'});

  const migrationFiles = await project.fs.readdir('migrations');
  expect(migrationFiles).toMatchObject([
    '20260331090000_create_users.sql',
    expect.stringMatching(/^\d+_add_posts\.sql$/),
  ]);
  const draftMigrationPath = `migrations/${migrationFiles.at(-1)!}`;
  expect(await project.fs.readFile(draftMigrationPath)).toContain('-- status: draft');
  expect(await project.fs.readFile(draftMigrationPath)).toMatch(/alter table "users" add column "nickname" text;/i);
  expect(await project.fs.readFile(draftMigrationPath)).toContain('create table posts');
  expect(await project.fs.readFile(draftMigrationPath)).not.toContain('create table users');
  expect(await project.fs.readFile('snapshot.sql')).toContain('create table users');
  expect(await project.db.exportSchema()).toContain('create table users');
});

test('draft rewrites the existing draft instead of creating a second editable migration', async () => {
  await using project = await createProjectFixture({
    definitionsSql: dedent`
      create table users (id int, email text);
      create table posts (id int, slug text);
      create index posts_slug_idx on posts(slug);
    `,
    snapshotSql: dedent`
      create table users (id int, email text);
    `,
    migrations: {
      'migrations/20260331090000_create_users.sql': finalMigration(`
        create table users (id int, email text);
      `),
      'migrations/20260331090001_add_posts.sql': draftMigration(`
        create table posts (id int, slug text);
      `),
    },
  });

  await project.db.applySchema(`
    create table users (id int, email text);
  `);

  const beforeFiles = await project.fs.readdir('migrations');
  await project.caller.draft();

  const afterFiles = await project.fs.readdir('migrations');
  expect(afterFiles).toMatchObject([
    '20260331090000_create_users.sql',
    '20260331090001_add_posts.sql',
  ]);
  expect(afterFiles).toEqual(beforeFiles);
  expect(await project.fs.readFile('migrations/20260331090001_add_posts.sql')).toContain('-- status: draft');
  expect(await project.fs.readFile('migrations/20260331090001_add_posts.sql')).toContain('create index posts_slug_idx');
});

test('draft without a name creates a default draft file when none exists yet', async () => {
  await using project = await createProjectFixture({
    definitionsSql: dedent`
      create table users (id int, email text);
      create table posts (id int, slug text);
    `,
    snapshotSql: dedent`
      create table users (id int, email text);
    `,
    migrations: {
      'migrations/20260331090000_create_users.sql': finalMigration(`
        create table users (id int, email text);
      `),
    },
  });

  await project.caller.draft();

  await expect(project.fs.readdir('migrations')).resolves.toMatchObject([
    '20260331090000_create_users.sql',
    expect.stringMatching(/^\d+_create_table_posts\.sql$/),
  ]);
});

test('draft with a name errors if a draft already exists', async () => {
  await using project = await createProjectFixture({
    definitionsSql: dedent`
      create table users (id int, email text);
      create table posts (id int, slug text);
      create index posts_slug_idx on posts(slug);
    `,
    snapshotSql: dedent`
      create table users (id int, email text);
    `,
    migrations: {
      'migrations/20260331090000_create_users.sql': finalMigration(`
        create table users (id int, email text);
      `),
      'migrations/20260331090001_add_posts.sql': draftMigration(`
        create table posts (id int, slug text);
      `),
    },
  });

  await expect(project.caller.draft({name: 'rename_me'})).rejects.toThrow(/already exists/i);
});

test('draft finalize flips the migration to final and updates snapshot.sql', async () => {
  await using project = await createProjectFixture({
    definitionsSql: dedent`
      create table users (id int, email text);
      create table posts (id int, slug text);
    `,
    snapshotSql: dedent`
      create table users (id int, email text);
    `,
    migrations: {
      'migrations/20260331090000_create_users.sql': finalMigration(`
        create table users (id int, email text);
      `),
      'migrations/20260331090001_add_posts.sql': draftMigration(`
        create table posts (id int, slug text);
      `),
    },
  });

  await project.caller.draft({finalize: true});

  expect(await project.fs.readFile('migrations/20260331090001_add_posts.sql')).toContain('-- status: final');
  expect(await project.fs.readFile('migrations/20260331090001_add_posts.sql')).not.toContain('-- status: draft');
  expect(await project.fs.readFile('snapshot.sql')).toContain('create table posts');
});

test('draft content writes the provided sql instead of generating a sqlite3def diff', async () => {
  await using project = await createProjectFixture({
    definitionsSql: dedent`
      create table users (id int, email text, nickname text);
      create table posts (id int, slug text);
    `,
    snapshotSql: dedent`
      create table users (id int, email text);
    `,
    migrations: {
      'migrations/20260331090000_create_users.sql': finalMigration(`
        create table users (id int, email text);
      `),
    },
  });

  await project.caller.draft({content: 'create table audit_log (id int);'});

  const migrationFiles = await project.fs.readdir('migrations');
  const draftMigrationPath = `migrations/${migrationFiles.at(-1)!}`;
  expect(await project.fs.readFile(draftMigrationPath)).toContain('create table audit_log (id int);');
  expect(await project.fs.readFile(draftMigrationPath)).not.toContain('alter table "users" add column "nickname" text;');
  expect(await project.fs.readFile(draftMigrationPath)).not.toContain('create table posts');
});

test('migrate refuses to run while a draft migration exists', async () => {
  await using project = await createProjectFixture({
    definitionsSql: dedent`
      create table users (id int, email text);
      create table posts (id int, slug text);
    `,
    snapshotSql: dedent`
      create table users (id int, email text);
    `,
    migrations: {
      'migrations/20260331090000_create_users.sql': finalMigration(`
        create table users (id int, email text);
      `),
      'migrations/20260331090001_add_posts.sql': draftMigration(`
        create table posts (id int, slug text);
      `),
    },
  });

  await project.db.applySchema(`
    create table users (id int, email text);
  `);

  await expect(project.caller.migrate()).rejects.toThrow(/draft/i);
  expect(await project.db.exportSchema()).toContain('create table users');
  expect(await project.db.exportSchema()).not.toContain('create table posts');
});

test('sync fixes a drifted development database without mutating migrations or snapshot.sql', async () => {
  await using project = await createProjectFixture({
    definitionsSql: dedent`
      create table users (id int, email text);
      create table posts (id int, slug text);
    `,
    snapshotSql: dedent`
      create table users (id int, email text);
    `,
    migrations: {
      'migrations/20260331090000_create_users.sql': finalMigration(`
        create table users (id int, email text);
      `),
      'migrations/20260331090001_add_posts.sql': draftMigration(`
        create table posts (id int, slug text);
      `),
    },
  });

  await project.db.applySchema(`
    create table users (id int, email text, nickname text);
  `);

  const beforeDraft = await project.fs.readFile('migrations/20260331090001_add_posts.sql');
  const beforeSnapshot = await project.fs.readFile('snapshot.sql');

  await project.caller.sync();

  expect(await project.db.exportSchema()).toContain('create table posts');
  expect(await project.db.exportSchema()).not.toContain('nickname');
  expect(await project.fs.readFile('migrations/20260331090001_add_posts.sql')).toBe(beforeDraft);
  expect(await project.fs.readFile('snapshot.sql')).toBe(beforeSnapshot);
});

test('check respects injected project config and db even when fs falls back to the default filesystem', async () => {
  await using project = await createProjectFixture({
    definitionsSql: dedent`
      create table users (id int, email text);
    `,
    snapshotSql: dedent`
      create table users (id int, email text);
    `,
    migrations: {
      'migrations/20260331090000_create_users.sql': finalMigration(`
        create table users (id int, email text);
      `),
    },
  });

  let exportSchemaCalls = 0;
  const caller = createRouterClient(sqlfuRouter, {
    context: {
      projectConfig: project.projectConfig,
      db: {
        async applySchema() {
          throw new Error('applySchema should not be called');
        },
        async exportSchema() {
          exportSchemaCalls += 1;
          return dedent`
            create table users (id int, email text);
          `;
        },
      },
    },
  });

  await expect(caller.check()).resolves.toMatchObject({
    ok: 'ok',
    desiredVsHistory: 'ok',
    finalizedVsSnapshot: 'ok',
    databaseVsDesired: 'ok',
    databaseVsFinalized: 'ok',
  });
  expect(exportSchemaCalls).toBe(1);
});

test('check reports where desired schema, finalized history, snapshot, and actual database disagree', async () => {
  await using project = await createProjectFixture({
    definitionsSql: dedent`
      create table users (id int, email text);
      create table posts (id int, slug text);
      create index posts_slug_idx on posts(slug);
    `,
    snapshotSql: dedent`
      create table users (id int, email text);
    `,
    migrations: {
      'migrations/20260331090000_create_users.sql': finalMigration(`
        create table users (id int, email text);
      `),
      'migrations/20260331090001_add_posts.sql': draftMigration(`
        create table posts (id int, slug text);
      `),
    },
  });

  await project.db.applySchema(`
    create table users (id int, email text, nickname text);
  `);

  await expect(project.caller.check()).resolves.toMatchObject({
    ok: expect.stringMatching(/^failure: /),
    desiredVsHistory: expect.stringContaining('desired schema'),
    finalizedVsSnapshot: 'ok',
    databaseVsDesired: expect.stringContaining('database'),
    databaseVsFinalized: expect.stringContaining('database'),
  });
});

test('draft does not require the actual database to match definitions.sql first', async () => {
  await using project = await createProjectFixture({
    definitionsSql: dedent`
      create table users (id int, email text, nickname text);
      create table posts (id int, slug text);
    `,
    snapshotSql: dedent`
      create table users (id int, email text);
    `,
    migrations: {
      'migrations/20260331090000_create_users.sql': finalMigration(`
        create table users (id int, email text);
      `),
    },
  });

  await project.db.applySchema(`
    create table users (id int, email text, nickname text);
  `);

  await project.caller.draft({name: 'add_posts'});

  const migrationFiles = await project.fs.readdir('migrations');
  const draftMigrationPath = `migrations/${migrationFiles.at(-1)!}`;
  expect(await project.fs.readFile(draftMigrationPath)).toContain('-- status: draft');
  expect(await project.fs.readFile(draftMigrationPath)).toMatch(/alter table "users" add column "nickname" text;/i);
  expect(await project.fs.readFile(draftMigrationPath)).toContain('create table posts');
  expect(await project.db.exportSchema()).toContain('nickname');
});

async function createProjectFixture(input: {
  definitionsSql: string;
  snapshotSql: string;
  migrations: Record<string, string>;
}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-router-'));
  const fsAdapter = createRealFs(root);
  await fsAdapter.writeFile('definitions.sql', input.definitionsSql);
  await fsAdapter.writeFile('snapshot.sql', input.snapshotSql);
  await fsAdapter.mkdir('migrations');
  for (const [filePath, contents] of Object.entries(input.migrations)) {
    await fsAdapter.writeFile(filePath, contents);
  }

  const db = createRealDatabase(path.join(root, 'dev.db'));
  const projectConfig: SqlfuProjectConfig = {
    projectRoot: root,
    dbPath: path.join(root, 'dev.db'),
    migrationsDir: path.join(root, 'migrations'),
    snapshotFile: path.join(root, 'snapshot.sql'),
    definitionsPath: path.join(root, 'definitions.sql'),
    sqlDir: path.join(root, 'sql'),
    generatedImportExtension: '.js',
  };
  const context = {
    projectConfig,
    fs: fsAdapter,
    db,
  };
  const caller = createRouterClient(sqlfuRouter, {context});

  return {
    caller,
    fs: fsAdapter,
    db,
    root,
    projectConfig,
    async [Symbol.asyncDispose]() {
      await db.close();
      await fs.rm(root, {recursive: true, force: true});
    },
  };
}

function createRealFs(root: string) {
  return {
    async exists(filePath: string) {
      try {
        await fs.access(resolvePath(root, filePath));
        return true;
      } catch {
        return false;
      }
    },
    async readFile(filePath: string) {
      return fs.readFile(resolvePath(root, filePath), 'utf8');
    },
    async writeFile(filePath: string, contents: string) {
      const fullPath = resolvePath(root, filePath);
      await fs.mkdir(path.dirname(fullPath), {recursive: true});
      await fs.writeFile(fullPath, contents);
    },
    async readdir(dirPath: string) {
      return (await fs.readdir(resolvePath(root, dirPath))).sort();
    },
    async mkdir(dirPath: string) {
      await fs.mkdir(resolvePath(root, dirPath), {recursive: true});
    },
  };
}

function createRealDatabase(dbPath: string) {
  const client = createClient({url: `file:${dbPath}`});

  return {
    async applySchema(sql: string) {
      const existingObjects = await client.execute(`
        select type, name
        from sqlite_schema
        where name not like 'sqlite_%'
        order by case type when 'index' then 0 else 1 end, name
      `);

      for (const row of existingObjects.rows as Array<Record<string, unknown>>) {
        const type = String(row.type);
        const name = String(row.name);
        if (type === 'index') {
          await client.execute(`drop index if exists "${name}"`);
          continue;
        }
        await client.execute(`drop ${type} if exists "${name}"`);
      }

      for (const statement of sqlStatements(sql)) {
        await client.execute(statement);
      }
    },
    async exportSchema() {
      const result = await client.execute(`
        select sql
        from sqlite_schema
        where sql is not null
          and name not like 'sqlite_%'
        order by type, name
      `);
      return result.rows.map((row) => String(row.sql).toLowerCase()).join('\n');
    },
    async close() {
      client.close();
    },
  };
}

function finalMigration(upSql: string) {
  return `-- status: final\n${dedent(upSql)}\n`;
}

function draftMigration(upSql: string) {
  return `-- status: draft\n${dedent(upSql)}\n`;
}

function resolvePath(root: string, filePath: string) {
  return path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
}

function sqlStatements(sql: string) {
  return dedent(sql)
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
}
