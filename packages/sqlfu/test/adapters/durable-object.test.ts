import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as esbuild from 'esbuild';
import {Miniflare} from 'miniflare';
import {expect, test} from 'vitest';
import dedent from 'dedent';

import {ensureBuilt, packageRoot} from './ensure-built.js';
import {createDurableObjectClient as createLocalDurableObjectClient} from '../../src/index.js';

declare const createDurableObjectClient: typeof import('../../src/index.ts').createDurableObjectClient;
declare const sql: typeof import('../../src/index.ts').sql;
declare const sync: typeof import('../../src/api/sync.ts').sync;
type DurableObjectClient = ReturnType<typeof createDurableObjectClient>;
declare const migrate: (client: DurableObjectClient) => void;
declare const migrateMissingInitialMigration: (client: DurableObjectClient) => void;

test('createDurableObjectClient works in a real durable object', async () => {
  await using fixture = await createDOFixture(
    class ClientDotAllTest {
      client: ReturnType<typeof createDurableObjectClient>;

      constructor(state: any) {
        this.client = createDurableObjectClient(state.storage);
      }

      async testme() {
        return this.client.all(sql`select 1 as value`);
      }
    },
  );

  expect(await fixture.stub.testme()).toMatchObject([{value: 1}]);
});

test('createDurableObjectClient can write and read rows in a durable object', async () => {
  await using fixture = await createDOFixture(
    class ClientPersonTest {
      client: ReturnType<typeof createDurableObjectClient>;

      constructor(state: any) {
        this.client = createDurableObjectClient(state.storage);
        this.client.run(sql`
          create table if not exists person (
            id integer primary key,
            name text not null
          )
        `);
      }

      async insertPerson(id: number, name: string) {
        return this.client.run(sql`
          insert into person (id, name) values (${id}, ${name})
        `);
      }

      async listPeople() {
        return this.client.all<{id: number; name: string}>(sql`
          select id, name
          from person
          order by id
        `);
      }
    },
  );

  await fixture.stub.insertPerson(1, 'bob');
  await fixture.stub.insertPerson(2, 'ada');

  expect(await fixture.stub.listPeople()).toMatchObject([
    {id: 1, name: 'bob'},
    {id: 2, name: 'ada'},
  ]);
});

test('generated migrate can run inside a durable object constructor', async () => {
  await using fixture = await createDOFixture(
    class GeneratedMigrationsTest {
      client: DurableObjectClient;

      constructor(state: any) {
        this.client = createDurableObjectClient(state.storage);
        migrate(this.client);
      }

      async getColumns() {
        return this.client.all<{name: string}>(sql`
          select name from pragma_table_info('posts') order by cid
        `);
      }

      async getApplied() {
        return this.client.all<{name: string}>(sql`
          select name from sqlfu_migrations order by name
        `);
      }
    },
    {
      migrations: {
        'migrations/2026-04-10T00.00.00.000Z_create_posts.sql':
          'create table posts (id integer primary key, slug text not null);',
        'migrations/2026-04-10T01.00.00.000Z_add_body.sql': 'alter table posts add column body text;',
      },
    },
  );

  expect(await fixture.stub.getColumns()).toMatchObject([{name: 'id'}, {name: 'slug'}, {name: 'body'}]);

  expect(await fixture.stub.getApplied()).toMatchObject([
    {name: '2026-04-10T00.00.00.000Z_create_posts'},
    {name: '2026-04-10T01.00.00.000Z_add_body'},
  ]);
});

test('runtime sync applies inline definitions in a durable object constructor', async () => {
  await using fixture = await createDOFixture(
    class InlineSyncInitialSchemaTest {
      client: DurableObjectClient;

      constructor(state: any) {
        this.client = createDurableObjectClient(state.storage);
        sync(this.client, {
          definitions: `
            create table posts (
              id integer primary key,
              slug text not null
            );
          `,
        });
      }

      async getColumns() {
        return this.client.all<{name: string}>(sql`
          select name from pragma_table_info('posts') order by cid
        `);
      }

      async getSyncScratchObjects() {
        return this.client.all<{name: string}>(sql`
          select name
          from sqlite_schema
          where name like '__sqlfu_sync_%'
          order by name
        `);
      }
    },
  );

  expect(await fixture.stub.getColumns()).toMatchObject([{name: 'id'}, {name: 'slug'}]);
  expect(await fixture.stub.getSyncScratchObjects()).toMatchObject([]);
});

