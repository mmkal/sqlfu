// The sqlfu root export. Strict-tier: zero node:* imports, zero bare
// specifiers in the runtime graph of dist/index.js. Enforced by
// test/import-surface.test.ts. If you're reaching for node:*, or for a
// vendor bundle like the formatter or typegen, the right home is
// sqlfu/api (heavy tier) or sqlfu/analyze (zero-node:* + vendor OK).

export * from './sql.js';
export * from './types.js';
export * from './naming.js';
export * from './util.js';
export * from './errors.js';
export * from './instrument.js';
export type {
  ProcessResult,
  QueryErrorReport,
  QueryExecutionContext,
  QueryExecutionHook,
  QueryExecutionHookArgs,
  QueryOperation,
} from './instrument.js';
export type {SpanLike, TracerLike} from './otel.js';
export * from './adapters/d1.js';
export * from './adapters/libsql.js';
export * from './adapters/libsql-client.js';
export * from './adapters/bun.js';
export * from './adapters/better-sqlite3.js';
export * from './adapters/node-sqlite.js';
export * from './adapters/durable-object.js';
export * from './adapters/expo-sqlite.js';
export * from './adapters/sqlite-wasm.js';
export * from './adapters/turso-database.js';
export * from './adapters/turso-serverless.js';

export {defineConfig} from './config.js';

// Pure-SQLite text helpers — no node:*, useful on the light path for
// anyone wrangling migration SQL, splitting statements, or extracting
// schema from a running client.
export {
  extractSchema,
  rawSqlWithSqlSplittingAsync,
  rawSqlWithSqlSplittingSync,
  rewriteNamedParamsToPositional,
  splitSqlStatements,
  sqlReturnsRows,
  surroundWithBeginCommitRollbackAsync,
  surroundWithBeginCommitRollbackSync,
} from './sqlite-text.js';

// Structural SqlfuHost interface + related types. Types only; useful for
// consumers building their own host implementations (test doubles, edge
// runtimes).
export type {
  AdHocSqlParams,
  AdHocSqlResult,
  DisposableAsyncClient,
  HostCatalog,
  HostFs,
  HostLogger,
  SqlfuHost,
} from './host.js';

// Query-catalog shape types — what `sqlfu generate` emits. Consumed by
// the UI, by custom codegen, and by anyone inspecting a project's
// generated metadata.
export type {
  AdHocQueryAnalysis,
  JsonSchema,
  JsonSchemaObject,
  QueryCatalog,
  QueryCatalogArgument,
  QueryCatalogEntry,
  QueryCatalogField,
} from './typegen/query-catalog.js';

// The "just-run-the-sql-bro" migrator: enough to apply migrations from a
// bundle at Cloudflare Worker / Bun boot. History-reconciliation helpers
// (baseline, replace, readHistory, drift helpers) stay internal to
// sqlfu/api — workers don't reconcile, they just apply.
export {applyMigrations, migrationsFromBundle} from './migrations/index.js';
export type {Migration, MigrationBundle} from './migrations/index.js';

export {prettifyStandardSchemaError} from './vendor/standard-schema/errors.js';
