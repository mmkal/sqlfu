import type {AsyncClient} from 'sqlfu/browser';

import type {VirtualFile} from './vfs.js';

export type Migration = {
  readonly path: string;
  readonly content: string;
};

export type AppliedMigration = {
  readonly name: string;
  readonly checksum: string;
  readonly appliedAt: string;
};

export async function migrationChecksum(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function migrationName(migration: {path: string}) {
  const base = migration.path.split('/').pop() ?? migration.path;
  return base.replace(/\.sql$/, '');
}

export function migrationsFromFiles(files: readonly VirtualFile[]): Migration[] {
  return files.map((file) => ({
    path: `migrations/${file.name}`,
    content: file.content,
  }));
}

export async function ensureMigrationTable(client: AsyncClient) {
  await client.run({
    sql: `
      create table if not exists sqlfu_migrations(
        name text primary key check(name not like '%.sql'),
        checksum text not null,
        applied_at text not null
      );
    `,
    args: [],
  });
}

export async function readMigrationHistory(client: AsyncClient): Promise<AppliedMigration[]> {
  await ensureMigrationTable(client);
  return client.all<AppliedMigration>({
    sql: `
      select name, checksum, applied_at as appliedAt
      from sqlfu_migrations
      order by name
    `,
    args: [],
  });
}

export async function replaceMigrationHistory(client: AsyncClient, migrations: readonly Migration[]) {
  await ensureMigrationTable(client);
  await client.run({sql: 'delete from sqlfu_migrations', args: []});
  for (const migration of migrations) {
    await client.run({
      sql: `insert into sqlfu_migrations(name, checksum, applied_at) values (?, ?, ?)`,
      args: [migrationName(migration), await migrationChecksum(migration.content), new Date().toISOString()],
    });
  }
}

export async function baselineMigrationHistory(client: AsyncClient, params: {
  migrations: readonly Migration[];
  target: string;
}) {
  const targetIndex = params.migrations.findIndex((migration) => migrationName(migration) === params.target);
  if (targetIndex === -1) {
    throw new Error(`migration ${params.target} not found`);
  }
  const applied = params.migrations.slice(0, targetIndex + 1);
  await client.transaction(async (tx) => {
    await replaceMigrationHistory(tx, applied);
  });
}

export async function applyMigrations(client: AsyncClient, params: {
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
    if ((await migrationChecksum(current.content)) !== historical.checksum) {
      throw new Error(`applied migration checksum mismatch: ${historical.name}`);
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

    const checksum = await migrationChecksum(migration.content);
    await client.transaction(async (tx) => {
      await tx.raw(migration.content);
      await tx.run({
        sql: `insert into sqlfu_migrations(name, checksum, applied_at) values (?, ?, ?)`,
        args: [name, checksum, new Date().toISOString()],
      });
    });
  }
}

