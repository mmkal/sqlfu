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

async function createUiServerFixture() {
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
