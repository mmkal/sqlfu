/*
 * Dialect interface — the seam between the main `sqlfu` package's
 * dialect-neutral logic (CLI flow, schema diff orchestration, migration
 * runner, formatter, typegen) and dialect-specific implementations.
 *
 * `sqliteDialect()` is a factory matching the shape `pgDialect({...})` will
 * use for per-project config. It currently takes no parameters; it's a
 * factory rather than a const so users learn the API once and don't have to
 * remember which dialects need calling and which don't.
 *
 * **Wart: side-effect registration of sqlite typegen impls.** The strict-tier
 * import check (`scripts/check-strict-imports.ts`) bundles the runtime graph
 * of `dist/index.js` and forbids `node:*` imports — including those reached
 * via *dynamic* imports (the check follows them). The sqlite typegen helpers
 * (`materializeTypegenDatabase`, `loadSchema`) live on a node:* code path, so
 * dialect.ts cannot import them statically *or* dynamically without breaking
 * strict tier.
 *
 * Workaround: dialect.ts ships throwing stubs for the three typegen methods.
 * `typegen/index.ts` calls `registerSqliteTypegenImpls(...)` at module-load
 * to install real implementations. Every heavy entry (CLI, api, ui server)
 * imports `typegen/index.ts` somewhere in its graph, so the stubs only ever
 * fire if a strict-tier consumer somehow tries to invoke typegen — which is
 * a bug regardless. The error message points at the right next step.
 *
 * Cleaner alternatives we considered:
 *   1. Move `sqliteDialect` itself to a heavy entry. Breaks `defineConfig`
 *      defaulting in the strict-tier `config.ts` (which needs to reference
 *      the value, not just the type).
 *   2. Make typegen methods optional (`typegen?: {...}`). Forces every
 *      caller to nullish-check, hurts the dialect's "uniform contract" UX.
 *   3. Strict check that *doesn't* follow dynamic imports. Loosens an
 *      existing guarantee for a single feature.
 *
 * The side-effect registration was the smallest hammer.
 */
import {formatSql, type FormatSqlOptions} from './formatter.js';
import type {SqlfuHost} from './host.js';
import {diffBaselineSqlToDesiredSql} from './schemadiff/sqlite/index.js';
import {quoteIdentifier as sqliteQuoteIdentifier} from './schemadiff/sqlite/identifiers.js';
import {excludeReservedSqliteObjects, extractSchema as extractSqliteSchema} from './sqlite-text.js';
import type {AsyncClient, Client, SqlfuProjectConfig} from './types.js';
import type {VendoredQueryAnalysis, VendoredQueryInput} from './typegen/analyze-vendored-typesql.js';

export type DiffSchemaInput = {
  baselineSql: string;
  desiredSql: string;
  allowDestructive: boolean;
};

/**
 * Dialect-neutral input for query analysis. Re-exports the existing
 * vendored-typesql input shape — `{sqlPath, sqlContent}` is portable.
 */
export type QueryAnalysisInput = VendoredQueryInput;

/**
 * Dialect-neutral output for query analysis (column types, parameter shapes,
 * query kind). Both the sqlite path (typesql) and the pg path (pgkit-derived)
 * produce values of this shape; downstream rendering is dialect-agnostic.
 */
export type QueryAnalysis = VendoredQueryAnalysis;

/**
 * Per-column type info as consumed by the typegen rendering pipeline. Both
 * dialects produce values of this shape.
 */
export type DialectColumnInfo = {
  name: string;
  tsType: string;
  notNull: boolean;
  /**
   * Optional higher-level shape hint that overrides `tsType` for
   * encoding/decoding purposes (e.g. sqlite columns declared as `json` are
   * stringified before write and parsed after read). Dialect-neutral —
   * sqlite recognises declared-type=`json`; pg can map `json`/`jsonb`.
   */
  logicalType?: LogicalType;
  /**
   * When true, `tsType` is already a plain TypeScript type expression from
   * schema metadata and should not be string-literal escaped when embedded in
   * generated output.
   */
  plainTsType?: boolean;
};

