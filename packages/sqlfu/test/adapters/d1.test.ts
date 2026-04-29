import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as esbuild from 'esbuild';
import dedent from 'dedent';
import {createORPCClient} from '@orpc/client';
import {RPCLink} from '@orpc/client/fetch';
import type {RouterClient} from '@orpc/server';
import {Miniflare} from 'miniflare';
import {expect, test} from 'vitest';

import {ensureBuilt, packageRoot} from './ensure-built.js';
import type {UiRouter} from '../../src/ui/browser.js';

declare const createD1Client: typeof import('../../src/index.ts').createD1Client;
declare const sql: typeof import('../../src/index.ts').sql;

test('createD1Client works in a generated local worker fixture', async () => {
  await using fixture = await createD1Fixture({
    async fetch(request: Request, env: {DB: unknown}) {
      const db = createD1Client(env.DB as Parameters<typeof createD1Client>[0]);
      const url = new URL(request.url);

      if (url.pathname === '/create') {
        await db.run(sql`
          create table if not exists person (
            id integer primary key,
            name text not null
          )
        `);
        return Response.json({ok: true});
      }

      if (url.pathname === '/insert') {
        await db.run(sql`
          insert into person (id, name)
          values (${Number(url.searchParams.get('id'))}, ${String(url.searchParams.get('name'))})
        `);
        return Response.json({ok: true});
      }

      if (url.pathname === '/list') {
        const rows = await db.all<{id: number; name: string}>(sql`
          select id, name
          from person
          order by id
        `);
        return Response.json(rows);
      }

      if (url.pathname === '/multi') {
        await db.raw(`
          create table person (
            id integer primary key,
            name text not null
          );
          insert into person (id, name) values (1, 'bob');
          insert into person (id, name) values (2, 'ada');
        `);
        return Response.json({ok: true});
      }

      return new Response('not found', {status: 404});
    },
  });

  expect(await fixture.fetch('http://fixture/create')).toMatchObject({ok: true});
  expect(await fixture.fetch('http://fixture/insert?id=1&name=bob')).toMatchObject({ok: true});
  expect(await fixture.fetch('http://fixture/insert?id=2&name=ada')).toMatchObject({ok: true});

  const res = await fixture.fetch('http://fixture/list');
  expect(await res.json()).toMatchObject([
    {id: 1, name: 'bob'},
    {id: 2, name: 'ada'},
  ]);
});

test('createD1SqlfuUiFetch serves assets and RPC from a plain D1 worker', async () => {
  await using fixture = await createD1PartialUiFetchFixture();

  const index = await fixture.fetch('http://fixture/');
  expect(await index.text()).toContain('d1-ui-ok');

  const asset = await fixture.fetch('http://fixture/assets/app.js');
  expect(await asset.text()).toContain('__sqlfuD1UiLoaded__');

  const fallback = await fixture.fetch('http://fixture/not-sqlfu');
  expect(fallback.status).toBe(299);

  const client: RouterClient<UiRouter> = createORPCClient(
    new RPCLink({
      url: 'http://fixture/api/rpc',
      fetch: async (input, init) => fixture.fetch(input, init),
    }),
  );

  const catalog = await client.catalog();
  expect(catalog.queries.map((query) => query.id)).toMatchObject(['list-people', 'people-by-role']);

  expect(await client.query.execute({queryId: 'list-people'})).toMatchObject({
    mode: 'rows',
    rows: [
      {id: 1, name: 'Ada', role: 'Query planner'},
      {id: 2, name: 'Grace', role: 'Compiler whisperer'},
    ],
  });

  expect(await client.query.execute({queryId: 'people-by-role', params: {role: 'Compiler'}})).toMatchObject({
    mode: 'rows',
    rows: [{id: 2, name: 'Grace', role: 'Compiler whisperer'}],
  });
});

