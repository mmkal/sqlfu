import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import dedent from 'dedent';
import * as esbuild from 'esbuild';
import {expect, test as baseTest} from 'vitest';

import {packageRoot} from './ensure-built.js';
import {createBrowserRpcFixture, type BrowserRpcFixture, type RenderedHost} from './browser-rpc-fixture.js';

const test = baseTest.skipIf(!process.env.SQLITE_WASM_TEST);

declare const createSqliteWasmClient: typeof import('../../src/client.js').createSqliteWasmClient;
declare const sql: typeof import('../../src/client.js').sql;

test('createSqliteWasmClient works in a real browser', {timeout: 60_000}, async () => {
  await using fixture = await createSqliteWasmWebFixture(
    class ClientDotAllTest {
      client: ReturnType<typeof createSqliteWasmClient>;

      constructor(db: any) {
        this.client = createSqliteWasmClient(db);
      }

      async testme() {
        return this.client.all(sql`select 1 as value`);
      }
    },
  );

  expect(await fixture.stub.testme()).toMatchObject([{value: 1}]);
});

test('createSqliteWasmClient can write and read rows in a real browser', {timeout: 60_000}, async () => {
  await using fixture = await createSqliteWasmWebFixture(
    class ClientPersonTest {
      client: ReturnType<typeof createSqliteWasmClient>;

      constructor(db: any) {
        this.client = createSqliteWasmClient(db);
      }

      async resetPeople() {
        await this.client.run(sql`
            drop table if exists person
          `);
        await this.client.run(sql`
            create table if not exists person (
              id integer primary key,
              name text not null
            )
          `);
        await this.client.run(sql`delete from person`);
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

  await fixture.stub.resetPeople();
  await fixture.stub.insertPerson(1, 'bob');
  await fixture.stub.insertPerson(2, 'ada');

  expect(await fixture.stub.listPeople()).toMatchObject([
    {id: 1, name: 'bob'},
    {id: 2, name: 'ada'},
  ]);
});

test('createSqliteWasmClient.raw runs multiple statements in a real browser', {timeout: 60_000}, async () => {
  await using fixture = await createSqliteWasmWebFixture(
    class ClientMultiStatementTest {
      client: ReturnType<typeof createSqliteWasmClient>;

      constructor(db: any) {
        this.client = createSqliteWasmClient(db);
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

function createSqliteWasmWebFixture<TInstance extends object>(
  classDef: new (...args: any[]) => TInstance,
): Promise<BrowserRpcFixture<TInstance>> {
  return createBrowserRpcFixture({
    classDef,
    async renderHost({root, port, classDefString, className, methodNames}): Promise<RenderedHost> {
      const require = createRequire(import.meta.url);
      const sqliteWasmPath = require.resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm');

      await fs.cp(path.join(packageRoot, 'dist'), path.join(root, 'runtime'), {recursive: true});
      await fs.copyFile(sqliteWasmPath, path.join(root, 'sqlite3.wasm'));

      await fs.writeFile(
        path.join(root, 'entry.js'),
        dedent`
          import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
          import {createSqliteWasmClient} from './runtime/adapters/sqlite-wasm.js';
          import {sql} from './runtime/core/sql.js';

          ${classDefString}

          const methodNames = ${JSON.stringify(methodNames)};
          let fixturePromise;

          function bootFixture() {
            if (!fixturePromise) {
              fixturePromise = sqlite3InitModule({
                locateFile: (fileName) => fileName === 'sqlite3.wasm' ? '/sqlite3.wasm' : fileName,
              }).then((sqlite3) => {
                const db = new sqlite3.oo1.DB(':memory:', 'c');
                return new ${className}(db);
              });
            }
            return fixturePromise;
          }

          function el(testId) {
            return document.querySelector(\`[data-testid="\${testId}"]\`);
          }

          function setText(testId, text) {
            const node = el(testId);
            if (node) node.textContent = text;
          }

          function render() {
            document.body.innerHTML = \`
              <div data-testid="boot-status">booting</div>
              <div data-testid="boot-error"></div>
              <div data-testid="rpc-request-id">0</div>
              <div data-testid="rpc-status">idle</div>
              <div data-testid="rpc-result"></div>
              <div data-testid="rpc-error"></div>
              \` + methodNames.map((method) => \`
                <div>
                  <input data-testid="rpc-input-\${method}" value="[]" />
                  <button data-testid="rpc-\${method}">\${method}</button>
                </div>
              \`).join('');

            let requestId = 0;
            for (const method of methodNames) {
              const button = el(\`rpc-\${method}\`);
              button.addEventListener('click', async () => {
                const nextRequestId = ++requestId;
                const input = el(\`rpc-input-\${method}\`);
                setText('rpc-request-id', String(nextRequestId));
                setText('rpc-status', 'running');
                setText('rpc-result', '');
                setText('rpc-error', '');
                try {
                  const parsed = JSON.parse(input.value);
                  if (!Array.isArray(parsed)) {
                    throw new Error('Method args must be a JSON array');
                  }
                  const fixture = await bootFixture();
                  const value = await fixture[method](...parsed);
                  setText('rpc-result', JSON.stringify({requestId: nextRequestId, value}));
                  setText('rpc-status', 'success');
                } catch (error) {
                  setText('rpc-error', JSON.stringify({requestId: nextRequestId, message: String(error)}));
                  setText('rpc-status', 'error');
                }
              });
            }
          }

          render();
          bootFixture().then(
            () => setText('boot-status', 'ready'),
            (error) => {
              setText('boot-status', 'error');
              setText('boot-error', String(error));
            },
          );
        ` + '\n',
      );

      await fs.writeFile(
        path.join(root, 'index.html'),
        dedent`
          <!doctype html>
          <html>
            <head><meta charset="utf-8"><title>sqlfu sqlite-wasm fixture</title></head>
            <body>
              <script type="module" src="/bundle.js"></script>
            </body>
          </html>
        ` + '\n',
      );

      await esbuild.build({
        entryPoints: [path.join(root, 'entry.js')],
        outfile: path.join(root, 'bundle.js'),
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        absWorkingDir: root,
        nodePaths: [path.join(packageRoot, 'node_modules')],
        logLevel: 'silent',
      });

      const logs: string[] = [];
      const pushLog = (line: string) => {
        logs.push(line);
        if (logs.length > 200) logs.shift();
      };

      const server = http.createServer(async (req, res) => {
        try {
          const urlPath = (req.url ?? '/').split('?')[0];
          const filePath = urlPath === '/' ? path.join(root, 'index.html') : path.join(root, urlPath);
          if (!filePath.startsWith(root)) {
            res.statusCode = 403;
            res.end('forbidden');
            return;
          }
          const data = await fs.readFile(filePath);
          res.setHeader('content-type', contentTypeFor(filePath));
          res.end(data);
        } catch (error) {
          pushLog(`[error] ${req.url}: ${String(error)}`);
          res.statusCode = 404;
          res.end('not found');
        }
      });

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });

      return {
        serverLogs: () => logs.join('\n'),
        async [Symbol.asyncDispose]() {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        },
      };
    },
    bootTimeoutMs: 30_000,
  });
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.wasm')) return 'application/wasm';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}