/**
 * Higher-level column shape hints recognized across dialects. Add new
 * values here when a new logical encoding becomes a first-class concept.
 */
export type LogicalType = 'json';

/**
 * Per-relation type info — table or view, with a column map and the original
 * `CREATE` SQL (used by view-shape inference for sqlite). Dialect-neutral
 * data, sqlite & pg both produce.
 */
export type RelationInfo = {
  kind: 'table' | 'view';
  name: string;
  columns: ReadonlyMap<string, DialectColumnInfo>;
  sql?: string;
};

export type DialectForeignKey = {
  columns: string[];
  referencedRelation: string;
  referencedColumns: string[];
};

/**
 * Opaque handle representing a materialized schema ready for typegen lookups +
 * analysis. Each dialect knows its own concrete shape; the value MUST only be
 * passed back to methods on the same dialect that produced it. Values are
 * `AsyncDisposable` so callers use `await using` to release dialect-owned
 * resources (pg temp schemas, transient sqlite files, open connections, etc.).
 */
export interface MaterializedTypegenSchema extends AsyncDisposable {
  /** Identifies the producing dialect. Used as a runtime sanity check. */
  dialect: string;
}

export type Dialect = {
  /** Stable identifier; e.g. `'sqlite'`, `'postgresql'`. */
  name: string;

  /**
   * Compute the ordered list of statements that takes a database from the
   * `baselineSql` shape to the `desiredSql` shape. SQL strings in, SQL
   * strings out — the dialect's internal representation of a schema does not
   * cross this boundary.
   */
  diffSchema(host: SqlfuHost, input: DiffSchemaInput): Promise<string[]>;

  /** Pretty-print a single SQL string in the dialect's native style. */
  formatSql(sql: string, options?: FormatSqlOptions): string;

  /** Quote an identifier (table/column/index name) per the dialect's rules. */
  quoteIdentifier(name: string): string;

  /**
   * The migration-bookkeeping table DDL for the default `'sqlfu'` migrations
   * preset. Dialect-locked presets (e.g. `'d1'`) bypass this and provide their
   * own DDL inline; we don't try to make those portable.
   */
  defaultMigrationTableDdl(tableName: string): string;

  /**
   * Optional: wrap migration application in a dialect-native lock. SQLite is
   * single-writer at the file level so the default `sqliteDialect` omits this;
   * postgres uses `pg_advisory_xact_lock`.
   */
  withMigrationLock?<T>(client: AsyncClient, fn: () => Promise<T>): Promise<T>;

  /**
   * Apply `sourceSql` (a single DDL string — could be definitions.sql, could
   * be concatenated migrations) to a scratch database, then extract and
   * return the resulting schema as a canonical SQL string. Disposes the
   * scratch database before returning.
   *
   * Sqlite materializes against `host.openScratchDb` (in-memory sqlite); pg
   * uses its own connection (closed-over from the dialect's factory config)
   * to `CREATE DATABASE sqlfu_<random>` and drop on completion.
   */
  materializeSchemaSql(host: SqlfuHost, input: {sourceSql: string; excludedTables?: string[]}): Promise<string>;

  /**
   * Extract the canonical schema from a live client. Used by the
   * `live_schema` typegen authority and by drift checks against the user's
   * actual database. Sqlite reads from `sqlite_schema` (the `'main'` db);
   * pg reads from `pg_catalog` (the default `public` schema and any others
   * the dialect's options say to include).
   *
   * Accepts either a `SyncClient` or `AsyncClient` so callers can pass any
   * `client` regardless of driver shape; pg-flavored impls coerce to async
   * (and error on a sync client, since no pg driver is sync today).
   */
  extractSchemaFromClient(client: Client, options?: {excludedTables?: string[]}): Promise<string>;

  /**
   * List relations (tables + views) on a live client. Used by the studio's
   * schema browser. Returns one entry per user-visible relation:
   *   - `name` — relation identifier as it appears to SQL
   *   - `kind` — 'table' or 'view'
   *   - `sql` — definition string when available (sqlite returns the
   *     `CREATE TABLE …` / `CREATE VIEW …` text from `sqlite_schema`;
   *     pg returns `pg_get_viewdef(...)` for views, `undefined` for tables
   *     since reconstructing CREATE TABLE syntactically requires more
   *     than `pg_get_viewdef`)
   *
   * System tables (sqlite's reserved objects, postgres catalogs in
   * non-public schemas) are filtered out.
   */
  listLiveRelations(client: Client): Promise<Array<{name: string; kind: 'table' | 'view'; sql?: string}>>;

  /**
   * Look up one relation by name, same shape as one entry of
   * `listLiveRelations`. Throws if no relation exists with that name.
   * Distinct from `listLiveRelations` so callers don't have to filter
   * a possibly-large list to find one entry.
   */
  getRelationInfo(client: Client, relationName: string): Promise<{name: string; kind: 'table' | 'view'; sql?: string}>;

  /**
   * Per-relation column metadata for the studio's row editor and schema
   * browser. Returns the columns in declaration order with:
   *   - `name`, `type` — as the dialect reports them
   *   - `notNull` — true when the column has a NOT NULL constraint
   *   - `primaryKey` — true when the column is part of the primary key
   *
   * Sqlite's `PRAGMA table_xinfo` exposes hidden columns (e.g.
   * `__sqlfu_rowid__`); those are filtered out before returning. Pg
   * filters dropped/system attributes the same way.
   */
  getRelationColumns(
    client: Client,
    relationName: string,
  ): Promise<Array<{name: string; type: string; notNull: boolean; primaryKey: boolean}>>;

  /**
   * Foreign keys declared by one relation. Used by the studio to build
   * forward and reverse row-navigation affordances. Views normally return
   * an empty list.
   */
  getRelationForeignKeys(client: Client, relationName: string): Promise<DialectForeignKey[]>;

  /**
   * Apply pre-read schema source SQL to a fresh dialect-specific scratch
   * database, returning a handle ready for typegen lookups + query
   * analysis. The caller (typegen entry point) reads the schema source —
   * via `readSchemaForAuthority` — *before* this call, so the dialect
   * doesn't need to know which authority is in play.
   *
   * Sqlite's materialized form is a temp `.sqlite` file at
   * `<projectRoot>/.sqlfu/typegen.db`; pg's is an ephemeral
   * `CREATE DATABASE`'d database. Both are disposed via
   * `Symbol.asyncDispose` on the returned handle.
   */
  materializeTypegenSchema(
    host: SqlfuHost,
    input: {projectRoot: string; sourceSql: string; experimentalJsonTypes: boolean},
  ): Promise<MaterializedTypegenSchema>;

  /** Extract relation (table/view) shapes from the materialized schema. */
  loadSchemaForTypegen(materialized: MaterializedTypegenSchema): Promise<ReadonlyMap<string, RelationInfo>>;

  /**
   * Analyze a batch of queries against the materialized schema, producing
   * column/parameter type info for each one.
   */
  analyzeQueries(materialized: MaterializedTypegenSchema, queries: QueryAnalysisInput[]): Promise<QueryAnalysis[]>;
};