test('createD1Client runs multiple statements in one query', async () => {
  await using fixture = await createD1Fixture({
    async fetch(request: Request, env: {DB: unknown}) {
      const db = createD1Client(env.DB as Parameters<typeof createD1Client>[0]);
      const url = new URL(request.url);

      if (url.pathname === '/multi') {
        await db.raw(`
          create table person (
            id integer primary key,
            name text not null
          );
          insert into person (id, name) values (1, 'bob');
          insert into person (id, name) values (2, 'ada');
        `);
        return Response.json({ok: true});
      }

      if (url.pathname === '/list') {
        return Response.json(await db.all(sql`select id, name from person order by id`));
      }

      return new Response('not found', {status: 404});
    },
  });

  expect(await fixture.fetch('http://fixture/multi')).toMatchObject({ok: true});
  const res = await fixture.fetch('http://fixture/list');
  expect(await res.json()).toMatchObject([
    {id: 1, name: 'bob'},
    {id: 2, name: 'ada'},
  ]);
});

async function createD1Fixture(workerDef: {
  fetch(request: Request, env: {DB: unknown}, ctx: unknown): Promise<Response> | Response;
}) {
  await ensureBuilt();

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-d1-fixture-'));
  const workerPath = path.join(tempDir, 'worker.js');
  await Promise.all([fs.cp(path.join(packageRoot, 'dist'), path.join(tempDir, 'runtime'), {recursive: true})]);

  await fs.writeFile(
    workerPath,
    dedent`
      import {createD1Client} from './runtime/adapters/d1.js';
      import {sql} from './runtime/sql.js';

      const userFetch = ${toCallableFunctionSource(workerDef.fetch.toString())};

      export default {
        fetch(request, env, ctx) {
          return userFetch(request, env, ctx);
        },
      };
    ` + '\n',
  );

  const miniflare = new Miniflare({
    rootPath: tempDir,
    modulesRoot: tempDir,
    scriptPath: 'worker.js',
    modules: true,
    modulesRules: [{type: 'ESModule', include: ['**/*.js']}],
    d1Databases: ['DB'],
  });

  await miniflare.ready;

  const worker = (await miniflare.getWorker()) as unknown as WorkerFetcherLike;

  return {
    async fetch(input: string | URL | Request, init?: RequestInit) {
      return fetchThroughWorker(worker, input, init);
    },
    async [Symbol.asyncDispose]() {
      await miniflare.dispose();
      await fs.rm(tempDir, {recursive: true, force: true});
    },
  };
}

