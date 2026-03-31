import dedent from 'dedent';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect, test} from 'vitest';

import {generateQueryTypes} from '../src/typegen/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sqlite3defBinaryPath = path.join(packageRoot, '.sqlfu', 'bin', 'sqlite3def');

test('generate writes wrappers and a barrel for every checked-in query', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null, body text not null, published_at text);
      create view post_summaries as select id, slug, published_at, body as excerpt from posts;
    `,
    sqlFiles: {
      'sql/list-post-summaries.sql': `select id, slug, published_at, excerpt from post_summaries;`,
      'sql/find-post-by-slug.sql': `select id, slug, body as excerpt from posts where slug = :slug limit 1;`,
    },
  });

  await project.generate();

  const listPostSummariesTs = await project.readFile('sql/list-post-summaries.ts');
  const findPostBySlugTs = await project.readFile('sql/find-post-by-slug.ts');
  const indexTs = await project.readFile('sql/index.ts');
  const typesqlJson = await project.readFile('typesql.json');

  expect(indexTs).toMatch(/list-post-summaries\.js/);
  expect(indexTs).toMatch(/find-post-by-slug\.js/);
  expect(listPostSummariesTs).toMatchInlineSnapshot(`
    "import type {AsyncExecutor} from 'sqlfu';

    export type ListPostSummariesResult = {
    	id: number;
    	slug: string;
    	published_at?: string;
    	excerpt: string;
    }

    export async function listPostSummaries(executor: AsyncExecutor): Promise<ListPostSummariesResult[]> {
    	const sql = \`
    		select id, slug, published_at, excerpt from post_summaries;
    		
    		\`
    	return executor.query<ListPostSummariesResult>({ sql, args: [] });
    }
    "
  `);
  expect(findPostBySlugTs).toMatchInlineSnapshot(`
    "import type {AsyncExecutor} from 'sqlfu';

    export type FindPostBySlugParams = {
    	slug: string;
    }

    export type FindPostBySlugResult = {
    	id: number;
    	slug: string;
    	excerpt: string;
    }

    export async function findPostBySlug(executor: AsyncExecutor, params: FindPostBySlugParams): Promise<FindPostBySlugResult | null> {
    	const sql = \`
    		select id, slug, body as excerpt from posts where slug = ? limit 1;
    		
    		\`
    	return executor.query<FindPostBySlugResult>({ sql, args: [params.slug] })
    	.then(result => result.rows[0] ?? null);
    }
    "
  `);
  expect(typesqlJson).toContain('"includeCrudTables": []');
});

test('generate emits named param types and a nullable single-row result for limit 1 queries', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null, title text);
    `,
    sqlFiles: {
      'sql/find-post-by-slug.sql': `select id, slug, title from posts where slug = :slug limit 1;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/find-post-by-slug.ts');

  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {AsyncExecutor} from 'sqlfu';

    export type FindPostBySlugParams = {
    	slug: string;
    }

    export type FindPostBySlugResult = {
    	id: number;
    	slug: string;
    	title?: string;
    }

    export async function findPostBySlug(executor: AsyncExecutor, params: FindPostBySlugParams): Promise<FindPostBySlugResult | null> {
    	const sql = \`
    		select id, slug, title from posts where slug = ? limit 1;
    		
    		\`
    	return executor.query<FindPostBySlugResult>({ sql, args: [params.slug] })
    	.then(result => result.rows[0] ?? null);
    }
    "
  `);
});

test('generate uses schema types for aliased selected columns instead of leaving any behind', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, body text not null);
    `,
    sqlFiles: {
      'sql/find-post-preview.sql': `select id, body as excerpt from posts limit 5;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/find-post-preview.ts');

  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {AsyncExecutor} from 'sqlfu';

    export type FindPostPreviewResult = {
    	id: number;
    	excerpt: string;
    }

    export async function findPostPreview(executor: AsyncExecutor): Promise<FindPostPreviewResult[]> {
    	const sql = \`
    		select id, body as excerpt from posts limit 5;
    		
    		\`
    	return executor.query<FindPostPreviewResult>({ sql, args: [] });
    }
    "
  `);
});