const sqliteSqlfuMigrationTableDdl = (tableName: string) =>
  `create table if not exists ${tableName} (\n  name text primary key check (name not like '%.sql'),\n  checksum text not null,\n  applied_at text not null\n);`;

/** Real implementations registered by `typegen/index.ts` at module-load. */
type SqliteTypegenImpls = {
  materializeTypegenSchema: Dialect['materializeTypegenSchema'];
  loadSchemaForTypegen: Dialect['loadSchemaForTypegen'];
  analyzeQueries: Dialect['analyzeQueries'];
};

let sqliteTypegenImpls: SqliteTypegenImpls | null = null;

/**
 * Called by `typegen/index.ts` at module-load to install the heavy-tier
 * typegen impls onto sqlite-dialect instances. After this runs, calls to
 * `sqliteDialect()` return objects with real typegen methods. Before it
 * runs (strict-tier paths), the typegen methods on a freshly-constructed
 * dialect are throwing stubs.
 */
export function registerSqliteTypegenImpls(impls: SqliteTypegenImpls): void {
  sqliteTypegenImpls = impls;
}

function typegenStub(methodName: string): never {
  throw new Error(
    `sqliteDialect.${methodName} requires loading sqlfu's typegen module — ` +
      `it is registered via a side-effect import in 'sqlfu/typegen' (and pulled in transitively by 'sqlfu/api', 'sqlfu/cli', 'sqlfu/ui'). ` +
      `If you're hitting this from a strict-tier path (browser/edge), you shouldn't be calling typegen methods at runtime.`,
  );
}

