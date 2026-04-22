import {bindAsyncSql} from '../core/sql.js';
import {rawSqlWithSqlSplittingAsync, surroundWithBeginCommitRollbackAsync} from '../core/sqlite.js';
import type {AsyncClient, ResultRow, SqlQuery} from '../core/types.js';

export interface LibsqlClientLike {
  execute<TRow extends ResultRow = ResultRow>(
    statement: string | {sql: string; args?: unknown[]},
  ): Promise<{
    rows: TRow[];
    rowsAffected?: number;
    lastInsertRowid?: string | number | bigint | null;
  }>;
}

export function createLibsqlClient(client: LibsqlClientLike): AsyncClient<LibsqlClientLike> {
  const all: AsyncClient<LibsqlClientLike>['all'] = async <TRow extends ResultRow = ResultRow>(sqlQuery: SqlQuery) => {
    const result = await client.execute<TRow>(toStatement(sqlQuery));
    return result.rows.map(materializeRow);
  };
  const run: AsyncClient<LibsqlClientLike>['run'] = async (sqlQuery: SqlQuery) => {
    const result = await client.execute(toStatement(sqlQuery));
    return {
      rowsAffected: result.rowsAffected,
      lastInsertRowid: result.lastInsertRowid,
    };
  };
  const raw: AsyncClient<LibsqlClientLike>['raw'] = async (sql: string) => {
    return rawSqlWithSqlSplittingAsync(async (singleQuery) => {
      const result = await client.execute(toStatement(singleQuery));
      return {
        rowsAffected: result.rowsAffected,
        lastInsertRowid: result.lastInsertRowid,
      };
    }, sql);
  };
  const iterate: AsyncClient<LibsqlClientLike>['iterate'] = async function* <TRow extends ResultRow = ResultRow>(
    sqlQuery: SqlQuery,
  ) {
    for (const row of await all<TRow>(sqlQuery)) {
      yield row;
    }
  };
  const queryClient: Omit<AsyncClient<LibsqlClientLike>, 'sql'> & {sql: AsyncClient<LibsqlClientLike>['sql']} = {
    driver: client,
    system: 'sqlite',
    sync: false,
    all,
    run,
    raw,
    iterate,
    async transaction<TResult>(fn: (tx: AsyncClient<LibsqlClientLike>) => Promise<TResult> | TResult) {
      return surroundWithBeginCommitRollbackAsync(queryClient, fn);
    },
    sql: undefined as unknown as AsyncClient<LibsqlClientLike>['sql'],
  } satisfies AsyncClient<LibsqlClientLike>;

  queryClient.sql = bindAsyncSql(queryClient);

  return queryClient;
}

export const createLibsqlDatabase = createLibsqlClient;

function toStatement(query: SqlQuery): {sql: string; args: unknown[]} {
  return {
    sql: query.sql,
    args: [...query.args],
  };
}

function materializeRow<TRow extends ResultRow>(row: TRow): TRow {
  return {...row};
}
