export type QueryArg = null | string | number | bigint | Uint8Array | boolean;

export type ResultRow = Record<string, unknown>;

export interface SqlFragment {
  readonly sql: string;
  readonly args: readonly QueryArg[];
}

export interface SqlQuery extends SqlFragment {
  readonly name?: string;
}

export interface QueryMetadata {
  readonly rowsAffected?: number;
  readonly lastInsertRowid?: string | number | bigint | null;
}

export type RunResult = QueryMetadata;

export interface SyncClient<TDriver = unknown> {
  readonly driver: TDriver;
  /** OTel `db.system.name`. Stamped by each adapter ('sqlite', 'postgresql', etc.). */
  readonly system: string;
  all<TRow extends ResultRow = ResultRow>(query: SqlQuery): TRow[];
  run(query: SqlQuery): RunResult;
  raw(sql: string): RunResult;
  iterate<TRow extends ResultRow = ResultRow>(query: SqlQuery): Iterable<TRow>;
  transaction<TResult>(fn: (tx: SyncClient<TDriver>) => TResult): TResult;
  transaction<TResult>(fn: (tx: SyncClient<TDriver>) => Promise<TResult>): Promise<TResult>;
  readonly sql: SyncSqlTag;
}

export interface AsyncClient<TDriver = unknown> {
  readonly driver: TDriver;
  /** OTel `db.system.name`. Stamped by each adapter ('sqlite', 'postgresql', etc.). */
  readonly system: string;
  all<TRow extends ResultRow = ResultRow>(query: SqlQuery): Promise<TRow[]>;
  run(query: SqlQuery): Promise<RunResult>;
  raw(sql: string): Promise<RunResult>;
  iterate<TRow extends ResultRow = ResultRow>(query: SqlQuery): AsyncIterable<TRow>;
  transaction<TResult>(fn: (tx: AsyncClient<TDriver>) => Promise<TResult> | TResult): Promise<TResult>;
  readonly sql: AsyncSqlTag;
}

export type Client<TDriver = unknown> = SyncClient<TDriver> | AsyncClient<TDriver>;

export interface SyncSqlTag {
  <TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: readonly SqlValue[]
  ): SqlRowsPromise<TRow>;
  all<TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: readonly SqlValue[]
  ): TRow[];
  run(strings: TemplateStringsArray, ...values: readonly SqlValue[]): RunResult;
}

export interface AsyncSqlTag {
  <TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: readonly SqlValue[]
  ): SqlRowsPromise<TRow>;
  all<TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: readonly SqlValue[]
  ): Promise<TRow[]>;
  run(strings: TemplateStringsArray, ...values: readonly SqlValue[]): Promise<RunResult>;
}

export type SqlTag = SyncSqlTag | AsyncSqlTag;

export interface SqlRowsPromise<TRow extends ResultRow = ResultRow> extends PromiseLike<TRow[]> {
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<TRow[] | TResult>;
  finally(onfinally?: (() => void) | null): Promise<TRow[]>;
}

export type SqlValue = QueryArg | SqlFragment;

export interface SqlfuConfig {
  readonly db: string;
  readonly migrations: string;
  readonly definitions: string;
  readonly queries: string;
  readonly generatedImportExtension?: '.js' | '.ts';
}

export interface SqlfuProjectConfig {
  readonly projectRoot: string;
  readonly db: string;
  readonly migrations: string;
  readonly definitions: string;
  readonly queries: string;
  readonly generatedImportExtension: '.js' | '.ts';
}

export interface MigrateDiffResult {
  readonly drift: boolean;
  readonly output: string;
}
