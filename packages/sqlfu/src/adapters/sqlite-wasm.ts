import {rawQueryContext, runSqliteAsync} from '../core/adapter-errors.js';
import type {MapError} from '../core/errors.js';
import {bindAsyncSql} from '../core/sql.js';
import {rawSqlWithSqlSplittingAsync, surroundWithBeginCommitRollbackAsync} from '../core/sqlite.js';
import type {AsyncClient, QueryArg, ResultRow, SqlQuery} from '../core/types.js';

export type SqliteWasmBindValue = string | number | bigint | Uint8Array | null;

export interface SqliteWasmExecOptions {
  sql: string;
  bind?: SqliteWasmBindValue[] | Record<string, SqliteWasmBindValue> | undefined;
  rowMode?: 'object' | 'array';
  returnValue?: 'resultRows' | 'this';
}

export interface SqliteWasmDatabaseLike {
  exec(...args: any[]): unknown;
  selectValue(sql: string): unknown;
  changes(isTotal?: boolean, use64Bit?: boolean): number | bigint;
}

export interface SqliteWasmClientOptions {
  mapError?: MapError;
}

export function createSqliteWasmClient(
  database: SqliteWasmDatabaseLike,
  options: SqliteWasmClientOptions = {},
): AsyncClient<SqliteWasmDatabaseLike> {
  const {mapError} = options;
  const system = 'sqlite';
  const all: AsyncClient<SqliteWasmDatabaseLike>['all'] = <TRow extends ResultRow = ResultRow>(query: SqlQuery) => {
    return runSqliteAsync(
      async () => {
        const rows = database.exec({
          sql: query.sql,
          bind: toPositionalBind(query.args),
          rowMode: 'object',
          returnValue: 'resultRows',
        });
        return (rows as TRow[] | undefined) ?? [];
      },
      {query, system, mapError},
    );
  };
  const run: AsyncClient<SqliteWasmDatabaseLike>['run'] = (query: SqlQuery) => {
    return runSqliteAsync(
      async () => {
        database.exec({
          sql: query.sql,
          bind: toPositionalBind(query.args),
        });
        return captureRunResult(database);
      },
      {query, system, mapError},
    );
  };
  const raw: AsyncClient<SqliteWasmDatabaseLike>['raw'] = (sql: string) => {
    return runSqliteAsync(
      () =>
        rawSqlWithSqlSplittingAsync(async (singleQuery) => {
          database.exec({
            sql: singleQuery.sql,
            bind: toPositionalBind(singleQuery.args),
          });
          return captureRunResult(database);
        }, sql),
      {query: rawQueryContext(sql), system, mapError},
    );
  };
  const iterate: AsyncClient<SqliteWasmDatabaseLike>['iterate'] = async function* <TRow extends ResultRow = ResultRow>(
    query: SqlQuery,
  ) {
    const rows = await all<TRow>(query);
    for (const row of rows) {
      yield row;
    }
  };
  const client: Omit<AsyncClient<SqliteWasmDatabaseLike>, 'sql'> & {sql: AsyncClient<SqliteWasmDatabaseLike>['sql']} = {
    driver: database,
    system,
    sync: false,
    all,
    run,
    raw,
    iterate,
    async transaction<TResult>(fn: (tx: AsyncClient<SqliteWasmDatabaseLike>) => Promise<TResult> | TResult) {
      return surroundWithBeginCommitRollbackAsync(client, fn);
    },
    sql: undefined as unknown as AsyncClient<SqliteWasmDatabaseLike>['sql'],
  } satisfies AsyncClient<SqliteWasmDatabaseLike>;

  client.sql = bindAsyncSql(client);

  return client;
}

export const createSqliteWasmDatabase = createSqliteWasmClient;

function toPositionalBind(args: QueryArg[]): SqliteWasmBindValue[] | undefined {
  if (args.length === 0) {
    return undefined;
  }
  return args.map((value) => {
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    return value;
  });
}

function captureRunResult(database: SqliteWasmDatabaseLike) {
  const lastInsertRowidValue = database.selectValue('select last_insert_rowid() as value');
  const rowsAffected = Number(database.changes(false, false) ?? 0);
  const lastInsertRowid =
    typeof lastInsertRowidValue === 'bigint'
      ? Number(lastInsertRowidValue)
      : ((lastInsertRowidValue as number | null | undefined) ?? null);
  return {rowsAffected, lastInsertRowid};
}
