import type {Client} from '../core/types.js';
import type {SqlfuHost} from '../core/host.js';
import {basename} from '../core/paths.js';

export type Migration = {
  path: string;
  content: string;
};

/**
 * A migrations bundle as emitted by `sqlfu generate` into
 * `<migrations>/.generated/migrations.ts`. Keys are the project-root-relative
 * path of each migration file (e.g. `"migrations/2020-…_create_posts.sql"`);
 * values are the file contents.
 *
 * The bundle lets runtimes without filesystem access (durable objects, edge
 * workers, browsers) import migrations as a plain typescript module and apply
 * them without ever touching `fs`.
 */
export type MigrationBundle = Record<string, string>;

/**
 * Convert a `MigrationBundle` (as emitted by `sqlfu generate`) into the
 * `Migration[]` shape `applyMigrations` consumes. Migrations are returned
 * sorted by bundle key, which is the same order the CLI applies them in.
 */
export function migrationsFromBundle(bundle: MigrationBundle): Migration[] {
  return Object.entries(bundle)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => ({path, content}));
}

export type AppliedMigration = {
  name: string;
  checksum: string;
  appliedAt: string;
};

export async function ensureMigrationTable(client: Client) {
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

  const columns = await client.all<{name: string}>({
    sql: `select name from pragma_table_info('sqlfu_migrations') order by cid`,
    args: [],
  });
  const columnNames = new Set(columns.map((column) => column.name));
  if (columnNames.has('content') && !columnNames.has('checksum')) {
    await client.run({
      sql: `alter table sqlfu_migrations rename column content to checksum`,
      args: [],
    });
  }
}

export function migrationName(migration: {path: string}) {
  return basename(migration.path, '.sql');
}

export async function readMigrationHistory(client: Client): Promise<AppliedMigration[]> {
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

export async function baselineMigrationHistory(
  host: SqlfuHost,
  client: Client,
  params: {
    migrations: readonly Migration[];
    target: string;
  },
) {
  const targetIndex = params.migrations.findIndex((migration) => migrationName(migration) === params.target);
  if (targetIndex === -1) {
    throw new Error(`migration ${params.target} not found`);
  }

  const applied = params.migrations.slice(0, targetIndex + 1);
  await client.transaction(async (tx) => {
    await replaceMigrationHistory(host, tx, applied);
  });
}

export async function replaceMigrationHistory(host: SqlfuHost, client: Client, migrations: readonly Migration[]) {
  await ensureMigrationTable(client);
  await client.run({sql: 'delete from sqlfu_migrations', args: []});
  for (const migration of migrations) {
    await client.run({
      sql: `
        insert into sqlfu_migrations(name, checksum, applied_at)
        values (?, ?, ?)
      `,
      args: [migrationName(migration), await host.digest(migration.content), host.now().toISOString()],
    });
  }
}

export async function applyMigrations(
  host: SqlfuHost,
  client: Client,
  params: {
    migrations: readonly Migration[];
  },
): Promise<void> {
  await ensureMigrationTable(client);
  const applied = await readMigrationHistory(client);
  const byName = new Map(params.migrations.map((migration) => [migrationName(migration), migration]));

  for (const historical of applied) {
    const current = byName.get(historical.name);
    if (!current) {
      throw new Error(`deleted applied migration: ${historical.name}`);
    }
    if ((await host.digest(current.content)) !== historical.checksum) {
      throw new Error(`applied migration checksum mismatch: ${historical.name}`);
    }
  }

  const appliedNames = applied.map((migration) => migration.name);
  const expectedAppliedPrefix = params.migrations.slice(0, applied.length).map((migration) => migrationName(migration));
  if (appliedNames.some((name, index) => name !== expectedAppliedPrefix[index])) {
    throw new Error('migration history is not a prefix of migrations');
  }

  for (const migration of params.migrations) {
    const name = migrationName(migration);
    if (applied.some((row) => row.name === name)) {
      continue;
    }

    const checksum = await host.digest(migration.content);
    const appliedAt = host.now().toISOString();
    await client.transaction(async (tx) => {
      await tx.raw(migration.content);
      await tx.run({
        sql: `
          insert into sqlfu_migrations(name, checksum, applied_at)
          values (?, ?, ?)
        `,
        args: [name, checksum, appliedAt],
      });
    });
  }
}
