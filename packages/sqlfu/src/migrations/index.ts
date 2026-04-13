import path from 'node:path';

import type {Client} from '../core/types.js';
import {runSqlStatements} from '../core/sqlite.js';

export type Migration = {
  path: string;
  content: string;
};

export type AppliedMigration = {
  name: string;
  content: string;
};

export async function ensureMigrationTable(client: Client) {
  await client.run({
    sql: `
      create table if not exists sqlfu_migrations(
        name text primary key check(name not like '%.sql'),
        content text not null,
        applied_at text not null
      );
    `,
    args: [],
  });
}

export function migrationName(migration: {path: string}) {
  return path.basename(migration.path, '.sql');
}

export async function readMigrationHistory(client: Client): Promise<AppliedMigration[]> {
  await ensureMigrationTable(client);
  return client.all<AppliedMigration>({
    sql: `
      select name, content
      from sqlfu_migrations
      order by name
    `,
    args: [],
  });
}

export async function baselineMigrationHistory(client: Client, params: {
  migrations: readonly Migration[];
  target: string;
}) {
  const targetIndex = params.migrations.findIndex((migration) => migrationName(migration) === params.target);
  if (targetIndex === -1) {
    throw new Error(`migration ${params.target} not found`);
  }

  const applied = params.migrations.slice(0, targetIndex + 1);
  await ensureMigrationTable(client);
  await client.run({sql: 'delete from sqlfu_migrations', args: []});
  for (const migration of applied) {
    await client.run({
      sql: `
        insert into sqlfu_migrations(name, content, applied_at)
        values (?, ?, ?)
      `,
      args: [migrationName(migration), migration.content, new Date().toISOString()],
    });
  }
}

export async function applyMigrations(client: Client, params: {
  migrations: readonly Migration[];
}): Promise<void> {
  await ensureMigrationTable(client);
  const applied = await readMigrationHistory(client);
  const byName = new Map(params.migrations.map((migration) => [migrationName(migration), migration]));

  for (const historical of applied) {
    const current = byName.get(historical.name);
    if (!current) {
      throw new Error(`deleted applied migration: ${historical.name}`);
    }
    if (current.content !== historical.content) {
      throw new Error(`edited applied migration: ${historical.name}`);
    }
  }

  const appliedNames = applied.map((migration) => migration.name);
  const expectedAppliedPrefix = params.migrations
    .slice(0, applied.length)
    .map((migration) => migrationName(migration));
  if (appliedNames.some((name, index) => name !== expectedAppliedPrefix[index])) {
    throw new Error('migration history is not a prefix of migrations');
  }

  for (const migration of params.migrations) {
    const name = migrationName(migration);
    if (applied.some((row) => row.name === name)) {
      continue;
    }

    await runSqlStatements(client, migration.content);
    await client.run({
      sql: `
        insert into sqlfu_migrations(name, content, applied_at)
        values (?, ?, ?)
      `,
      args: [name, migration.content, new Date().toISOString()],
    });
  }
}
