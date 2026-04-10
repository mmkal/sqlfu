import dedent from 'dedent';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import BetterSqlite3 from 'better-sqlite3';
import {createClient} from '@libsql/client';
import {Project, ts} from 'ts-morph';
import {expect, test} from 'vitest';

import {createBetterSqlite3Client, createLibsqlClient} from '../src/client.js';
import {generateQueryTypes} from '../src/typegen/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('generate writes wrappers and a barrel for every checked-in query', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null, body text not null, published_at text);
      create view post_summaries as select id, slug, published_at, body as excerpt from posts;
    `,
    files: {
      'sql/list-post-summaries.sql': `select id, slug, published_at, excerpt from post_summaries;`,
      'sql/find-post-by-slug.sql': `select id, slug, body as excerpt from posts where slug = :slug limit 1;`,
    },
  });

  await project.generate();

  const listPostSummariesTs = await project.readFile('sql/list-post-summaries.ts');
  const findPostBySlugTs = await project.readFile('sql/find-post-by-slug.ts');
  const indexTs = await project.readFile('sql/index.ts');
  const typesqlJson = await project.readFile('.sqlfu/typesql.json');

  expect(indexTs).toMatch(/list-post-summaries\.js/);
  expect(indexTs).toMatch(/find-post-by-slug\.js/);
  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(listPostSummariesTs).toMatchInlineSnapshot(`
    "import type {Client, SqlQuery} from 'sqlfu';

    export type ListPostSummariesResult = {
    	id: number;
    	slug: string;
    	published_at?: string;
    	excerpt: string;
    }

    export async function listPostSummaries(client: Client): Promise<ListPostSummariesResult[]> {
    	const sql = \`
    	select id, slug, published_at, excerpt from post_summaries;
    	
    	\`
    	const query: SqlQuery = { sql, args: [] };
    	return client.all<ListPostSummariesResult>(query);
    }
    "
  `);
  expect(findPostBySlugTs).toMatchInlineSnapshot(`
    "import type {Client, SqlQuery} from 'sqlfu';

    export type FindPostBySlugParams = {
    	slug: string;
    }

    export type FindPostBySlugResult = {
    	id: number;
    	slug: string;
    	excerpt: string;
    }

    export async function findPostBySlug(client: Client, params: FindPostBySlugParams): Promise<FindPostBySlugResult | null> {
    	const sql = \`
    	select id, slug, body as excerpt from posts where slug = ? limit 1;
    	
    	\`
    	const query: SqlQuery = { sql, args: [params.slug] };
    	const rows = await client.all<FindPostBySlugResult>(query);
    	return rows.length > 0 ? rows[0] : null;
    }
    "
  `);
  expect(typesqlJson).toContain('"includeCrudTables": []');
});

