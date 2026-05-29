import {DatabaseSync} from 'node:sqlite';
import {expect, expectTypeOf, test} from 'vitest';

import {createNodeSqliteClient, defineConfig, sql, type QueryMetadata, type SyncClient} from '../src/index.js';

test('defineConfig accepts compact generated query tags', () => {
  using fixture = createInlineConfigFixture();

  class PostObject {
    static dbConfig = defineConfig({
      definitions: sql`
        create table posts (slug text primary key, title text not null);
      `,
      migrations: [
        {
          name: '0001_create_posts',
          content: sql`
            create table posts (slug text primary key, title text not null);
          `,
        },
      ],
      queries: {
        listPosts: sql.many<{parameters: {limit: number}; result: {slug: string; title: string}}>`
          select slug, title
          from posts
          order by slug
          limit :limit
        `,
        createPost: sql.run<{parameters: {slug: string; title: string}}>`
          insert into posts (slug, title)
          values (:slug, :title)
        `,
      },
    });

    db: ReturnType<typeof PostObject.dbConfig<SyncClient>>;

    constructor(client: SyncClient) {
      this.db = PostObject.dbConfig(client);
    }
  }

  const postObject = new PostObject(fixture.client);
  postObject.db.migrate();

  const created: QueryMetadata = postObject.db.createPost({slug: 'hello-world', title: 'Hello, World!'});
  expect(created).toMatchObject({rowsAffected: 1});

  const posts: {slug: string; title: string}[] = postObject.db.listPosts({limit: 10});
  expect(posts).toEqual([{slug: 'hello-world', title: 'Hello, World!'}]);
});

test('defineConfig works with a class', () => {
  using fixture = createInlineConfigFixture();

  class PostObject {
    static dbConfig = defineConfig({
      definitions: sql`
        create table posts (slug text primary key, title text not null);
      `,
      migrations: [
        {
          name: '0001_create_posts',
          content: sql`
            create table posts (slug text primary key, title text not null);
          `,
        },
      ],
      queries: {
        listPosts: sql.many<{parameters: {limit: number}; result: {slug: string; title: string}}>`
          select slug, title
          from posts
          order by slug
          limit :limit
        `,
        createPost: sql.run<{parameters: {slug: string; title: string}}>`
          insert into posts (slug, title)
          values (:slug, :title)
        `,
      },
    });

    db: ReturnType<typeof PostObject.dbConfig<SyncClient>>;

    constructor(client: SyncClient) {
      this.db = PostObject.dbConfig(client);
    }
  }

  const postObject = new PostObject(fixture.client);

  postObject.db.migrate();
  const tables = fixture.client.all(sql`select name from sqlite_schema where type = 'table'`);
  expect(tables).toContainEqual({name: 'posts'});

  postObject.db.createPost({slug: 'hello-world', title: 'Hello, World!'});

  const rawPosts = fixture.client.all(sql`select slug, title from posts`);
  expect(rawPosts).toHaveLength(1);

  const posts = postObject.db.listPosts({limit: 10});

  expect(posts).toEqual(rawPosts);
  expect(posts).toMatchObject([{slug: 'hello-world'}]);

  postObject.db.createPost({slug: 'hello-world-2', title: 'Hello, World 2!'});

  const onePost = postObject.db.listPosts({limit: 1});
  expect(onePost).toHaveLength(1);
});

test('defineConfig works without having generated types yet', () => {
  using fixture = createInlineConfigFixture();

  class PostObject {
    static dbConfig = defineConfig({
      definitions: sql`
        create table posts (slug text primary key, title text not null);
      `,
      queries: {
        listPosts: sql.many`
          select slug, title from posts limit :limit
        `,
      },
    });

    db: ReturnType<typeof PostObject.dbConfig<SyncClient>>;

    constructor(client: SyncClient) {
      this.db = PostObject.dbConfig(client);
    }
  }

  const postObject = new PostObject(fixture.client);
  expectTypeOf(postObject.db.listPosts).toBeCallableWith({limit: 10});
});