test('runtime sync migrates existing durable object storage on redeploy', async () => {
  await using redeploy = await createDORedeployFixture();

  const initial = await redeploy.deploy(
    class InlineSyncRedeployV1Test {
      client: DurableObjectClient;

      constructor(state: any) {
        this.client = createDurableObjectClient(state.storage);
        sync(this.client, {
          definitions: `
            create table posts (
              id integer primary key,
              slug text not null
            );
          `,
        });
      }

      async insertPost(id: number, slug: string) {
        this.client.run(sql`
          insert into posts (id, slug) values (${id}, ${slug})
        `);
      }

      async getColumns() {
        return this.client.all<{name: string}>(sql`
          select name from pragma_table_info('posts') order by cid
        `);
      }
    },
  );

  await initial.stub.insertPost(1, 'hello-world');
  expect(await initial.stub.getColumns()).toMatchObject([{name: 'id'}, {name: 'slug'}]);

  const upgraded = await redeploy.deploy(
    class InlineSyncRedeployV2Test {
      client: DurableObjectClient;

      constructor(state: any) {
        this.client = createDurableObjectClient(state.storage);
        sync(this.client, {
          definitions: `
            create table posts (
              id integer primary key,
              slug text not null,
              body text
            );

            create unique index posts_slug_key on posts (slug);
          `,
        });
      }

      async getColumns() {
        return this.client.all<{name: string}>(sql`
          select name from pragma_table_info('posts') order by cid
        `);
      }

      async listPosts() {
        return this.client.all<{id: number; slug: string; body: string | null}>(sql`
          select id, slug, body
          from posts
          order by id
        `);
      }

      async getIndexes() {
        return this.client.all<{name: string; unique: number}>(sql`
          select name, "unique"
          from pragma_index_list('posts')
          where name = 'posts_slug_key'
        `);
      }

      async getSyncScratchObjects() {
        return this.client.all<{name: string}>(sql`
          select name
          from sqlite_schema
          where name like '__sqlfu_sync_%'
          order by name
        `);
      }
    },
  );

  expect(await upgraded.stub.getColumns()).toMatchObject([{name: 'id'}, {name: 'slug'}, {name: 'body'}]);
  expect(await upgraded.stub.listPosts()).toMatchObject([{id: 1, slug: 'hello-world', body: null}]);
  expect(await upgraded.stub.getIndexes()).toMatchObject([{name: 'posts_slug_key', unique: 1}]);
  expect(await upgraded.stub.getSyncScratchObjects()).toMatchObject([]);
});

test('createDurableObjectClient uses transactionSync when given durable object storage', async () => {
  await using fixture = await createDOFixture(
    class ClientTransactionSyncTest {
      client: ReturnType<typeof createDurableObjectClient>;
      transactionCalls = 0;

      constructor(state: any) {
        const owner = this;
        this.client = createDurableObjectClient({
          sql: state.storage.sql,
          transactionSync<TResult>(callback: () => TResult) {
            owner.transactionCalls += 1;
            return state.storage.transactionSync(callback);
          },
        });
      }

      async applyGeneratedMigrations() {
        migrate(this.client);
      }

      async getTransactionCalls() {
        return this.transactionCalls;
      }
    },
    {
      migrations: {
        'migrations/2026-04-10T00.00.00.000Z_create_posts.sql':
          'create table posts (id integer primary key, slug text not null);',
        'migrations/2026-04-10T01.00.00.000Z_add_body.sql': 'alter table posts add column body text;',
      },
    },
  );

  await fixture.stub.applyGeneratedMigrations();

  expect(await fixture.stub.getTransactionCalls()).toBe(2);
});

test('generated migrate in a durable object refuses a missing applied migration', async () => {
  await using fixture = await createDOFixture(
    class ClientMissingGeneratedMigrationTest {
      client: ReturnType<typeof createDurableObjectClient>;

      constructor(state: any) {
        this.client = createDurableObjectClient(state.storage);
      }

      async applyInitialGeneratedMigrations() {
        migrate(this.client);
      }

      async applyGeneratedMigrationsAfterDeletingInitialFile() {
        try {
          migrateMissingInitialMigration(this.client);
          return {ok: true};
        } catch (error) {
          return {ok: false, message: String(error)};
        }
      }

      async getColumns() {
        return this.client.all<{name: string}>(sql`
          select name from pragma_table_info('posts') order by cid
        `);
      }
    },
    {
      migrations: {
        'migrations/2026-04-10T00.00.00.000Z_create_posts.sql':
          'create table posts (id integer primary key, slug text not null);',
      },
      migrationsAfterDeletingInitialFile: {
        'migrations/2026-04-10T01.00.00.000Z_add_body.sql': 'alter table posts add column body text;',
      },
    },
  );

  await fixture.stub.applyInitialGeneratedMigrations();

  expect(await fixture.stub.applyGeneratedMigrationsAfterDeletingInitialFile()).toMatchObject({
    ok: false,
    message: expect.stringContaining('deleted applied migration: 2026-04-10T00.00.00.000Z_create_posts'),
  });
  expect(await fixture.stub.getColumns()).toMatchObject([{name: 'id'}, {name: 'slug'}]);
});