test('generate helpers accept sqlfu adapter clients created from real libraries', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    files: {
      'sql/better-sqlite3.d.ts': dedent`
        declare module 'better-sqlite3' {
          type RunResult = {
            changes?: number;
            lastInsertRowid?: string | number | bigint | null;
          };

          class Statement<TRow = unknown> {
            readonly reader: boolean;
            all(...params: readonly unknown[]): TRow[];
            run(...params: readonly unknown[]): RunResult;
            raw(toggle?: boolean): Statement;
          }

          export default class BetterSqlite3Database {
            constructor(filename: string);
            prepare<TRow = unknown>(query: string): Statement<TRow>;
          }
        }
      `,
      'sql/expo-sqlite.d.ts': dedent`
        declare module 'expo-sqlite' {
          export interface SQLiteDatabase {
            getAllAsync<TRow = unknown>(source: string, params?: readonly unknown[]): Promise<TRow[]>;
            getEachAsync<TRow = unknown>(source: string, params?: readonly unknown[]): AsyncIterableIterator<TRow>;
            runAsync(
              source: string,
              params?: readonly unknown[],
            ): Promise<{changes?: number; lastInsertRowId?: string | number | bigint | null}>;
          }
        }
      `,
      'sql/list-posts.sql': `select id, slug from posts;`,
      'sql/usage.ts': dedent`
        import BetterSqlite3 from 'better-sqlite3';
        import {createClient} from '@libsql/client';
        import type {SQLiteDatabase} from 'expo-sqlite';
        import {createBetterSqlite3Client, createExpoSqliteClient, createLibsqlClient} from 'sqlfu/client';
        import {listPosts} from './list-posts.js';

        const sqlite = new BetterSqlite3(':memory:');
        const libsql = createClient({url: 'file:/tmp/sqlfu-generate-usage.db'});
        const expo = null as unknown as SQLiteDatabase;

        void listPosts(createBetterSqlite3Client(sqlite));
        void listPosts(createLibsqlClient(libsql));
        void listPosts(createExpoSqliteClient(expo));
      `,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/list-posts.ts');

  expect(generatedTs).toContain(`import type {Client, SqlQuery} from 'sqlfu';`);
  expect(generatedTs).toContain(`export async function listPosts(client: Client): Promise<ListPostsResult[]> {`);
  expect(generatedTs).toContain(`const query: SqlQuery = { sql, args: [] };`);
  expect(generatedTs).toContain(`return client.all<ListPostsResult>(query);`);
  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);

  const {listPosts} = await project.importTranspiledModule<{
    listPosts: (executor: unknown) => Promise<readonly unknown[]>;
  }>('sql/list-posts.ts');

  const libsqlPath = path.join(os.tmpdir(), `sqlfu-generate-libsql-${process.pid}-${Date.now()}.db`);
  const libsql = createClient({url: `file:${libsqlPath}`});
  await libsql.execute('create table posts (id integer primary key, slug text not null)');
  await libsql.execute({sql: 'insert into posts (slug) values (?)', args: ['libsql']});
  await expect(listPosts(createLibsqlClient(libsql)).then((rows) => [...rows])).resolves.toMatchObject([{id: 1, slug: 'libsql'}]);
  libsql.close();
  await fs.rm(libsqlPath, {force: true});

  const sqlite = new BetterSqlite3(':memory:');
  sqlite.exec('create table posts (id integer primary key, slug text not null)');
  sqlite.prepare('insert into posts (slug) values (?)').run('better-sqlite3');
  await expect(listPosts(createBetterSqlite3Client(sqlite)).then((rows) => [...rows])).resolves.toMatchObject([{id: 1, slug: 'better-sqlite3'}]);
  sqlite.close();
});

test('generate can use .ts extensions in the barrel file', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    files: {
      'sql/list-posts.sql': `select id, slug from posts;`,
    },
    config: {
      generatedImportExtension: '.ts',
    },
  });

  await project.generate();

  const indexTs = await project.readFile('sql/index.ts');

  expect(indexTs).toBe(`export * from "./list-posts.ts";\n`);
});

test('generate defaults to .ts extensions when tsconfig opts into ts import extensions', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    files: {
      'sql/list-posts.sql': `select id, slug from posts;`,
      'tsconfig.json': JSON.stringify(
        { compilerOptions: { allowImportingTsExtensions: true } },
      ),
    },
  });

  await project.generate();

  const indexTs = await project.readFile('sql/index.ts');

  expect(indexTs).toBe(`export * from "./list-posts.ts";\n`);
});

test('explicit generatedImportExtension overrides tsconfig detection', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    files: {
      'sql/list-posts.sql': `select id, slug from posts;`,
      'tsconfig.json': JSON.stringify(
        { compilerOptions: { allowImportingTsExtensions: true } },
      ),
    },
    config: {
      generatedImportExtension: '.js',
    },
  });

  await project.generate();

  const indexTs = await project.readFile('sql/index.ts');

  expect(indexTs).toBe(`export * from "./list-posts.js";\n`);
});

