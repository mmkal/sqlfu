import {wrapAsyncClientErrors} from '../adapter-errors.js';
import {bindAsyncSql} from '../sql.js';
import {rawSqlWithSqlSplittingAsync, surroundWithBeginCommitRollbackAsync} from '../sqlite-text.js';
import type {
  AsyncClient,
  PreparedStatement,
  PreparedStatementParams,
  QueryArg,
  ResultRow,
  SqlQuery,
} from '../types.js';

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
  const prepare: AsyncClient<SqliteWasmDatabaseLike>['prepare'] = <TRow extends ResultRow = ResultRow>(
    sql: string,
  ): PreparedStatement<TRow> => {
    // sqlite-wasm exposes a low-level cursor `Stmt` via `db.prepare(sql)`, but
    // wrapping it would expand the structural `SqliteWasmDatabaseLike`
    // interface and require manual finalize/step plumbing in error paths.
    // Instead this shim captures the SQL and re-issues `db.exec` per call.
    // The wasm runtime caches parsed statements internally, so repeated exec
    // of the same SQL doesn't re-parse at the C level — sqlfu just doesn't
    // hold a native handle. Named params flow through wasm's native `bind`
    // shape (it accepts `Record` directly).
    return {
      async all(params) {
        const rows = database.exec({
          sql,
          bind: toBind(params),
          rowMode: 'object',
          returnValue: 'resultRows',
        });
        return (rows as TRow[] | undefined) ?? [];
      },
      async run(params) {
        database.exec({
          sql,
          bind: toBind(params),
        });
        return captureRunResult(database);
      },
      async *iterate(params) {
        const rows = database.exec({
          sql,
          bind: toBind(params),
          rowMode: 'object',
          returnValue: 'resultRows',
        });
        for (const row of (rows as TRow[] | undefined) ?? []) {
          yield row;
        }
      },
      async [Symbol.asyncDispose]() {},
    };
  };
  const client: Omit<AsyncClient<SqliteWasmDatabaseLike>, 'sql'> & {sql: AsyncClient<SqliteWasmDatabaseLike>['sql']} = {
    driver: database,
    system: 'sqlite',
    sync: false,
    all,
    run,
    raw,
    iterate,
    prepare,
    async transaction<TResult>(fn: (tx: AsyncClient<SqliteWasmDatabaseLike>) => Promise<TResult> | TResult) {
      return surroundWithBeginCommitRollbackAsync(client, fn);
    },
    sql: undefined as unknown as AsyncClient<SqliteWasmDatabaseLike>['sql'],
  } satisfies AsyncClient<SqliteWasmDatabaseLike>;

  client.sql = bindAsyncSql(client);

  return wrapAsyncClientErrors(client);
}

export const createSqliteWasmDatabase = createSqliteWasmClient;

function toPositionalBind(args: QueryArg[]): SqliteWasmBindValue[] | undefined {
  if (args.length === 0) {
    return undefined;
  }
  return args.map(coerceBindValue);
}

function toBind(
  params: PreparedStatementParams | undefined,
): SqliteWasmBindValue[] | Record<string, SqliteWasmBindValue> | undefined {
  if (params == null) return undefined;
  if (Array.isArray(params)) return toPositionalBind(params as QueryArg[]);
  const out: Record<string, SqliteWasmBindValue> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key.startsWith(':') || key.startsWith('$') || key.startsWith('@') ? key : `:${key}`] =
      coerceBindValue(value as QueryArg);
  }
  return out;
}

function coerceBindValue(value: QueryArg): SqliteWasmBindValue {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return value;
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
