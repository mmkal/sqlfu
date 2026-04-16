import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

import {createORPCClient} from '@orpc/client';
import {RPCLink} from '@orpc/client/fetch';
import type {RouterClient} from '@orpc/server';
import {expect, test} from 'vitest';

import type {UiRouter} from '../src/ui/server.js';
import {startSqlfuServer} from '../src/ui/server.js';
import {createTempFixtureRoot, writeFixtureFiles} from './fs-fixture.js';

test('sqlfu server serves a local backend page and the ui rpc contract from packages/sqlfu', async () => {
  await using fixture = await createUiServerFixture();

  const homeResponse = await fetch(fixture.baseUrl, {
    signal: AbortSignal.timeout(5_000),
  });

  expect(homeResponse.status).toBe(200);
  expect(await homeResponse.text()).toContain('Local project server is running.');

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

test('sqlfu server can serve the packages/ui Vite client in dev mode', async () => {
  await using fixture = await createUiServerFixture({
    dev: true,
    uiRoot: path.resolve(process.cwd(), '..', 'ui'),
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

async function createUiServerFixture(input: {
  dev?: boolean;
  uiRoot?: string;
} = {}) {
  const root = await createTempFixtureRoot('ui-server');
  const dbPath = path.join(root, 'app.db');

  await writeFixtureFiles(root, {
    'sqlfu.config.ts': `
      export default {
        db: './app.db',
        migrationsDir: './migrations',
        definitionsPath: './definitions.sql',
        sqlDir: './sql',
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

  const server = await startSqlfuServer({
    port: 0,
    projectRoot: root,
    dev: input.dev,
    ui: input.uiRoot
      ? {
          root: input.uiRoot,
        }
      : undefined,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const client: RouterClient<UiRouter> = createORPCClient(new RPCLink({
    url: `${baseUrl}/api/rpc`,
  }));

  return {
    root,
    baseUrl,
    client,
    async [Symbol.asyncDispose]() {
      await server.stop();
      await fs.rm(root, {recursive: true, force: true});
    },
  };
}