/**
 * Build a fresh sqlite `Dialect`. Currently takes no parameters — exists as a
 * factory for API parity with `pgDialect({...})` (see `@sqlfu/pg`), so users
 * can write `defineConfig({dialect: sqliteDialect()})` or `pgDialect({...})`
 * without remembering which is a value and which is a constructor.
 */
export function sqliteDialect(): Dialect {
  return {
    name: 'sqlite',
    diffSchema: diffBaselineSqlToDesiredSql,
    formatSql,
    quoteIdentifier: sqliteQuoteIdentifier,
    defaultMigrationTableDdl: sqliteSqlfuMigrationTableDdl,
    // withMigrationLock omitted — sqlite serializes writers at the file level

    materializeSchemaSql: async (host, input) => {
      await using database = await host.openScratchDb('materialize-schema');
      if (input.sourceSql.trim()) {
        await database.client.raw(input.sourceSql);
      }
      return extractSqliteSchema(database.client, 'main', {excludedTables: [...(input.excludedTables ?? [])]});
    },
    extractSchemaFromClient: async (client, options) =>
      extractSqliteSchema(client, 'main', {excludedTables: [...(options?.excludedTables ?? [])]}),

    listLiveRelations: async (client) => {
      const rows = await client.all<{name: string; type: string; sql: string | null}>({
        sql: `select name, type, sql from sqlite_master where type in ('table', 'view') and ${excludeReservedSqliteObjects} order by type, name`,
        args: [],
      });
      return rows.map((row) => ({
        name: String(row.name),
        kind: row.type === 'view' ? 'view' : 'table',
        sql: typeof row.sql === 'string' ? row.sql : undefined,
      }));
    },

    getRelationInfo: async (client, relationName) => {
      const rows = await client.all<{name: string; type: string; sql: string | null}>({
        sql: `select name, type, sql from sqlite_schema where name = ?`,
        args: [relationName],
      });
      const row = rows[0];
      if (!row || (row.type !== 'table' && row.type !== 'view')) {
        throw new Error(`Unknown relation "${relationName}"`);
      }
      return {
        name: row.name,
        kind: row.type as 'table' | 'view',
        sql: typeof row.sql === 'string' ? row.sql : undefined,
      };
    },

    getRelationColumns: async (client, relationName) => {
      const rows = await client.all<Record<string, unknown>>({
        sql: `PRAGMA table_xinfo(${sqliteQuoteIdentifier(relationName)})`,
        args: [],
      });
      return rows
        .filter((row) => Number(row.hidden ?? 0) === 0)
        .map((row) => ({
          name: String(row.name),
          type: typeof row.type === 'string' ? row.type : '',
          notNull: Number(row.notnull ?? 0) === 1,
          primaryKey: Number(row.pk ?? 0) >= 1,
        }));
    },

    getRelationForeignKeys: async (client, relationName) => {
      const rows = await client.all<Record<string, unknown>>({
        sql: `PRAGMA foreign_key_list(${sqliteQuoteIdentifier(relationName)})`,
        args: [],
      });
      return resolveSqliteForeignKeyReferences(client, groupSqliteForeignKeys(rows));
    },

    materializeTypegenSchema:
      sqliteTypegenImpls?.materializeTypegenSchema ?? (() => typegenStub('materializeTypegenSchema')),
    loadSchemaForTypegen: sqliteTypegenImpls?.loadSchemaForTypegen ?? (() => typegenStub('loadSchemaForTypegen')),
    analyzeQueries: sqliteTypegenImpls?.analyzeQueries ?? (() => typegenStub('analyzeQueries')),
  };
}

