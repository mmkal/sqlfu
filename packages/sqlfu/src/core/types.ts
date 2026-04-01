export type QueryArg = null | string | number | bigint | Uint8Array | boolean;

export type ResultRow = Record<string, unknown>;

export interface SqlFragment {
  readonly sql: string;
  readonly args: readonly QueryArg[];
}

export interface SqlQuery extends SqlFragment {}

export type QueryResult<TRow extends ResultRow = ResultRow> = TRow[];

export interface SyncExecutor {
  query<TRow extends ResultRow = ResultRow>(query: SqlQuery): QueryResult<TRow>;
}

export interface AsyncExecutor {
  query<TRow extends ResultRow = ResultRow>(query: SqlQuery): Promise<QueryResult<TRow>>;
}

export interface SyncTransaction extends SyncExecutor {}

export interface AsyncTransaction extends AsyncExecutor {}

export interface SyncTransactional {
  transaction<TResult>(fn: (tx: SyncTransaction) => TResult): TResult;
}

export interface AsyncTransactional {
  transaction<TResult>(fn: (tx: AsyncTransaction) => Promise<TResult>): Promise<TResult>;
}

export interface SyncConnection extends SyncExecutor, SyncTransactional {}

export interface AsyncConnection extends AsyncExecutor, AsyncTransactional {}

export interface SyncClient {
  connect(): SyncConnection;
}

export interface AsyncClient {
  connect(): Promise<AsyncConnection>;
}

export interface SyncSqlClient extends SyncExecutor {
  readonly sql: SyncSqlTag;
}

export interface AsyncSqlClient extends AsyncExecutor {
  readonly sql: AsyncSqlTag;
}

export interface SyncSqlTag {
  <TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: readonly SqlValue[]
  ): PromiseLike<QueryResult<TRow>>;
  exec<TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: readonly SqlValue[]
  ): QueryResult<TRow>;
}

export interface AsyncSqlTag {
  <TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: readonly SqlValue[]
  ): PromiseLike<QueryResult<TRow>>;
  exec<TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: readonly SqlValue[]
  ): Promise<QueryResult<TRow>>;
}

export type SqlTag = SyncSqlTag | AsyncSqlTag;

export type SqlValue = QueryArg | SqlFragment;

export interface SqlfuConfig {
  readonly dbPath: string;
  readonly migrationsDir: string;
  readonly snapshotFile: string;
  readonly definitionsPath: string;
  readonly sqlDir: string;
  readonly generatedImportExtension?: '.js' | '.ts';
  readonly tempDir?: string;
  readonly tempDbPath?: string;
  readonly typesqlConfigPath?: string;
  readonly sqlite3defVersion?: string;
  readonly sqlite3defBinaryPath?: string;
}

export interface SqlfuProjectConfig {
  readonly cwd: string;
  readonly configPath?: string;
  readonly dbPath: string;
  readonly migrationsDir: string;
  readonly snapshotFile: string;
  readonly definitionsPath: string;
  readonly sqlDir: string;
  readonly generatedImportExtension: '.js' | '.ts';
  readonly tempDir: string;
  readonly tempDbPath: string;
  readonly typesqlConfigPath: string;
  readonly sqlite3defVersion: string;
  readonly sqlite3defBinaryPath: string;
}

export interface ProjectConfigOverrides {
  readonly cwd?: string;
  readonly configPath?: string;
}

export interface MigrateDiffResult {
  readonly drift: boolean;
  readonly output: string;
}
