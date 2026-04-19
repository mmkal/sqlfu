import {bindAsyncSql} from '../core/sql.js';
import {rawSqlWithSqlSplittingAsync, surroundWithBeginCommitRollbackAsync} from '../core/sqlite.js';
import type {AsyncClient, ResultRow, SqlQuery} from '../core/types.js';

export interface ExpoSqliteRunResult {
  readonly changes?: number;
  readonly lastInsertRowId?: string | number | bigint | null;
}

export interface ExpoSqliteDatabaseLike {
  getAllAsync<TRow extends ResultRow = ResultRow>(source: string, params?: readonly unknown[]): Promise<TRow[]>;
  getEachAsync<TRow extends ResultRow = ResultRow>(source: string, params?: readonly unknown[]): AsyncIterableIterator<TRow>;
  runAsync(source: string, params?: readonly unknown[]): Promise<ExpoSqliteRunResult>;
}

export function createExpoSqliteClient(database: ExpoSqliteDatabaseLike): AsyncClient<ExpoSqliteDatabaseLike> {
  const all: AsyncClient<ExpoSqliteDatabaseLike>['all'] = async <TRow extends ResultRow = ResultRow>(query: SqlQuery) => {
    return database.getAllAsync<TRow>(query.sql, [...query.args]);
  };
  const run: AsyncClient<ExpoSqliteDatabaseLike>['run'] = async (query: SqlQuery) => {
    const result = await database.runAsync(query.sql, [...query.args]);
    return {
      rowsAffected: result.changes,
      lastInsertRowid: result.lastInsertRowId,
    };
  };
  const raw: AsyncClient<ExpoSqliteDatabaseLike>['raw'] = async (sql: string) => {
    return rawSqlWithSqlSplittingAsync(async (singleQuery) => {
      const result = await database.runAsync(singleQuery.sql, [...singleQuery.args]);
      return {
        rowsAffected: result.changes,
        lastInsertRowid: result.lastInsertRowId,
      };
    }, sql);
  };
  const iterate: AsyncClient<ExpoSqliteDatabaseLike>['iterate'] = async function* <TRow extends ResultRow = ResultRow>(query: SqlQuery) {
    for await (const row of database.getEachAsync<TRow>(query.sql, [...query.args])) {
      yield row;
    }
  };
  const client: Omit<AsyncClient<ExpoSqliteDatabaseLike>, 'sql'> & {sql: AsyncClient<ExpoSqliteDatabaseLike>['sql']} = {
    driver: database,
    system: 'sqlite',
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
