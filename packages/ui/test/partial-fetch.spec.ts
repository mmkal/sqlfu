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
declare const createSqlfuUiPartialFetch: typeof import('sqlfu/ui/browser').createSqlfuUiPartialFetch;
declare const env: {DB: Parameters<typeof createD1Client>[0]};
declare const uiAssets: import('sqlfu/ui/browser').SqlfuUiAssets;
declare const project: import('sqlfu/ui/browser').CreateSqlfuUiPartialFetchInput['project'];
declare const catalog: import('sqlfu').QueryCatalog;
declare function ensureSeeded(database: Parameters<typeof createD1Client>[0]): Promise<void>;
declare function createHost(input: {
  project: typeof project;
  catalog: typeof catalog;
  openClient: () => ReturnType<typeof createD1Client>;
}): import('sqlfu').SqlfuHost;

test('D1 worker partial fetch serves real UI assets while leaving app routes available', async ({page}) => {
  await using fixture = await createPartialFetchWorkerFixture({
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === '/hello') {
        return new Response('<!doctype html><h1>Hello!</h1>', {
          headers: {'content-type': 'text/html; charset=utf-8'},
        });
      }

      await ensureSeeded(env.DB);

      const partialResponse = await createSqlfuUiPartialFetch({
        assets: uiAssets,
        project,
        host: createHost({
          project,
          catalog,
          openClient: () => createD1Client(env.DB),
        }),
      })(request);
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

  await fs.cp(path.join(sqlfuRoot, 'dist'), path.join(tempDir, 'runtime'), {recursive: true});
  await fs.copyFile(path.join(sqlfuRoot, 'package.json'), path.join(tempDir, 'package.json'));
  await writeUiAssetsModule({
    distDir: path.join(uiRoot, 'dist'),
    outPath: path.join(tempDir, 'ui-assets.generated.js'),
  });
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

async function writeUiAssetsModule(input: {distDir: string; outPath: string}) {
  const files = await listFiles(input.distDir);
  const lines = ['export const uiAssets = {'];
  for (const filePath of files) {
    const relativePath = path.relative(input.distDir, filePath).split(path.sep).join('/');
    const assetPath = `/${relativePath}`;
    const body = await assetLiteral(filePath);
    lines.push(`  ${JSON.stringify(assetPath)}: ${body},`);
  }
  lines.push('};');
  lines.push('');
  lines.push('function bytes(base64) {');
  lines.push('  const binary = atob(base64);');
  lines.push('  const out = new Uint8Array(binary.length);');
  lines.push('  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);');
  lines.push('  return out;');
  lines.push('}');
  await fs.writeFile(input.outPath, `${lines.join('\n')}\n`);
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, {withFileTypes: true});
  const files = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(dir, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    }),
  );
  return files.flat().sort();
}

async function assetLiteral(filePath: string) {
  const body = await fs.readFile(filePath);
  if (/\.(css|html|js|json|svg|txt)$/u.test(filePath)) {
    return JSON.stringify(body.toString('utf8'));
  }
  return `bytes(${JSON.stringify(body.toString('base64'))})`;
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
  fetch(request: Request): Promise<Response> | Response;
}

