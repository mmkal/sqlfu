import {mapSqliteDriverError, type MapError, type SqlfuError} from './errors.js';
import type {SqlQuery} from './types.js';

const rawSqlQuery: SqlQuery = {sql: '', args: []};

/**
 * Run `fn`; if it throws, rethrow as a `SqlfuError` normalized against the
 * given sqlite driver. The adapter passes its `system` and the active
 * query so the resulting `SqlfuError` carries enough context for error
 * reporters.
 */
export function runSqliteSync<TResult>(
  fn: () => TResult,
  context: {query: SqlQuery; system: string; mapError: MapError | undefined},
): TResult {
  try {
    return fn();
  } catch (error) {
    throw mapSqliteDriverError(error, {query: context.query, system: context.system}, context.mapError);
  }
}

export async function runSqliteAsync<TResult>(
  fn: () => Promise<TResult>,
  context: {query: SqlQuery; system: string; mapError: MapError | undefined},
): Promise<TResult> {
  try {
    return await fn();
  } catch (error) {
    throw mapSqliteDriverError(error, {query: context.query, system: context.system}, context.mapError);
  }
}

/**
 * `raw` takes a string of SQL rather than a `SqlQuery`. We still want an
 * error to carry *something* identifying. Use a synthetic query whose
 * `sql` is the raw input string.
 */
export function rawQueryContext(sql: string): SqlQuery {
  return {sql, args: rawSqlQuery.args};
}

// Re-exported for convenience from adapters.
export {type SqlfuError};