test('createDurableObjectClient rolls back a failed migration with transactionSync', async () => {
  await using fixture = await createDOFixture(
    class ClientTransactionRollbackTest {
      client: ReturnType<typeof createDurableObjectClient>;

      constructor(state: any) {
        this.client = createDurableObjectClient(state.storage);
      }

      async applyBrokenMigration() {
        try {
          migrate(this.client);
          return {ok: true};
        } catch (error) {
          return {ok: false, message: String(error)};
        }
      }

      async listPartialTables() {
        return this.client.all<{name: string}>(sql`
          select name
          from sqlite_schema
          where type = 'table' and name = 'partially_created'
        `);
      }
    },
    {
      migrations: {
        'migrations/2026-04-10T00.00.00.000Z_broken.sql': `
                create table partially_created (id integer primary key);
                insert into missing_table (id) values (1);
              `,
      },
    },
  );

  expect(await fixture.stub.applyBrokenMigration()).toMatchObject({
    ok: false,
    message: expect.stringContaining('missing_table'),
  });
  expect(await fixture.stub.listPartialTables()).toMatchObject([]);
});

test('createDurableObjectClient.raw runs multiple statements', async () => {
  await using fixture = await createDOFixture(
    class ClientMultiStatementTest {
      client: ReturnType<typeof createDurableObjectClient>;

      constructor(state: any) {
        this.client = createDurableObjectClient({sql: state.storage.sql});
      }

      async seedPeople() {
        return this.client.raw(`
          create table person (
            id integer primary key,
            name text not null
          );
          insert into person (id, name) values (1, 'bob');
          insert into person (id, name) values (2, 'ada');
        `);
      }

      async listPeople() {
        return this.client.all<{id: number; name: string}>(sql`
          select id, name
          from person
          order by id
        `);
      }
    },
  );

  await fixture.stub.seedPeople();

  expect(await fixture.stub.listPeople()).toMatchObject([
    {id: 1, name: 'bob'},
    {id: 2, name: 'ada'},
  ]);
});

test('createDurableObjectClient rejects a bare durable object sql handle', () => {
  const sqlStorage = {
    exec() {
      return {toArray: () => []};
    },
  };

  expect(() => createLocalDurableObjectClient(sqlStorage as any)).toThrow(
    'createDurableObjectClient expects ctx.storage or {sql, transactionSync}; pass ctx.storage.sql as {sql}.',
  );
});

async function createDORedeployFixture() {
  const persistPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-do-persist-'));
  let current: DOFixture<object> | null = null;

  return {
    async deploy<TInstance extends object>(classDef: new (...args: any[]) => TInstance) {
      await disposeCurrentDeployment();
      current = await createDOFixture(classDef, {persistPath});
      return current as DOFixture<TInstance>;
    },
    async [Symbol.asyncDispose]() {
      await disposeCurrentDeployment();
      await fs.rm(persistPath, {recursive: true, force: true});
    },
  };

  async function disposeCurrentDeployment() {
    const fixture = current;
    current = null;
    await fixture?.[Symbol.asyncDispose]();
  }
}

type DOFixture<TInstance extends object> = {
  stub: TInstance;
  [Symbol.asyncDispose](): Promise<void>;
};

