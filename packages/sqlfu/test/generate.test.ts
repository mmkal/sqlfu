import dedent from 'dedent';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Project, ts} from 'ts-morph';
import {expect, test} from 'vitest';

import {createNodeSqliteClient} from '../src/client.js';
import {generateQueryTypes} from '../src/typegen/index.js';
import {createTempFixtureRoot, dumpFixtureFs, withTrailingNewline, writeFixtureFiles} from './fs-fixture.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedTsDump = {
  includeGlobs: ['sql/.generated/*.ts'],
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
      .generated/
        find-post-by-slug.sql.ts
          import type {Client, SqlQuery} from 'sqlfu';
          
          export type FindPostBySlugParams = {
          	slug: string;
          }
          
          export type FindPostBySlugResult = {
          	id: number;
          	slug: string;
          	excerpt: string;
          }
          
          const FindPostBySlugSql = \`
          select id, slug, body as excerpt from posts where slug = ? limit 1;
          \`
          
          export async function findPostBySlug(client: Client, params: FindPostBySlugParams): Promise<FindPostBySlugResult | null> {
          	const query: SqlQuery = { sql: FindPostBySlugSql, args: [params.slug], name: "find-post-by-slug" };
          	const rows = await client.all<FindPostBySlugResult>(query);
          	return rows.length > 0 ? rows[0] : null;
          }
        index.ts
          export * from "./find-post-by-slug.sql.js";
          export * from "./list-post-summaries.sql.js";
        list-post-summaries.sql.ts
          import type {Client, SqlQuery} from 'sqlfu';
          
          export type ListPostSummariesResult = {
          	id: number;
          	slug: string;
          	published_at?: string;
          	excerpt: string;
          }
          
          const ListPostSummariesSql = \`
          select id, slug, published_at, excerpt from post_summaries;
          \`
          
          export async function listPostSummaries(client: Client): Promise<ListPostSummariesResult[]> {
          	const query: SqlQuery = { sql: ListPostSummariesSql, args: [], name: "list-post-summaries" };
          	return client.all<ListPostSummariesResult>(query);
          }
    "
  `);
});