test('generate treats selected columns as required when the query narrows them with is not null', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, published_at text);
    `,
    sqlFiles: {
      'sql/find-published-post-by-slug.sql': `select id, published_at from posts where published_at is not null limit 1;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/find-published-post-by-slug.ts');

  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {AsyncExecutor} from 'sqlfu';

    export type FindPublishedPostBySlugResult = {
    	id: number;
    	published_at: string;
    }

    export async function findPublishedPostBySlug(executor: AsyncExecutor): Promise<FindPublishedPostBySlugResult | null> {
    	const sql = \`
    		select id, published_at from posts where published_at is not null limit 1;
    		
    		\`
    	return executor.query<FindPublishedPostBySlugResult>({ sql, args: [] })
    	.then(result => result.rows[0] ?? null);
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
    sqlFiles: {
      'sql/list-post-summaries.sql': `select id, excerpt from post_summaries;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/list-post-summaries.ts');

  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {AsyncExecutor} from 'sqlfu';

    export type ListPostSummariesResult = {
    	id: number;
    	excerpt: string;
    }

    export async function listPostSummaries(executor: AsyncExecutor): Promise<ListPostSummariesResult[]> {
    	const sql = \`
    		select id, excerpt from post_summaries;
    		
    		\`
    	return executor.query<ListPostSummariesResult>({ sql, args: [] });
    }
    "
  `);
});

test('generate infers simple expression aliases like substr in result types', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (body text not null);
    `,
    sqlFiles: {
      'sql/list-post-cards.sql': `select substr(body, 1, 20) as excerpt from posts;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/list-post-cards.ts');

  expect(generatedTs).toMatchInlineSnapshot(`"//Invalid SQL"`);
});

test('generate snapshots insert queries', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    sqlFiles: {
      'sql/insert-post.sql': `insert into posts (slug) values (:slug);`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/insert-post.ts');

  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {AsyncExecutor} from 'sqlfu';

    export type InsertPostParams = {
    	slug: string;
    }

    export type InsertPostResult = {
    	rowsAffected: number;
    	lastInsertRowid: number;
    }

    export async function insertPost(client: Client | Transaction, params: InsertPostParams): Promise<InsertPostResult> {
    	const sql = \`
    	insert into posts (slug) values (?);
    	
    	\`
    	return client.execute({ sql, args: [params.slug] })
    		.then(res => mapArrayToInsertPostResult(res));
    }

    function mapArrayToInsertPostResult(data: any) {
    	const result: InsertPostResult = {
    		rowsAffected: data.rowsAffected,
    		lastInsertRowid: data.lastInsertRowid
    	}
    	return result;
    }"
  `);
});

test('generate snapshots update queries', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    sqlFiles: {
      'sql/update-post.sql': `update posts set slug = :slug where id = :id;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/update-post.ts');

  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {AsyncExecutor} from 'sqlfu';

    export type UpdatePostData = {
    	slug: string;
    }

    export type UpdatePostParams = {
    	id: number;
    }

    export type UpdatePostResult = {
    	rowsAffected: number;
    }

    export async function updatePost(client: Client | Transaction, data: UpdatePostData, params: UpdatePostParams): Promise<UpdatePostResult> {
    	const sql = \`
    	update posts set slug = ? where id = ?;
    	
    	\`
    	return client.execute({ sql, args: [data.slug, params.id] })
    		.then(res => mapArrayToUpdatePostResult(res));
    }

    function mapArrayToUpdatePostResult(data: any) {
    	const result: UpdatePostResult = {
    		rowsAffected: data.rowsAffected
    	}
    	return result;
    }"
  `);
});

test('generate snapshots delete queries', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    sqlFiles: {
      'sql/delete-post.sql': `delete from posts where id = :id;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/delete-post.ts');

  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {AsyncExecutor} from 'sqlfu';

    export type DeletePostParams = {
    	id: number;
    }

    export type DeletePostResult = {
    	rowsAffected: number;
    }

    export async function deletePost(client: Client | Transaction, params: DeletePostParams): Promise<DeletePostResult> {
    	const sql = \`
    	delete from posts where id = ?;
    	
    	\`
    	return client.execute({ sql, args: [params.id] })
    		.then(res => mapArrayToDeletePostResult(res));
    }

    function mapArrayToDeletePostResult(data: any) {
    	const result: DeletePostResult = {
    		rowsAffected: data.rowsAffected
    	}
    	return result;
    }"
  `);
});

test('generate snapshots function queries', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    sqlFiles: {
      'sql/count-posts.sql': `select count(*) as total from posts;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/count-posts.ts');

  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {AsyncExecutor} from 'sqlfu';

    export type CountPostsResult = {
    	total: number;
    }

    export async function countPosts(executor: AsyncExecutor): Promise<CountPostsResult | null> {
    	const sql = \`
    		select count(*) as total from posts;
    		
    		\`
    	return executor.query<CountPostsResult>({ sql, args: [] })
    	.then(result => result.rows[0] ?? null);
    }
    "
  `);
});

