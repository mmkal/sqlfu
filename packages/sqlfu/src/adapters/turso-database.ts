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

export interface TursoDatabaseStatementLike<TRow extends ResultRow = ResultRow> {
  reader: boolean;
  all(...params: unknown[]): Promise<TRow[]>;
  iterate(...params: unknown[]): AsyncIterable<TRow>;
  run(...params: unknown[]): Promise<{
    changes?: number;
    lastInsertRowid?: string | number | bigint | null;
  }>;
  /** Optional. Native turso statements expose `finalize` to release the underlying handle. */
  finalize?(): void;
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
  const prepare: AsyncClient<TDatabase>['prepare'] = <TRow extends ResultRow = ResultRow>(
    sql: string,
  ): PreparedStatement<TRow> => {
    // Turso's native prepared statement (the same shape as better-sqlite3 over
    // the wire — positional spread for `?`, single named-param object for
    // `:name`).
    const statement = database.prepare<TRow>(sql);
    return {
      async all(params) {
        return statement.all(...bindArgs(params));
      },
      async run(params) {
        const result = await statement.run(...bindArgs(params));
        return {
          rowsAffected: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        };
      },
      async *iterate(params) {
        yield* statement.iterate(...bindArgs(params));
      },
      async [Symbol.asyncDispose]() {
        statement.finalize?.();
      },
    };
  };

  const client: Omit<AsyncClient<TDatabase>, 'sql'> & {sql: AsyncClient<TDatabase>['sql']} = {
    driver: database,
    system: 'sqlite',
    sync: false,
    all,
    run,
    raw,
    iterate,
    prepare,
    transaction<TResult>(fn: (tx: AsyncClient<TDatabase>) => Promise<TResult> | TResult) {
      return surroundWithBeginCommitRollbackAsync(client, fn);
    },
    sql: undefined as unknown as AsyncClient<TDatabase>['sql'],
  } satisfies AsyncClient<TDatabase>;

  client.sql = bindAsyncSql(client);

  return wrapAsyncClientErrors(client);
}

export const createTursoDatabase = createTursoDatabaseClient;
export const createTursoSyncClient = createTursoDatabaseClient;
export const createTursoSync = createTursoDatabaseClient;

function bindArgs(params: PreparedStatementParams | undefined): unknown[] {
  if (params == null) return [];
  if (Array.isArray(params)) return params;
  return [params];
}