test('generate writes a runtime query catalog with json schema for forms', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (
        id integer primary key,
        slug text not null,
        title text,
        is_published boolean not null,
        status text not null check (status in ('draft', 'published'))
      );
    `,
    files: {
      'sql/find-posts.sql': dedent`
        select id, slug, title, is_published, status
        from posts
        where status = :status and is_published = :is_published
        limit 10;
      `,
    },
  });

  await project.generate();

  expect(await project.readJson('.sqlfu/query-catalog.json')).toMatchObject({
    queries: [
      {
        kind: 'query',
        id: 'find-posts',
        sqlFile: 'sql/find-posts.sql',
        functionName: 'findPosts',
        queryType: 'Select',
        resultMode: 'many',
        args: [
          {
            scope: 'params',
            name: 'status',
            tsType: `('draft' | 'published')`,
            driverEncoding: 'identity',
          },
          {
            scope: 'params',
            name: 'is_published',
            tsType: 'number',
            driverEncoding: 'identity',
          },
        ],
        paramsSchema: {
          type: 'object',
          required: ['status', 'is_published'],
          properties: {
            status: {
              type: 'string',
              enum: ['draft', 'published'],
            },
            is_published: {
              type: 'number',
            },
          },
        },
        resultSchema: {
          type: 'object',
          properties: {
            id: {type: 'number'},
            slug: {type: 'string'},
            title: {anyOf: [{type: 'string'}, {type: 'null'}]},
            is_published: {type: 'number'},
            status: {type: 'string', enum: ['draft', 'published']},
          },
        },
      },
    ],
  });
});

test('generate includes invalid queries in the runtime query catalog', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    files: {
      'sql/broken.sql': `select nope from missing_table;`,
    },
  });

  await project.generate();

  expect(await project.readJson('.sqlfu/query-catalog.json')).toMatchObject({
    queries: [
      {
        kind: 'error',
        id: 'broken',
        sqlFile: 'sql/broken.sql',
        functionName: 'broken',
        error: {
          name: 'Invalid sql',
        },
      },
    ],
  });
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
      .generated/
        index.ts
          export * from "./list-posts.sql.ts";
        list-posts.sql.ts
          import type {Client, SqlQuery} from 'sqlfu';
          
          export type ListPostsResult = {
          	id: number;
          	slug: string;
          }
          
          const ListPostsSql = \`
          select id, slug from posts;
          \`
          
          export async function listPosts(client: Client): Promise<ListPostsResult[]> {
          	const query: SqlQuery = { sql: ListPostsSql, args: [], name: "list-posts" };
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
      'tsconfig.json': JSON.stringify({compilerOptions: {allowImportingTsExtensions: true}}),
    },
  });

  await project.generate();
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      .generated/
        index.ts
          export * from "./list-posts.sql.ts";
        list-posts.sql.ts
          import type {Client, SqlQuery} from 'sqlfu';
          
          export type ListPostsResult = {
          	id: number;
          	slug: string;
          }
          
          const ListPostsSql = \`
          select id, slug from posts;
          \`
          
          export async function listPosts(client: Client): Promise<ListPostsResult[]> {
          	const query: SqlQuery = { sql: ListPostsSql, args: [], name: "list-posts" };
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
      'tsconfig.json': JSON.stringify({compilerOptions: {allowImportingTsExtensions: true}}),
    },
    config: {
      generatedImportExtension: '.js',
    },
  });

  await project.generate();
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      .generated/
        index.ts
          export * from "./list-posts.sql.js";
        list-posts.sql.ts
          import type {Client, SqlQuery} from 'sqlfu';
          
          export type ListPostsResult = {
          	id: number;
          	slug: string;
          }
          
          const ListPostsSql = \`
          select id, slug from posts;
          \`
          
          export async function listPosts(client: Client): Promise<ListPostsResult[]> {
          	const query: SqlQuery = { sql: ListPostsSql, args: [], name: "list-posts" };
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
      .generated/
        find-post-by-slug.sql.ts
          import type {Client, SqlQuery} from 'sqlfu';
          
          export type FindPostBySlugParams = {
          	slug: string;
          }
          
          export type FindPostBySlugResult = {
          	id: number;
          	slug: string;
          	title?: string;
          }
          
          const FindPostBySlugSql = \`
          select id, slug, title from posts where slug = ? limit 1;
          \`
          
          export async function findPostBySlug(client: Client, params: FindPostBySlugParams): Promise<FindPostBySlugResult | null> {
          	const query: SqlQuery = { sql: FindPostBySlugSql, args: [params.slug], name: "find-post-by-slug" };
          	const rows = await client.all<FindPostBySlugResult>(query);
          	return rows.length > 0 ? rows[0] : null;
          }
        index.ts
          export * from "./find-post-by-slug.sql.js";
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
      .generated/
        find-post-preview.sql.ts
          import type {Client, SqlQuery} from 'sqlfu';
          
          export type FindPostPreviewResult = {
          	id: number;
          	excerpt: string;
          }
          
          const FindPostPreviewSql = \`
          select id, body as excerpt from posts limit 5;
          \`
          
          export async function findPostPreview(client: Client): Promise<FindPostPreviewResult[]> {
          	const query: SqlQuery = { sql: FindPostPreviewSql, args: [], name: "find-post-preview" };
          	return client.all<FindPostPreviewResult>(query);
          }
        index.ts
          export * from "./find-post-preview.sql.js";
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
      .generated/
        find-published-post-by-slug.sql.ts
          import type {Client, SqlQuery} from 'sqlfu';
          
          export type FindPublishedPostBySlugResult = {
          	id: number;
          	published_at: string;
          }
          
          const FindPublishedPostBySlugSql = \`
          select id, published_at from posts where published_at is not null limit 1;
          \`
          
          export async function findPublishedPostBySlug(client: Client): Promise<FindPublishedPostBySlugResult | null> {
          	const query: SqlQuery = { sql: FindPublishedPostBySlugSql, args: [], name: "find-published-post-by-slug" };
          	const rows = await client.all<FindPublishedPostBySlugResult>(query);
          	return rows.length > 0 ? rows[0] : null;
          }
        index.ts
          export * from "./find-published-post-by-slug.sql.js";
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
      .generated/
        index.ts
          export * from "./list-post-summaries.sql.js";
        list-post-summaries.sql.ts
          import type {Client, SqlQuery} from 'sqlfu';
          
          export type ListPostSummariesResult = {
          	id: number;
          	excerpt: string;
          }
          
          const ListPostSummariesSql = \`
          select id, excerpt from post_summaries;
          \`
          
          export async function listPostSummaries(client: Client): Promise<ListPostSummariesResult[]> {
          	const query: SqlQuery = { sql: ListPostSummariesSql, args: [], name: "list-post-summaries" };
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
      .generated/
        index.ts
          export * from "./list-post-cards.sql.js";
        list-post-cards.sql.ts
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
      .generated/
        index.ts
          export * from "./insert-post.sql.js";
        insert-post.sql.ts
          import type {Client, SqlQuery} from 'sqlfu';
          
          export type InsertPostParams = {
          	slug: string;
          }
          
          export type InsertPostResult = {
          	rowsAffected: number;
          	lastInsertRowid: number;
          }
          
          const InsertPostSql = \`
          insert into posts (slug) values (?);
          \`
          
          export async function insertPost(client: Client, params: InsertPostParams): Promise<InsertPostResult> {
          	const query: SqlQuery = { sql: InsertPostSql, args: [params.slug], name: "insert-post" };
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
      .generated/
        add-user.sql.ts
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
          
          const AddUserSql = \`
          insert into users (name, email) values (?, ?) returning *;
          \`
          
          export async function addUser(client: Client, params: AddUserParams): Promise<AddUserResult> {
          	const query: SqlQuery = { sql: AddUserSql, args: [params.fullName, params.emailAddress], name: "add-user" };
          	const rows = await client.all<AddUserResult>(query);
          	return rows[0];
          }
        index.ts
          export * from "./add-user.sql.js";
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
      .generated/
        index.ts
          export * from "./update-post.sql.js";
        update-post.sql.ts
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
          
          const UpdatePostSql = \`
          update posts set slug = ? where id = ?;
          \`
          
          export async function updatePost(client: Client, data: UpdatePostData, params: UpdatePostParams): Promise<UpdatePostResult> {
          	const query: SqlQuery = { sql: UpdatePostSql, args: [data.slug, params.id], name: "update-post" };
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
      .generated/
        delete-post.sql.ts
          import type {Client, SqlQuery} from 'sqlfu';
          
          export type DeletePostParams = {
          	id: number;
          }
          
          export type DeletePostResult = {
          	rowsAffected: number;
          }
          
          const DeletePostSql = \`
          delete from posts where id = ?;
          \`
          
          export async function deletePost(client: Client, params: DeletePostParams): Promise<DeletePostResult> {
          	const query: SqlQuery = { sql: DeletePostSql, args: [params.id], name: "delete-post" };
          	const result = await client.run(query);
          	if (result.rowsAffected === undefined) {
          		throw new Error('Expected rowsAffected to be present on query result');
          	}
          	return {
          		rowsAffected: result.rowsAffected,
          	};
          }
        index.ts
          export * from "./delete-post.sql.js";
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
      .generated/
        count-posts.sql.ts
          import type {Client, SqlQuery} from 'sqlfu';
          
          export type CountPostsResult = {
          	total: number;
          }
          
          const CountPostsSql = \`
          select count(*) as total from posts;
          \`
          
          export async function countPosts(client: Client): Promise<CountPostsResult | null> {
          	const query: SqlQuery = { sql: CountPostsSql, args: [], name: "count-posts" };
          	const rows = await client.all<CountPostsResult>(query);
          	return rows.length > 0 ? rows[0] : null;
          }
        index.ts
          export * from "./count-posts.sql.js";
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
      .generated/
        index.ts
          export * from "./list-normalized-slugs.sql.js";
        list-normalized-slugs.sql.ts
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
      .generated/
        index.ts
          export * from "./sync-post-from-cte.sql.js";
        sync-post-from-cte.sql.ts
          //Invalid SQL
          export {};
    "
  `);
});

