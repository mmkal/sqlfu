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
