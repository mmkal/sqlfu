export {queryNickname} from './core/naming.js';
export type {QueryCatalog, QueryCatalogEntry} from './typegen/query-catalog.js';
export type {SqlAnalysisResponse, SqlEditorDiagnostic} from './ui/shared.js';
export {
  isInternalUnsupportedSqlAnalysisError,
  toSqlEditorDiagnostic,
} from './core/sql-editor-diagnostic.js';
export {analyzeVendoredTypesqlQueriesWithClient} from './typegen/analyze-vendored-typesql-with-client.js';
export type {
  VendoredQueryAnalysis,
  VendoredQueryInput,
} from './typegen/analyze-vendored-typesql-with-client.js';

export type {
  AsyncClient,
  AsyncSqlTag,
  Client,
  QueryArg,
  QueryMetadata,
  ResultRow,
  RunResult,
  SqlQuery,
  SqlfuConfig,
  SqlfuProjectConfig,
  SyncClient,
  SyncSqlTag,
} from './core/types.js';
export {
  extractSchema,
  rawSqlWithSqlSplittingAsync,
  splitSqlStatements,
  surroundWithBeginCommitRollbackAsync,
} from './core/sqlite.js';
export {bindAsyncSql} from './core/sql.js';
export {inspectSqliteSchema} from './schemadiff/sqlite/inspect.js';
export {planSchemaDiff} from './schemadiff/sqlite/plan.js';
export type {SqliteInspectedDatabase} from './schemadiff/sqlite/types.js';

export type {
  AdHocSqlParams,
  AdHocSqlResult,
  DisposableAsyncClient,
  HostCatalog,
  HostFs,
  HostLogger,
  SqlfuHost,
} from './core/host.js';