test('generate snapshots user-defined function queries', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (slug text not null);
    `,
    sqlFiles: {
      'sql/list-normalized-slugs.sql': `select my_slugify(slug) as normalized_slug from posts;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/list-normalized-slugs.ts');

  expect(generatedTs).toMatchInlineSnapshot(`"//Invalid SQL"`);
});

test('generate snapshots cte queries with the works', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    sqlFiles: {
      'sql/latest-posts.sql': dedent`
        with latest as (select id, slug from posts)
        select id, slug from latest;
      `,
      'sql/latest-post-by-slug.sql': dedent`
        with latest as (select id, slug from posts where slug = :slug)
        select id, slug from latest
        limit 1;
      `,
      'sql/insert-post-from-cte.sql': dedent`
        with incoming as (select :slug as slug)
        insert into posts (slug) select slug from incoming;
      `,
      'sql/update-post-from-cte.sql': dedent`
        with incoming as (select :id as id, :slug as slug)
        update posts
        set slug = (select slug from incoming where incoming.id = posts.id)
        where id in (select id from incoming);
      `,
    },
  });

  await project.generate();

  const latestPostsTs = await project.readFile('sql/latest-posts.ts');
  const latestPostBySlugTs = await project.readFile('sql/latest-post-by-slug.ts');
  const insertPostFromCteTs = await project.readFile('sql/insert-post-from-cte.ts');
  const updatePostFromCteTs = await project.readFile('sql/update-post-from-cte.ts');

  expect(latestPostsTs).toMatchInlineSnapshot(`
    "import type {AsyncExecutor} from 'sqlfu';

    export type LatestPostsResult = {
    	id: number;
    	slug: string;
    }

    export async function latestPosts(executor: AsyncExecutor): Promise<LatestPostsResult[]> {
    	const sql = \`
    		with latest as (select id, slug from posts)
    		select id, slug from latest;
    		
    		\`
    	return executor.query<LatestPostsResult>({ sql, args: [] });
    }
    "
  `);
  expect(latestPostBySlugTs).toMatchInlineSnapshot(`
    "import type {AsyncExecutor} from 'sqlfu';

    export type LatestPostBySlugParams = {
    	slug: string;
    }

    export type LatestPostBySlugResult = {
    	id: number;
    	slug: string;
    }

    export async function latestPostBySlug(executor: AsyncExecutor, params: LatestPostBySlugParams): Promise<LatestPostBySlugResult | null> {
    	const sql = \`
    		with latest as (select id, slug from posts where slug = ?)
    		select id, slug from latest
    		limit 1;
    		
    		\`
    	return executor.query<LatestPostBySlugResult>({ sql, args: [params.slug] })
    	.then(result => result.rows[0] ?? null);
    }
    "
  `);
  expect(insertPostFromCteTs).toMatchInlineSnapshot(`"//Invalid SQL"`);
  expect(updatePostFromCteTs).toMatchInlineSnapshot(`"//Invalid SQL"`);
});

async function createGenerateFixture(input: {
  definitionsSql: string;
  sqlFiles: Record<string, string>;
}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-generate-'));
  await fs.writeFile(path.join(root, 'definitions.sql'), `${input.definitionsSql.trim()}\n`);
  await fs.writeFile(
    path.join(root, 'sqlfu.config.ts'),
    dedent`
      export default {
        dbPath: './app.db',
        snapshotFile: './snapshot.sql',
        definitionsPath: './definitions.sql',
        sqlDir: './sql',
        tempDir: './.sqlfu',
        tempDbPath: './.sqlfu/typegen.db',
        typesqlConfigPath: './typesql.json',
      };
    `,
  );

  for (const [relativePath, contents] of Object.entries(input.sqlFiles)) {
    const fullPath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(fullPath), {recursive: true});
    await fs.writeFile(fullPath, `${contents.trim()}\n`);
  }

  return {
    async generate() {
      await generateQueryTypes({
        cwd: root,
        sqlite3defBinaryPath,
      });
    },
    async readFile(relativePath: string) {
      return fs.readFile(path.join(root, relativePath), 'utf8');
    },
    async [Symbol.asyncDispose]() {
      await fs.rm(root, {recursive: true, force: true});
    },
  };
}
