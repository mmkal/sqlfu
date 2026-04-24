import {wrapSyncClientErrors} from '../adapter-errors.js';
import {bindSyncSql} from '../sql.js';
import {rawSqlWithSqlSplittingSync, surroundWithBeginCommitRollbackSync} from '../sqlite-text.js';
import type {
  PreparedStatementParams,
  ResultRow,
  SqlQuery,
  SyncClient,
  SyncPreparedStatement,
} from '../types.js';

export interface LibsqlSyncStatementLike {
  reader: boolean;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): {
    changes?: number;
    lastInsertRowid?: string | number | bigint | null;
  };
  /** Optional. libsql sync statements expose `finalize` to release the underlying handle. */
  finalize?(): void;
}

export interface LibsqlSyncDatabaseLike {
  prepare(query: string): LibsqlSyncStatementLike;
}

export function createLibsqlSyncClient(database: LibsqlSyncDatabaseLike): SyncClient<LibsqlSyncDatabaseLike> {
  const all: SyncClient<LibsqlSyncDatabaseLike>['all'] = <TRow extends ResultRow = ResultRow>(query: SqlQuery) => {
    return database.prepare(query.sql).all(...query.args) as TRow[];
  };
  const run: SyncClient<LibsqlSyncDatabaseLike>['run'] = (query: SqlQuery) => {
    const statement = database.prepare(query.sql);
    const result = statement.run(...query.args);
    return {
      rowsAffected: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    };
  };
  const raw: SyncClient<LibsqlSyncDatabaseLike>['raw'] = (sql: string) => {
    return rawSqlWithSqlSplittingSync((singleQuery) => {
      const statement = database.prepare(singleQuery.sql);
      const result = statement.run(...singleQuery.args);
      return {
        rowsAffected: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    }, sql);
  };
  const iterate: SyncClient<LibsqlSyncDatabaseLike>['iterate'] = function* <TRow extends ResultRow = ResultRow>(
    query: SqlQuery,
  ) {
    yield* all<TRow>(query);
  };
  const prepare: SyncClient<LibsqlSyncDatabaseLike>['prepare'] = <TRow extends ResultRow = ResultRow>(
    sql: string,
  ): SyncPreparedStatement<TRow> => {
    // libsql's sync `Statement` mirrors better-sqlite3's: positional spread
    // for `?`-style placeholders, single named-param object for `:name`-style.
    const statement = database.prepare(sql);
    return {
      all(params) {
        return statement.all(...bindArgs(params)) as TRow[];
      },
      run(params) {
        const result = statement.run(...bindArgs(params));
        return {
          rowsAffected: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        };
      },
      *iterate(params) {
        yield* statement.all(...bindArgs(params)) as TRow[];
      },
      [Symbol.dispose]() {
        statement.finalize?.();
      },
    };
  };
  const client: Omit<SyncClient<LibsqlSyncDatabaseLike>, 'sql'> & {sql: SyncClient<LibsqlSyncDatabaseLike>['sql']} = {
    driver: database,
    system: 'sqlite',
    sync: true,
    all,
    run,
    raw,
    iterate,
    prepare,
    transaction<TResult>(fn: (tx: SyncClient<LibsqlSyncDatabaseLike>) => TResult | Promise<TResult>) {
      return surroundWithBeginCommitRollbackSync(client, fn);
    },
    sql: undefined as unknown as SyncClient<LibsqlSyncDatabaseLike>['sql'],
  } satisfies SyncClient<LibsqlSyncDatabaseLike>;

  client.sql = bindSyncSql(client);

  return wrapSyncClientErrors(client);
}

export const createLibsqlSyncDatabase = createLibsqlSyncClient;

function bindArgs(params: PreparedStatementParams | undefined): unknown[] {
  if (params == null) return [];
  if (Array.isArray(params)) return params;
  return [params];
}
