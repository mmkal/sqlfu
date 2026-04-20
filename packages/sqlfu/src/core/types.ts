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
  /** `true` for a `SyncClient`; lets callers route sync/async logic without probing. */
  readonly sync: true;
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
  /** `false` for an `AsyncClient`; lets callers route sync/async logic without probing. */
  readonly sync: false;
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
  all<TRow extends ResultRow = ResultRow>(strings: TemplateStringsArray, ...values: readonly SqlValue[]): TRow[];
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

export type SqlfuValidator = 'zod' | 'valibot' | 'zod-mini';

export interface SqlfuGenerateConfig {
  /**
   * Emit runtime validation schemas as the source of truth for each generated query's params and result.
   *
   * - `null` / `undefined` / omitted = plain TypeScript types, no runtime validation (the default).
   * - `'zod'` = generated wrappers declare zod schemas, `.parse()` params on the way in and each row
   *   on the way out, and types are derived via `z.infer`.
   * - `'valibot'` = same shape, but with [valibot](https://valibot.dev) (smaller bundle, functional API).
   * - `'zod-mini'` = same shape as `'zod'`, but imports from `zod/mini` and uses the functional
   *   `z.parse(Schema, input)` API (smaller bundle than standard zod).
   */
  readonly validator?: SqlfuValidator | null;
  /**
   * When true (default), the generated wrapper catches validation errors thrown by `.parse()` and
   * re-throws them with a readable, indented message built from the Standard Schema issues list.
   * When false, the raw error from the underlying validator library passes through untouched.
   *
   * No effect when `validator` is null/undefined (plain TS types never throw validation errors).
   */
  readonly prettyErrors?: boolean;
}

export interface SqlfuConfig {
  readonly db: string;
  readonly migrations: string;
  readonly definitions: string;
  readonly queries: string;
  readonly generatedImportExtension?: '.js' | '.ts';
  readonly generate?: SqlfuGenerateConfig;
}

export interface SqlfuProjectConfig {
  readonly projectRoot: string;
  readonly db: string;
  readonly migrations: string;
  readonly definitions: string;
  readonly queries: string;
  readonly generatedImportExtension: '.js' | '.ts';
  readonly generate: {
    readonly validator: SqlfuValidator | null;
    readonly prettyErrors: boolean;
  };
}

export interface MigrateDiffResult {
  readonly drift: boolean;
  readonly output: string;
}