test('generate preserves nested query directories in output, name, and functionName', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table profiles (id integer primary key, name text not null);
      create table orders (id integer primary key, total integer not null);
    `,
    files: {
      'sql/users/list-profiles.sql': `select id, name from profiles;`,
      'sql/orders/list-orders.sql': `select id, total from orders;`,
    },
  });

  await project.generate();

  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(await project.dumpFs({includeGlobs: ['sql/.generated/**/*.ts']})).toMatchInlineSnapshot(`
    "sql/
      .generated/
        index.ts
          export * from "./orders/list-orders.sql.js";
          export * from "./users/list-profiles.sql.js";
        orders/
          list-orders.sql.ts
            import type {Client, SqlQuery} from 'sqlfu';
            
            export type OrdersListOrdersResult = {
            	id: number;
            	total: number;
            }
            
            const OrdersListOrdersSql = \`
            select id, total from orders;
            \`
            
            export async function ordersListOrders(client: Client): Promise<OrdersListOrdersResult[]> {
            	const query: SqlQuery = { sql: OrdersListOrdersSql, args: [], name: "orders/list-orders" };
            	return client.all<OrdersListOrdersResult>(query);
            }
        users/
          list-profiles.sql.ts
            import type {Client, SqlQuery} from 'sqlfu';
            
            export type UsersListProfilesResult = {
            	id: number;
            	name: string;
            }
            
            const UsersListProfilesSql = \`
            select id, name from profiles;
            \`
            
            export async function usersListProfiles(client: Client): Promise<UsersListProfilesResult[]> {
            	const query: SqlQuery = { sql: UsersListProfilesSql, args: [], name: "users/list-profiles" };
            	return client.all<UsersListProfilesResult>(query);
            }
    "
  `);
});

