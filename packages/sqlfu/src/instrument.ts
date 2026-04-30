import {bindAsyncSql, bindSyncSql} from './sql.js';
import type {AsyncClient, Client, SqlQuery, SyncClient} from './types.js';
import {createOtelHook} from './otel.js';

export type QueryOperation = 'all' | 'run';

export interface QueryExecutionContext {
  query: SqlQuery;
  operation: QueryOperation;
  system: string;
}

export interface SyncQueryExecutionHookArgs<TResult> {
  context: QueryExecutionContext;
  execute: () => TResult;
}

export interface AsyncQueryExecutionHookArgs<TResult> {
  context: QueryExecutionContext;
  execute: () => Promise<TResult>;
}

export type QueryExecutionHookArgs<TResult> =
  | SyncQueryExecutionHookArgs<TResult>
  | AsyncQueryExecutionHookArgs<TResult>;

export type SyncQueryExecutionHook = <TResult>(args: SyncQueryExecutionHookArgs<TResult>) => TResult;
export type AsyncQueryExecutionHook = <TResult>(args: AsyncQueryExecutionHookArgs<TResult>) => Promise<TResult>;

export interface QueryExecutionHook {
  sync: SyncQueryExecutionHook;
  async: AsyncQueryExecutionHook;
}

export type SyncQueryExecutionHookInput = SyncQueryExecutionHook | QueryExecutionHook;
export type AsyncQueryExecutionHookInput = AsyncQueryExecutionHook | QueryExecutionHook;

/**
 * Wrap a Client so every `all`/`run` flows through `hook`. `raw`, `iterate`,
 * and `transaction` are passed through unchanged. Queries issued inside a
 * transaction still fire the hook because the tx client is re-instrumented.
 */
export function instrumentClient<TDriver>(
  client: SyncClient<TDriver>,
  hook: SyncQueryExecutionHookInput,
): SyncClient<TDriver>;
export function instrumentClient<TDriver>(
  client: AsyncClient<TDriver>,
  hook: AsyncQueryExecutionHookInput,
): AsyncClient<TDriver>;
export function instrumentClient<TClient extends Client>(client: TClient, hook: QueryExecutionHook): TClient;
export function instrumentClient(
  client: Client,
  hook: SyncQueryExecutionHookInput | AsyncQueryExecutionHookInput,
): Client {
  if (client.sync) {
    return instrumentSync(client, syncHookFrom(hook as SyncQueryExecutionHookInput));
  }
  return instrumentAsync(client, asyncHookFrom(hook as AsyncQueryExecutionHookInput));
}

/**
 * Run `hooks` left-to-right, each wrapping the next. The first hook is the
 * outermost — it sees the call before any others and gets the final result
 * or error last.
 */
export function composeSyncHooks(...hooks: SyncQueryExecutionHookInput[]): SyncQueryExecutionHook {
  if (hooks.length === 0) {
    return ({execute}) => execute();
  }
  if (hooks.length === 1) {
    return syncHookFrom(hooks[0]!);
  }
  const syncHooks = hooks.map(syncHookFrom);
  return <TResult>(args: SyncQueryExecutionHookArgs<TResult>): TResult => {
    let chained: () => TResult = args.execute;
    for (let index = syncHooks.length - 1; index >= 0; index -= 1) {
      const hook = syncHooks[index]!;
      const next = chained;
      chained = () => hook({...args, execute: next});
    }
    return chained();
  };
}

/**
 * Async variant of `composeSyncHooks`. The first hook is still outermost.
 */
export function composeAsyncHooks(...hooks: AsyncQueryExecutionHookInput[]): AsyncQueryExecutionHook {
  if (hooks.length === 0) {
    return ({execute}) => execute();
  }
  if (hooks.length === 1) {
    return asyncHookFrom(hooks[0]!);
  }
  const asyncHooks = hooks.map(asyncHookFrom);
  return <TResult>(args: AsyncQueryExecutionHookArgs<TResult>): Promise<TResult> => {
    let chained: () => Promise<TResult> = args.execute;
    for (let index = asyncHooks.length - 1; index >= 0; index -= 1) {
      const hook = asyncHooks[index]!;
      const next = chained;
      chained = () => hook({...args, execute: next});
    }
    return chained();
  };
}

export function composeHooks(...hooks: QueryExecutionHook[]): QueryExecutionHook {
  return {
    sync: composeSyncHooks(...hooks),
    async: composeAsyncHooks(...hooks),
  };
}

export interface QueryErrorReport {
  context: QueryExecutionContext;
  error: unknown;
}

/**
 * Reference error-reporter hook. Invokes `report` whenever a query throws
 * (or its promise rejects), then always rethrows so higher hooks (and the
 * caller) still see the error. `report`'s return value is discarded; any
 * promise it returns is not awaited.
 *
 * Like `createOtelHook`, this is a deliberately small reference impl — if
 * you want extra context (breadcrumbs, rate limiting, redaction), copy
 * this body and edit it.
 *
 * Useful for Sentry-style capture without pulling Sentry into the library:
 * `createErrorReporterHook(({ context, error }) => Sentry.captureException(error, { tags: { 'db.query.summary': context.query.name || 'sql' } }))`.
 */
export function createErrorReporterHook(report: (params: QueryErrorReport) => unknown): QueryExecutionHook {
  return {
    sync: ({context, execute}) => {
      try {
        return execute();
      } catch (error) {
        try {
          report({context, error});
        } catch {
          // the error handler itself failing shouldn't mask the original error
        }
        throw error;
      }
    },
    async: async ({context, execute}) => {
      try {
        return await execute();
      } catch (error) {
        try {
          report({context, error});
        } catch {
          // the error handler itself failing shouldn't mask the original error
        }
        throw error;
      }
    },
  };
}

