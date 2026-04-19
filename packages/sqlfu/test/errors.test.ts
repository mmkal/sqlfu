import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

import {createClient as createRawLibsqlClient} from '@libsql/client';
import BetterSqlite3 from 'better-sqlite3';
import LibsqlDatabase, {type Database as LibsqlSyncDatabase} from 'libsql';
import {expect, test} from 'vitest';

import {
  createBetterSqlite3Client,
  createLibsqlClient,
  createLibsqlSyncClient,
  createNodeSqliteClient,
  SqlfuError,
  type AsyncClient,
  type Client,
  type SyncClient,
} from '../src/client.js';

// Integration spec: every adapter throws `SqlfuError` with a correct `kind`,
// with the original driver error preserved as `cause`, and with a call stack
// that still points at this file (not at sqlfu internals).
//
// One test per adapter × kind. Plus a single stack-quality sweep at the end
// that covers all adapters so a failure pinpoints the regressing adapter.

for (const setup of adapterSetups()) {
  test(`[${setup.label}] seleeeeect * from foo → kind 'syntax'`, async () => {
    await using fixture = await setup.create();
    await setupSchema(fixture.client);

    const error = await captureError(() => fixture.client.all({sql: 'seleeeeect * from foo', args: []}));
    expect(error).toBeInstanceOf(SqlfuError);
    expect(error).toMatchObject({
      kind: 'syntax',
      query: {sql: 'seleeeeect * from foo'},
      system: 'sqlite',
    });
    expect((error as SqlfuError).cause).toBeDefined();
    expect((error as SqlfuError).message).toContain('syntax error');
  });

  test(`[${setup.label}] select * from wrongtable → kind 'missing_relation'`, async () => {
    await using fixture = await setup.create();
    await setupSchema(fixture.client);

    const error = await captureError(() => fixture.client.all({sql: 'select * from wrongtable', args: []}));
    expect(error).toMatchObject({
      kind: 'missing_relation',
      system: 'sqlite',
    });
    expect((error as SqlfuError).message).toContain('no such table');
  });

  test(`[${setup.label}] unique constraint violation → kind 'constraint:unique'`, async () => {
    await using fixture = await setup.create();
    await setupSchema(fixture.client);
    await insert(fixture.client, 'ada@example.com');

    const error = await captureError(() => insert(fixture.client, 'ada@example.com'));
    expect(error).toMatchObject({kind: 'constraint:unique'});
    expect((error as SqlfuError).message.toLowerCase()).toContain('unique');
  });

  test(`[${setup.label}] foreign key constraint violation → kind 'constraint:foreign_key'`, async () => {
    await using fixture = await setup.create();
    await enableForeignKeys(fixture.client);
    await fixture.client.run({sql: 'create table parent (id integer primary key)', args: []});
    await fixture.client.run({
      sql: 'create table child (parent_id integer not null references parent(id))',
      args: [],
    });

    const error = await captureError(() =>
      fixture.client.run({sql: 'insert into child (parent_id) values (?)', args: [999]}),
    );
    expect(error).toMatchObject({kind: 'constraint:foreign_key'});
  });

  test(`[${setup.label}] not-null constraint violation → kind 'constraint:not_null'`, async () => {
    await using fixture = await setup.create();
    await setupSchema(fixture.client);

    // Use a literal NULL in the SQL rather than a bound `null` parameter —
    // some drivers (libsql sync) reject `null` at the parameter-binding
    // layer with a TypeError before the statement hits SQLite. The
    // constraint violation is what we're testing, not parameter binding.
    const error = await captureError(() =>
      fixture.client.run({sql: 'insert into users (email) values (NULL)', args: []}),
    );
    expect(error).toMatchObject({kind: 'constraint:not_null'});
    expect((error as SqlfuError).message).toContain('NOT NULL');
  });

  test(`[${setup.label}] preserves the call-site stack — error.stack contains this file name`, async () => {
    await using fixture = await setup.create();
    await setupSchema(fixture.client);

    const error = await captureError(() => fixture.client.all({sql: 'select * from wrongtable', args: []}));
    expect((error as SqlfuError).stack ?? '').toContain(path.basename(__filename));
  });
}

// --- fixtures ---------------------------------------------------------------

// This file is ESM; __filename-equivalent for integration assertions.
const __filename = new URL(import.meta.url).pathname;

interface AdapterFixture {
  client: Client;
  [Symbol.asyncDispose](): Promise<void>;
}

interface AdapterSetup {
  label: string;
  create: () => Promise<AdapterFixture>;
}

function adapterSetups(): AdapterSetup[] {
  return [
    {
      label: 'better-sqlite3',
      async create() {
        const db = new BetterSqlite3(':memory:');
        const client: SyncClient = createBetterSqlite3Client(db);
        return {
          client,
          async [Symbol.asyncDispose]() {
            db.close();
          },
        };
      },
    },
    {
      label: 'node:sqlite',
      async create() {
        const db = new DatabaseSync(':memory:');
        const client: SyncClient = createNodeSqliteClient(db);
        return {
          client,
          async [Symbol.asyncDispose]() {
            db.close();
          },
        };
      },
    },
    {
      label: 'libsql (sync)',
      async create() {
        const db: LibsqlSyncDatabase = new LibsqlDatabase(':memory:');
        const client: SyncClient = createLibsqlSyncClient(db);
        return {
          client,
          async [Symbol.asyncDispose]() {
            db.close();
          },
        };
      },
    },
    {
      label: '@libsql/client (async)',
      async create() {
        const dbPath = path.join(
          os.tmpdir(),
          `sqlfu-errors-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
        );
        const raw = createRawLibsqlClient({url: `file:${dbPath}`});
        const client: AsyncClient = createLibsqlClient(raw);
        return {
          client,
          async [Symbol.asyncDispose]() {
            raw.close();
            await fs.rm(dbPath, {force: true});
          },
        };
      },
    },
  ];
}

async function setupSchema(client: Client) {
  await client.run({
    sql: 'create table users (id integer primary key, email text unique not null)',
    args: [],
  });
}

async function enableForeignKeys(client: Client) {
  await client.run({sql: 'pragma foreign_keys = on', args: []});
}

async function insert(client: Client, email: string) {
  await client.run({sql: 'insert into users (email) values (?)', args: [email]});
}

async function captureError(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected fn to throw');
}
