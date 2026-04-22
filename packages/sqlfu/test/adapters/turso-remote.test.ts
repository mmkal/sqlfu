import '../helpers/load-env.js';

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {createClient as createLibsqlClientRaw} from '@libsql/client';
import {connect as connectServerless} from '@tursodatabase/serverless';
import {connect as connectSync} from '@tursodatabase/sync';
import {describe, expect, test} from 'vitest';

import {createLibsqlClient, createTursoDatabaseClient, createTursoServerlessClient} from '../../src/client.js';
import type {AsyncClient} from '../../src/client.js';

const TURSO_URL = process.env.TURSO_TEST_DB_URL;
const TURSO_TOKEN = process.env.TURSO_TEST_DB_TOKEN;

// skip the whole suite locally when there are no credentials. the maintainer / ci provides env vars.
const describeIfTurso = TURSO_URL ? describe : describe.skip;

describeIfTurso('remote turso database', () => {
  test('@libsql/client adapter works against a real Turso cloud database', async () => {
    const raw = createLibsqlClientRaw({url: TURSO_URL!, authToken: TURSO_TOKEN});
    const client = createLibsqlClient(raw);
    try {
      await exerciseRemoteClient(client, 'libsql_client');
    } finally {
      raw.close();
    }
  });

  test('@tursodatabase/serverless adapter works against a real Turso cloud database', async () => {
    const conn = connectServerless({url: TURSO_URL!, authToken: TURSO_TOKEN});
    const client = createTursoServerlessClient(conn);
    try {
      await exerciseRemoteClient(client, 'turso_serverless');
    } finally {
      await conn.close();
    }
  });

  test('@tursodatabase/sync adapter works against a real Turso cloud database', async () => {
    const localPath = path.join(os.tmpdir(), `sqlfu-turso-sync-${process.pid}-${Date.now()}.db`);
    const db = await connectSync({path: localPath, url: TURSO_URL!, authToken: TURSO_TOKEN});
    await db.connect();
    const client = createTursoDatabaseClient(db);

    const table = uniqueTableName('turso_sync');
    try {
      await client.raw(`create table ${table} (id integer primary key, email text not null)`);
      await client.run({
        sql: `insert into ${table} (email) values (?), (?)`,
        args: ['ada@example.com', 'grace@example.com'],
      });

      // push local writes to the cloud so the remote is in sync (also proves push() doesn't error).
      await db.push();

      expect(
        await client.all<{id: number; email: string}>({
          sql: `select id, email from ${table} order by id`,
          args: [],
        }),
      ).toMatchObject([
        {id: 1, email: 'ada@example.com'},
        {id: 2, email: 'grace@example.com'},
      ]);
    } finally {
      await client.raw(`drop table if exists ${table}`).catch(() => {});
      await db.push().catch(() => {});
      await db.close().catch(() => {});
      await Promise.all(
        [localPath, `${localPath}-info`, `${localPath}-wal`].map((p) => fs.rm(p, {force: true}).catch(() => {})),
      );
    }
  });
});

async function exerciseRemoteClient(client: AsyncClient, prefix: string) {
  const table = uniqueTableName(prefix);
  try {
    await client.raw(`create table ${table} (id integer primary key, email text not null)`);

    const writeResult = await client.run({
      sql: `insert into ${table} (email) values (?), (?)`,
      args: ['ada@example.com', 'grace@example.com'],
    });
    expect(writeResult.rowsAffected).toBe(2);

    expect(
      await client.all<{id: number; email: string}>({
        sql: `select id, email from ${table} order by id`,
        args: [],
      }),
    ).toMatchObject([
      {id: 1, email: 'ada@example.com'},
      {id: 2, email: 'grace@example.com'},
    ]);

    const rows: Array<{id: number; email: string}> = [];
    for await (const row of client.iterate<{id: number; email: string}>({
      sql: `select id, email from ${table} order by id`,
      args: [],
    })) {
      rows.push(row);
    }
    expect(rows).toHaveLength(2);
  } finally {
    await client.raw(`drop table if exists ${table}`).catch(() => {});
  }
}

function uniqueTableName(prefix: string) {
  return `sqlfu_test_${prefix}_${process.pid}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}