async function createDOFixture<TInstance extends object>(
  classDef: new (...args: any[]) => TInstance,
  options: {
    migrations?: Record<string, string>;
    migrationsAfterDeletingInitialFile?: Record<string, string>;
    persistPath?: string;
  } = {},
) {
  await ensureBuilt();

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-do-fixture-'));
  const workerSourcePath = path.join(tempDir, 'worker-source.js');
  const workerPath = path.join(tempDir, 'worker.js');
  await fs.cp(path.join(packageRoot, 'dist'), path.join(tempDir, 'runtime'), {recursive: true});
  await writeGeneratedMigrationsModule(tempDir, 'migrations', options.migrations || {});
  await writeGeneratedMigrationsModule(
    tempDir,
    'migrations-missing-initial',
    options.migrationsAfterDeletingInitialFile || {},
  );

  const classDefString = classDef.toString().trim();
  const className = classDefString.match(/^class (\w+) \{/)?.[1];
  if (!className) {
    throw new Error(`Failed to extract class name from class definition: ${classDefString}`);
  }

  await fs.writeFile(
    workerSourcePath,
    dedent`
      import {createDurableObjectClient, sql} from './runtime/index.js';
      import {sync} from './runtime/api/sync.js';
      import {migrate} from './migrations/.generated/migrations.ts';
      import {migrate as migrateMissingInitialMigration} from './migrations-missing-initial/.generated/migrations.ts';

      ${classDefString}

      export class FixtureObject extends ${className} {
        async fetch(request) {
          const url = new URL(request.url);
          if (request.method !== 'POST' || url.pathname !== '/__rpc__') {
            return new Response('not found', {status: 404});
          }

          const {method, args} = await request.json();

          return this[method].apply(this, args).then(
            (value) => Response.json({ok: true, value}),
            (error) => Response.json({ok: false, error: {message: String(error)}}),
          );
        }
      }

      export default {
        fetch() {
          return new Response('ok');
        },
      };
    `,
  );

  // bundle so miniflare (modules mode) sees only relative imports. the runtime
  // transitively imports bare specifiers like `@noble/hashes/sha2.js`, which
  // miniflare's module locator does not resolve on its own. we let esbuild
  // resolve node_modules starting from the sqlfu package root.
  await esbuild.build({
    entryPoints: [workerSourcePath],
    outfile: workerPath,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    absWorkingDir: packageRoot,
    nodePaths: [path.join(packageRoot, 'node_modules')],
  });

  const miniflare = new Miniflare({
    rootPath: tempDir,
    modulesRoot: tempDir,
    scriptPath: 'worker.js',
    modules: true,
    modulesRules: [{type: 'ESModule', include: ['**/*.js']}],
    durableObjects: {
      FIXTURE_OBJECT: {
        className: 'FixtureObject',
        useSQLite: true,
      },
    },
    durableObjectsPersist: options.persistPath,
  });

  await miniflare.ready;

  const bindings = await miniflare.getBindings<{FIXTURE_OBJECT: DurableObjectNamespaceLike}>();
  const durableObjectStub = bindings.FIXTURE_OBJECT.get(bindings.FIXTURE_OBJECT.idFromName('fixture'));
  const stub = createRpcStub<TInstance>(durableObjectStub);

  return {
    stub,
    async [Symbol.asyncDispose]() {
      await miniflare.dispose();
      await fs.rm(tempDir, {recursive: true, force: true});
    },
  };
}

async function writeGeneratedMigrationsModule(
  rootPath: string,
  migrationsDir: string,
  migrations: Record<string, string>,
) {
  const generatedDir = path.join(rootPath, migrationsDir, '.generated');
  await fs.mkdir(generatedDir, {recursive: true});
  await fs.writeFile(
    path.join(generatedDir, 'migrations.ts'),
    [
      '// Generated by `sqlfu generate`. Do not edit.',
      `// A bundle of every migration in ${migrationsDir}/,`,
      '// importable from runtimes without filesystem access (durable objects, edge workers, browsers).',
      '// Use `migrate(client)` for the common path, or `migrations` for lower-level control.',
      '',
      "import {applyMigrations, migrationsFromBundle, type AsyncClient, type Client, type SyncClient} from '../../runtime/index.js';",
      '',
      `export const migrations = ${JSON.stringify(migrations, null, 2)};`,
      '',
      'export function migrate(client: SyncClient): void;',
      'export function migrate(client: AsyncClient): Promise<void>;',
      'export function migrate(client: Client): void | Promise<void> {',
      '  return applyMigrations(client, {',
      '    migrations: migrationsFromBundle(migrations),',
      '    preset: "sqlfu",',
      '  });',
      '}',
      '',
    ].join('\n'),
  );
}

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectFetchStub;
}

interface DurableObjectFetchStub {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

function createRpcStub<TInstance extends object>(stub: DurableObjectFetchStub) {
  return new Proxy({} as TInstance, {
    get(_target, propertyKey) {
      if (typeof propertyKey !== 'string') {
        return undefined;
      }

      return async (...args: unknown[]) => {
        const response = await stub.fetch('http://do/__rpc__', {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({method: propertyKey, args}),
        });
        const payload = (await response.json()) as {ok: true; value: unknown} | {ok: false; error: {message: string}};

        if (!response.ok || !payload.ok) {
          throw new Error(payload.ok ? `RPC failed with status ${response.status}` : payload.error.message);
        }

        return payload.value;
      };
    },
  });
}
