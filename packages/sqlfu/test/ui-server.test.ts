import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

import {createORPCClient} from '@orpc/client';
import {RPCLink} from '@orpc/client/fetch';
import type {RouterClient} from '@orpc/server';
import {execa, execaNode} from 'execa';
import {expect, test} from 'vitest';

import type {UiRouter} from '../src/ui/server.js';
import {startSqlfuServer} from '../src/ui/server.js';
import {createDefaultInitPreview} from '../src/config.js';
import {ensureBuilt, packageRoot} from './adapters/ensure-built.js';
import {createTempFixtureRoot, dumpFixtureFs, writeFixtureFiles} from './fs-fixture.js';

test('sqlfu server serves a local backend page and the ui rpc contract from packages/sqlfu', async () => {
  await using fixture = await createUiServerFixture();

  const homeResponse = await fetch(fixture.baseUrl, {
    signal: AbortSignal.timeout(5_000),
  });

  expect(homeResponse.status).toBe(200);
  expect(await homeResponse.text()).toContain('Local project server is running.');

  const status = await fixture.client.project.status();
  expect(status).toMatchObject({
    initialized: true,
    projectRoot: fixture.root,
    serverVersion: expect.stringMatching(/^\d+\.\d+\.\d+(-\S+)?$/u) as unknown as string,
  });

  const schema = await fixture.client.schema.get();
  expect(schema).toMatchObject({
    projectName: path.basename(fixture.root),
    relations: [
      {
        name: 'posts',
        kind: 'table',
      },
    ],
  });

  const rows = await fixture.client.table.list({
    relationName: 'posts',
    page: 0,
  });
  expect(rows).toMatchObject({
    relation: 'posts',
    editable: true,
    rows: [
      {
        slug: 'hello-world',
        title: 'Hello World',
      },
    ],
  });
});

test('sqlfu server serves serialized @sqlfu/ui assets when passed ui.assets', async () => {
  await using fixture = await createUiServerFixture({
    uiAssets: {
      '/index.html': '<!doctype html><html><body><div id="app">serialized-ui-ok</div></body></html>',
      '/assets/app.js': '/* serialized */ globalThis.__sqlfuSerializedUiLoaded__ = true;',
    },
  });

  const homeResponse = await fetch(fixture.baseUrl, {signal: AbortSignal.timeout(5_000)});
  expect(homeResponse.status).toBe(200);
  expect(await homeResponse.text()).toContain('serialized-ui-ok');

  const assetResponse = await fetch(`${fixture.baseUrl}/assets/app.js`, {signal: AbortSignal.timeout(5_000)});
  expect(assetResponse.status).toBe(200);
  expect(assetResponse.headers.get('content-type')).toMatch(/text\/javascript/u);
  expect(await assetResponse.text()).toContain('__sqlfuSerializedUiLoaded__');

  expect(await fixture.client.project.status()).toMatchObject({
    initialized: true,
    projectRoot: fixture.root,
  });
});

test('sqlfu server can serve the packages/ui Vite client in dev mode', async () => {
  await using fixture = await createUiServerFixture({
    dev: true,
  });

  const homeResponse = await fetch(fixture.baseUrl, {
    signal: AbortSignal.timeout(15_000),
  });

  expect(homeResponse.status).toBe(200);
  expect(await homeResponse.text()).toMatch(/@vite\/client|\/src\/client\.tsx/u);

  expect(await fixture.client.schema.get()).toMatchObject({
    projectName: path.basename(fixture.root),
    relations: [
      {
        name: 'posts',
        kind: 'table',
      },
    ],
  });
});

test('sql.analyze resolves sqlite_schema columns without reporting "no such column"', async () => {
  await using fixture = await createUiServerFixture();

  const analysis = await fixture.client.sql.analyze({
    sql: `select name, type
from sqlite_schema
where name not like 'sqlite_%'
order by type, name;`,
  });

  expect(analysis).toMatchObject({diagnostics: []});
});

test('sql.run executes ad-hoc statements through the ui router', async () => {
  await using fixture = await createUiServerFixture();

  expect(
    await fixture.client.sql.run({
      sql: 'select id, slug from posts where slug = :slug',
      params: {slug: 'hello-world'},
    }),
  ).toMatchObject({
    mode: 'rows',
    rows: [{id: 1, slug: 'hello-world'}],
  });

  expect(
    await fixture.client.sql.run({
      sql: `select 'a:b' as literal, :real as param`,
      params: {real: 42},
    }),
  ).toMatchObject({
    mode: 'rows',
    rows: [{literal: 'a:b', param: 42}],
  });

  expect(
    await fixture.client.sql.run({
      sql: 'insert into posts (slug, title) values (:slug, :title)',
      params: {slug: 'second-post', title: 'Second Post'},
    }),
  ).toMatchObject({
    mode: 'metadata',
    metadata: {rowsAffected: 1, lastInsertRowid: 2},
  });
});

