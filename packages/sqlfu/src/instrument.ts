import {bindAsyncSql, bindSyncSql} from './sql.js';
import type {AsyncClient, Client, SqlQuery, SyncClient} from './types.js';
import {createOtelHook} from './otel.js';

export type QueryOperation = 'all' | 'run';

export interface QueryExecutionContext {
  query: SqlQuery;
  operation: QueryOperation;
  system: string;
}

/**
 * Run `execute` and call `onSuccess` on the result. If `execute` throws
 * synchronously, or returns a Promise that rejects, `onError` is called —
 * if `onError` is omitted, the error propagates. The shape of the return
 * value matches the shape of `execute`'s return: sync in, sync out;
 * Promise in, Promise out. Abstracts the "is it a Promise" check so hook
 * authors don't write it every time.
 */
export type ProcessResult = <T>(
  execute: () => T,
  onSuccess: (value: Awaited<T>) => Awaited<T>,
  onError?: (error: unknown) => Awaited<T>,
) => T;

export interface QueryExecutionHookArgs<TResult> {
  context: QueryExecutionContext;
  execute: () => TResult;
  processResult: ProcessResult;
}

export type QueryExecutionHook = <TResult>(args: QueryExecutionHookArgs<TResult>) => TResult;

const processResult: ProcessResult = <T>(
  execute: () => T,
  onSuccess: (value: Awaited<T>) => Awaited<T>,
  onError?: (error: unknown) => Awaited<T>,
): T => {
  let result: T;
  try {
    result = execute();
  } catch (error) {
    if (onError) return onError(error) as T;
    throw error;
  }
  if (isPromiseLike(result)) {
    return (result as unknown as Promise<Awaited<T>>).then(
      onSuccess,
      onError ??
        ((error: unknown) => {
          throw error;
        }),
    ) as T;
  }
  return onSuccess(result as Awaited<T>) as T;
};

/**
 * Wrap a Client so every `all`/`run` flows through `hook`. `raw`, `iterate`,
 * and `transaction` are passed through unchanged. Queries issued inside a
 * transaction still fire the hook because the tx client is re-instrumented.
 */
export function instrumentClient<TClient extends Client>(client: TClient, hook: QueryExecutionHook): TClient {
  return client.sync ? (instrumentSync(client, hook) as TClient) : (instrumentAsync(client, hook) as TClient);
}

/**
 * Run `hooks` left-to-right, each wrapping the next. The first hook is the
 * outermost — it sees the call before any others and gets the final result
 * or error last.
 */
export function composeHooks(...hooks: QueryExecutionHook[]): QueryExecutionHook {
  if (hooks.length === 0) {
    return ({execute}) => execute();
  }
  if (hooks.length === 1) {
    return hooks[0]!;
  }
  return <TResult>(args: QueryExecutionHookArgs<TResult>): TResult => {
    let chained: () => TResult = args.execute;
    for (let index = hooks.length - 1; index >= 0; index -= 1) {
      const hook = hooks[index]!;
      const next = chained;
      chained = () => hook({...args, execute: next});
    }
    return chained();
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
 * `createErrorReporterHook(({ context, error }) => Sentry.captureException(error, { tags: { 'db.query.summary': context.query.name ?? 'sql' } }))`.
 */
export function createErrorReporterHook(report: (params: QueryErrorReport) => unknown): QueryExecutionHook {
  return ({context, execute, processResult}) =>
    processResult(
      execute,
      (value) => value,
      (error) => {
        try {
          report({context, error});
        } catch {
          // the error handler itself failing shouldn't mask the original error
        }
        throw error;
      },
    );
}

function buildHookArgs<TResult>(
  context: QueryExecutionContext,
  execute: () => TResult,
): QueryExecutionHookArgs<TResult> {
  return {context, execute, processResult};
}

function instrumentAsync<TDriver>(client: AsyncClient<TDriver>, hook: QueryExecutionHook): AsyncClient<TDriver> {
  const wrapped: Omit<AsyncClient<TDriver>, 'sql'> & {sql: AsyncClient<TDriver>['sql']} = {
    driver: client.driver,
    system: client.system,
    sync: false,
    all: (query) => hook(buildHookArgs({query, operation: 'all', system: client.system}, () => client.all(query))),
    run: (query) => hook(buildHookArgs({query, operation: 'run', system: client.system}, () => client.run(query))),
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

function instrumentSync<TDriver>(client: SyncClient<TDriver>, hook: QueryExecutionHook): SyncClient<TDriver> {
  const wrapped: Omit<SyncClient<TDriver>, 'sql'> & {sql: SyncClient<TDriver>['sql']} = {
    driver: client.driver,
    system: client.system,
    sync: true,
    all: (query) => hook(buildHookArgs({query, operation: 'all', system: client.system}, () => client.all(query))),
    run: (query) => hook(buildHookArgs({query, operation: 'run', system: client.system}, () => client.run(query))),
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

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return value != null && typeof (value as {then?: unknown}).then === 'function';
}

interface InstrumentFn {
  <TClient extends Client>(client: TClient, ...hooks: QueryExecutionHook[]): TClient;
  otel: typeof createOtelHook;
  onError: typeof createErrorReporterHook;
}

const instrumentImpl = <TClient extends Client>(client: TClient, ...hooks: QueryExecutionHook[]): TClient =>
  instrumentClient(client, composeHooks(...hooks));

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