test('generate with validator: zod emits zod schemas as the source of truth with namespace-merged exports', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (
        id integer primary key,
        slug text not null,
        title text,
        status text not null check (status in ('draft', 'published'))
      );
    `,
    files: {
      'sql/find-post-by-slug.sql': `select id, slug, title, status from posts where slug = :slug limit 1;`,
    },
    config: {generate: {validator: 'zod'}},
  });

  await project.generate();

  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      .generated/
        find-post-by-slug.sql.ts
          import {z} from 'zod';
          import type {Client, SqlQuery} from 'sqlfu';
          
          const Params = z.object({
          	slug: z.string(),
          });
          const Result = z.object({
          	id: z.number(),
          	slug: z.string(),
          	title: z.string().nullable(),
          	status: z.enum(["draft", "published"]),
          });
          const sql = \`
          select id, slug, title, status from posts where slug = ? limit 1;
          \`;
          
          export const findPostBySlug = Object.assign(
          	async function findPostBySlug(client: Client, rawParams: z.infer<typeof Params>): Promise<z.infer<typeof Result> | null> {
          		const parsedParams = Params.safeParse(rawParams);
          		if (!parsedParams.success) throw new Error(z.prettifyError(parsedParams.error));
          		const params = parsedParams.data;
          		const query: SqlQuery = { sql, args: [params.slug], name: "find-post-by-slug" };
          		const rows = await client.all(query);
          		if (rows.length === 0) return null;
          		const parsed = Result.safeParse(rows[0]);
          		if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
          		return parsed.data;
          	},
          	{ Params, Result, sql },
          );
          
          export namespace findPostBySlug {
          	export type Params = z.infer<typeof findPostBySlug.Params>;
          	export type Result = z.infer<typeof findPostBySlug.Result>;
          }
        index.ts
          export * from "./find-post-by-slug.sql.js";
    "
  `);
});

test('generate with validator: zod emits zod wrappers for insert metadata queries', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    files: {
      'sql/insert-post.sql': `insert into posts (slug) values (:slug);`,
    },
    config: {generate: {validator: 'zod'}},
  });

  await project.generate();
  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  const generated = await project.readFile('sql/.generated/insert-post.sql.ts');
  expect(generated).toContain('const Params = z.object({');
  expect(generated).toContain('const Result = z.object({');
  expect(generated).toContain('rowsAffected: z.number()');
  expect(generated).toContain('lastInsertRowid: z.number()');
  expect(generated).toContain('export namespace insertPost');
});

