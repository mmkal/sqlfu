import {bindAsyncSql} from '../core/sql.js';
import {rawSqlWithSqlSplittingAsync, surroundWithBeginCommitRollbackAsync} from '../core/sqlite.js';
import type {AsyncClient, QueryArg, ResultRow, SqlQuery} from '../core/types.js';

export type SqliteWasmBindValue = string | number | bigint | Uint8Array | null;

export interface SqliteWasmExecOptions {
  readonly sql: string;
  readonly bind?: readonly SqliteWasmBindValue[] | Record<string, SqliteWasmBindValue> | undefined;
  readonly rowMode?: 'object' | 'array';
  readonly returnValue?: 'resultRows' | 'this';
}

export interface SqliteWasmDatabaseLike {
  exec(...args: any[]): unknown;
  selectValue(sql: string): unknown;
  changes(isTotal?: boolean, use64Bit?: boolean): number | bigint;
}

export function createSqliteWasmClient(database: SqliteWasmDatabaseLike): AsyncClient<SqliteWasmDatabaseLike> {
  const all: AsyncClient<SqliteWasmDatabaseLike>['all'] = async <TRow extends ResultRow = ResultRow>(
    query: SqlQuery,
  ) => {
    const rows = database.exec({
      sql: query.sql,
      bind: toPositionalBind(query.args),
      rowMode: 'object',
      returnValue: 'resultRows',
    });
    return (rows as TRow[] | undefined) ?? [];
  };
  const run: AsyncClient<SqliteWasmDatabaseLike>['run'] = async (query: SqlQuery) => {
    database.exec({
      sql: query.sql,
      bind: toPositionalBind(query.args),
    });
    return captureRunResult(database);
  };
  const raw: AsyncClient<SqliteWasmDatabaseLike>['raw'] = async (sql: string) => {
    return rawSqlWithSqlSplittingAsync(async (singleQuery) => {
      database.exec({
        sql: singleQuery.sql,
        bind: toPositionalBind(singleQuery.args),
      });
      return captureRunResult(database);
    }, sql);
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
    system: 'sqlite',
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

function toPositionalBind(args: readonly QueryArg[]): readonly SqliteWasmBindValue[] | undefined {
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
