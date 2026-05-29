import {defineConfig, sql} from '../src/index.js';
import type {SyncClient} from '../src/types.js';

const app = defineConfig({
  definitions: sql`
    create table metrics(rowsAffected integer not null);
  `,
  migrations: [],
  queries: {
    listMetrics: sql.many<{result: {rowsAffected: number}}>`
      select rowsAffected from metrics
    `,
    createMetric: sql.run<{}>`
      insert into metrics(rowsAffected) values (1)
    `,
  },
});

declare const client: SyncClient;

const metrics: {rowsAffected: number}[] = app(client).listMetrics();
const runResult: {rowsAffected?: number} = app(client).createMetric();

const compactApp = defineConfig({
  definitions: sql`
    create table posts(slug text primary key, title text not null);
  `,
  queries: {
    listPosts: sql.many<{parameters: {limit: number}; result: {slug: string; title: string}}>`
      select slug, title
      from posts
      order by slug
      limit :limit
    `,
    getPost: sql.one<{parameters: {slug: string}; result: {slug: string; title: string}}>`
      select slug, title
      from posts
      where slug = :slug
    `,
    findPost: sql.nullableOne<{parameters: {slug: string}; result: {slug: string; title: string}}>`
      select slug, title
      from posts
      where slug = :slug
    `,
    createPost: sql.run<{parameters: {slug: string; title: string}}>`
      insert into posts(slug, title) values (:slug, :title)
    `,
  },
});

const compactPosts: {slug: string; title: string}[] = compactApp(client).listPosts({limit: 10});
const compactPost: {slug: string; title: string} = compactApp(client).getPost({slug: 'hello'});
const maybeCompactPost: {slug: string; title: string} | null = compactApp(client).findPost({slug: 'hello'});
const compactRunResult: {rowsAffected?: number} = compactApp(client).createPost({slug: 'hello', title: 'Hello'});
