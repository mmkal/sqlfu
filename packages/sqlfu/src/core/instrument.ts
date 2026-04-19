import {bindAsyncSql, bindSyncSql} from './sql.js';
import type {AsyncClient, Client, SqlQuery, SyncClient} from './types.js';

export type QueryOperation = 'all' | 'run';

export interface QueryExecutionContext {
  readonly query: SqlQuery;
  readonly operation: QueryOperation;
  readonly system: string;
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
  readonly context: QueryExecutionContext;
  readonly execute: () => TResult;
  readonly processResult: ProcessResult;
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
  return isAsyncClient(client)
    ? (instrumentAsync(client, hook) as TClient)
    : (instrumentSync(client as SyncClient, hook) as TClient);
}

/**
 * Run `hooks` left-to-right, each wrapping the next. The first hook is the
 * outermost — it sees the call before any others and gets the final result
 * or error last.
 */
export function composeHooks(...hooks: readonly QueryExecutionHook[]): QueryExecutionHook {
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
  readonly context: QueryExecutionContext;
  readonly error: unknown;
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
    all: (query) => hook(buildHookArgs({query, operation: 'all', system: client.system}, () => client.all(query))),
    run: (query) => hook(buildHookArgs({query, operation: 'run', system: client.system}, () => client.run(query))),
    raw: (sql) => client.raw(sql),
    iterate: (query) => client.iterate(query),
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
    all: (query) => hook(buildHookArgs({query, operation: 'all', system: client.system}, () => client.all(query))),
    run: (query) => hook(buildHookArgs({query, operation: 'run', system: client.system}, () => client.run(query))),
    raw: (sql) => client.raw(sql),
    iterate: (query) => client.iterate(query),
    transaction: (<TResult>(fn: (tx: SyncClient<TDriver>) => TResult) =>
      client.transaction((tx: SyncClient<TDriver>) =>
        fn(instrumentSync(tx, hook)),
      )) as SyncClient<TDriver>['transaction'],
    sql: undefined as unknown as SyncClient<TDriver>['sql'],
  };
  wrapped.sql = bindSyncSql(wrapped);
  return wrapped;
}

function isAsyncClient<TDriver>(client: Client<TDriver>): client is AsyncClient<TDriver> {
  // Adapters declare `all` as either a regular function (sync clients) or an
  // `async` function (async clients). The Function constructor name is the
  // cleanest side-effect-free discriminator.
  return client.all.constructor.name === 'AsyncFunction';
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return value != null && typeof (value as {then?: unknown}).then === 'function';
}
