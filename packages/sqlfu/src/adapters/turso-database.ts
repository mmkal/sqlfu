import {bindAsyncSql} from '../core/sql.js';
import {rawSqlWithSqlSplittingAsync, surroundWithBeginCommitRollbackAsync} from '../core/sqlite.js';
import type {AsyncClient, ResultRow, SqlQuery} from '../core/types.js';

export interface TursoDatabaseStatementLike<TRow extends ResultRow = ResultRow> {
  readonly reader: boolean;
  all(...params: readonly unknown[]): Promise<TRow[]>;
  iterate(...params: readonly unknown[]): AsyncIterable<TRow>;
  run(...params: readonly unknown[]): Promise<{
    readonly changes?: number;
    readonly lastInsertRowid?: string | number | bigint | null;
  }>;
}

export interface TursoDatabaseLike {
  prepare<TRow extends ResultRow = ResultRow>(sql: string): TursoDatabaseStatementLike<TRow>;
}

export function createTursoDatabaseClient<TDatabase extends TursoDatabaseLike>(
  database: TDatabase,
): AsyncClient<TDatabase> {
  const all: AsyncClient<TDatabase>['all'] = async <TRow extends ResultRow = ResultRow>(query: SqlQuery) => {
    return database.prepare<TRow>(query.sql).all(...query.args);
  };
  const run: AsyncClient<TDatabase>['run'] = async (query: SqlQuery) => {
    const result = await database.prepare(query.sql).run(...query.args);
    return {
      rowsAffected: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    };
  };
  const raw: AsyncClient<TDatabase>['raw'] = async (sql: string) => {
    return rawSqlWithSqlSplittingAsync(async (singleQuery) => {
      const result = await database.prepare(singleQuery.sql).run(...singleQuery.args);
      return {rowsAffected: result.changes, lastInsertRowid: result.lastInsertRowid};
    }, sql);
  };
  const iterate: AsyncClient<TDatabase>['iterate'] = async function* <TRow extends ResultRow = ResultRow>(
    query: SqlQuery,
  ) {
    yield* database.prepare<TRow>(query.sql).iterate(...query.args);
  };

  const client: Omit<AsyncClient<TDatabase>, 'sql'> & {sql: AsyncClient<TDatabase>['sql']} = {
    driver: database,
    system: 'sqlite',
    sync: false,
    all,
    run,
    raw,
    iterate,
    transaction<TResult>(fn: (tx: AsyncClient<TDatabase>) => Promise<TResult> | TResult) {
      return surroundWithBeginCommitRollbackAsync(client, fn);
    },
    sql: undefined as unknown as AsyncClient<TDatabase>['sql'],
  } satisfies AsyncClient<TDatabase>;

  client.sql = bindAsyncSql(client);

  return client;
}

export const createTursoDatabase = createTursoDatabaseClient;
export const createTursoSyncClient = createTursoDatabaseClient;
export const createTursoSync = createTursoDatabaseClient;
