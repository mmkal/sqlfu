import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {createClient} from '@libsql/client';
import {expect, test} from 'vitest';

import {createLibsqlClient, instrument} from '../src/index.js';

test('async clients use async hooks with ordinary await', async () => {
  await using fixture = await createLibsqlFixture();
  await fixture.client.raw(`
    create table profiles (id integer primary key, name text not null);
    insert into profiles (id, name) values (1, 'ada'), (2, 'linus');
  `);

  const events: string[] = [];
  const client = instrument(fixture.client, async ({context, execute}) => {
    events.push(`start ${context.operation}:${context.query.name || 'sql'}`);
    try {
      const value = await execute();
      events.push(`success ${context.operation}:${context.query.name || 'sql'}`);
      return value;
    } catch (error) {
      events.push(`error ${context.operation}:${context.query.name || 'sql'}:${String((error as Error).message)}`);
      throw error;
    }
  });

  await expect(
    client.all<{id: number; name: string}>({
      sql: 'select id, name from profiles order by id',
      args: [],
      name: 'listProfiles',
    }),
  ).resolves.toMatchObject([
    {id: 1, name: 'ada'},
    {id: 2, name: 'linus'},
  ]);
  await expect(
    client.all({
      sql: 'select * from missing_table',
      args: [],
      name: 'findMissing',
    }),
  ).rejects.toThrow(/no such table/);

  expect(events).toMatchObject([
    'start all:listProfiles',
    'success all:listProfiles',
    'start all:findMissing',
    expect.stringMatching(/error all:findMissing:.*no such table: missing_table/),
  ]);
});

async function createLibsqlFixture() {
  const raw = createClient({url: getTmpDbUrl()});
  const dbPath = await getDbPath(raw);
  return {
    client: createLibsqlClient(raw),
    async [Symbol.asyncDispose]() {
      raw.close();
      await fs.rm(dbPath, {force: true});
    },
  };
}

function getTmpDbUrl() {
  const dbPath = path.join(
    os.tmpdir(),
    `sqlfu-instrument-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  );
  return `file:${dbPath}`;
}

async function getDbPath(raw: ReturnType<typeof createClient>) {
  const result = await raw.execute('pragma database_list');
  const row = result.rows[0] as {file?: string} | undefined;
  if (!row?.file) throw new Error('expected pragma database_list to return the backing file path');
  return row.file;
}