test('generate emits named param types and a nullable single-row result for limit 1 queries', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null, title text);
    `,
    files: {
      'sql/find-post-by-slug.sql': `select id, slug, title from posts where slug = :slug limit 1;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/find-post-by-slug.ts');

  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {Client, SqlQuery} from 'sqlfu';

    export type FindPostBySlugParams = {
    	slug: string;
    }

    export type FindPostBySlugResult = {
    	id: number;
    	slug: string;
    	title?: string;
    }

    export async function findPostBySlug(client: Client, params: FindPostBySlugParams): Promise<FindPostBySlugResult | null> {
    	const sql = \`
    	select id, slug, title from posts where slug = ? limit 1;
    	
    	\`
    	const query: SqlQuery = { sql, args: [params.slug] };
    	const rows = await client.all<FindPostBySlugResult>(query);
    	return rows.length > 0 ? rows[0] : null;
    }
    "
  `);
});

test('generate uses schema types for aliased selected columns instead of leaving any behind', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, body text not null);
    `,
    files: {
      'sql/find-post-preview.sql': `select id, body as excerpt from posts limit 5;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/find-post-preview.ts');

  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {Client, SqlQuery} from 'sqlfu';

    export type FindPostPreviewResult = {
    	id: number;
    	excerpt: string;
    }

    export async function findPostPreview(client: Client): Promise<FindPostPreviewResult[]> {
    	const sql = \`
    	select id, body as excerpt from posts limit 5;
    	
    	\`
    	const query: SqlQuery = { sql, args: [] };
    	return client.all<FindPostPreviewResult>(query);
    }
    "
  `);
});

test('generate treats selected columns as required when the query narrows them with is not null', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, published_at text);
    `,
    files: {
      'sql/find-published-post-by-slug.sql': `select id, published_at from posts where published_at is not null limit 1;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/find-published-post-by-slug.ts');

  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {Client, SqlQuery} from 'sqlfu';

    export type FindPublishedPostBySlugResult = {
    	id: number;
    	published_at: string;
    }

    export async function findPublishedPostBySlug(client: Client): Promise<FindPublishedPostBySlugResult | null> {
    	const sql = \`
    	select id, published_at from posts where published_at is not null limit 1;
    	
    	\`
    	const query: SqlQuery = { sql, args: [] };
    	const rows = await client.all<FindPublishedPostBySlugResult>(query);
    	return rows.length > 0 ? rows[0] : null;
    }
    "
  `);
});

test('generate preserves useful result types for queries that read through views', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, body text not null);
      create view post_summaries as select id, body as excerpt from posts;
    `,
    files: {
      'sql/list-post-summaries.sql': `select id, excerpt from post_summaries;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/list-post-summaries.ts');

  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {Client, SqlQuery} from 'sqlfu';

    export type ListPostSummariesResult = {
    	id: number;
    	excerpt: string;
    }

    export async function listPostSummaries(client: Client): Promise<ListPostSummariesResult[]> {
    	const sql = \`
    	select id, excerpt from post_summaries;
    	
    	\`
    	const query: SqlQuery = { sql, args: [] };
    	return client.all<ListPostSummariesResult>(query);
    }
    "
  `);
});

test('generate infers simple expression aliases like substr in result types', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (body text not null);
    `,
    files: {
      'sql/list-post-cards.sql': `select substr(body, 1, 20) as excerpt from posts;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/list-post-cards.ts');

  expect(generatedTs).toMatchInlineSnapshot(`
    "//Invalid SQL
    export {};
    "
  `);
});

test('generate snapshots insert queries', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    files: {
      'sql/insert-post.sql': `insert into posts (slug) values (:slug);`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/insert-post.ts');

  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {Client, SqlQuery} from 'sqlfu';

    export type InsertPostParams = {
    	slug: string;
    }

    export type InsertPostResult = {
    	rowsAffected: number;
    	lastInsertRowid: number;
    }

    export async function insertPost(client: Client, params: InsertPostParams): Promise<InsertPostResult> {
    	const sql = \`
    	insert into posts (slug) values (?);
    	
    	\`
    	const query: SqlQuery = { sql, args: [params.slug] };
    	const result = await client.run(query);
    	if (result.rowsAffected === undefined) {
    		throw new Error('Expected rowsAffected to be present on query result');
    	}
    	if (result.lastInsertRowid === undefined || result.lastInsertRowid === null) {
    		throw new Error('Expected lastInsertRowid to be present on query result');
    	}
    	return {
    		rowsAffected: result.rowsAffected,
    		lastInsertRowid: Number(result.lastInsertRowid),
    	};
    }
    "
  `);
});