type GroupedSqliteForeignKey = {
  columns: string[];
  referencedRelation: string;
  referencedColumns: Array<string | null>;
  seq: number[];
};

function groupSqliteForeignKeys(rows: Record<string, unknown>[]): GroupedSqliteForeignKey[] {
  const grouped = new Map<number, GroupedSqliteForeignKey>();
  for (const row of rows) {
    const id = Number(row.id);
    const seq = Number(row.seq);
    const referencedRelation = String(row.table);
    const column = String(row.from);
    const referencedColumn = typeof row.to === 'string' && row.to ? row.to : null;
    const existing = grouped.get(id);
    if (!existing) {
      grouped.set(id, {
        columns: [column],
        referencedRelation,
        referencedColumns: [referencedColumn],
        seq: [seq],
      });
      continue;
    }
    existing.columns.push(column);
    existing.referencedColumns.push(referencedColumn);
    existing.seq.push(seq);
  }
  return Array.from(grouped.values()).map((foreignKey) => {
    const ordered = foreignKey.seq
      .map((seq, index) => ({
        seq,
        column: foreignKey.columns[index]!,
        referencedColumn: foreignKey.referencedColumns[index],
      }))
      .sort((left, right) => left.seq - right.seq);
    return {
      columns: ordered.map((entry) => entry.column),
      referencedRelation: foreignKey.referencedRelation,
      referencedColumns: ordered.map((entry) => entry.referencedColumn || null),
      seq: ordered.map((entry) => entry.seq),
    };
  });
}

async function resolveSqliteForeignKeyReferences(
  client: Client,
  foreignKeys: GroupedSqliteForeignKey[],
): Promise<DialectForeignKey[]> {
  const primaryKeysByRelation = new Map<string, Promise<string[]>>();
  const getPrimaryKeyColumns = (relationName: string) => {
    const existing = primaryKeysByRelation.get(relationName);
    if (existing) {
      return existing;
    }
    const promise = getSqlitePrimaryKeyColumns(client, relationName);
    primaryKeysByRelation.set(relationName, promise);
    return promise;
  };

  return Promise.all(
    foreignKeys.map(async (foreignKey) => {
      const hasImplicitReference = foreignKey.referencedColumns.some((column) => !column);
      const primaryKeyColumns = hasImplicitReference ? await getPrimaryKeyColumns(foreignKey.referencedRelation) : [];
      return {
        columns: foreignKey.columns,
        referencedRelation: foreignKey.referencedRelation,
        referencedColumns: foreignKey.referencedColumns.flatMap((column, index) => {
          const referencedColumn = column || primaryKeyColumns[index];
          return referencedColumn ? [referencedColumn] : [];
        }),
      };
    }),
  );
}

async function getSqlitePrimaryKeyColumns(client: Client, relationName: string): Promise<string[]> {
  const rows = await client.all<Record<string, unknown>>({
    sql: `PRAGMA table_xinfo(${sqliteQuoteIdentifier(relationName)})`,
    args: [],
  });
  return rows
    .filter((row) => Number(row.pk || 0) >= 1)
    .sort((left, right) => Number(left.pk || 0) - Number(right.pk || 0))
    .map((row) => String(row.name));
}

/**
 * Asserts a `MaterializedTypegenSchema` was produced by the sqlite dialect.
 * Exposed so the registration in `typegen/index.ts` can use it without
 * duplicating the cast logic.
 */
export function assertSqliteMaterialized(materialized: MaterializedTypegenSchema): {
  databasePath: string;
  experimentalJsonTypes: boolean;
} {
  if (materialized.dialect !== 'sqlite') {
    throw new Error(
      `sqliteDialect received a MaterializedTypegenSchema produced by '${materialized.dialect}' — dialect handles must not cross dialect boundaries.`,
    );
  }
  return materialized as MaterializedTypegenSchema & {databasePath: string; experimentalJsonTypes: boolean};
}
