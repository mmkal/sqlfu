import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import dedent from 'dedent';
import {Miniflare} from 'miniflare';
import {expect, test} from 'vitest';

import {ensureBuilt, packageRoot} from './ensure-built.js';

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
      import {sql} from './runtime/core/sql.js';

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
    async fetch(input: string, init?: RequestInit) {
      return worker.fetch(input, init);
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

interface WorkerFetcherLike {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}
