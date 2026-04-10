import dedent from 'dedent';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createClient} from '@libsql/client';
import {Project, ts} from 'ts-morph';
import {expect, test} from 'vitest';

import {generateQueryTypes} from '../src/typegen/index.js';
import {createTempFixtureRoot, dumpFixtureFs, withTrailingNewline, writeFixtureFiles} from './fs-fixture.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedTsDump = {
  includeGlobs: ['sql/*.ts'],
} as const;

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

  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      find-post-by-slug.ts
        import type {Client, SqlQuery} from 'sqlfu';
        
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
      index.ts
        export * from "./find-post-by-slug.js";
        export * from "./list-post-summaries.js";
      list-post-summaries.ts
        import type {Client, SqlQuery} from 'sqlfu';
        
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
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      index.ts
        export * from "./list-posts.ts";
      list-posts.ts
        import type {Client, SqlQuery} from 'sqlfu';
        
        export type ListPostsResult = {
        	id: number;
        	slug: string;
        }
        
        export async function listPosts(client: Client): Promise<ListPostsResult[]> {
        	const sql = \`
        	select id, slug from posts;
        	
        	\`
        	const query: SqlQuery = { sql, args: [] };
        	return client.all<ListPostsResult>(query);
        }
    "
  `);
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
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      index.ts
        export * from "./list-posts.ts";
      list-posts.ts
        import type {Client, SqlQuery} from 'sqlfu';
        
        export type ListPostsResult = {
        	id: number;
        	slug: string;
        }
        
        export async function listPosts(client: Client): Promise<ListPostsResult[]> {
        	const sql = \`
        	select id, slug from posts;
        	
        	\`
        	const query: SqlQuery = { sql, args: [] };
        	return client.all<ListPostsResult>(query);
        }
    "
  `);
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
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      index.ts
        export * from "./list-posts.js";
      list-posts.ts
        import type {Client, SqlQuery} from 'sqlfu';
        
        export type ListPostsResult = {
        	id: number;
        	slug: string;
        }
        
        export async function listPosts(client: Client): Promise<ListPostsResult[]> {
        	const sql = \`
        	select id, slug from posts;
        	
        	\`
        	const query: SqlQuery = { sql, args: [] };
        	return client.all<ListPostsResult>(query);
        }
    "
  `);
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
  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      find-post-by-slug.ts
        import type {Client, SqlQuery} from 'sqlfu';
        
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
      index.ts
        export * from "./find-post-by-slug.js";
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
  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      find-post-preview.ts
        import type {Client, SqlQuery} from 'sqlfu';
        
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
      index.ts
        export * from "./find-post-preview.js";
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
  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      find-published-post-by-slug.ts
        import type {Client, SqlQuery} from 'sqlfu';
        
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
      index.ts
        export * from "./find-published-post-by-slug.js";
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
  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      index.ts
        export * from "./list-post-summaries.js";
      list-post-summaries.ts
        import type {Client, SqlQuery} from 'sqlfu';
        
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
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      index.ts
        export * from "./list-post-cards.js";
      list-post-cards.ts
        //Invalid SQL
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
  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      index.ts
        export * from "./insert-post.js";
      insert-post.ts
        import type {Client, SqlQuery} from 'sqlfu';
        
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
  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      add-user.ts
        import type {Client, SqlQuery} from 'sqlfu';
        
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
      index.ts
        export * from "./add-user.js";
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
  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      index.ts
        export * from "./update-post.js";
      update-post.ts
        import type {Client, SqlQuery} from 'sqlfu';
        
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
  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      delete-post.ts
        import type {Client, SqlQuery} from 'sqlfu';
        
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
      index.ts
        export * from "./delete-post.js";
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
  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      count-posts.ts
        import type {Client, SqlQuery} from 'sqlfu';
        
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
      index.ts
        export * from "./count-posts.js";
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
  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      index.ts
        export * from "./list-normalized-slugs.js";
      list-normalized-slugs.ts
        //Invalid SQL
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
  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      index.ts
        export * from "./sync-post-from-cte.js";
      sync-post-from-cte.ts
        //Invalid SQL
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
  const root = await createTempFixtureRoot('generate');
  const dbPath = path.join(root, 'app.db');
  await writeFixtureFiles(root, {
    'definitions.sql': input.definitionsSql,
    'sqlfu.config.ts': dedent`
      export default {
        dbPath: './app.db',
        migrationsDir: './migrations',
        definitionsPath: './definitions.sql',
        sqlDir: './sql',
        createDatabase() {
          throw new Error('unused in generate tests');
        },
        getMainDatabase() {
          throw new Error('unused in generate tests');
        },
        ${input.config?.generatedImportExtension ? `generatedImportExtension: '${input.config.generatedImportExtension}',` : ''}
      };
    `,
    ...input.files,
  });

  await applyDefinitionsToDatabase(dbPath, input.definitionsSql);

  return {
    async generate() {
      await inWorkingDirectory(root, () => generateQueryTypes());
    },
    async readFile(relativePath: string) {
      return fs.readFile(path.join(root, relativePath), 'utf8');
    },
    async dumpFs(input?: {
      includeGlobs?: readonly string[];
      excludeGlobs?: readonly string[];
    }) {
      return dumpFixtureFs(root, {ignoredNames: ['app.db', '.sqlfu'], ...input});
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

async function applyDefinitionsToDatabase(dbPath: string, definitionsSql: string) {
  const client = createClient({url: `file:${dbPath}`});

  try {
    for (const statement of definitionsSqlStatements(definitionsSql)) {
      await client.execute(statement);
    }
  } finally {
    client.close();
  }
}

function definitionsSqlStatements(sql: string) {
  return withTrailingNewline(dedent(sql))
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
}
