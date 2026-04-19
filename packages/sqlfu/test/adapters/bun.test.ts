import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import dedent from 'dedent';
import * as devalue from 'devalue';
import {execa} from 'execa';
import {expect, test} from 'vitest';

const packageRoot = path.resolve(path.dirname(import.meta.filename), '../..');
declare const createBunClient: typeof import('../../src/client.ts').createBunClient;
type ExecaProcess = ReturnType<typeof execa>;

test('createBunClient works with a real bun:sqlite database in a bun subprocess', async () => {
  await using fixture = await createBunFixture(
    class ClientUsersTest {
      client: ReturnType<typeof createBunClient>;

      constructor(db: any) {
        this.client = createBunClient(db);
      }

      createUsersTable() {
        this.client.sql.run`create table users (id integer primary key, email text not null)`;
      }

      insertUser(email: string) {
        return this.client.sql.run`insert into users (email) values (${email})`;
      }

      findUsersByEmail(email: string) {
        return this.client.all<{id: number; email: string}>({
          sql: 'select id, email from users where email = ?',
          args: [email],
        });
      }

      listUsers() {
        return this.client.sql.all<{id: number; email: string}>`select id, email from users order by id`;
      }
    },
  );

  await fixture.stub.createUsersTable();
  await fixture.stub.insertUser('ada@example.com');
  await fixture.stub.insertUser('grace@example.com');

  expect(await fixture.stub.findUsersByEmail('ada@example.com')).toMatchObject([{id: 1, email: 'ada@example.com'}]);
  expect(await fixture.stub.listUsers()).toMatchObject([
    {id: 1, email: 'ada@example.com'},
    {id: 2, email: 'grace@example.com'},
  ]);

  const writeResult = await fixture.stub.insertUser('lin@example.com');
  expect(writeResult).toMatchObject({rowsAffected: 1});
  expect(typeof writeResult.lastInsertRowid).toMatch(/^(number|string)$/);

  expect(await fixture.stub.findUsersByEmail('lin@example.com')).toMatchObject([{id: 3, email: 'lin@example.com'}]);
});

test('createBunClient turns real sqlite syntax errors into promise rejections for tagged sql', async () => {
  await using fixture = await createBunFixture(
    class ClientSyntaxErrorTest {
      client: ReturnType<typeof createBunClient>;

      constructor(db: any) {
        this.client = createBunClient(db);
        this.client.sql.run`create table users (id integer primary key, email text not null)`;
      }

      async selectTypo() {
        return this.client.sql`selectTYPO from users`;
      }
    },
  );

  await expect(fixture.stub.selectTypo()).rejects.toMatchInlineSnapshot(`
    [Error: SQLiteError: near "selectTYPO": syntax error

    Server logs:
    (none)]
  `);
});

test('createBunClient iterates rows with native statement iteration in a bun subprocess', async () => {
  await using fixture = await createBunFixture(
    class ClientIterationTest {
      client: ReturnType<typeof createBunClient>;

      constructor(db: any) {
        this.client = createBunClient(db);
        this.client.sql.run`create table users (id integer primary key, email text not null)`;
        this.client.sql.run`insert into users (email) values (${'ada@example.com'})`;
        this.client.sql.run`insert into users (email) values (${'grace@example.com'})`;
      }

      iterateUsers() {
        return [
          ...this.client.iterate<{id: number; email: string}>({
            sql: 'select id, email from users order by id',
            args: [],
          }),
        ];
      }
    },
  );

  expect(await fixture.stub.iterateUsers()).toMatchObject([
    {id: 1, email: 'ada@example.com'},
    {id: 2, email: 'grace@example.com'},
  ]);
});

test('createBunClient.raw runs multiple statements in a bun subprocess', async () => {
  await using fixture = await createBunFixture(
    class ClientMultiStatementTest {
      client: ReturnType<typeof createBunClient>;

      constructor(db: any) {
        this.client = createBunClient(db);
      }

      seedUsers() {
        return this.client.raw(`
          create table users (id integer primary key, email text not null);
          insert into users (email) values ('ada@example.com');
          insert into users (email) values ('grace@example.com');
        `);
      }

      listUsers() {
        return this.client.sql.all<{email: string}>`select email from users order by email`;
      }
    },
  );

  await fixture.stub.seedUsers();

  expect(await fixture.stub.listUsers()).toMatchObject([{email: 'ada@example.com'}, {email: 'grace@example.com'}]);
});