test('generate with validator: zod validates params and rows at runtime', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null, title text);
    `,
    files: {
      'sql/find-post-by-slug.sql': `select id, slug, title from posts where slug = :slug limit 1;`,
    },
    config: {generate: {validator: 'zod'}},
  });

  await project.generate();
  await project.applyStatements(`insert into posts (id, slug, title) values (1, 'hello', 'Hello');`);

  const mod = await project.importTranspiledModule<{
    findPostBySlug: {
      (client: unknown, params: {slug: string}): Promise<{id: number; slug: string; title: string | null} | null>;
      Params: {parse: (value: unknown) => unknown};
      Result: {parse: (value: unknown) => unknown};
      sql: string;
    };
  }>('sql/.generated/find-post-by-slug.sql.ts');

  using database = project.openDatabase();
  const client = createNodeSqliteClient(database.database);

  await expect(mod.findPostBySlug(client, {slug: 'hello'})).resolves.toMatchObject({
    id: 1,
    slug: 'hello',
    title: 'Hello',
  });

  // Pretty-errors uses zod's native z.prettifyError, so the message is the prettified
  // issues list — one line per issue, with the dotted path.
  await expect(mod.findPostBySlug(client, {slug: 42 as unknown as string})).rejects.toThrow(
    /Invalid input[\s\S]+slug/,
  );

  const badClient = {
    ...client,
    all: async () => [{id: 'not-a-number', slug: 'oops', title: null}],
  };
  await expect(mod.findPostBySlug(badClient as never, {slug: 'x'})).rejects.toThrow(
    /Invalid input[\s\S]+id/,
  );

  expect(typeof mod.findPostBySlug.sql).toBe('string');
  expect(mod.findPostBySlug.sql).toContain('from posts where slug = ?');
});

test('generate with validator: valibot emits valibot schemas and validates at runtime', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (
        id integer primary key,
        slug text not null,
        title text,
        status text not null check (status in ('draft', 'published'))
      );
    `,
    files: {
      'sql/find-post-by-slug.sql': `select id, slug, title, status from posts where slug = :slug limit 1;`,
    },
    config: {generate: {validator: 'valibot'}},
  });

  await project.generate();

  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      .generated/
        find-post-by-slug.sql.ts
          import * as v from 'valibot';
          import {prettifyStandardSchemaError, type Client, type SqlQuery} from 'sqlfu';
          
          const Params = v.object({
          	slug: v.string(),
          });
          const Result = v.object({
          	id: v.number(),
          	slug: v.string(),
          	title: v.nullable(v.string()),
          	status: v.picklist(["draft", "published"]),
          });
          const sql = \`
          select id, slug, title, status from posts where slug = ? limit 1;
          \`;
          
          export const findPostBySlug = Object.assign(
          	async function findPostBySlug(client: Client, rawParams: v.InferOutput<typeof Params>): Promise<v.InferOutput<typeof Result> | null> {
          		const parsedParamsResult = Params['~standard'].validate(rawParams);
          		if ('then' in parsedParamsResult) throw new Error('Unexpected async validation from Params.');
          		if ('issues' in parsedParamsResult) throw new Error(prettifyStandardSchemaError(parsedParamsResult) || 'Validation failed');
          		const params = parsedParamsResult.value;
          		const query: SqlQuery = { sql, args: [params.slug], name: "find-post-by-slug" };
          		const rows = await client.all(query);
          		if (rows.length === 0) return null;
          		const parsed = Result['~standard'].validate(rows[0]);
          		if ('then' in parsed) throw new Error('Unexpected async validation from Result.');
          		if ('issues' in parsed) throw new Error(prettifyStandardSchemaError(parsed) || 'Validation failed');
          		return parsed.value;
          	},
          	{ Params, Result, sql },
          );
          
          export namespace findPostBySlug {
          	export type Params = v.InferOutput<typeof findPostBySlug.Params>;
          	export type Result = v.InferOutput<typeof findPostBySlug.Result>;
          }
        index.ts
          export * from "./find-post-by-slug.sql.js";
    "
  `);

  await project.applyStatements(`insert into posts (id, slug, title, status) values (1, 'hello', 'Hello', 'draft');`);

  const mod = await project.importTranspiledModule<{
    findPostBySlug: (client: unknown, params: {slug: string}) => Promise<unknown>;
  }>('sql/.generated/find-post-by-slug.sql.ts');

  using database = project.openDatabase();
  const client = createNodeSqliteClient(database.database);

  await expect(mod.findPostBySlug(client, {slug: 'hello'})).resolves.toMatchObject({
    slug: 'hello',
    status: 'draft',
  });
  // Valibot's pretty-errors path inlines the Standard Schema result-guard and calls
  // `prettifyStandardSchemaError` (re-exported from sqlfu) on the failure result — the
  // resulting message is the prettified issues list, one line per issue.
  await expect(mod.findPostBySlug(client, {slug: 42 as unknown as string})).rejects.toThrow(
    /Invalid type[\s\S]+slug/,
  );
});