test('sqlfu server can serve the packages/ui Vite client in dev mode for ngrok-style hosts when opted in', async () => {
  await using fixture = await createUiServerFixture({
    dev: true,
    allowUnknownHosts: true,
  });

  const homeResponse = await requestWithHost({
    url: fixture.baseUrl,
    host: 'sqlfu-local.ngrok.app',
  });

  expect(homeResponse).toMatchObject({
    status: 200,
  });
  expect(homeResponse.body).toMatch(/@vite\/client|\/src\/client\.tsx/u);
});

test('sqlfu server accepts secure cross-origin preflight for rpc requests', async () => {
  await using fixture = await createUiServerFixture();

  const response = await fetch(`${fixture.baseUrl}/api/rpc/schema/get`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://sqlfu-local.ngrok.app',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,x-sqlfu-project',
      'access-control-request-private-network': 'true',
    },
    signal: AbortSignal.timeout(5_000),
  });

  expect(response.status).toBe(204);
  expect(Object.fromEntries(response.headers.entries())).toMatchObject({
    'access-control-allow-origin': 'https://sqlfu-local.ngrok.app',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-private-network': 'true',
  });
  expect(response.headers.get('access-control-allow-headers')).toContain('content-type');
});

test('sqlfu server reports a useful error when the requested port is already in use', async () => {
  await using fixture = await createUiServerFixture();
  const port = await getAvailablePort();
  await using blocker = await createInProcessPortBlocker(port);

  await expect(
    startSqlfuServer({
      port,
      projectRoot: fixture.root,
    }),
  ).rejects.toThrow(`Port ${port} is already in use.`);
});

test('sqlfu server uses an explicit config path instead of rediscovering the default config', async () => {
  const root = await createTempFixtureRoot('ui-server-config-path');
  await writeFixtureFiles(root, {
    'sqlfu.config.ts': `
      export default {
        db: './default.db',
        definitions: './default-definitions.sql',
        queries: './default-sql',
      };
    `,
    'sqlfu.config.prod.ts': `
      export default {
        db: './prod.db',
        definitions: './prod-definitions.sql',
        queries: './prod-sql',
      };
    `,
    'default-definitions.sql': 'create table default_posts(id integer primary key);',
    'prod-definitions.sql': 'create table prod_posts(id integer primary key);',
    'default-sql/.gitkeep': '',
    'prod-sql/.gitkeep': '',
  });

  const defaultDatabase = new DatabaseSync(path.join(root, 'default.db'));
  const prodDatabase = new DatabaseSync(path.join(root, 'prod.db'));
  try {
    defaultDatabase.exec('create table default_posts(id integer primary key);');
    prodDatabase.exec('create table prod_posts(id integer primary key);');
  } finally {
    defaultDatabase.close();
    prodDatabase.close();
  }

  await using fixture = await createUiServerFixture({
    projectRoot: root,
    configPath: path.join(root, 'sqlfu.config.prod.ts'),
  });

  const schema = await fixture.client.schema.get();
  expect(schema.relations.map((relation) => relation.name)).toEqual(['prod_posts']);
});

test('sqlfu server can initialize a fresh directory through the ui rpc', async () => {
  const root = await createTempFixtureRoot('ui-server-init');
  await using fixture = await createUiServerFixture({projectRoot: root});

  expect(await fixture.client.project.status()).toMatchObject({
    initialized: false,
    projectRoot: root,
  });

  const initEvents = await fixture.client.schema.command({command: 'sqlfu init'});
  for await (const event of initEvents) {
    if (event.kind === 'needsConfirmation') {
      await fixture.client.schema.submitConfirmation({
        id: event.id,
        body: createDefaultInitPreview(root).configContents,
      });
    }
  }

  expect(await fixture.client.project.status()).toMatchObject({
    initialized: true,
    projectRoot: root,
  });
  const check = await fixture.client.schema.check();
  expect(check.recommendations).toMatchObject([]);
  expect(check.cards.every((card) => card.ok)).toBe(true);
  expect(await dumpFixtureFs(root)).toContain('sqlfu.config.ts');
  expect(await dumpFixtureFs(root)).toContain('definitions.sql');
  expect(await dumpFixtureFs(root)).toContain('migrations/');
  expect(await dumpFixtureFs(root)).toContain('sql/');
});

