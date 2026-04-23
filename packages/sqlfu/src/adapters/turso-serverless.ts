import {wrapAsyncClientErrors} from '../adapter-errors.js';
import {bindAsyncSql} from '../sql.js';
import {rawSqlWithSqlSplittingAsync, surroundWithBeginCommitRollbackAsync} from '../sqlite-text.js';
import type {AsyncClient, ResultRow, SqlQuery} from '../types.js';

// @tursodatabase/serverless returns rows as arrays with column names attached as non-enumerable
// properties (see `createRowObject` in the upstream session implementation). we use the
// enumerable `columns` array to re-materialize rows as plain `{col: value}` objects so downstream
// consumers get a normal shape.
export interface TursoServerlessConnectionLike {
  execute(
    sql: string,
    args?: unknown[],
  ): Promise<{
    columns: string[];
    rows: unknown[];
    rowsAffected?: number;
    lastInsertRowid?: string | number | bigint | null;
  }>;
}

export function createTursoServerlessClient<TConnection extends TursoServerlessConnectionLike>(
  connection: TConnection,
): AsyncClient<TConnection> {
  const all: AsyncClient<TConnection>['all'] = async <TRow extends ResultRow = ResultRow>(query: SqlQuery) => {
    const result = await connection.execute(query.sql, [...query.args]);
    return result.rows.map((row) => materializeRow<TRow>(row, result.columns));
  };
  const run: AsyncClient<TConnection>['run'] = async (query: SqlQuery) => {
    const result = await connection.execute(query.sql, [...query.args]);
    return {
      rowsAffected: result.rowsAffected,
      lastInsertRowid: result.lastInsertRowid,
    };
  };
  const raw: AsyncClient<TConnection>['raw'] = async (sql: string) => {
    return rawSqlWithSqlSplittingAsync(async (singleQuery) => {
      const result = await connection.execute(singleQuery.sql, [...singleQuery.args]);
      return {rowsAffected: result.rowsAffected, lastInsertRowid: result.lastInsertRowid};
    }, sql);
  };
  const iterate: AsyncClient<TConnection>['iterate'] = async function* <TRow extends ResultRow = ResultRow>(
    query: SqlQuery,
  ) {
    for (const row of await all<TRow>(query)) {
      yield row;
    }
  };

  const client: Omit<AsyncClient<TConnection>, 'sql'> & {sql: AsyncClient<TConnection>['sql']} = {
    driver: connection,
    system: 'sqlite',
    sync: false,
    all,
    run,
    raw,
    iterate,
    transaction<TResult>(fn: (tx: AsyncClient<TConnection>) => Promise<TResult> | TResult) {
      return surroundWithBeginCommitRollbackAsync(client, fn);
    },
    sql: undefined as unknown as AsyncClient<TConnection>['sql'],
  } satisfies AsyncClient<TConnection>;

  client.sql = bindAsyncSql(client);

  return wrapAsyncClientErrors(client);
}

export const createTursoServerless = createTursoServerlessClient;
export const createTursoServerlessConnection = createTursoServerlessClient;

function materializeRow<TRow extends ResultRow>(row: unknown, columns: string[]): TRow {
  const values = row as unknown[];
  const out: Record<string, unknown> = {};
  for (let i = 0; i < columns.length; i++) {
    out[columns[i]!] = values[i];
  }
  return out as TRow;
}