async function createD1PartialUiFetchFixture() {
  await ensureBuilt();

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-d1-ui-fixture-'));
  const workerSourcePath = path.join(tempDir, 'worker-source.js');
  const workerPath = path.join(tempDir, 'worker.js');
  await fs.cp(path.join(packageRoot, 'dist'), path.join(tempDir, 'runtime'), {recursive: true});
  await fs.copyFile(path.join(packageRoot, 'package.json'), path.join(tempDir, 'package.json'));
  await fs.writeFile(
    workerSourcePath,
    dedent`
      import {createD1Client} from './runtime/adapters/d1.js';
      import {sql} from './runtime/sql.js';
      import {createD1SqlfuUiFetch} from './runtime/ui/browser.js';

      const catalog = {
        generatedAt: new Date(0).toISOString(),
        queries: [
          {
            kind: 'query',
            id: 'list-people',
            sqlFile: 'sql/list-people.sql',
            functionName: 'listPeople',
            sql: 'select id, name, role from person order by id',
            sqlFileContent: 'select id, name, role from person order by id;',
            queryType: 'Select',
            multipleRowsResult: true,
            resultMode: 'many',
            args: [],
            resultSchema: {
              type: 'object',
              properties: {
                id: {type: 'number', title: 'id'},
                name: {type: 'string', title: 'name'},
                role: {type: 'string', title: 'role'},
              },
              required: ['id', 'name', 'role'],
              additionalProperties: false,
            },
            columns: [
              {name: 'id', tsType: 'number', notNull: true, optional: false},
              {name: 'name', tsType: 'string', notNull: true, optional: false},
              {name: 'role', tsType: 'string', notNull: true, optional: false},
            ],
          },
          {
            kind: 'query',
            id: 'people-by-role',
            sqlFile: 'sql/people-by-role.sql',
            functionName: 'peopleByRole',
            sql: "select id, name, role from person where role like '%' || ? || '%' order by id",
            sqlFileContent: "select id, name, role from person where role like '%' || :role || '%' order by id;",
            queryType: 'Select',
            multipleRowsResult: true,
            resultMode: 'many',
            args: [
              {
                scope: 'params',
                name: 'role',
                tsType: 'string',
                notNull: true,
                optional: false,
                isArray: false,
                driverEncoding: 'identity',
              },
            ],
            paramsSchema: {
              type: 'object',
              properties: {role: {type: 'string', title: 'role'}},
              required: ['role'],
              additionalProperties: false,
            },
            resultSchema: {
              type: 'object',
              properties: {
                id: {type: 'number', title: 'id'},
                name: {type: 'string', title: 'name'},
                role: {type: 'string', title: 'role'},
              },
              required: ['id', 'name', 'role'],
              additionalProperties: false,
            },
            columns: [
              {name: 'id', tsType: 'number', notNull: true, optional: false},
              {name: 'name', tsType: 'string', notNull: true, optional: false},
              {name: 'role', tsType: 'string', notNull: true, optional: false},
            ],
          },
        ],
      };

      export default {
        async fetch(request, env) {
          const db = createD1Client(env.DB);
          await db.raw(\`
            create table if not exists person (
              id integer primary key,
              name text not null,
              role text not null
            );
          \`);

          const counts = await db.all(sql\`select count(*) as count from person\`);
          if (Number(counts[0]?.count || 0) === 0) {
            await db.raw(\`
              insert into person (id, name, role) values (1, 'Ada', 'Query planner');
              insert into person (id, name, role) values (2, 'Grace', 'Compiler whisperer');
            \`);
          }

          const partialFetch = createD1SqlfuUiFetch({
            database: env.DB,
            projectName: 'fixture-d1',
            definitionsSql: \`
              create table person (
                id integer primary key,
                name text not null,
                role text not null
              );
            \`,
            catalog,
            assets: {
              '/index.html': '<!doctype html><html><body><div id="app">d1-ui-ok</div></body></html>',
              '/assets/app.js': 'globalThis.__sqlfuD1UiLoaded__ = true;',
            },
          });

          const response = await partialFetch(request);
          if (response) {
            return response;
          }
          return new Response('plain worker fallback', {status: 299});
        },
      };
    ` + '\n',
  );

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
    d1Databases: ['DB'],
  });

  await miniflare.ready;

  const worker = (await miniflare.getWorker()) as unknown as WorkerFetcherLike;

  return {
    async fetch(input: string | URL | Request, init?: RequestInit) {
      return fetchThroughWorker(worker, input, init);
    },
    async [Symbol.asyncDispose]() {
      await miniflare.dispose();
      await fs.rm(tempDir, {recursive: true, force: true});
    },
  };
}

function toCallableFunctionSource(source: string): string {
  if (source.startsWith('async fetch(')) {
    return source.replace(/^async fetch\(/, 'async function fetch(');
  }

  if (source.startsWith('fetch(')) {
    return source.replace(/^fetch\(/, 'function fetch(');
  }

  return source;
}

async function fetchThroughWorker(worker: WorkerFetcherLike, input: string | URL | Request, init?: RequestInit) {
  if (!(input instanceof Request)) {
    return worker.fetch(input, init);
  }

  return worker.fetch(input.url, {
    ...init,
    method: init?.method || input.method,
    headers: init?.headers || input.headers,
    body: init?.body || (input.method === 'GET' || input.method === 'HEAD' ? undefined : await input.arrayBuffer()),
  });
}

interface WorkerFetcherLike {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}
