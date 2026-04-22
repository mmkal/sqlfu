import {rawQueryContext, runSqliteAsync} from '../core/adapter-errors.js';
import type {MapError} from '../core/errors.js';
import {bindAsyncSql} from '../core/sql.js';
import {rawSqlWithSqlSplittingAsync, surroundWithBeginCommitRollbackAsync} from '../core/sqlite.js';
import type {AsyncClient, ResultRow, SqlQuery} from '../core/types.js';

export interface ExpoSqliteRunResult {
  changes?: number;
  lastInsertRowId?: string | number | bigint | null;
}

export interface ExpoSqliteDatabaseLike {
  getAllAsync<TRow extends ResultRow = ResultRow>(source: string, params?: unknown[]): Promise<TRow[]>;
  getEachAsync<TRow extends ResultRow = ResultRow>(
    source: string,
    params?: unknown[],
  ): AsyncIterableIterator<TRow>;
  runAsync(source: string, params?: unknown[]): Promise<ExpoSqliteRunResult>;
}

export interface ExpoSqliteClientOptions {
  mapError?: MapError;
}

export function createExpoSqliteClient(
  database: ExpoSqliteDatabaseLike,
  options: ExpoSqliteClientOptions = {},
): AsyncClient<ExpoSqliteDatabaseLike> {
  const {mapError} = options;
  const system = 'sqlite';
  const all: AsyncClient<ExpoSqliteDatabaseLike>['all'] = <TRow extends ResultRow = ResultRow>(query: SqlQuery) => {
    return runSqliteAsync(() => database.getAllAsync<TRow>(query.sql, [...query.args]), {query, system, mapError});
  };
  const run: AsyncClient<ExpoSqliteDatabaseLike>['run'] = (query: SqlQuery) => {
    return runSqliteAsync(
      async () => {
        const result = await database.runAsync(query.sql, [...query.args]);
        return {
          rowsAffected: result.changes,
          lastInsertRowid: result.lastInsertRowId,
        };
      },
      {query, system, mapError},
    );
  };
  const raw: AsyncClient<ExpoSqliteDatabaseLike>['raw'] = (sql: string) => {
    return runSqliteAsync(
      () =>
        rawSqlWithSqlSplittingAsync(async (singleQuery) => {
          const result = await database.runAsync(singleQuery.sql, [...singleQuery.args]);
          return {
            rowsAffected: result.changes,
            lastInsertRowid: result.lastInsertRowId,
          };
        }, sql),
      {query: rawQueryContext(sql), system, mapError},
    );
  };
  const iterate: AsyncClient<ExpoSqliteDatabaseLike>['iterate'] = async function* <TRow extends ResultRow = ResultRow>(
    query: SqlQuery,
  ) {
    const iterator = database.getEachAsync<TRow>(query.sql, [...query.args]);
    while (true) {
      const next = await runSqliteAsync(() => iterator.next(), {query, system, mapError});
      if (next.done) return;
      yield next.value;
    }
  };
  const client: Omit<AsyncClient<ExpoSqliteDatabaseLike>, 'sql'> & {sql: AsyncClient<ExpoSqliteDatabaseLike>['sql']} = {
    driver: database,
    system,
    sync: false,
    all,
    run,
    raw,
    iterate,
    async transaction<TResult>(fn: (tx: AsyncClient<ExpoSqliteDatabaseLike>) => Promise<TResult> | TResult) {
      return surroundWithBeginCommitRollbackAsync(client, fn);
    },
    sql: undefined as unknown as AsyncClient<ExpoSqliteDatabaseLike>['sql'],
  } satisfies AsyncClient<ExpoSqliteDatabaseLike>;

  client.sql = bindAsyncSql(client);

  return client;
}

export const createExpoSqliteDatabase = createExpoSqliteClient;