function createWorkerSource(fetch: PartialFetchWorkerFixtureInput['fetch']) {
  return String.raw`
import {createD1Client} from './runtime/adapters/d1.js';
import {createSqlfuUiPartialFetch} from './runtime/ui/browser.js';
import {sqlReturnsRows} from './runtime/sqlite-text.js';
import {uiAssets} from './ui-assets.generated.js';

const definitionsSql = [
  'create table people (',
  '  id integer primary key,',
  '  name text not null,',
  '  role text not null',
  ');',
].join('\n');

const catalog = {
  generatedAt: new Date(0).toISOString(),
  queries: [],
};

const project = createProject({
  projectName: 'partial-fetch-playwright',
  db: ':d1:',
  definitionsSql,
});

let env;
const userFetch = ${toCallableFunctionExpressionSource(fetch.toString())};

async function ensureSeeded(database) {
  const db = createD1Client(database);
  await db.raw([
    'create table if not exists people (',
    '  id integer primary key,',
    '  name text not null,',
    '  role text not null',
    ');',
  ].join('\n'));

  const rows = await db.all({sql: 'select count(*) as count from people', args: []});
  if (Number(rows[0]?.count || 0) === 0) {
    await db.raw([
      "insert into people (id, name, role) values (1, 'Ada Lovelace', 'Query planner');",
      "insert into people (id, name, role) values (2, 'Grace Hopper', 'Compiler whisperer');",
    ].join('\n'));
  }
}

function createProject(input) {
  const projectName = sanitizeProjectName(input.projectName);
  const projectRoot = '/' + projectName;
  return {
    initialized: true,
    projectRoot,
    config: {
      projectRoot,
      db: input.db,
      definitions: projectRoot + '/definitions.sql',
      migrations: {
        path: projectRoot + '/migrations',
        prefix: 'iso',
        preset: 'sqlfu',
      },
      queries: projectRoot + '/sql',
      generate: {
        validator: null,
        prettyErrors: true,
        sync: false,
        importExtension: '.js',
        authority: 'live_schema',
      },
    },
    definitionsSql: input.definitionsSql,
  };
}

function createHost(input) {
  const fs = createMemoryFs({
    [input.project.config.definitions]: input.project.definitionsSql,
  });

  return {
    fs,
    async openDb() {
      return {
        client: input.openClient(),
        async [Symbol.asyncDispose]() {},
      };
    },
    async openScratchDb() {
      throw new Error('partial fetch Playwright fixture does not provide scratch databases');
    },
    execAdHocSql,
    async initializeProject(projectInput) {
      await fs.writeFile(projectInput.projectRoot + '/sqlfu.config.ts', projectInput.configContents);
    },
    async digest(content) {
      return digest(content);
    },
    now: () => new Date(),
    uuid: () => globalThis.crypto.randomUUID(),
    logger: console,
    catalog: {
      async load() {
        return input.catalog;
      },
      async refresh() {},
      async analyzeSql() {
        return {};
      },
    },
  };
}

async function execAdHocSql(client, sql, params) {
  const stmt = client.prepare(sql);
  try {
    if (sqlReturnsRows(sql)) {
      return {
        mode: 'rows',
        rows: await stmt.all(params),
      };
    }
    return {
      mode: 'metadata',
      metadata: await stmt.run(params),
    };
  } finally {
    await disposeStatement(stmt);
  }
}

async function disposeStatement(stmt) {
  if (stmt[Symbol.asyncDispose]) {
    await stmt[Symbol.asyncDispose]();
    return;
  }
  stmt[Symbol.dispose]?.();
}

function createMemoryFs(initialFiles) {
  const files = new Map(Object.entries(initialFiles).map(([filePath, content]) => [normalizePath(filePath), content]));

  return {
    async readFile(filePath) {
      const normalized = normalizePath(filePath);
      if (!files.has(normalized)) {
        const error = new Error(normalized + ' not found');
        error.code = 'ENOENT';
        throw error;
      }
      return files.get(normalized);
    },
    async writeFile(filePath, contents) {
      files.set(normalizePath(filePath), contents);
    },
    async readdir(dirPath) {
      const prefix = normalizeDirectoryPath(dirPath);
      const entries = new Set();
      for (const filePath of files.keys()) {
        if (!filePath.startsWith(prefix)) {
          continue;
        }
        const [entry] = filePath.slice(prefix.length).split('/');
        if (entry) {
          entries.add(entry);
        }
      }
      return [...entries].sort();
    },
    async mkdir() {},
    async rm(filePath) {
      files.delete(normalizePath(filePath));
    },
    async rename(from, to) {
      const normalizedFrom = normalizePath(from);
      if (!files.has(normalizedFrom)) {
        const error = new Error(normalizedFrom + ' not found');
        error.code = 'ENOENT';
        throw error;
      }
      const content = files.get(normalizedFrom);
      files.delete(normalizedFrom);
      files.set(normalizePath(to), content);
    },
    async exists(filePath) {
      const normalized = normalizePath(filePath);
      if (files.has(normalized)) {
        return true;
      }
      const prefix = normalizeDirectoryPath(normalized);
      return [...files.keys()].some((candidate) => candidate.startsWith(prefix));
    },
  };
}

function normalizePath(filePath) {
  const withSlash = filePath.startsWith('/') ? filePath : '/' + filePath;
  return withSlash.replace(/\/+/g, '/');
}

function normalizeDirectoryPath(dirPath) {
  const normalized = normalizePath(dirPath);
  return normalized.endsWith('/') ? normalized : normalized + '/';
}

function sanitizeProjectName(projectName) {
  const sanitized = projectName.trim().replace(/^\/+|\/+$/g, '');
  if (!sanitized || !/^[a-z0-9-]+$/u.test(sanitized)) {
    throw new Error('Invalid sqlfu UI project name: ' + projectName);
  }
  return sanitized;
}

async function digest(content) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export default {
  fetch(request, workerEnv) {
    env = workerEnv;
    return userFetch(request);
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
