import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

import * as esbuild from 'esbuild';
import {expect, test, type Page} from '@playwright/test';
import {Miniflare} from 'miniflare';
import {dedent} from 'sqlfu';

const execFile = promisify(childProcess.execFile);
const currentDir = import.meta.dirname;
const repoRoot = path.resolve(currentDir, '../../..');
const sqlfuRoot = path.resolve(currentDir, '../../sqlfu');
const uiRoot = path.resolve(currentDir, '..');

let buildPromise: Promise<void> | undefined;

declare const createD1Client: typeof import('sqlfu').createD1Client;
declare const createDurableObjectClient: typeof import('sqlfu').createDurableObjectClient;
declare const createSqlfuUiPartialFetch: typeof import('@sqlfu/ui').createSqlfuUiPartialFetch;

test('D1 worker partial fetch serves real UI assets while leaving app routes available', async ({page}) => {
  await using fixture = await createPartialFetchWorkerFixture({
    fetch: async (request, env) => {
      const db = createD1Client(env.DB);
      await db.sql`
        create table if not exists todos (
          id integer primary key,
          title text not null,
          completed integer not null default 0
        );
      `;

      const url = new URL(request.url);
      if (url.pathname === '/app') {
        return new Response(
          dedent`
            <!doctype html>
            <form method="post" action="/api/todos">
              <label>
                Todo
                <input name="title" />
              </label>
              <button type="submit">Add</button>
            </form>
          `,
          {headers: {'content-type': 'text/html; charset=utf-8'}},
        );
      }

      if (url.pathname === '/api/todos' && request.method === 'POST') {
        const formData = await request.formData();
        await db.run({
          sql: 'insert into todos (title) values (?)',
          args: [String(formData.get('title') || '')],
        });
        return new Response(null, {status: 303, headers: {location: '/app'}});
      }

      const uiPartialFetch = createSqlfuUiPartialFetch({
        project: {
          initialized: true,
          projectRoot: '/partial-fetch-playwright',
        },
        host: {
          openDb: async () => ({
            client: db,
            async [Symbol.asyncDispose]() {},
          }),
        },
      });
      const sqlfuUiResponse = await uiPartialFetch(request);

      if (sqlfuUiResponse) {
        return sqlfuUiResponse;
      }

      return new Response('plain worker fallback', {status: 404});
    },
  });

  await page.goto(`${fixture.origin}/app`);
  await page.getByLabel('Todo').fill('Feed snake');
  await page.getByRole('button', {name: 'Add'}).click();

  await page.goto(`${fixture.origin}/#table/todos`);
  await expect(page.getByRole('heading', {name: 'todos'})).toBeVisible();
  await expect(page.getByText('Feed snake')).toBeVisible();

  await page.getByRole('link', {name: 'SQL runner'}).click();
  await replaceCodeMirrorText(
    page,
    'SQL editor',
    dedent`
      select id, title, completed
      from todos
      order by id;
    `,
  );
  await page.getByRole('button', {name: 'Run SQL'}).click();
  await expect(page.getByText('Feed snake')).toBeVisible();
});

