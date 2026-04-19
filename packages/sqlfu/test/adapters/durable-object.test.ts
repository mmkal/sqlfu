import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {Miniflare} from 'miniflare';
import {expect, test} from 'vitest';
import dedent from 'dedent';

import {ensureBuilt, packageRoot} from './ensure-built.js';

declare const createDurableObjectClient: typeof import('../../src/index.ts').createDurableObjectClient;
declare const sql: typeof import('../../src/index.ts').sql;
declare const applyMigrations: typeof import('../../src/migrations/index.ts').applyMigrations;
declare const migrationsFromBundle: typeof import('../../src/migrations/index.ts').migrationsFromBundle;

test('createDurableObjectClient works in a real durable object', async () => {
  await using fixture = await createDOFixture(
    class ClientDotAllTest {
      client: ReturnType<typeof createDurableObjectClient>;

      constructor(state: any) {
        this.client = createDurableObjectClient(state.storage.sql);
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
        this.client = createDurableObjectClient(state.storage.sql);
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

test('applyMigrations can run inside a durable object using a migrations bundle', async () => {
  await using fixture = await createDOFixture(
    class BundleMigrationsTest {
      client: ReturnType<typeof createDurableObjectClient>;

      constructor(state: any) {
        this.client = createDurableObjectClient(state.storage.sql);
        const bundle = {
          'migrations/2026-04-10T00.00.00.000Z_create_posts.sql':
            'create table posts (id integer primary key, slug text not null);',
          'migrations/2026-04-10T01.00.00.000Z_add_body.sql': 'alter table posts add column body text;',
        };
        // Hand-rolled host + `as any` cast because `applyMigrations` currently
        // demands full `SqlfuHost` even though it only uses `digest` and `now`.
        // Follow-up in tasks/migrations-sync-async.md will drop the host
        // parameter entirely so this stub and cast go away.
        const host = {
          digest: async (content: string) => {
            const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
            return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
          },
          now: () => new Date(),
        };
        // blockConcurrencyWhile gates incoming handlers until migrations finish,
        // so getColumns / getApplied can use this.client directly — no per-handler
        // await-ready dance.
        state.blockConcurrencyWhile(() =>
          applyMigrations(host as any, this.client, {
            migrations: migrationsFromBundle(bundle),
          }),
        );
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
  );

  expect(await fixture.stub.getColumns()).toMatchObject([{name: 'id'}, {name: 'slug'}, {name: 'body'}]);

  expect(await fixture.stub.getApplied()).toMatchObject([
    {name: '2026-04-10T00.00.00.000Z_create_posts'},
    {name: '2026-04-10T01.00.00.000Z_add_body'},
  ]);
});

test('createDurableObjectClient.raw runs multiple statements', async () => {
  await using fixture = await createDOFixture(
    class ClientMultiStatementTest {
      client: ReturnType<typeof createDurableObjectClient>;

      constructor(state: any) {
        this.client = createDurableObjectClient(state.storage.sql);
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

async function createDOFixture<TInstance extends object>(classDef: new (...args: any[]) => TInstance) {
  await ensureBuilt();

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-do-fixture-'));
  const workerPath = path.join(tempDir, 'worker.js');
  await Promise.all([fs.cp(path.join(packageRoot, 'dist'), path.join(tempDir, 'runtime'), {recursive: true})]);

  const classDefString = classDef.toString().trim();
  const className = classDefString.match(/^class (\w+) \{/)?.[1];
  if (!className) {
    throw new Error(`Failed to extract class name from class definition: ${classDefString}`);
  }

  await fs.writeFile(
    workerPath,
    dedent`
      import {createDurableObjectClient} from './runtime/adapters/durable-object.js';
      import {sql} from './runtime/core/sql.js';
      import {applyMigrations, migrationsFromBundle} from './runtime/migrations/index.js';

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

      return async (...args: readonly unknown[]) => {
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
