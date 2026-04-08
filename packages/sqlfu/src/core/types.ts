export type QueryArg = null | string | number | bigint | Uint8Array | boolean;

export type ResultRow = Record<string, unknown>;

export interface SqlFragment {
  readonly sql: string;
  readonly args: readonly QueryArg[];
}

export interface SqlQuery extends SqlFragment {}

export interface QueryMetadata {
  readonly rowsAffected?: number;
  readonly lastInsertRowid?: string | number | bigint | null;
}

export type QueryResult<TRow extends ResultRow = ResultRow> = TRow[] & QueryMetadata;

export interface SyncExecutor {
  query<TRow extends ResultRow = ResultRow>(query: SqlQuery): QueryResult<TRow>;
}

export interface AsyncExecutor {
  query<TRow extends ResultRow = ResultRow>(query: SqlQuery): Promise<QueryResult<TRow>>;
}

export type QueryExecutor = SyncExecutor | AsyncExecutor;

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
  ): SqlQueryPromise<TRow>;
  exec<TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: readonly SqlValue[]
  ): QueryResult<TRow>;
}

export interface AsyncSqlTag {
  <TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: readonly SqlValue[]
  ): SqlQueryPromise<TRow>;
  exec<TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: readonly SqlValue[]
  ): Promise<QueryResult<TRow>>;
}

export type SqlTag = SyncSqlTag | AsyncSqlTag;

export interface SqlQueryPromise<TRow extends ResultRow = ResultRow> extends PromiseLike<QueryResult<TRow>> {
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<QueryResult<TRow> | TResult>;
  finally(onfinally?: (() => void) | null): Promise<QueryResult<TRow>>;
}

export type SqlValue = QueryArg | SqlFragment;

export interface SqlfuConfig {
  readonly dbPath: string;
  readonly migrationsDir: string;
  readonly snapshotFile: string;
  readonly definitionsPath: string;
  readonly sqlDir: string;
  readonly generatedImportExtension?: '.js' | '.ts';
}

export interface SqlfuProjectConfig {
  readonly projectRoot: string;
  readonly dbPath: string;
  readonly migrationsDir: string;
  readonly snapshotFile: string;
  readonly definitionsPath: string;
  readonly sqlDir: string;
  readonly generatedImportExtension: '.js' | '.ts';
}

export interface MigrateDiffResult {
  readonly drift: boolean;
  readonly output: string;
}
