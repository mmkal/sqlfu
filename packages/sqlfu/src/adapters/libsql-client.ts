import {wrapAsyncClientErrors} from '../adapter-errors.js';
import {bindAsyncSql} from '../sql.js';
import {rawSqlWithSqlSplittingAsync, surroundWithBeginCommitRollbackAsync} from '../sqlite-text.js';
import type {
  AsyncClient,
  PreparedStatement,
  PreparedStatementParams,
  ResultRow,
  SqlQuery,
} from '../types.js';

export interface LibsqlClientLike {
  execute<TRow extends ResultRow = ResultRow>(
    statement: string | {sql: string; args?: unknown[] | Record<string, unknown>},
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
  const prepare: AsyncClient<LibsqlClientLike>['prepare'] = <TRow extends ResultRow = ResultRow>(
    sql: string,
  ): PreparedStatement<TRow> => {
    // libsql-client (the async over-the-wire client) has no prepared-statement
    // concept on the client side — every `execute` round-trips a parsed
    // statement to the server. This shim captures the SQL string and re-issues
    // `execute` on each call; libsql's `args` accepts either positional arrays
    // or named-param `Record`s natively, so no tokenization is needed.
    return {
      async all(params) {
        const result = await client.execute<TRow>({sql, args: toArgs(params)});
        return result.rows.map(materializeRow);
      },
      async run(params) {
        const result = await client.execute({sql, args: toArgs(params)});
        return {
          rowsAffected: result.rowsAffected,
          lastInsertRowid: result.lastInsertRowid,
        };
      },
      async *iterate(params) {
        const result = await client.execute<TRow>({sql, args: toArgs(params)});
        for (const row of result.rows) {
          yield materializeRow(row);
        }
      },
      async [Symbol.asyncDispose]() {},
    };
  };
  const queryClient: Omit<AsyncClient<LibsqlClientLike>, 'sql'> & {sql: AsyncClient<LibsqlClientLike>['sql']} = {
    driver: client,
    system: 'sqlite',
    sync: false,
    all,
    run,
    raw,
    iterate,
    prepare,
    async transaction<TResult>(fn: (tx: AsyncClient<LibsqlClientLike>) => Promise<TResult> | TResult) {
      return surroundWithBeginCommitRollbackAsync(queryClient, fn);
    },
    sql: undefined as unknown as AsyncClient<LibsqlClientLike>['sql'],
  } satisfies AsyncClient<LibsqlClientLike>;

  queryClient.sql = bindAsyncSql(queryClient);

  return wrapAsyncClientErrors(queryClient);
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

function toArgs(params: PreparedStatementParams | undefined): unknown[] | Record<string, unknown> {
  if (params == null) return [];
  if (Array.isArray(params)) return [...params];
  return params;
}
