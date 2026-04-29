import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

import * as esbuild from 'esbuild';
import {expect, test, type Page} from '@playwright/test';
import {Miniflare} from 'miniflare';

const execFile = promisify(childProcess.execFile);
const currentDir = import.meta.dirname;
const repoRoot = path.resolve(currentDir, '../../..');
const sqlfuRoot = path.resolve(currentDir, '../../sqlfu');
const uiRoot = path.resolve(currentDir, '..');

let buildPromise: Promise<void> | undefined;

declare const createD1Client: typeof import('sqlfu').createD1Client;
declare const createSqlfuUiPartialFetch: typeof import('@sqlfu/ui/partial-fetch').createSqlfuUiPartialFetch;

test('D1 worker partial fetch serves real UI assets while leaving app routes available', async ({page}) => {
  await using fixture = await createPartialFetchWorkerFixture({
    fetch: async (request, env) => {
      const url = new URL(request.url);
      if (url.pathname === '/hello') {
        return new Response('<!doctype html><h1>Hello!</h1>', {
          headers: {'content-type': 'text/html; charset=utf-8'},
        });
      }

      const db = createD1Client(env.DB);
      await db.raw(`
        create table if not exists people (
          id integer primary key,
          name text not null,
          role text not null
        );
        insert or ignore into people (id, name, role) values (1, 'Ada Lovelace', 'Query planner');
        insert or ignore into people (id, name, role) values (2, 'Grace Hopper', 'Compiler whisperer');
      `);

      const uiPartialFetch = createSqlfuUiPartialFetch({
        project: {
          initialized: true,
          projectRoot: '/partial-fetch-playwright',
        },
        host: {
          async openDb() {
            return {
              client: db,
              async [Symbol.asyncDispose]() {},
            };
          },
        },
      });
      const partialResponse = await uiPartialFetch(request);

      if (partialResponse) {
        return partialResponse;
      }

      return new Response('plain worker fallback', {status: 404});
    },
  });

  await page.goto(`${fixture.origin}/hello`);
  await expect(page.getByRole('heading', {name: 'Hello!'})).toBeVisible();

  await page.goto(`${fixture.origin}/#table/people`);
  await expect(page.getByRole('heading', {name: 'people'})).toBeVisible();
  await expect(page.getByText('Ada Lovelace')).toBeVisible();
  await expect(page.getByText('Grace Hopper')).toBeVisible();

  await page.getByRole('link', {name: 'SQL runner'}).click();
  await replaceCodeMirrorText(
    page,
    'SQL editor',
    `
    insert into people (id, name, role)
    values (3, 'Katherine Johnson', 'Orbit calculator');
  `,
  );
  await page.getByRole('button', {name: 'Run SQL'}).click();
  await expect(page.getByText('rowsAffected')).toBeVisible();

  await replaceCodeMirrorText(
    page,
    'SQL editor',
    `
    select id, name, role
    from people
    order by id;
  `,
  );
  await page.getByRole('button', {name: 'Run SQL'}).click();
  await expect(page.getByText('Katherine Johnson')).toBeVisible();
});

async function createPartialFetchWorkerFixture(input: PartialFetchWorkerFixtureInput) {
  await ensureBuilt();

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-partial-fetch-playwright-'));
  const workerSourcePath = path.join(tempDir, 'worker-source.js');
  const workerPath = path.join(tempDir, 'worker.js');

  await fs.writeFile(workerSourcePath, createWorkerSource(input.fetch));

  await esbuild.build({
    entryPoints: [workerSourcePath],
    outfile: workerPath,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    absWorkingDir: sqlfuRoot,
    nodePaths: [path.join(sqlfuRoot, 'node_modules'), path.join(uiRoot, 'node_modules')],
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
  const workerResponse = await worker.fetch(`http://partial-fetch.local${request.url || '/'}`, {
    method: request.method,
    headers: headersFromIncomingRequest(request),
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
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

interface PartialFetchWorkerFixtureInput {
  fetch(
    request: Request,
    env: {
      DB: Parameters<typeof createD1Client>[0];
    },
  ): Promise<Response> | Response;
}

function createWorkerSource(fetch: PartialFetchWorkerFixtureInput['fetch']) {
  return String.raw`
import {createD1Client} from 'sqlfu';
import {createSqlfuUiPartialFetch} from '@sqlfu/ui/partial-fetch';

const userFetch = ${toCallableFunctionExpressionSource(fetch.toString())};

export default {
  fetch(request, workerEnv) {
    return userFetch(request, workerEnv);
  },
};
`;
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
