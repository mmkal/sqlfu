import {sha256} from '../vendor/sha256.js';

import type {AsyncClient, Client, SyncClient} from '../core/types.js';
import {basename} from '../core/paths.js';
import {driveAsync, driveSync, type DualGenerator} from './dual-dispatch.js';
import {
  deleteMigrationHistory as deleteMigrationHistoryWrapper,
  ensureMigrationTable as ensureMigrationTableWrapper,
  insertMigration as insertMigrationWrapper,
  selectMigrationHistory as selectMigrationHistoryWrapper,
  type SqlfuMigrationsRow,
} from './queries/.generated/index.js';

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

// The shape of a `sqlfu_migrations` row — re-exported from the generated output so
// external callers (and the sqlfu UI) can type their migration-history consumers
// without knowing where the type comes from. If you want to change the shape, edit
// `packages/sqlfu/internal/definitions.sql` and run `pnpm run build:internal-queries`.
export type {SqlfuMigrationsRow};

function* ensureMigrationTableGen(client: Client): DualGenerator<void> {
  yield client.run({sql: ensureMigrationTableWrapper.sql, args: [], name: 'ensure-migration-table'});
}

export function migrationName(migration: {path: string}) {
  return basename(migration.path, '.sql');
}

export function readMigrationHistory(client: SyncClient): SqlfuMigrationsRow[];
export function readMigrationHistory(client: AsyncClient): Promise<SqlfuMigrationsRow[]>;
export function readMigrationHistory(client: Client): SqlfuMigrationsRow[] | Promise<SqlfuMigrationsRow[]>;
export function readMigrationHistory(client: Client): SqlfuMigrationsRow[] | Promise<SqlfuMigrationsRow[]> {
  return client.sync ? driveSync(readMigrationHistoryGen(client)) : driveAsync(readMigrationHistoryGen(client));
}

function* readMigrationHistoryGen(client: Client): DualGenerator<SqlfuMigrationsRow[]> {
  yield* ensureMigrationTableGen(client);
  return (yield client.all<SqlfuMigrationsRow>({
    sql: selectMigrationHistoryWrapper.sql,
    args: [],
    name: 'select-migration-history',
  })) as SqlfuMigrationsRow[];
}

type ApplyMigrationsParams = {
  migrations: Migration[];
};

type BaselineParams = {
  migrations: Migration[];
  target: string;
};

export function applyMigrations(client: SyncClient, params: ApplyMigrationsParams): void;
export function applyMigrations(client: AsyncClient, params: ApplyMigrationsParams): Promise<void>;
export function applyMigrations(client: Client, params: ApplyMigrationsParams): void | Promise<void>;
export function applyMigrations(client: Client, params: ApplyMigrationsParams): void | Promise<void> {
  return client.sync
    ? driveSync(applyMigrationsGen(client, params))
    : driveAsync(applyMigrationsGen(client, params));
}

export function baselineMigrationHistory(client: SyncClient, params: BaselineParams): void;
export function baselineMigrationHistory(client: AsyncClient, params: BaselineParams): Promise<void>;
export function baselineMigrationHistory(client: Client, params: BaselineParams): void | Promise<void>;
export function baselineMigrationHistory(client: Client, params: BaselineParams): void | Promise<void> {
  return client.sync
    ? driveSync(baselineMigrationHistoryGen(client, params))
    : driveAsync(baselineMigrationHistoryGen(client, params));
}

export function replaceMigrationHistory(client: SyncClient, migrations: Migration[]): void;
export function replaceMigrationHistory(client: AsyncClient, migrations: Migration[]): Promise<void>;
export function replaceMigrationHistory(client: Client, migrations: Migration[]): void | Promise<void>;
export function replaceMigrationHistory(client: Client, migrations: Migration[]): void | Promise<void> {
  return client.sync
    ? driveSync(replaceMigrationHistoryGen(client, migrations))
    : driveAsync(replaceMigrationHistoryGen(client, migrations));
}

function* applyMigrationsGen(client: Client, params: ApplyMigrationsParams): DualGenerator<void> {
  yield* ensureMigrationTableGen(client);
  const applied = yield* readMigrationHistoryGen(client);
  const byName = new Map(params.migrations.map((migration) => [migrationName(migration), migration]));

  for (const historical of applied) {
    const current = byName.get(historical.name);
    if (!current) {
      throw new Error(`deleted applied migration: ${historical.name}`);
    }
    if (digest(current.content) !== historical.checksum) {
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

    const checksum = digest(migration.content);
    const applied_at = new Date().toISOString();
    // the sync transaction method takes a sync callback and returns its value;
    // the async transaction method awaits an async callback. we route the
    // inner generator through the matching driver so the same generator body
    // services both shapes.
    yield client.transaction((tx) => {
      const innerGen = applyOneMigrationGen(tx, {content: migration.content, name, checksum, applied_at});
      return tx.sync ? (driveSync(innerGen) as unknown as Promise<void>) : driveAsync(innerGen);
    });
  }
}

function* applyOneMigrationGen(
  client: Client,
  input: {content: string; name: string; checksum: string; applied_at: string},
): DualGenerator<void> {
  yield client.raw(input.content);
  yield client.run({
    sql: insertMigrationWrapper.sql,
    args: [input.name, input.checksum, input.applied_at],
    name: 'insert-migration',
  });
}

function* baselineMigrationHistoryGen(client: Client, params: BaselineParams): DualGenerator<void> {
  const targetIndex = params.migrations.findIndex((migration) => migrationName(migration) === params.target);
  if (targetIndex === -1) {
    throw new Error(`migration ${params.target} not found`);
  }
  const appliedSlice = params.migrations.slice(0, targetIndex + 1);
  yield client.transaction((tx) => {
    const innerGen = replaceMigrationHistoryGen(tx, appliedSlice);
    return tx.sync ? (driveSync(innerGen) as unknown as Promise<void>) : driveAsync(innerGen);
  });
}

function* replaceMigrationHistoryGen(client: Client, migrations: Migration[]): DualGenerator<void> {
  yield* ensureMigrationTableGen(client);
  yield client.run({sql: deleteMigrationHistoryWrapper.sql, args: [], name: 'delete-migration-history'});
  for (const migration of migrations) {
    yield client.run({
      sql: insertMigrationWrapper.sql,
      args: [migrationName(migration), digest(migration.content), new Date().toISOString()],
      name: 'insert-migration',
    });
  }
}

function digest(content: string): string {
  // Pure-JS sha256 (vendored from @noble/hashes in src/vendor/sha256.ts).
  // Sync, portable, and avoids shimming node:crypto into Workers runtimes.
  const bytes = sha256(new TextEncoder().encode(content));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
