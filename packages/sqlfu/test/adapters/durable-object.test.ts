import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {Miniflare} from 'miniflare';
import ts from 'typescript';
import {expect, test} from 'vitest';
import dedent from 'dedent';

const packageRoot = path.resolve(path.dirname(import.meta.filename), '../..');
declare const createDurableObjectClient: typeof import('../../src/index.ts').createDurableObjectClient;
declare const sql: typeof import('../../src/index.ts').sql;

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

async function createDOFixture<TInstance extends object>(
  classDef: new (...args: any[]) => TInstance,
) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-do-fixture-'));
  const workerPath = path.join(tempDir, 'worker.js');
  const sqlRuntimePath = path.join(tempDir, 'runtime/sql.js');
  const durableObjectRuntimePath = path.join(tempDir, 'runtime/durable-object.js');

  await Promise.all([
    writeTranspiledModule(
      path.join(packageRoot, 'src/core/sql.ts'),
      sqlRuntimePath,
    ),
    writeTranspiledModule(
      path.join(packageRoot, 'src/adapters/durable-object.ts'),
      durableObjectRuntimePath,
      [['../core/sql.js', './sql.js']],
    ),
  ]);

  const classDefString = classDef.toString().trim();
  const className = classDefString.match(/^class (\w+) \{/)?.[1];
  if (!className) {
    throw new Error(`Failed to extract class name from class definition: ${classDefString}`);
  }

  await fs.writeFile(
    workerPath,
    dedent`
      import {createDurableObjectClient} from './runtime/durable-object.js';
      import {sql} from './runtime/sql.js';
      
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
    `
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

async function writeTranspiledModule(
  sourcePath: string,
  outputPath: string,
  replacements: ReadonlyArray<readonly [from: string, to: string]> = [],
) {
  const source = await fs.readFile(sourcePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: sourcePath,
  });

  let output = transpiled.outputText;
  for (const [from, to] of replacements) {
    output = output.replaceAll(from, to);
  }

  await fs.mkdir(path.dirname(outputPath), {recursive: true});
  await fs.writeFile(outputPath, output);
}

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectFetchStub;
}

interface DurableObjectFetchStub {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

function createRpcStub<TInstance extends object>(stub: DurableObjectFetchStub) {
  return new Proxy(
    {} as TInstance,
    {
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
          const payload = (await response.json()) as
            | {ok: true; value: unknown}
            | {ok: false; error: {message: string}};

          if (!response.ok || !payload.ok) {
            throw new Error(payload.ok ? `RPC failed with status ${response.status}` : payload.error.message);
          }

          return payload.value;
        };
      },
    },
  );
}
