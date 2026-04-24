// Runtime SQL builders for sqlfu's migration bookkeeping. Replaces the four
// hand-written generated wrappers in `./queries/.generated/` — those are too
// rigid once the table name, column set, and id-generation strategy vary by
// preset (sqlfu vs d1/alchemy).
//
// `'sqlfu'` preset stays byte-for-byte compatible with the previous generated
// output. `'d1'` preset emits alchemy/wrangler-compatible SQL for the
// `d1_migrations` table. Alchemy uses two different schemas depending on where
// it's running (remote D1 vs local/miniflare), so `ensureMigrationTableGen`
// detects the existing column set via `pragma table_info` and encodes the
// variant in the returned `ResolvedPresetShape` so downstream inserts/selects
// adapt.

import type {Client} from '../types.js';
import type {SqlfuMigrationPreset} from '../types.js';
import {type DualGenerator} from './dual-dispatch.js';

const SQLFU_TABLE = 'sqlfu_migrations';
const D1_TABLE = 'd1_migrations';

export type ResolvedPresetShape =
  | {kind: 'sqlfu'; table: typeof SQLFU_TABLE; hasChecksum: true}
  | {kind: 'd1'; table: typeof D1_TABLE; hasChecksum: false; variant: 'remote' | 'local'};

export function presetTableName(preset: SqlfuMigrationPreset): string {
  return preset === 'd1' ? D1_TABLE : SQLFU_TABLE;
}

export function* ensureMigrationTableGen(
  client: Client,
  preset: SqlfuMigrationPreset,
): DualGenerator<ResolvedPresetShape> {
  if (preset === 'sqlfu') {
    yield client.run({
      sql: `create table if not exists ${SQLFU_TABLE} (\n  name text primary key check (name not like '%.sql'),\n  checksum text not null,\n  applied_at text not null\n);`,
      args: [],
      name: 'ensureMigrationTable',
    });
    return {kind: 'sqlfu', table: SQLFU_TABLE, hasChecksum: true};
  }

  // preset === 'd1'
  const info = (yield client.all({
    sql: `pragma table_info(${D1_TABLE})`,
    args: [],
    name: 'pragma-d1-migrations',
  })) as Array<{name: string}>;

  if (info.length === 0) {
    // Fresh DB — create alchemy's "remote" shape. Alchemy itself creates this
    // when running against production D1.
    yield client.run({
      sql: `create table ${D1_TABLE} (\n  id text primary key,\n  name text not null,\n  applied_at text not null\n);`,
      args: [],
      name: 'create-d1-migrations-remote',
    });
    return {kind: 'd1', table: D1_TABLE, hasChecksum: false, variant: 'remote'};
  }

  // Existing table — detect which variant alchemy created.
  const hasType = info.some((row) => row.name === 'type');
  return {kind: 'd1', table: D1_TABLE, hasChecksum: false, variant: hasType ? 'local' : 'remote'};
}

export type MigrationHistoryRow = {
  name: string;
  applied_at: string;
  checksum?: string;
  id?: string;
  type?: string;
};

export function selectHistoryQuery(shape: ResolvedPresetShape) {
  if (shape.kind === 'sqlfu') {
    return {
      sql: `select name, checksum, applied_at from ${shape.table} order by name;`,
      args: [],
      name: 'selectMigrationHistory',
    };
  }
  // D1/local also stores data imports (type = 'import') in the same table;
  // filter to schema migrations so imports don't show up as sqlfu state.
  const typeFilter = shape.variant === 'local' ? ` where type = 'migration'` : '';
  return {
    sql: `select id, name, applied_at from ${shape.table}${typeFilter} order by id;`,
    args: [],
    name: 'selectMigrationHistory',
  };
}

/**
 * Alchemy stores migration filenames with the `.sql` suffix in `d1_migrations`
 * (both remote and local variants). Sqlfu's internal representation drops the
 * suffix via `migrationName()`. These helpers normalize at the read/write
 * boundary so callers can keep operating on the sqlfu-native form regardless
 * of preset.
 */
export function normalizeHistoryName(shape: ResolvedPresetShape, name: string): string {
  if (shape.kind === 'd1' && name.endsWith('.sql')) {
    return name.slice(0, -'.sql'.length);
  }
  return name;
}

export function serializeHistoryName(shape: ResolvedPresetShape, name: string): string {
  return shape.kind === 'd1' && !name.endsWith('.sql') ? `${name}.sql` : name;
}

export function deleteHistoryQuery(shape: ResolvedPresetShape) {
  return {sql: `delete from ${shape.table};`, args: [], name: 'deleteMigrationHistory'};
}

export type InsertMigrationParams = {
  name: string;
  checksum: string;
  applied_at: string;
};

export function insertMigrationQuery(shape: ResolvedPresetShape, params: InsertMigrationParams) {
  if (shape.kind === 'sqlfu') {
    return {
      sql: `insert into ${shape.table} (name, checksum, applied_at) values (?, ?, ?);`,
      args: [params.name, params.checksum, params.applied_at],
      name: 'insertMigration',
    };
  }
  const wireName = serializeHistoryName(shape, params.name);
  if (shape.variant === 'local') {
    // Local schema: id INTEGER AUTOINCREMENT, applied_at DEFAULT CURRENT_TIMESTAMP.
    // Matches alchemy's local insert shape so alchemy tooling keeps working.
    return {
      sql: `insert into ${shape.table} (name, type) values (?, ?);`,
      args: [wireName, 'migration'],
      name: 'insertMigration',
    };
  }
  // Remote schema: id is a 5-digit zero-padded string computed as max + 1.
  // Matches the convention alchemy uses (see alchemy/src/cloudflare/d1-migrations.ts).
  return {
    sql: `insert into ${shape.table} (id, name, applied_at) values (printf('%05d', (select coalesce(max(cast(id as integer)), 0) + 1 from ${shape.table})), ?, datetime('now'));`,
    args: [wireName],
    name: 'insertMigration',
  };
}
