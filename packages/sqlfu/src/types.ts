export type QueryArg = null | string | number | bigint | Uint8Array | boolean;

export type ResultRow = Record<string, unknown>;

export interface SqlFragment {
  sql: string;
  args: QueryArg[];
}

export interface SqlQuery extends SqlFragment {
  name?: string;
}

export interface QueryMetadata {
  rowsAffected?: number;
  lastInsertRowid?: string | number | bigint | null;
}

export type RunResult = QueryMetadata;

export interface SyncClient<TDriver = unknown> {
  driver: TDriver;
  /** OTel `db.system.name`. Stamped by each adapter ('sqlite', 'postgresql', etc.). */
  system: string;
  /** `true` for a `SyncClient`; lets callers route sync/async logic without probing. */
  sync: true;
  all<TRow extends ResultRow = ResultRow>(query: SqlQuery): TRow[];
  run(query: SqlQuery): RunResult;
  raw(sql: string): RunResult;
  iterate<TRow extends ResultRow = ResultRow>(query: SqlQuery): Iterable<TRow>;
  transaction<TResult>(fn: (tx: SyncClient<TDriver>) => TResult): TResult;
  transaction<TResult>(fn: (tx: SyncClient<TDriver>) => Promise<TResult>): Promise<TResult>;
  sql: SyncSqlTag;
}

export interface AsyncClient<TDriver = unknown> {
  driver: TDriver;
  /** OTel `db.system.name`. Stamped by each adapter ('sqlite', 'postgresql', etc.). */
  system: string;
  /** `false` for an `AsyncClient`; lets callers route sync/async logic without probing. */
  sync: false;
  all<TRow extends ResultRow = ResultRow>(query: SqlQuery): Promise<TRow[]>;
  run(query: SqlQuery): Promise<RunResult>;
  raw(sql: string): Promise<RunResult>;
  iterate<TRow extends ResultRow = ResultRow>(query: SqlQuery): AsyncIterable<TRow>;
  transaction<TResult>(fn: (tx: AsyncClient<TDriver>) => Promise<TResult> | TResult): Promise<TResult>;
  sql: AsyncSqlTag;
}

export type Client<TDriver = unknown> = SyncClient<TDriver> | AsyncClient<TDriver>;

export interface SyncSqlTag {
  <TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: SqlValue[]
  ): SqlRowsPromise<TRow>;
  all<TRow extends ResultRow = ResultRow>(strings: TemplateStringsArray, ...values: SqlValue[]): TRow[];
  run(strings: TemplateStringsArray, ...values: SqlValue[]): RunResult;
}

export interface AsyncSqlTag {
  <TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: SqlValue[]
  ): SqlRowsPromise<TRow>;
  all<TRow extends ResultRow = ResultRow>(
    strings: TemplateStringsArray,
    ...values: SqlValue[]
  ): Promise<TRow[]>;
  run(strings: TemplateStringsArray, ...values: SqlValue[]): Promise<RunResult>;
}

export type SqlTag = SyncSqlTag | AsyncSqlTag;

export interface SqlRowsPromise<TRow extends ResultRow = ResultRow> extends PromiseLike<TRow[]> {
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<TRow[] | TResult>;
  finally(onfinally?: (() => void) | null): Promise<TRow[]>;
}

export type SqlValue = QueryArg | SqlFragment;

export type SqlfuValidator = 'arktype' | 'valibot' | 'zod' | 'zod-mini';

/**
 * Schema source of truth for `sqlfu generate`. Controls where typegen reads
 * the schema from when building the query catalog. Defaults to
 * `'desired_schema'` — typegen reads `definitions.sql` directly, so `generate`
 * works even without a live database.
 *
 * - `'desired_schema'` — read `definitions.sql` verbatim. Fastest, most
 *   deterministic, requires no DB. Types follow intent; any drift from
 *   migrations is surfaced by `sqlfu check`.
 * - `'migrations'` — replay `migrations/*.sql` into a scratch DB and extract
 *   the resulting schema. Types follow what the migrator actually produces;
 *   catches drift from `definitions.sql` implicitly.
 * - `'migration_history'` — read `sqlfu_migrations` from `config.db`, replay
 *   only the files listed there (in order), extract. Throws if a recorded
 *   migration is missing from `migrations/`. Useful when types should match
 *   what's actually deployed.
 * - `'live_schema'` — extract schema directly from `config.db`. Requires the
 *   DB to be populated up-front; was the default before the factory form of
 *   `config.db` landed.
 */
export type SqlfuAuthority = 'desired_schema' | 'migrations' | 'migration_history' | 'live_schema';