test('generate with validator: zod-mini emits zod/mini schemas and validates at runtime', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null, title text);
    `,
    files: {
      'sql/find-post-by-slug.sql': `select id, slug, title from posts where slug = :slug limit 1;`,
    },
    config: {generate: {validator: 'zod-mini'}},
  });

  await project.generate();

  await expect(project.getCompileDiagnostics()).resolves.toEqual([]);
  expect(await project.dumpFs(generatedTsDump)).toMatchInlineSnapshot(`
    "sql/
      .generated/
        find-post-by-slug.sql.ts
          import * as z from 'zod/mini';
          import {prettifyStandardSchemaError, type Client, type SqlQuery} from 'sqlfu';
          
          const Params = z.object({
          	slug: z.string(),
          });
          const Result = z.object({
          	id: z.number(),
          	slug: z.string(),
          	title: z.nullable(z.string()),
          });
          const sql = \`
          select id, slug, title from posts where slug = ? limit 1;
          \`;
          
          export const findPostBySlug = Object.assign(
          	async function findPostBySlug(client: Client, rawParams: z.infer<typeof Params>): Promise<z.infer<typeof Result> | null> {
          		const parsedParamsResult = Params['~standard'].validate(rawParams);
          		if ('then' in parsedParamsResult) throw new Error('Unexpected async validation from Params.');
          		if ('issues' in parsedParamsResult) throw new Error(prettifyStandardSchemaError(parsedParamsResult) || 'Validation failed');
          		const params = parsedParamsResult.value;
          		const query: SqlQuery = { sql, args: [params.slug], name: "find-post-by-slug" };
          		const rows = await client.all(query);
          		if (rows.length === 0) return null;
          		const parsed = Result['~standard'].validate(rows[0]);
          		if ('then' in parsed) throw new Error('Unexpected async validation from Result.');
          		if ('issues' in parsed) throw new Error(prettifyStandardSchemaError(parsed) || 'Validation failed');
          		return parsed.value;
          	},
          	{ Params, Result, sql },
          );
          
          export namespace findPostBySlug {
          	export type Params = z.infer<typeof findPostBySlug.Params>;
          	export type Result = z.infer<typeof findPostBySlug.Result>;
          }
        index.ts
          export * from "./find-post-by-slug.sql.js";
    "
  `);

  await project.applyStatements(`insert into posts (id, slug, title) values (1, 'hello', 'Hello');`);

  const mod = await project.importTranspiledModule<{
    findPostBySlug: (client: unknown, params: {slug: string}) => Promise<unknown>;
  }>('sql/.generated/find-post-by-slug.sql.ts');

  using database = project.openDatabase();
  const client = createNodeSqliteClient(database.database);

  await expect(mod.findPostBySlug(client, {slug: 'hello'})).resolves.toMatchObject({
    id: 1,
    slug: 'hello',
    title: 'Hello',
  });
  // zod-mini shares the same inline Standard Schema guard + prettifyStandardSchemaError call.
  await expect(mod.findPostBySlug(client, {slug: 42 as unknown as string})).rejects.toThrow(
    /Invalid input[\s\S]+slug/,
  );
});

test('generate with prettyErrors: false + validator: zod lets the raw ZodError propagate', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    files: {
      'sql/find-post-by-slug.sql': `select id, slug from posts where slug = :slug limit 1;`,
    },
    config: {generate: {validator: 'zod', prettyErrors: false}},
  });

  await project.generate();

  const generated = await project.readFile('sql/.generated/find-post-by-slug.sql.ts');
  // No safeParse wrapper, no prettifyError call — just Schema.parse directly.
  expect(generated).not.toContain('safeParse');
  expect(generated).not.toContain('prettifyError');
  expect(generated).toContain('Params.parse(rawParams)');
  // Only type-imports are allowed from sqlfu here — no runtime value dependency.
  expect(generated).toContain(`import type {Client, SqlQuery} from 'sqlfu';`);

  const mod = await project.importTranspiledModule<{
    findPostBySlug: (client: unknown, params: {slug: string}) => Promise<unknown>;
  }>('sql/.generated/find-post-by-slug.sql.ts');

  using database = project.openDatabase();
  const client = createNodeSqliteClient(database.database);

  // Raw ZodError — `.issues` is an array, no prettified "validation failed" wrapper string.
  await expect(mod.findPostBySlug(client, {slug: 42 as unknown as string})).rejects.toSatisfy((error: unknown) => {
    if (!(error instanceof Error)) return false;
    if (error.message.includes('Validation failed')) return false;
    return Array.isArray((error as unknown as {issues?: unknown}).issues);
  });
});