test('partial fetch can serve the UI behind worker-owned prefix auth', async ({page}) => {
  await using fixture = await createPartialFetchWorkerFixture({
    fetch: async (request, env) => {
      const db = createD1Client(env.DB);
      await db.sql`
        create table if not exists todos (
          id integer primary key,
          title text not null,
          completed integer not null default 0
        );
      `;

      const url = new URL(request.url);

      const sessionId = request.headers.get('cookie')?.match(/session_id=([^;]+)/u)?.[1] || '';

      if (!sessionId && url.pathname !== '/login' && url.pathname !== '/api/login') {
        return new Response(null, {status: 303, headers: {location: '/login'}});
      }

      if (url.pathname === '/app') {
        return new Response(
          dedent`
            <!doctype html>
            <form method="post" action="/api/todos">
              <label>
                Todo
                <input name="title" />
              </label>
              <button type="submit">Add</button>
            </form>
          `,
          {headers: {'content-type': 'text/html; charset=utf-8'}},
        );
      }

      if (url.pathname === '/api/todos' && request.method === 'POST') {
        const formData = await request.formData();
        const title = String(formData.get('title') || '');
        await db.sql`insert into todos (title) values (${title})`;
        return new Response(null, {status: 303, headers: {location: '/app'}});
      }

      if (url.pathname === '/login') {
        return new Response(
          dedent`
            <!doctype html>
            <form method="post" action="/api/login">
              <label>
                Passphrase
                <input name="passphrase" type="password" />
              </label>
              <button type="submit">Unlock</button>
            </form>
          `,
          {headers: {'content-type': 'text/html; charset=utf-8'}},
        );
      }

      if (url.pathname === '/api/login' && request.method === 'POST') {
        const formData = await request.formData();
        if (formData.get('passphrase') !== 'open sesame') {
          return new Response('Nope', {status: 401});
        }
        return new Response(null, {
          status: 303,
          headers: {
            location: '/my-db',
            'set-cookie': `session_id=${crypto.randomUUID()}; HttpOnly; SameSite=Lax; Path=/`,
          },
        });
      }

      if (url.pathname.startsWith('/my-db') && !sessionId) {
        return new Response('Unauthorized', {status: 401});
      }

      const uiPartialFetch = createSqlfuUiPartialFetch({
        prefixPath: '/my-db',
        project: {
          initialized: true,
          projectRoot: '/partial-fetch-playwright',
        },
        host: {
          openDb: async () => ({
            client: db,
            async [Symbol.asyncDispose]() {},
          }),
        },
      });
      const sqlfuUiResponse = await uiPartialFetch(request);

      if (sqlfuUiResponse) {
        return sqlfuUiResponse;
      }

      return new Response('plain worker fallback', {status: 404});
    },
  });

  await page.goto(`${fixture.origin}/my-db`);
  await expect(page).toHaveURL(`${fixture.origin}/login`);
  await page.getByLabel('Passphrase').fill('open sesame');
  await page.getByRole('button', {name: 'Unlock'}).click();
  await expect(page).toHaveURL(`${fixture.origin}/my-db`);

  await page.goto(`${fixture.origin}/app`);
  await page.getByLabel('Todo').fill('Wash cloak');
  await page.getByRole('button', {name: 'Add'}).click();

  await page.goto(`${fixture.origin}/my-db/#table/todos`);
  await expect(page).toHaveURL(/\/my-db\/?#table\/todos$/u);
  await expect(page.getByRole('heading', {name: 'todos'})).toBeVisible();
  await expect(page.getByText('Wash cloak')).toBeVisible();
});

test('partial fetch can serve separate worker and durable object UIs from one worker', async ({page}) => {
  await using fixture = await createPartialFetchWorkerFixture({
    durableObjects: {
      SESSION_OBJECT: class SessionObject {
        client: ReturnType<typeof createDurableObjectClient>;

        constructor(state: any) {
          this.client = createDurableObjectClient(state.storage);
          this.client.raw(dedent`
            create table if not exists events (
              id integer primary key,
              type text not null,
              created_at text not null
            );
          `);
        }

        getTodoAddedCount() {
          const rows = this.client.all<{total: number}>({
            sql: "select count(*) as total from events where type = 'todo_added'",
            args: [],
          });
          return rows[0]?.total || 0;
        }

        incrementTodoAddedCount() {
          this.client.run({
            sql: 'insert into events (type, created_at) values (?, ?)',
            args: ['todo_added', new Date().toISOString()],
          });
        }

        async fetch(request: Request) {
          const client = this.client;
          const partialFetch = createSqlfuUiPartialFetch({
            prefixPath: '/app/session-db',
            project: {
              initialized: true,
              projectRoot: '/app/session-db',
            },
            host: {
              openDb: async () => ({
                client,
                async [Symbol.asyncDispose]() {},
              }),
            },
          });
          const sqlfuUiResponse = await partialFetch(request);

          if (sqlfuUiResponse) {
            return sqlfuUiResponse;
          }

          return new Response('session not found', {status: 404});
        }
      },
    },
    fetch: async (request, env) => {
      const db = createD1Client(env.DB);
      const sql = db.sql;
      await sql`
        create table if not exists todos (
          id integer primary key,
          title text not null,
          session_id text not null,
          completed integer not null default 0
        );
      `;

      const url = new URL(request.url);
      const cookie = request.headers.get('cookie') || '';
      const sessionId = cookie.match(/session_id=([^;]+)/u)?.[1] || '';
      const sessionObj = sessionId ? env.SESSION_OBJECT.get(env.SESSION_OBJECT.idFromName(sessionId)) : null;

      if (!sessionObj && url.pathname !== '/login' && url.pathname !== '/api/login') {
        return new Response(null, {status: 303, headers: {location: '/login'}});
      }

      if (url.pathname === '/app') {
        const count = await sessionObj!.getTodoAddedCount();
        return new Response(
          dedent`
            <!doctype html>
            <form method="post" action="/api/todos">
              <label>
                Worker todo
                <input name="title" />
              </label>
              <button type="submit">Add</button>
            </form>
            <form method="post" action="/api/logout">
              <button type="submit">Logout</button>
            </form>
            <p>Todos added this session: ${count}</p>
          `,
          {headers: {'content-type': 'text/html; charset=utf-8'}},
        );
      }

      if (url.pathname === '/api/todos' && request.method === 'POST') {
        const formData = await request.formData();
        await sql`
          insert into todos (title, session_id)
          values (${String(formData.get('title') || '')}, ${sessionId})
        `;
        await sessionObj!.incrementTodoAddedCount();
        return new Response(null, {status: 303, headers: {location: '/app'}});
      }

      if (url.pathname === '/login') {
        return new Response(
          dedent`
            <!doctype html>
            <form method="post" action="/api/login">
              <label>
                Passphrase
                <input name="passphrase" type="password" />
              </label>
              <button type="submit">Unlock</button>
            </form>
          `,
          {headers: {'content-type': 'text/html; charset=utf-8'}},
        );
      }

      if (url.pathname === '/api/login' && request.method === 'POST') {
        const formData = await request.formData();
        if (formData.get('passphrase') !== 'open sesame') {
          return new Response('Nope', {status: 401});
        }
        return new Response(null, {
          status: 303,
          headers: {
            location: '/app',
            'set-cookie': `session_id=${crypto.randomUUID()}; HttpOnly; SameSite=Lax; Path=/`,
          },
        });
      }

      if (url.pathname === '/api/logout' && request.method === 'POST') {
        return new Response(null, {
          status: 303,
          headers: {
            location: '/login',
            'set-cookie': 'session_id=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/',
          },
        });
      }

      if (url.pathname.startsWith('/app/session-db')) {
        return sessionObj!.fetch(request);
      }

      if (url.pathname.startsWith('/my-db') && !sessionObj) {
        return new Response(null, {status: 303, headers: {location: '/login'}});
      }

      const partialResponse = await createSqlfuUiPartialFetch({
        prefixPath: '/my-db',
        project: {
          initialized: true,
          projectRoot: '/partial-fetch-playwright-worker',
        },
        host: {
          async openDb() {
            return {
              client: db,
              async [Symbol.asyncDispose]() {},
            };
          },
        },
      })(request);

      if (partialResponse) {
        return partialResponse;
      }

      return new Response('plain worker fallback', {status: 404});
    },
  });

  await page.goto(`${fixture.origin}/my-db`);
  await expect(page).toHaveURL(`${fixture.origin}/login`);
  await page.getByLabel('Passphrase').fill('open sesame');
  await page.getByRole('button', {name: 'Unlock'}).click();
  await expect(page).toHaveURL(`${fixture.origin}/app`);
  await expect(page.getByText('Todos added this session: 0')).toBeVisible();
  await page.getByLabel('Worker todo').fill('Feed snake');
  await page.getByRole('button', {name: 'Add'}).click();
  await expect(page).toHaveURL(`${fixture.origin}/app`);
  await expect(page.getByText('Todos added this session: 1')).toBeVisible();

  await page.goto(`${fixture.origin}/my-db/#table/todos`);
  await expect(page.getByRole('heading', {name: 'todos'})).toBeVisible();
  await expect(page.getByText('Feed snake')).toBeVisible();

  await page.goto(`${fixture.origin}/app/session-db/#table/events`);
  await expect(page).toHaveURL(/\/app\/session-db\/?#table\/events$/u);
  await expect(page.getByRole('heading', {name: 'events'})).toBeVisible();
  await expect(page.getByText('todo_added')).toBeVisible();

  await page.goto(`${fixture.origin}/my-db/#table/todos`);
  await expect(page.getByRole('heading', {name: 'todos'})).toBeVisible();
  await expect(page.getByText('Feed snake')).toBeVisible();

  await page.goto(`${fixture.origin}/app`);
  await page.getByRole('button', {name: 'Logout'}).click();
  await expect(page).toHaveURL(`${fixture.origin}/login`);
  await page.getByLabel('Passphrase').fill('open sesame');
  await page.getByRole('button', {name: 'Unlock'}).click();
  await expect(page).toHaveURL(`${fixture.origin}/app`);
  await expect(page.getByText('Todos added this session: 0')).toBeVisible();
});

async function createPartialFetchWorkerFixture<DOs extends Record<string, new (...args: any[]) => object>>(
  input: PartialFetchWorkerFixtureInput<DOs>,
) {
  await ensureBuilt();

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-partial-fetch-playwright-'));
  const workerSourcePath = path.join(tempDir, 'worker-source.js');
  const workerPath = path.join(tempDir, 'worker.js');

  await fs.writeFile(workerSourcePath, createWorkerSource(input));

  await esbuild.build({
    entryPoints: [workerSourcePath],
    outfile: workerPath,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    absWorkingDir: sqlfuRoot,
    nodePaths: [path.join(sqlfuRoot, 'node_modules'), path.join(uiRoot, 'node_modules')],
    external: ['cloudflare:workers'],
  });

  const miniflare = new Miniflare({
    rootPath: tempDir,
    modulesRoot: tempDir,
    scriptPath: 'worker.js',
    modules: true,
    modulesRules: [{type: 'ESModule', include: ['**/*.js']}],
    compatibilityDate: '2024-04-03',
    d1Databases: ['DB'],
    durableObjects: durableObjectBindings(input.durableObjects || {}),
  });
  await miniflare.ready;

  const worker = (await miniflare.getWorker()) as unknown as WorkerFetcherLike;
  const proxy = await createHttpWorkerProxy(worker);

  return {
    origin: proxy.origin,
    async [Symbol.asyncDispose]() {
      await proxy[Symbol.asyncDispose]();
      await miniflare.dispose();
      await fs.rm(tempDir, {recursive: true, force: true});
    },
  };
}

async function ensureBuilt() {
  buildPromise ||= (async () => {
    await execFile('pnpm', ['--filter', 'sqlfu', 'build:runtime'], {cwd: repoRoot});
    await execFile('pnpm', ['--filter', '@sqlfu/ui', 'build'], {cwd: repoRoot});
  })();
  await buildPromise;
}

async function createHttpWorkerProxy(worker: WorkerFetcherLike) {
  const server = http.createServer((request, response) => {
    void proxyRequest(worker, request, response).catch((error) => {
      response.statusCode = 500;
      response.setHeader('content-type', 'text/plain; charset=utf-8');
      response.end(String(error));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not start partial fetch worker proxy');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    async [Symbol.asyncDispose]() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function proxyRequest(worker: WorkerFetcherLike, request: http.IncomingMessage, response: http.ServerResponse) {
  const body = await readIncomingBody(request);
  const requestUrl = `http://${request.headers.host || 'partial-fetch.local'}${request.url || '/'}`;
  const workerResponse = await worker.fetch(requestUrl, {
    method: request.method,
    headers: headersFromIncomingRequest(request),
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
    redirect: 'manual',
  });

  response.statusCode = workerResponse.status;
  response.statusMessage = workerResponse.statusText;
  workerResponse.headers.forEach((value, key) => response.setHeader(key, value));
  response.end(Buffer.from(await workerResponse.arrayBuffer()));
}

async function readIncomingBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function headersFromIncomingRequest(request: http.IncomingMessage) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }
    if (value !== undefined) {
      headers.set(key, String(value));
    }
  }
  return headers;
}

async function replaceCodeMirrorText(page: Page, ariaLabel: string, value: string) {
  const content = page.locator(`[aria-label="${ariaLabel}"] .cm-content`);
  await content.click();
  await content.fill(value);
}

interface WorkerFetcherLike {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

interface PartialFetchWorkerFixtureInput<DOs extends Record<string, new (...args: any[]) => object>> {
  durableObjects?: DOs;
  fetch(
    request: Request,
    env: {
      [K in keyof DOs]: {
        get: (id: string & {_brand: 'id'}) => Asyncify<InstanceType<DOs[K]>>;
        idFromName: (name: string) => string & {_brand: 'id'};
      };
    } & {
      DB: Parameters<typeof createD1Client>[0];
    },
  ): Promise<Response> | Response;
}

type Asyncify<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<R> : T[K];
};

function createWorkerSource<DOs extends Record<string, new (...args: any[]) => object>>(
  input: PartialFetchWorkerFixtureInput<DOs>,
) {
  return dedent`
import {DurableObject} from 'cloudflare:workers';
import {createD1Client, createDurableObjectClient, dedent} from 'sqlfu';
import {createSqlfuUiPartialFetch} from '@sqlfu/ui';

${durableObjectClassSource(input.durableObjects || {})}

const userFetch = ${toCallableFunctionExpressionSource(input.fetch.toString())};

export default {
  fetch(request, workerEnv) {
    return userFetch(request, workerEnv);
  },
};
`;
}

function durableObjectBindings(durableObjects: Record<string, new (...args: any[]) => object>) {
  return Object.fromEntries(
    Object.entries(durableObjects).map(([bindingName, classDef]) => [
      bindingName,
      {
        className: durableObjectClassName(classDef),
        useSQLite: true,
      },
    ]),
  );
}

function durableObjectClassSource(durableObjects: Record<string, new (...args: any[]) => object>) {
  return Object.values(durableObjects)
    .map((classDef) => {
      const className = durableObjectClassName(classDef);
      return `${durableObjectClassWithBase(classDef)}\nexport {${className}};`;
    })
    .join('\n\n');
}

function durableObjectClassWithBase(classDef: new (...args: any[]) => object) {
  return classDef
    .toString()
    .trim()
    .replace(/^class\s+([A-Za-z_$][\w$]*)\s+\{/u, 'class $1 extends DurableObject {')
    .replace(/constructor\(([^)]*)\)\s+\{/u, 'constructor($1) { super(...arguments);');
}

function durableObjectClassName(classDef: new (...args: any[]) => object) {
  const className = classDef
    .toString()
    .trim()
    .match(/^class\s+([A-Za-z_$][\w$]*)/u)?.[1];
  if (!className) {
    throw new Error(`Durable Object fixtures must use named classes: ${classDef.toString()}`);
  }
  return className;
}

function toCallableFunctionExpressionSource(source: string): string {
  if (source.startsWith('async fetch(')) {
    return source.replace(/^async fetch\(/u, 'async function fetch(');
  }

  if (source.startsWith('fetch(')) {
    return source.replace(/^fetch\(/u, 'function fetch(');
  }

  return source;
}