test('generate treats insert returning queries as single-row results', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table users (id integer primary key, name text not null, email text not null);
    `,
    files: {
      'sql/add-user.sql': `insert into users (name, email) values (:fullName, :emailAddress) returning *;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/add-user.ts');

  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {Client, SqlQuery} from 'sqlfu';

    export type AddUserParams = {
    	fullName: string;
    	emailAddress: string;
    }

    export type AddUserResult = {
    	id: number;
    	name: string;
    	email: string;
    }

    export async function addUser(client: Client, params: AddUserParams): Promise<AddUserResult> {
    	const sql = \`
    	insert into users (name, email) values (?, ?) returning *;
    	
    	\`
    	const query: SqlQuery = { sql, args: [params.fullName, params.emailAddress] };
    	const rows = await client.all<AddUserResult>(query);
    	return rows[0];
    }
    "
  `);
});

test('generate snapshots update queries', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    files: {
      'sql/update-post.sql': `update posts set slug = :slug where id = :id;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/update-post.ts');

  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {Client, SqlQuery} from 'sqlfu';

    export type UpdatePostData = {
    	slug: string;
    }

    export type UpdatePostParams = {
    	id: number;
    }

    export type UpdatePostResult = {
    	rowsAffected: number;
    }

    export async function updatePost(client: Client, data: UpdatePostData, params: UpdatePostParams): Promise<UpdatePostResult> {
    	const sql = \`
    	update posts set slug = ? where id = ?;
    	
    	\`
    	const query: SqlQuery = { sql, args: [data.slug, params.id] };
    	const result = await client.run(query);
    	if (result.rowsAffected === undefined) {
    		throw new Error('Expected rowsAffected to be present on query result');
    	}
    	return {
    		rowsAffected: result.rowsAffected,
    	};
    }
    "
  `);
});

test('generate snapshots delete queries', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    files: {
      'sql/delete-post.sql': `delete from posts where id = :id;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/delete-post.ts');

  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {Client, SqlQuery} from 'sqlfu';

    export type DeletePostParams = {
    	id: number;
    }

    export type DeletePostResult = {
    	rowsAffected: number;
    }

    export async function deletePost(client: Client, params: DeletePostParams): Promise<DeletePostResult> {
    	const sql = \`
    	delete from posts where id = ?;
    	
    	\`
    	const query: SqlQuery = { sql, args: [params.id] };
    	const result = await client.run(query);
    	if (result.rowsAffected === undefined) {
    		throw new Error('Expected rowsAffected to be present on query result');
    	}
    	return {
    		rowsAffected: result.rowsAffected,
    	};
    }
    "
  `);
});

test('generate snapshots function queries', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    files: {
      'sql/count-posts.sql': `select count(*) as total from posts;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/count-posts.ts');

  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {Client, SqlQuery} from 'sqlfu';

    export type CountPostsResult = {
    	total: number;
    }

    export async function countPosts(client: Client): Promise<CountPostsResult | null> {
    	const sql = \`
    	select count(*) as total from posts;
    	
    	\`
    	const query: SqlQuery = { sql, args: [] };
    	const rows = await client.all<CountPostsResult>(query);
    	return rows.length > 0 ? rows[0] : null;
    }
    "
  `);
});

test('generate snapshots user-defined function queries', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (slug text not null);
    `,
    files: {
      'sql/list-normalized-slugs.sql': `select my_slugify(slug) as normalized_slug from posts;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/list-normalized-slugs.ts');

  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(generatedTs).toMatchInlineSnapshot(`
    "//Invalid SQL
    export {};
    "
  `);
});