test('defineConfig works with a class without migrations via sync(...)', async () => {
  using fixture = createInlineConfigFixture();
  const {sync} = await import('../src/api/sync.js'); // separate import because it's a bit more heavyweight than the client adapters

  class PostObject {
    static dbConfig = defineConfig({
      definitions: sql`
        create table posts (slug text primary key, title text not null);
      `,
      queries: {
        listPosts: sql.many<{parameters: {limit: number}; result: {slug: string; title: string}}>`
          select slug, title
          from posts
          order by slug
          limit :limit
        `,
        createPost: sql.run<{parameters: {slug: string; title: string}}>`
          insert into posts (slug, title)
          values (:slug, :title)
        `,
      },
    });

    db: ReturnType<typeof PostObject.dbConfig<SyncClient>>;

    constructor(client: SyncClient) {
      this.db = PostObject.dbConfig(client);
    }
  }

  const postObject = new PostObject(fixture.client);

  sync(fixture.client, {definitions: PostObject.dbConfig.config.definitions.sql});
  const tables = fixture.client.all(sql`select name from sqlite_schema where type = 'table'`);
  expect(tables).toContainEqual({name: 'posts'});

  postObject.db.createPost({slug: 'hello-world', title: 'Hello, World!'});

  const rawPosts = fixture.client.all(sql`select slug, title from posts`);
  expect(rawPosts).toHaveLength(1);

  const posts = postObject.db.listPosts({limit: 10});

  expect(posts).toEqual(rawPosts);
  expect(posts).toMatchObject([{slug: 'hello-world'}]);

  postObject.db.createPost({slug: 'hello-world-2', title: 'Hello, World 2!'});

  const onePost = postObject.db.listPosts({limit: 1});
  expect(onePost).toHaveLength(1);
});

test('static inline defineConfig binds generated query methods to a sync client', () => {
  using fixture = createInlineConfigFixture();

  class PostObject {
    static dbConfig = defineConfig({
      definitions: sql`
        create table posts (slug text primary key, title text not null);
      `,
      migrations: [
        {
          name: '0001_create_posts',
          content: sql`
            create table posts (slug text primary key, title text not null);
          `,
        },
      ],
      queries: {
        listPosts: sql.many<{parameters: {limit: number}; result: {slug: string; title: string}}>`
          select slug, title
          from posts
          order by slug
          limit :limit
        `,
        findPost: sql.nullableOne<{parameters: {slug: string}; result: {slug: string; title: string}}>`
          select slug, title
          from posts
          where slug = :slug
        `,
        getPost: sql.one<{parameters: {slug: string}; result: {slug: string; title: string}}>`
          select slug, title
          from posts
          where slug = :slug
        `,
        createPost: sql.run<{parameters: {slug: string; title: string}}>`
          insert into posts (slug, title)
          values (:slug, :title)
        `,
      },
    });

    db: PostDatabase;

    constructor(client: SyncClient) {
      this.db = PostObject.dbConfig(client);
    }
  }

  type PostDatabase = ReturnType<typeof PostObject.dbConfig<SyncClient>>;

  const postObject = new PostObject(fixture.client);
  const migrated: void = postObject.db.migrate();

  expect(migrated).toBeUndefined();
  const tables = fixture.client.all(sql`select name from sqlite_schema where type = 'table' order by name`);
  expect(tables).toContainEqual({name: 'posts'});

  const missingPost: {slug: string; title: string} | null = postObject.db.findPost({slug: 'hello-world'});
  expect(missingPost).toBeNull();

  const created: QueryMetadata = postObject.db.createPost({slug: 'hello-world', title: 'Hello, World!'});
  expect(created).toMatchObject({rowsAffected: 1});

  const posts: {slug: string; title: string}[] = postObject.db.listPosts({limit: 10});
  expect(posts).toEqual([{slug: 'hello-world', title: 'Hello, World!'}]);

  const foundPost: {slug: string; title: string} | null = postObject.db.findPost({slug: 'hello-world'});
  expect(foundPost).toEqual({slug: 'hello-world', title: 'Hello, World!'});

  const requiredPost: {slug: string; title: string} = postObject.db.getPost({slug: 'hello-world'});
  expect(requiredPost).toEqual({slug: 'hello-world', title: 'Hello, World!'});
});

function createInlineConfigFixture() {
  const database = new DatabaseSync(':memory:');
  const client = createNodeSqliteClient(database);
  return {
    client,
    [Symbol.dispose]() {
      database.close();
    },
  };
}