async function createBunFixture<TInstance extends object>(classDef: new (...args: any[]) => TInstance) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-bun-fixture-'));
  const port = await getAvailablePort();
  const rootUrl = `http://127.0.0.1:${port}`;
  const workerPath = path.join(tempDir, 'worker.ts');
  const bunAdapterUrl = pathToFileURL(path.join(packageRoot, 'src/adapters/bun.ts')).href;
  const sqlRuntimeUrl = pathToFileURL(path.join(packageRoot, 'src/core/sql.ts')).href;

  const classDefString = classDef.toString().trim();
  const className = classDefString.match(/^class (\w+) \{/)?.[1];
  if (!className) {
    throw new Error(`Failed to extract class name from class definition: ${classDefString}`);
  }

  await fs.writeFile(
    workerPath,
    dedent`
      import {Database} from 'bun:sqlite';
      import * as devalue from 'devalue';
      import {createBunClient} from ${JSON.stringify(bunAdapterUrl)};
      import {sql} from ${JSON.stringify(sqlRuntimeUrl)};

      ${classDefString}

      const db = new Database(':memory:');
      const fixture = new ${className}(db);

      Bun.serve({
        port: Number(process.env.PORT),
        async fetch(request) {
          const url = new URL(request.url);

          if (request.method === 'GET' && url.pathname === '/__health__') {
            return new Response('ok');
          }

          if (request.method !== 'POST' || url.pathname !== '/__rpc__') {
            return new Response('not found', {status: 404});
          }

          const {method, args} = await request.json();

          try {
            const value = await fixture[method](...devalue.parse(args));
            return Response.json({ok: true, value: devalue.stringify(value)});
          } catch (error) {
            return Response.json({ok: false, error: {message: String(error)}});
          }
        },
      });

      process.on('SIGINT', () => {
        db.close();
        process.exit(0);
      });
    ` + '\n',
  );

  const server = execa('bun', ['run', workerPath], {
    cwd: tempDir,
    env: {PORT: String(port)},
    all: true,
    reject: false,
  });
  const serverLogs = captureOutput(server);

  try {
    await waitForHttp(`${rootUrl}/__health__`, 15_000);

    return {
      stub: createRpcStub<TInstance>(rootUrl, serverLogs),
      async [Symbol.asyncDispose]() {
        await Promise.allSettled([stopProcess(server), fs.rm(tempDir, {recursive: true, force: true})]);
      },
    };
  } catch (error) {
    await Promise.allSettled([stopProcess(server), fs.rm(tempDir, {recursive: true, force: true})]);
    throw new Error(formatFixtureFailure(error instanceof Error ? error.message : String(error), serverLogs()));
  }
}

function createRpcStub<TInstance extends object>(rootUrl: string, serverLogs: () => string) {
  return new Proxy({} as {[K in keyof TInstance]: PromisifyReturnType<TInstance[K]>}, {
    get(_target, propertyKey) {
      if (typeof propertyKey !== 'string') {
        return undefined;
      }

      return async (...args: readonly unknown[]) => {
        try {
          const response = await fetch(`${rootUrl}/__rpc__`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({method: propertyKey, args: devalue.stringify(args)}),
          });
          const payload = (await response.json()) as {ok: true; value: string} | {ok: false; error: {message: string}};

          if (!response.ok || !payload.ok) {
            throw new Error(payload.ok ? `RPC failed with status ${response.status}` : payload.error.message);
          }

          return devalue.parse(payload.value);
        } catch (error) {
          throw new Error(formatFixtureFailure(error instanceof Error ? error.message : String(error), serverLogs()));
        }
      };
    },
  });
}

type PromisifyReturnType<T> = T extends (...args: infer A) => infer R
  ? (...args: A) => R extends Promise<any> ? R : Promise<R>
  : T;

async function getAvailablePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error(`Failed to allocate a local port: ${String(address)}`));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
    server.on('error', reject);
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {}

    await delay(100);
  }

  throw new Error(`Timed out waiting for Bun fixture to respond at ${url}`);
}

function captureOutput(child: ExecaProcess) {
  const chunks: string[] = [];
  child.all?.on('data', (chunk: string | Buffer) => {
    chunks.push(String(chunk));
    if (chunks.length > 200) {
      chunks.shift();
    }
  });

  return () => chunks.join('');
}

function formatFixtureFailure(message: string, serverLogs: string): string {
  return [message, '', 'Server logs:', serverLogs.trim() || '(none)'].join('\n');
}

async function stopProcess(child: ExecaProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  child.kill('SIGINT');
  const exited = await Promise.race([
    child.then(
      () => true,
      () => true,
    ),
    delay(5_000).then(() => false),
  ]);

  if (!exited && child.exitCode === null && !child.killed) {
    child.kill('SIGKILL');
    await child.catch(() => undefined);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