test('generate with prettyErrors: false + validator: valibot throws raw issues inline', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    files: {
      'sql/find-post-by-slug.sql': `select id, slug from posts where slug = :slug limit 1;`,
    },
    config: {generate: {validator: 'valibot', prettyErrors: false}},
  });

  await project.generate();

  const generated = await project.readFile('sql/.generated/find-post-by-slug.sql.ts');
  // Inline Standard Schema guard + issue-throw, no sqlfu runtime value dependency.
  expect(generated).toContain(`Params['~standard'].validate(rawParams)`);
  expect(generated).toContain('throw Object.assign(new Error');
  // Only type-imports from sqlfu — generated file is self-contained apart from valibot.
  expect(generated).toContain(`import type {Client, SqlQuery} from 'sqlfu';`);
  expect(generated).not.toContain('prettifyStandardSchemaError');

  const mod = await project.importTranspiledModule<{
    findPostBySlug: (client: unknown, params: {slug: string}) => Promise<unknown>;
  }>('sql/.generated/find-post-by-slug.sql.ts');

  using database = project.openDatabase();
  const client = createNodeSqliteClient(database.database);

  await expect(mod.findPostBySlug(client, {slug: 42 as unknown as string})).rejects.toSatisfy((error: unknown) => {
    if (!(error instanceof Error)) return false;
    return Array.isArray((error as unknown as {issues?: unknown}).issues);
  });
});

test('generate with prettyErrors: false + validator: zod-mini throws raw issues inline', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    files: {
      'sql/find-post-by-slug.sql': `select id, slug from posts where slug = :slug limit 1;`,
    },
    config: {generate: {validator: 'zod-mini', prettyErrors: false}},
  });

  await project.generate();

  const generated = await project.readFile('sql/.generated/find-post-by-slug.sql.ts');
  expect(generated).toContain(`Params['~standard'].validate(rawParams)`);
  expect(generated).toContain('throw Object.assign(new Error');
  // Same self-contained shape as the valibot prettyErrors: false case.
  expect(generated).toContain(`import type {Client, SqlQuery} from 'sqlfu';`);
  expect(generated).not.toContain('prettifyStandardSchemaError');

  const mod = await project.importTranspiledModule<{
    findPostBySlug: (client: unknown, params: {slug: string}) => Promise<unknown>;
  }>('sql/.generated/find-post-by-slug.sql.ts');

  using database = project.openDatabase();
  const client = createNodeSqliteClient(database.database);

  await expect(mod.findPostBySlug(client, {slug: 42 as unknown as string})).rejects.toSatisfy((error: unknown) => {
    if (!(error instanceof Error)) return false;
    return Array.isArray((error as unknown as {issues?: unknown}).issues);
  });
});

test('generate rejects unknown validator values at config load', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: `create table posts (id integer primary key);`,
    files: {
      'sql/list-posts.sql': `select id from posts;`,
    },
    rawGenerate: `{validator: 'not-a-real-validator' as any}`,
  });

  await expect(project.generate()).rejects.toThrow(
    /"generate\.validator" must be one of 'zod', 'valibot', 'zod-mini', null, or undefined/,
  );
});

test('generate rejects the legacy generate.zod flag with a migration hint', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: `create table posts (id integer primary key);`,
    files: {
      'sql/list-posts.sql': `select id from posts;`,
    },
    rawGenerate: `{zod: true} as any`,
  });

  await expect(project.generate()).rejects.toThrow(
    /"generate\.zod" is no longer supported[\s\S]+generate\.validator/,
  );
});

test('generate without generate.validator keeps plain TS output unchanged', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: dedent`
      create table posts (id integer primary key, slug text not null);
    `,
    files: {
      'sql/list-posts.sql': `select id, slug from posts;`,
    },
  });

  await project.generate();

  // Byte-identical to the plain-TS snapshot above — no zod/valibot import, no runtime validation.
  const generated = await project.readFile('sql/.generated/list-posts.sql.ts');
  expect(generated).not.toContain(`from 'zod'`);
  expect(generated).not.toContain(`from 'valibot'`);
  expect(generated).not.toContain('Object.assign');
  expect(generated).toContain('export type ListPostsResult = {');
});