test('sqlfu kill stops the process listening on the requested port', async () => {
  await ensureBuilt();
  await using fixture = await createUiServerFixture();
  const port = await getAvailablePort();
  await using blocker = await createChildPortBlocker(port);

  const cli = await execa('node', [path.join(packageRoot, 'dist', 'cli.js'), 'kill', '--port', String(port)], {
    cwd: fixture.root,
  });

  expect(cli.stdout).toContain(`Stopped process on port ${port}`);
  await expect(waitForExit(blocker.process, 5_000)).resolves.toBeUndefined();
});

async function createUiServerFixture(
  input: {
    dev?: boolean;
    uiAssets?: Record<string, string>;
    allowUnknownHosts?: boolean;
    projectRoot?: string;
    configPath?: string;
  } = {},
) {
  const root = input.projectRoot ?? (await createTempFixtureRoot('ui-server'));
  const dbPath = path.join(root, 'app.db');

  if (!input.projectRoot) {
    await writeFixtureFiles(root, {
      'sqlfu.config.ts': `
        export default {
          db: './app.db',
          migrations: './migrations',
          definitions: './definitions.sql',
          queries: './sql',
        };
      `,
      'definitions.sql': `
        create table posts (
          id integer primary key,
          slug text not null,
          title text not null
        );
      `,
      'sql/.gitkeep': '',
      'migrations/.gitkeep': '',
    });

    const database = new DatabaseSync(dbPath);
    try {
      database.exec(`
        create table posts (
          id integer primary key,
          slug text not null,
          title text not null
        );

        insert into posts (slug, title) values ('hello-world', 'Hello World');
      `);
    } finally {
      database.close();
    }
  }

  const serverInput: Parameters<typeof startSqlfuServer>[0] = {
    port: 0,
    allowUnknownHosts: input.allowUnknownHosts || false,
    dev: input.dev,
    ui: input.uiAssets
      ? {
          assets: input.uiAssets,
        }
      : undefined,
    uiDev: input.dev
      ? {
          root: path.resolve(process.cwd(), '..', 'ui'),
        }
      : undefined,
  };
  if (input.configPath) {
    serverInput.configPath = input.configPath;
  } else {
    serverInput.projectRoot = root;
  }

  const server = await startSqlfuServer(serverInput);
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const client: RouterClient<UiRouter> = createORPCClient(
    new RPCLink({
      url: `${baseUrl}/api/rpc`,
    }),
  );

  return {
    root,
    port: server.port,
    baseUrl,
    client,
    async [Symbol.asyncDispose]() {
      await server.stop();
      await fs.rm(root, {recursive: true, force: true});
    },
  };
}

function requestWithHost(input: {url: string; host: string}) {
  return new Promise<{status: number; body: string}>((resolve, reject) => {
    const url = new URL(input.url);
    const request = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname,
        method: 'GET',
        headers: {
          host: input.host,
        },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve({
            status: response.statusCode || 0,
            body,
          });
        });
      },
    );

    request.once('error', reject);
    request.end();
  });
}

async function createChildPortBlocker(port: number) {
  const process = execaNode(path.join(import.meta.dirname, 'helpers', 'listen-forever.js'), [String(port)], {
    cwd: packageRoot,
  });
  void process.catch(() => undefined);

  await waitForPort(port, 5_000);

  return {
    process,
    async [Symbol.asyncDispose]() {
      process.kill('SIGTERM');
      await waitForExit(process, 5_000).catch(() => undefined);
    },
  };
}

async function createInProcessPortBlocker(port: number) {
  const server = http.createServer((_, response) => {
    response.writeHead(200, {'content-type': 'text/plain'});
    response.end('ok');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      resolve();
    });
  });

  return {
    async [Symbol.asyncDispose]() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function getAvailablePort() {
  const server = net.createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to determine an available port'));
        return;
      }
      resolve(address.port);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return port;
}

async function waitForPort(port: number, timeoutMs: number) {
  const timeoutAt = Date.now() + timeoutMs;
  while (Date.now() < timeoutAt) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`, {
        signal: AbortSignal.timeout(500),
      });
      await response.arrayBuffer();
      return;
    } catch {}

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  throw new Error(`Timed out waiting for port ${port}`);
}

async function waitForExit(child: PromiseLike<unknown>, timeoutMs: number) {
  await Promise.race([
    Promise.resolve(child).then(() => undefined),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timed out waiting for child process to exit after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}