function buildSyncHookArgs<TResult>(
  context: QueryExecutionContext,
  execute: () => TResult,
): SyncQueryExecutionHookArgs<TResult> {
  return {context, execute};
}

function buildAsyncHookArgs<TResult>(
  context: QueryExecutionContext,
  execute: () => Promise<TResult>,
): AsyncQueryExecutionHookArgs<TResult> {
  return {context, execute};
}

function instrumentAsync<TDriver>(client: AsyncClient<TDriver>, hook: AsyncQueryExecutionHook): AsyncClient<TDriver> {
  const wrapped: Omit<AsyncClient<TDriver>, 'sql'> & {sql: AsyncClient<TDriver>['sql']} = {
    driver: client.driver,
    system: client.system,
    sync: false,
    all: (query) => hook(buildAsyncHookArgs({query, operation: 'all', system: client.system}, () => client.all(query))),
    run: (query) => hook(buildAsyncHookArgs({query, operation: 'run', system: client.system}, () => client.run(query))),
    raw: (sql) => client.raw(sql),
    iterate: (query) => client.iterate(query),
    // prepare bypasses the hook because the hook contract takes a `SqlQuery`
    // and a single execute thunk; a prepared handle has no bound `args` and
    // can be invoked many times. If we ran the hook here, every `.all/.run`
    // call on the handle would record `args: []` against the original SQL,
    // which is misleading and worse than skipping. Re-instrumentation can
    // wrap the handle's methods explicitly if needed in a follow-up.
    prepare: (sql) => client.prepare(sql),
    transaction: (fn) => client.transaction((tx) => fn(instrumentAsync(tx, hook))),
    sql: undefined as unknown as AsyncClient<TDriver>['sql'],
  };
  wrapped.sql = bindAsyncSql(wrapped);
  return wrapped;
}

function instrumentSync<TDriver>(client: SyncClient<TDriver>, hook: SyncQueryExecutionHook): SyncClient<TDriver> {
  const wrapped: Omit<SyncClient<TDriver>, 'sql'> & {sql: SyncClient<TDriver>['sql']} = {
    driver: client.driver,
    system: client.system,
    sync: true,
    all: (query) => hook(buildSyncHookArgs({query, operation: 'all', system: client.system}, () => client.all(query))),
    run: (query) => hook(buildSyncHookArgs({query, operation: 'run', system: client.system}, () => client.run(query))),
    raw: (sql) => client.raw(sql),
    iterate: (query) => client.iterate(query),
    prepare: (sql) => client.prepare(sql),
    transaction: (<TResult>(fn: (tx: SyncClient<TDriver>) => TResult) =>
      client.transaction((tx: SyncClient<TDriver>) =>
        fn(instrumentSync(tx, hook)),
      )) as SyncClient<TDriver>['transaction'],
    sql: undefined as unknown as SyncClient<TDriver>['sql'],
  };
  wrapped.sql = bindSyncSql(wrapped);
  return wrapped;
}

function syncHookFrom(hook: SyncQueryExecutionHookInput): SyncQueryExecutionHook {
  return typeof hook === 'function' ? hook : hook.sync;
}

function asyncHookFrom(hook: AsyncQueryExecutionHookInput): AsyncQueryExecutionHook {
  return typeof hook === 'function' ? hook : hook.async;
}

interface InstrumentFn {
  <TDriver>(client: SyncClient<TDriver>, ...hooks: SyncQueryExecutionHookInput[]): SyncClient<TDriver>;
  <TDriver>(client: AsyncClient<TDriver>, ...hooks: AsyncQueryExecutionHookInput[]): AsyncClient<TDriver>;
  <TClient extends Client>(client: TClient, ...hooks: QueryExecutionHook[]): TClient;
  otel: typeof createOtelHook;
  onError: typeof createErrorReporterHook;
}

function instrumentImpl<TDriver>(
  client: SyncClient<TDriver>,
  ...hooks: SyncQueryExecutionHookInput[]
): SyncClient<TDriver>;
function instrumentImpl<TDriver>(
  client: AsyncClient<TDriver>,
  ...hooks: AsyncQueryExecutionHookInput[]
): AsyncClient<TDriver>;
function instrumentImpl<TClient extends Client>(client: TClient, ...hooks: QueryExecutionHook[]): TClient;
function instrumentImpl(
  client: Client,
  ...hooks: Array<SyncQueryExecutionHookInput | AsyncQueryExecutionHookInput>
): Client {
  if (client.sync) {
    return instrumentSync(client, composeSyncHooks(...(hooks as SyncQueryExecutionHookInput[])));
  }
  return instrumentAsync(client, composeAsyncHooks(...(hooks as AsyncQueryExecutionHookInput[])));
}

/**
 * Wrap a Client with one or more query-execution hooks. Hooks run
 * left-to-right — the first one is the outermost, seeing the call first
 * and the result/error last.
 *
 * ```ts
 * const client = instrument(baseClient,
 *   instrument.otel({tracer}),
 *   instrument.onError(({context, error}) => Sentry.captureException(error)),
 * )
 * ```
 *
 * `instrument.otel` and `instrument.onError` are small reference
 * implementations. If your team has different conventions (different
 * attribute names, extra resource attributes, rate limiting, redaction)
 * copy their bodies and edit them. The stable contract is
 * `QueryExecutionHook`; these helpers are just one way to satisfy it.
 */
export const instrument: InstrumentFn = Object.assign(instrumentImpl, {
  otel: createOtelHook,
  onError: createErrorReporterHook,
});
