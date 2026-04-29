import {sha256} from '../vendor/sha256.js';

import type {AsyncClient, Client, SqlfuMigrationPreset, SyncClient} from '../types.js';
import {basename} from '../paths.js';
import {awaited, driveAsync, driveSync, type DualGenerator} from '../dual-dispatch.js';
import {
  deleteHistoryQuery,
  ensureMigrationTableGen,
  insertMigrationQuery,
  type MigrationHistoryRow,
  normalizeHistoryName,
  type ResolvedPresetShape,
  selectHistoryQuery,
} from './preset-queries.js';

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

export type {MigrationHistoryRow};
/**
 * @deprecated Use `MigrationHistoryRow`. Retained for back-compat; an alias of
 * the wider row type that covers both sqlfu and d1 preset shapes.
 */
export type SqlfuMigrationsRow = MigrationHistoryRow;

export function migrationName(migration: {path: string}) {
  return basename(migration.path, '.sql');
}

type HistoryParams = {preset?: SqlfuMigrationPreset};

export function readMigrationHistory(client: SyncClient, params?: HistoryParams): MigrationHistoryRow[];
export function readMigrationHistory(client: AsyncClient, params?: HistoryParams): Promise<MigrationHistoryRow[]>;
export function readMigrationHistory(
  client: Client,
  params?: HistoryParams,
): MigrationHistoryRow[] | Promise<MigrationHistoryRow[]>;
export function readMigrationHistory(
  client: Client,
  params: HistoryParams = {},
): MigrationHistoryRow[] | Promise<MigrationHistoryRow[]> {
  const preset = params.preset ?? 'sqlfu';
  return client.sync ? driveSync(readMigrationHistoryGen(client, preset)) : driveAsync(readMigrationHistoryGen(client, preset));
}

function* readMigrationHistoryGen(client: Client, preset: SqlfuMigrationPreset): DualGenerator<MigrationHistoryRow[]> {
  const shape = yield* ensureMigrationTableGen(client, preset);
  const rows = yield* awaited(client.all<MigrationHistoryRow>(selectHistoryQuery(shape)));
  return rows.map((row) => ({...row, name: normalizeHistoryName(shape, row.name)}));
}

type ApplyMigrationsParams = {
  migrations: Migration[];
  preset?: SqlfuMigrationPreset;
};

type BaselineParams = {
  migrations: Migration[];
  target: string;
  preset?: SqlfuMigrationPreset;
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

type ReplaceParams = {
  migrations: Migration[];
  preset?: SqlfuMigrationPreset;
};

export function replaceMigrationHistory(client: SyncClient, params: ReplaceParams): void;
export function replaceMigrationHistory(client: AsyncClient, params: ReplaceParams): Promise<void>;
export function replaceMigrationHistory(client: Client, params: ReplaceParams): void | Promise<void>;
export function replaceMigrationHistory(client: Client, params: ReplaceParams): void | Promise<void> {
  return client.sync
    ? driveSync(replaceMigrationHistoryGen(client, params))
    : driveAsync(replaceMigrationHistoryGen(client, params));
}

function* applyMigrationsGen(client: Client, params: ApplyMigrationsParams): DualGenerator<void> {
  const preset = params.preset ?? 'sqlfu';
  const shape = yield* ensureMigrationTableGen(client, preset);
  const appliedRaw = yield* awaited(client.all<MigrationHistoryRow>(selectHistoryQuery(shape)));
  const applied = appliedRaw.map((row) => ({...row, name: normalizeHistoryName(shape, row.name)}));
  const byName = new Map(params.migrations.map((migration) => [migrationName(migration), migration]));

  for (const historical of applied) {
    const current = byName.get(historical.name);
    if (!current) {
      throw new Error(`deleted applied migration: ${historical.name}`);
    }
    // Under presets without a checksum column (d1), we can't detect edits.
    // Documented downgrade — see docs/migration-model.md.
    if (shape.hasChecksum && historical.checksum && digest(current.content) !== historical.checksum) {
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
      const innerGen = applyOneMigrationGen(tx, shape, {content: migration.content, name, checksum, applied_at});
      return tx.sync ? (driveSync(innerGen) as unknown as Promise<void>) : driveAsync(innerGen);
    });
  }
}

function* applyOneMigrationGen(
  client: Client,
  shape: ResolvedPresetShape,
  input: {content: string; name: string; checksum: string; applied_at: string},
): DualGenerator<void> {
  yield client.raw(input.content);
  yield client.run(insertMigrationQuery(shape, {name: input.name, checksum: input.checksum, applied_at: input.applied_at}));
}

function* baselineMigrationHistoryGen(client: Client, params: BaselineParams): DualGenerator<void> {
  const targetIndex = params.migrations.findIndex((migration) => migrationName(migration) === params.target);
  if (targetIndex === -1) {
    throw new Error(`migration ${params.target} not found`);
  }
  const appliedSlice = params.migrations.slice(0, targetIndex + 1);
  yield client.transaction((tx) => {
    const innerGen = replaceMigrationHistoryGen(tx, {migrations: appliedSlice, preset: params.preset});
    return tx.sync ? (driveSync(innerGen) as unknown as Promise<void>) : driveAsync(innerGen);
  });
}

function* replaceMigrationHistoryGen(client: Client, params: ReplaceParams): DualGenerator<void> {
  const preset = params.preset ?? 'sqlfu';
  const shape = yield* ensureMigrationTableGen(client, preset);
  yield client.run(deleteHistoryQuery(shape));
  for (const migration of params.migrations) {
    yield client.run(
      insertMigrationQuery(shape, {
        name: migrationName(migration),
        checksum: digest(migration.content),
        applied_at: new Date().toISOString(),
      }),
    );
  }
}

function digest(content: string): string {
  // Pure-JS sha256 (vendored from @noble/hashes in src/vendor/sha256.ts).
  // Sync, portable, and avoids shimming node:crypto into Workers runtimes.
  const bytes = sha256(new TextEncoder().encode(content));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
