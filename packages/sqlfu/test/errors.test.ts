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
} from '../src/index.js';

// Every adapter throws `SqlfuError` on driver errors, with:
//   - the correct `kind` discriminator
//   - the untouched driver error preserved as `cause`
//   - a stack that still points at this file (not clobbered by the wrapper)
//
// The test matrix is adapter × kind, plus one stack-quality check per adapter.
// If a single adapter regresses, the failing test names it directly.

for (const setup of adapterSetups()) {
  test(`[${setup.label}] syntax error → kind 'syntax'`, async () => {
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

  test(`[${setup.label}] unknown table → kind 'missing_table'`, async () => {
    await using fixture = await setup.create();
    await setupSchema(fixture.client);

    const error = await captureError(() => fixture.client.all({sql: 'select * from wrongtable', args: []}));
    expect(error).toMatchObject({kind: 'missing_table', system: 'sqlite'});
    expect((error as SqlfuError).message).toContain('no such table');
  });

  test(`[${setup.label}] unique violation → kind 'unique_violation'`, async () => {
    await using fixture = await setup.create();
    await setupSchema(fixture.client);
    await insertUser(fixture.client, 'ada@example.com');

    const error = await captureError(() => insertUser(fixture.client, 'ada@example.com'));
    expect(error).toMatchObject({kind: 'unique_violation'});
    expect((error as SqlfuError).message.toLowerCase()).toContain('unique');
  });

  test(`[${setup.label}] foreign-key violation → kind 'foreign_key_violation'`, async () => {
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
    expect(error).toMatchObject({kind: 'foreign_key_violation'});
  });

  test(`[${setup.label}] not-null violation → kind 'not_null_violation'`, async () => {
    await using fixture = await setup.create();
    await setupSchema(fixture.client);

    // Use a literal NULL rather than a bound `null` parameter — some drivers
    // (libsql sync) reject `null` at the parameter-binding layer with a
    // TypeError before SQLite sees it. The constraint violation is what
    // we're testing, not parameter binding.
    const error = await captureError(() =>
      fixture.client.run({sql: 'insert into users (email) values (NULL)', args: []}),
    );
    expect(error).toMatchObject({kind: 'not_null_violation'});
  });

  test(`[${setup.label}] preserves driver error on .cause`, async () => {
    await using fixture = await setup.create();
    await setupSchema(fixture.client);

    const error = await captureError(() => fixture.client.all({sql: 'select * from wrongtable', args: []}));
    expect(error).toBeInstanceOf(SqlfuError);
    expect((error as SqlfuError).cause).toBeInstanceOf(Error);
    // driver-specific cause not touched — user can still inspect raw code/props
    expect((error as SqlfuError).cause).not.toBe(error);
  });

  test(`[${setup.label}] preserves the call-site stack`, async () => {
    await using fixture = await setup.create();
    await setupSchema(fixture.client);

    const error = await captureError(() => fixture.client.all({sql: 'select * from wrongtable', args: []}));
    // The stack should still mention this file — if the wrapper
    // constructed its own stack, the user's frame would be gone.
    expect((error as SqlfuError).stack ?? '').toContain(path.basename(testFilename));
  });
}

// --- fixtures ---------------------------------------------------------------

const testFilename = new URL(import.meta.url).pathname;

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

async function insertUser(client: Client, email: string) {
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