export interface SqlfuGenerateConfig {
  /**
   * Where typegen reads the schema from. Default `'desired_schema'` —
   * `definitions.sql` is the source of truth and no DB is required. See
   * {@link SqlfuAuthority} for each value's semantics.
   */
  authority?: SqlfuAuthority;
  /**
   * Emit runtime validation schemas as the source of truth for each generated query's params and result.
   *
   * - `null` / `undefined` / omitted = plain TypeScript types, no runtime validation (the default).
   * - `'arktype'` = generated wrappers declare [arktype](https://arktype.io) schemas via the
   *   `type(...)` constructor, validate through Standard Schema, and derive types from `Schema.infer`.
   * - `'valibot'` = [valibot](https://valibot.dev) schemas (smaller bundle, functional API).
   * - `'zod'` = [zod](https://zod.dev) schemas with `.parse()` / `.safeParse()` and `z.infer`.
   * - `'zod-mini'` = same schema primitives as zod, imported from `zod/mini` and called via the
   *   functional `z.parse(Schema, input)` API (smaller bundle than standard zod).
   */
  validator?: SqlfuValidator | null;
  /**
   * When true (default), the generated wrapper catches validation errors thrown by `.parse()` and
   * re-throws them with a readable, indented message built from the Standard Schema issues list.
   * When false, the raw error from the underlying validator library passes through untouched.
   *
   * No effect when `validator` is null/undefined (plain TS types never throw validation errors).
   */
  prettyErrors?: boolean;
  /**
   * When true, generated wrappers take a `SyncClient` and return values synchronously (no
   * `async`/`await`, no `Promise<...>` return types). Default false.
   *
   * Use this when you know your app always runs against a sync driver (`node:sqlite`,
   * `better-sqlite3`, `bun:sqlite`). The resulting wrappers are easier to call from
   * non-async contexts (constructors, non-async callbacks).
   */
  sync?: boolean;
  /**
   * Extension used in generated `.generated/index.ts` barrel re-exports (`./tables.js` vs
   * `./tables.ts`). If omitted, sqlfu infers it from the nearest `tsconfig.json`:
   * `.ts` when `allowImportingTsExtensions` / `rewriteRelativeImportExtensions` is on,
   * otherwise `.js`.
   */
  importExtension?: '.js' | '.ts';
}

/**
 * Prefix format used when drafting new migration filenames.
 * - `'iso'` (default): `2026-04-22T10.30.45.123Z_<slug>.sql`
 * - `'four-digit'`: `0000_<slug>.sql`, `0001_<slug>.sql`, … (next-integer-after-max of existing
 *   `^\d{4}_` files; starts at `0000` in an empty directory)
 */
export type SqlfuMigrationPrefix = 'iso' | 'four-digit';

export interface SqlfuMigrationsConfig {
  path: string;
  prefix: SqlfuMigrationPrefix;
}

/**
 * A disposable wrapper around an `AsyncClient`. Returned by `SqlfuHost.openDb` and
 * by user-provided `SqlfuDbFactory` callbacks. The `[Symbol.asyncDispose]` method
 * runs when an `await using` scope exits, letting sqlfu pair each command with a
 * clean connection lifecycle regardless of where the client came from.
 */
export interface DisposableAsyncClient {
  client: AsyncClient;
  [Symbol.asyncDispose](): Promise<void>;
}

/**
 * A factory that produces a fresh disposable client whenever sqlfu needs to touch
 * the configured database. Invoked on every `host.openDb(config)` call; users
 * memoize inside the factory if they want to share an expensive resource (e.g. a
 * Miniflare instance) across multiple sqlfu commands in one process.
 */
export type SqlfuDbFactory = () => DisposableAsyncClient | Promise<DisposableAsyncClient>;

export interface SqlfuConfig {
  /**
   * The database sqlfu talks to. Either a filesystem path to a local sqlite
   * file (sugar for opening it via `node:sqlite`), or a factory that returns a
   * `DisposableAsyncClient` — use the callback form to point sqlfu at an
   * adapter-mediated DB (D1, Turso, libsql, miniflare bindings, …) so
   * `migrate`, `check`, `sync`, `goto`, `baseline`, and the UI all operate on
   * the same database your app reads from. Optional: if you only ever run
   * `sqlfu generate` with `authority: 'desired_schema'` (or `'migrations'`),
   * you can omit `db` entirely.
   */
  db?: string | SqlfuDbFactory;
  /**
   * Migrations directory. Pass a string for the default ISO-timestamp prefix, or
   * `{ path, prefix: 'four-digit' }` to use `0000_*.sql`, `0001_*.sql`, … for newly
   * drafted migrations. Omit entirely if your project doesn't use migrations
   * (e.g. library-author use cases where definitions.sql alone is the source of truth).
   */
  migrations?: string | SqlfuMigrationsConfig;
  definitions: string;
  queries: string;
  generate?: SqlfuGenerateConfig;
}

export interface SqlfuProjectConfig {
  projectRoot: string;
  db?: string | SqlfuDbFactory;
  migrations?: SqlfuMigrationsConfig;
  definitions: string;
  queries: string;
  generate: {
    validator: SqlfuValidator | null;
    prettyErrors: boolean;
    sync: boolean;
    importExtension: '.js' | '.ts';
    authority: SqlfuAuthority;
  };
}

export interface MigrateDiffResult {
  drift: boolean;
  output: string;
}
