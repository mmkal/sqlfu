import dedent from 'dedent';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Project, ts} from 'ts-morph';
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
    files: {
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
  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(listPostSummariesTs).toMatchInlineSnapshot(`
    "import type {AsyncExecutor, SqlQuery} from 'sqlfu';

    export type ListPostSummariesResult = {
    	id: number;
    	slug: string;
    	published_at?: string;
    	excerpt: string;
    }

    export async function listPostSummaries(executor: AsyncExecutor): Promise<ListPostSummariesResult[]> {
    	const client = {
    		execute(query: string | SqlQuery) {
    			return executor.query(typeof query === 'string' ? {sql: query, args: []} : query).then((result) => ({
    				...result,
    				rows: Array.from(result.rows),
    			}));
    		},
    	};
    	const sql = \`
    	select id, slug, published_at, excerpt from post_summaries;
    	
    	\`
    	return client.execute(sql)
    		.then(res => res.rows)
    		.then(rows => rows.map(row => mapArrayToListPostSummariesResult(row)));
    }

    function mapArrayToListPostSummariesResult(data: any) {
    	const result: ListPostSummariesResult = {
    		id: data[0],
    		slug: data[1],
    		published_at: data[2],
    		excerpt: data[3]
    	}
    	return result;
    }"
  `);
  expect(findPostBySlugTs).toMatchInlineSnapshot(`
    "import type {AsyncExecutor, SqlQuery} from 'sqlfu';

    export type FindPostBySlugParams = {
    	slug: string;
    }

    export type FindPostBySlugResult = {
    	id: number;
    	slug: string;
    	excerpt: string;
    }

    export async function findPostBySlug(executor: AsyncExecutor, params: FindPostBySlugParams): Promise<FindPostBySlugResult | null> {
    	const client = {
    		execute(query: string | SqlQuery) {
    			return executor.query(typeof query === 'string' ? {sql: query, args: []} : query).then((result) => ({
    				...result,
    				rows: Array.from(result.rows),
    			}));
    		},
    	};
    	const sql = \`
    	select id, slug, body as excerpt from posts where slug = ? limit 1;
    	
    	\`
    	return client.execute({ sql, args: [params.slug] })
    		.then(res => res.rows)
    		.then(rows => rows.length > 0 ? mapArrayToFindPostBySlugResult(rows[0]) : null);
    }

    function mapArrayToFindPostBySlugResult(data: any) {
    	const result: FindPostBySlugResult = {
    		id: data[0],
    		slug: data[1],
    		excerpt: data[2]
    	}
    	return result;
    }"
  `);
  expect(typesqlJson).toContain('"includeCrudTables": []');
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
    "import type {AsyncExecutor, SqlQuery} from 'sqlfu';

    export type FindPostBySlugParams = {
    	slug: string;
    }

    export type FindPostBySlugResult = {
    	id: number;
    	slug: string;
    	title?: string;
    }

    export async function findPostBySlug(executor: AsyncExecutor, params: FindPostBySlugParams): Promise<FindPostBySlugResult | null> {
    	const client = {
    		execute(query: string | SqlQuery) {
    			return executor.query(typeof query === 'string' ? {sql: query, args: []} : query).then((result) => ({
    				...result,
    				rows: Array.from(result.rows),
    			}));
    		},
    	};
    	const sql = \`
    	select id, slug, title from posts where slug = ? limit 1;
    	
    	\`
    	return client.execute({ sql, args: [params.slug] })
    		.then(res => res.rows)
    		.then(rows => rows.length > 0 ? mapArrayToFindPostBySlugResult(rows[0]) : null);
    }

    function mapArrayToFindPostBySlugResult(data: any) {
    	const result: FindPostBySlugResult = {
    		id: data[0],
    		slug: data[1],
    		title: data[2]
    	}
    	return result;
    }"
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
    "import type {AsyncExecutor, SqlQuery} from 'sqlfu';

    export type FindPostPreviewResult = {
    	id: number;
    	excerpt: string;
    }

    export async function findPostPreview(executor: AsyncExecutor): Promise<FindPostPreviewResult[]> {
    	const client = {
    		execute(query: string | SqlQuery) {
    			return executor.query(typeof query === 'string' ? {sql: query, args: []} : query).then((result) => ({
    				...result,
    				rows: Array.from(result.rows),
    			}));
    		},
    	};
    	const sql = \`
    	select id, body as excerpt from posts limit 5;
    	
    	\`
    	return client.execute(sql)
    		.then(res => res.rows)
    		.then(rows => rows.map(row => mapArrayToFindPostPreviewResult(row)));
    }

    function mapArrayToFindPostPreviewResult(data: any) {
    	const result: FindPostPreviewResult = {
    		id: data[0],
    		excerpt: data[1]
    	}
    	return result;
    }"
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
    "import type {AsyncExecutor, SqlQuery} from 'sqlfu';

    export type FindPublishedPostBySlugResult = {
    	id: number;
    	published_at: string;
    }

    export async function findPublishedPostBySlug(executor: AsyncExecutor): Promise<FindPublishedPostBySlugResult | null> {
    	const client = {
    		execute(query: string | SqlQuery) {
    			return executor.query(typeof query === 'string' ? {sql: query, args: []} : query).then((result) => ({
    				...result,
    				rows: Array.from(result.rows),
    			}));
    		},
    	};
    	const sql = \`
    	select id, published_at from posts where published_at is not null limit 1;
    	
    	\`
    	return client.execute(sql)
    		.then(res => res.rows)
    		.then(rows => rows.length > 0 ? mapArrayToFindPublishedPostBySlugResult(rows[0]) : null);
    }

    function mapArrayToFindPublishedPostBySlugResult(data: any) {
    	const result: FindPublishedPostBySlugResult = {
    		id: data[0],
    		published_at: data[1]
    	}
    	return result;
    }"
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
    "import type {AsyncExecutor, SqlQuery} from 'sqlfu';

    export type ListPostSummariesResult = {
    	id: number;
    	excerpt: string;
    }

    export async function listPostSummaries(executor: AsyncExecutor): Promise<ListPostSummariesResult[]> {
    	const client = {
    		execute(query: string | SqlQuery) {
    			return executor.query(typeof query === 'string' ? {sql: query, args: []} : query).then((result) => ({
    				...result,
    				rows: Array.from(result.rows),
    			}));
    		},
    	};
    	const sql = \`
    	select id, excerpt from post_summaries;
    	
    	\`
    	return client.execute(sql)
    		.then(res => res.rows)
    		.then(rows => rows.map(row => mapArrayToListPostSummariesResult(row)));
    }

    function mapArrayToListPostSummariesResult(data: any) {
    	const result: ListPostSummariesResult = {
    		id: data[0],
    		excerpt: data[1]
    	}
    	return result;
    }"
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
    "import type {AsyncExecutor, SqlQuery} from 'sqlfu';

    export type InsertPostParams = {
    	slug: string;
    }

    export type InsertPostResult = {
    	rowsAffected: number;
    	lastInsertRowid: number;
    }

    export async function insertPost(executor: AsyncExecutor, params: InsertPostParams): Promise<InsertPostResult> {
    	const client = {
    		execute(query: string | SqlQuery) {
    			return executor.query(typeof query === 'string' ? {sql: query, args: []} : query).then((result) => ({
    				...result,
    				rows: Array.from(result.rows),
    			}));
    		},
    	};
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
    files: {
      'sql/update-post.sql': `update posts set slug = :slug where id = :id;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/update-post.ts');

  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {AsyncExecutor, SqlQuery} from 'sqlfu';

    export type UpdatePostData = {
    	slug: string;
    }

    export type UpdatePostParams = {
    	id: number;
    }

    export type UpdatePostResult = {
    	rowsAffected: number;
    }

    export async function updatePost(executor: AsyncExecutor, data: UpdatePostData, params: UpdatePostParams): Promise<UpdatePostResult> {
    	const client = {
    		execute(query: string | SqlQuery) {
    			return executor.query(typeof query === 'string' ? {sql: query, args: []} : query).then((result) => ({
    				...result,
    				rows: Array.from(result.rows),
    			}));
    		},
    	};
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
    files: {
      'sql/delete-post.sql': `delete from posts where id = :id;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/delete-post.ts');

  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {AsyncExecutor, SqlQuery} from 'sqlfu';

    export type DeletePostParams = {
    	id: number;
    }

    export type DeletePostResult = {
    	rowsAffected: number;
    }

    export async function deletePost(executor: AsyncExecutor, params: DeletePostParams): Promise<DeletePostResult> {
    	const client = {
    		execute(query: string | SqlQuery) {
    			return executor.query(typeof query === 'string' ? {sql: query, args: []} : query).then((result) => ({
    				...result,
    				rows: Array.from(result.rows),
    			}));
    		},
    	};
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
    files: {
      'sql/count-posts.sql': `select count(*) as total from posts;`,
    },
  });

  await project.generate();

  const generatedTs = await project.readFile('sql/count-posts.ts');

  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(generatedTs).toMatchInlineSnapshot(`
    "import type {AsyncExecutor, SqlQuery} from 'sqlfu';

    export type CountPostsResult = {
    	total: number;
    }

    export async function countPosts(executor: AsyncExecutor): Promise<CountPostsResult | null> {
    	const client = {
    		execute(query: string | SqlQuery) {
    			return executor.query(typeof query === 'string' ? {sql: query, args: []} : query).then((result) => ({
    				...result,
    				rows: Array.from(result.rows),
    			}));
    		},
    	};
    	const sql = \`
    	select count(*) as total from posts;
    	
    	\`
    	return client.execute(sql)
    		.then(res => res.rows)
    		.then(rows => rows.length > 0 ? mapArrayToCountPostsResult(rows[0]) : null);
    }

    function mapArrayToCountPostsResult(data: any) {
    	const result: CountPostsResult = {
    		total: data[0]
    	}
    	return result;
    }"
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
        snapshotFile: './snapshot.sql',
        definitionsPath: './definitions.sql',
        sqlDir: './sql',
        ${input.config?.generatedImportExtension ? `generatedImportExtension: '${input.config.generatedImportExtension}',` : ''}
        tempDir: './.sqlfu',
        tempDbPath: './.sqlfu/typegen.db',
        typesqlConfigPath: './typesql.json',
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
      await generateQueryTypes({
        cwd: root,
        sqlite3defBinaryPath,
      });
    },
    async readFile(relativePath: string) {
      return fs.readFile(path.join(root, relativePath), 'utf8');
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
          },
          types: ['node'],
        },
      });

      project.addSourceFilesAtPaths(path.join(packageRoot, 'src', '**', '*.ts'));
      project.addSourceFilesAtPaths(path.join(root, 'sql', '**', '*.ts'));

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
