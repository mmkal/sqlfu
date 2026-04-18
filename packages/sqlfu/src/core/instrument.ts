import {spanNameFor} from './naming.js';
import {bindAsyncSql, bindSyncSql} from './sql.js';
import type {AsyncClient, Client, SqlQuery, SyncClient} from './types.js';

export type QueryOperation = 'all' | 'run';

export interface QueryExecutionContext {
  readonly query: SqlQuery;
  readonly operation: QueryOperation;
  readonly system: string;
}

export type QueryExecutionHook = <TResult>(
  context: QueryExecutionContext,
  execute: () => TResult,
) => TResult;

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
    return (_context, execute) => execute();
  }
  if (hooks.length === 1) {
    return hooks[0]!;
  }
  return <TResult>(context: QueryExecutionContext, execute: () => TResult): TResult => {
    let chained: () => TResult = execute;
    for (let index = hooks.length - 1; index >= 0; index -= 1) {
      const hook = hooks[index]!;
      const next = chained;
      chained = () => hook(context, next);
    }
    return chained();
  };
}

/**
 * Minimal OTel tracer shape. Authored structurally so consumers can pass a
 * real `Tracer` from `@opentelemetry/api` without sqlfu taking a peer dep.
 */
export interface TracerLike {
  startActiveSpan<TResult>(name: string, fn: (span: SpanLike) => TResult): TResult;
}

export interface SpanLike {
  setAttribute(key: string, value: string | number | boolean): unknown;
  recordException(exception: unknown): void;
  setStatus(status: {code: number; message?: string}): unknown;
  end(): void;
}

// OTel's SpanStatusCode: UNSET = 0, OK = 1, ERROR = 2. Hardcoded so the
// library doesn't need to import from @opentelemetry/api.
const OTEL_STATUS_OK = 1;
const OTEL_STATUS_ERROR = 2;

/**
 * Build a hook that emits an OTel span per query, populated with the
 * standard DB semantic attributes (`db.query.summary`, `db.query.text`,
 * `db.system.name`). Records exceptions and sets ERROR status on throw.
 */
export function createOtelHook(options: {readonly tracer: TracerLike}): QueryExecutionHook {
  const {tracer} = options;
  return <TResult>(context: QueryExecutionContext, execute: () => TResult): TResult => {
    const name = spanNameFor(context.query);
    return tracer.startActiveSpan(name, (span) => {
      if (context.query.name) {
        span.setAttribute('db.query.summary', context.query.name);
      }
      span.setAttribute('db.query.text', context.query.sql);
      span.setAttribute('db.system.name', context.system);

      const success = (result: TResult): TResult => {
        span.setStatus({code: OTEL_STATUS_OK});
        span.end();
        return result;
      };
      const failure = (error: unknown): never => {
        span.recordException(error);
        span.setStatus({code: OTEL_STATUS_ERROR, message: error instanceof Error ? error.message : String(error)});
        span.end();
        throw error;
      };

      try {
        const result = execute();
        if (isPromiseLike(result)) {
          return result.then(success, failure) as TResult;
        }
        return success(result);
      } catch (error) {
        return failure(error);
      }
    });
  };
}

/**
 * Build a hook that invokes `report` whenever a query throws (or its
 * promise rejects). The error is always rethrown; `report`'s return value
 * is discarded and any promise it returns is not awaited.
 *
 * Useful for Sentry-style error capture without pulling Sentry into the
 * library: `createErrorReporterHook((ctx, err) => Sentry.captureException(err, { tags: { 'db.query.summary': ctx.query.name ?? 'sql' } }))`.
 */
export function createErrorReporterHook(
  report: (context: QueryExecutionContext, error: unknown) => unknown,
): QueryExecutionHook {
  return <TResult>(context: QueryExecutionContext, execute: () => TResult): TResult => {
    try {
      const result = execute();
      if (isPromiseLike(result)) {
        return result.then(
          (value) => value,
          (error: unknown) => {
            try {
              report(context, error);
            } catch {
              // the error handler itself failing shouldn't mask the original error
            }
            throw error;
          },
        ) as TResult;
      }
      return result;
    } catch (error) {
      try {
        report(context, error);
      } catch {}
      throw error;
    }
  };
}

function instrumentAsync<TDriver>(client: AsyncClient<TDriver>, hook: QueryExecutionHook): AsyncClient<TDriver> {
  const wrapped: Omit<AsyncClient<TDriver>, 'sql'> & {sql: AsyncClient<TDriver>['sql']} = {
    driver: client.driver,
    system: client.system,
    all: (query) => hook({query, operation: 'all', system: client.system}, () => client.all(query)),
    run: (query) => hook({query, operation: 'run', system: client.system}, () => client.run(query)),
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
    all: (query) => hook({query, operation: 'all', system: client.system}, () => client.all(query)),
    run: (query) => hook({query, operation: 'run', system: client.system}, () => client.run(query)),
    raw: (sql) => client.raw(sql),
    iterate: (query) => client.iterate(query),
    transaction: (<TResult>(fn: (tx: SyncClient<TDriver>) => TResult) =>
      client.transaction((tx: SyncClient<TDriver>) => fn(instrumentSync(tx, hook)))) as SyncClient<TDriver>['transaction'],
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