async function createGenerateFixture(input: {
  definitionsSql: string;
  files: Record<string, string>;
  config?: {
    generatedImportExtension?: '.js' | '.ts';
    generate?: {validator?: 'zod' | 'valibot' | 'zod-mini' | null; prettyErrors?: boolean};
  };
  /** Raw override for the generate block in the emitted `sqlfu.config.ts`. Useful for failure-case tests. */
  rawGenerate?: string;
}) {
  const root = await createTempFixtureRoot('generate');
  const dbPath = path.join(root, 'app.db');
  const configBodyLines = [
    `db: './app.db',`,
    `migrations: './migrations',`,
    `definitions: './definitions.sql',`,
    `queries: './sql',`,
    ...(input.config?.generatedImportExtension
      ? [`generatedImportExtension: '${input.config.generatedImportExtension}',`]
      : []),
    ...(input.rawGenerate
      ? [`generate: ${input.rawGenerate},`]
      : input.config?.generate
        ? [`generate: ${JSON.stringify(input.config.generate)},`]
        : []),
  ];
  await writeFixtureFiles(root, {
    'definitions.sql': input.definitionsSql,
    'sqlfu.config.ts': dedent`
      export default {
        ${configBodyLines.join('\n        ')}
      };
    `,
    ...input.files,
  });

  await applyDefinitionsToDatabase(dbPath, input.definitionsSql);

  return {
    async generate() {
      await inWorkingDirectory(root, () => generateQueryTypes());
    },
    async applyStatements(sql: string) {
      await applyDefinitionsToDatabase(dbPath, sql);
    },
    openDatabase() {
      const database = new DatabaseSync(dbPath);
      return {
        database,
        [Symbol.dispose]() {
          database.close();
        },
      };
    },
    async readFile(relativePath: string) {
      return fs.readFile(path.join(root, relativePath), 'utf8');
    },
    async readJson(relativePath: string) {
      return JSON.parse(await fs.readFile(path.join(root, relativePath), 'utf8'));
    },
    async dumpFs(input?: {includeGlobs?: readonly string[]; excludeGlobs?: readonly string[]}) {
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

      // The transpiled file lives in os.tmpdir() where `import 'zod'` / `import 'sqlfu'` etc.
      // cannot be resolved by Node's default ESM walk. Rewrite bare specifiers to absolute
      // file URLs pointing at the packages the workspace already resolved.
      const resolvedSource = rewriteBareImports(transpiled.outputText);
      await fs.writeFile(outputPath, resolvedSource);
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
            'better-sqlite3': [path.join(packageRoot, 'node_modules', 'better-sqlite3')],
            zod: [path.join(packageRoot, 'node_modules', 'zod')],
            'zod/mini': [path.join(packageRoot, 'node_modules', 'zod', 'mini')],
            valibot: [path.join(packageRoot, 'node_modules', 'valibot')],
          },
          types: ['node'],
        },
      });

      project.addSourceFilesAtPaths(path.join(packageRoot, 'src', '**', '*.ts'));
      for (const sourceFile of project.getSourceFiles()) {
        if (sourceFile.getFilePath().includes(`${path.sep}src${path.sep}vendor${path.sep}`)) {
          project.removeSourceFile(sourceFile);
        }
      }
      project.addSourceFilesAtPaths(path.join(root, 'sql', '.generated', '*.ts'));
      project.addSourceFilesAtPaths(path.join(root, 'sql', '.generated', '*.d.ts'));

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
  const database = new DatabaseSync(dbPath);
  const client = createNodeSqliteClient(database);

  try {
    await client.raw(withTrailingNewline(dedent(definitionsSql)));
  } finally {
    database.close();
  }
}

/**
 * The transpiled .mjs lives in os.tmpdir() where `import 'zod'` can't be resolved by Node's
 * module walk. The test already knows where each package sits in the workspace, so replace
 * bare specifiers in `import`/`export from` statements with absolute file URLs.
 */
function rewriteBareImports(source: string): string {
  const mapping: Record<string, string> = {
    sqlfu: pathToFileURL(path.join(packageRoot, 'src', 'index.ts')).href,
    zod: pathToFileURL(path.join(packageRoot, 'node_modules', 'zod', 'index.js')).href,
    'zod/mini': pathToFileURL(path.join(packageRoot, 'node_modules', 'zod', 'mini', 'index.js')).href,
    valibot: pathToFileURL(path.join(packageRoot, 'node_modules', 'valibot', 'dist', 'index.mjs')).href,
  };
  // For sqlfu specifically we need to execute .ts source. vitest has a loader in-process, so
  // pointing at the .ts file lets the process import it through the vitest TS pipeline.
  return source.replace(/from\s+["']([^"']+)["']/g, (match, specifier) => {
    const replacement = mapping[specifier];
    return replacement ? `from "${replacement}"` : match;
  });
}