test('generate snapshots cte queries with the works in one query', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    files: {
      'sql/sync-post-from-cte.sql': dedent`
        with incoming as (select :id as id, :slug as slug),
        inserted as (
          insert into posts (id, slug)
          select id, slug from incoming
          where not exists (select 1 from posts where posts.id = incoming.id)
          returning id, slug
        ),
        updated as (
          update posts
          set slug = (select slug from incoming where incoming.id = posts.id)
          where id in (select id from incoming)
          returning id, slug
        )
        select id, slug from updated
        union all
        select id, slug from inserted;
      `,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/sync-post-from-cte.ts');

  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(generatedTs).toMatchInlineSnapshot(`
    "//Invalid SQL
    export {};
    "
  `);
});

async function createGenerateFixture(input: {
  definitionsSql: string;
  files: Record<string, string>;
  config?: {
    generatedImportExtension?: '.js' | '.ts';
  };
}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-generate-'));
  await fs.writeFile(path.join(root, 'definitions.sql'), `${input.definitionsSql.trim()}\n`);
  await fs.writeFile(
    path.join(root, 'sqlfu.config.ts'),
    dedent`
      export default {
        dbPath: './app.db',
        migrationsDir: './migrations',
        definitionsPath: './definitions.sql',
        sqlDir: './sql',
        ${input.config?.generatedImportExtension ? `generatedImportExtension: '${input.config.generatedImportExtension}',` : ''}
      };
    `,
  );

  for (const [relativePath, contents] of Object.entries(input.files)) {
    const fullPath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(fullPath), {recursive: true});
    await fs.writeFile(fullPath, `${contents.trim()}\n`);
  }

  return {
    async generate() {
      await inWorkingDirectory(root, () => generateQueryTypes());
    },
    async readFile(relativePath: string) {
      return fs.readFile(path.join(root, relativePath), 'utf8');
    },
    async importTranspiledModule<TModule>(relativePath: string): Promise<TModule> {
      const sourcePath = path.join(root, relativePath);
      const source = await fs.readFile(sourcePath, 'utf8');
      const outputPath = sourcePath.replace(/\.ts$/, '.mjs');
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ESNext,
        },
      });

      await fs.writeFile(outputPath, transpiled.outputText);
      return import(pathToFileURL(outputPath).href) as Promise<TModule>;
    },
    async getCompileDiagnostics() {
      const project = new Project({
        compilerOptions: {
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          target: ts.ScriptTarget.ESNext,
          lib: ['lib.esnext.d.ts'],
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          baseUrl: root,
          paths: {
            sqlfu: [path.join(packageRoot, 'src', 'index.ts')],
            'sqlfu/client': [path.join(packageRoot, 'src', 'client.ts')],
            '@libsql/client': [path.join(packageRoot, 'node_modules', '@libsql', 'client')],
            'better-sqlite3': [path.join(packageRoot, 'node_modules', 'better-sqlite3')],
          },
          types: ['node'],
        },
      });

      project.addSourceFilesAtPaths(path.join(packageRoot, 'src', '**', '*.ts'));
      project.addSourceFilesAtPaths(path.join(root, 'sql', '**', '*.ts'));
      project.addSourceFilesAtPaths(path.join(root, 'sql', '**', '*.d.ts'));

      return project
        .getPreEmitDiagnostics()
        .map((diagnostic) => project.formatDiagnosticsWithColorAndContext([diagnostic]))
        .filter((message) => message.includes(`${path.sep}sql${path.sep}`));
    },
    async [Symbol.asyncDispose]() {
      await fs.rm(root, {recursive: true, force: true});
    },
  };
}

async function inWorkingDirectory<TResult>(cwd: string, fn: () => Promise<TResult>): Promise<TResult> {
  const previousCwd = process.cwd();
  process.chdir(cwd);
  try {
    return await fn();
  } finally {
    process.chdir(previousCwd);
  }
}
