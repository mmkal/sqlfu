import {rawQueryContext, runSqliteSync} from '../core/adapter-errors.js';
import type {MapError} from '../core/errors.js';
import {bindSyncSql} from '../core/sql.js';
import {rawSqlWithSqlSplittingSync, surroundWithBeginCommitRollbackSync} from '../core/sqlite.js';
import type {ResultRow, SqlQuery, SyncClient} from '../core/types.js';

export interface LibsqlSyncStatementLike {
  reader: boolean;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): {
    changes?: number;
    lastInsertRowid?: string | number | bigint | null;
  };
}

export interface LibsqlSyncDatabaseLike {
  prepare(query: string): LibsqlSyncStatementLike;
}

export interface LibsqlSyncClientOptions {
  mapError?: MapError;
}

export function createLibsqlSyncClient(
  database: LibsqlSyncDatabaseLike,
  options: LibsqlSyncClientOptions = {},
): SyncClient<LibsqlSyncDatabaseLike> {
  const {mapError} = options;
  const system = 'sqlite';
  const all: SyncClient<LibsqlSyncDatabaseLike>['all'] = <TRow extends ResultRow = ResultRow>(query: SqlQuery) => {
    return runSqliteSync(() => database.prepare(query.sql).all(...query.args) as TRow[], {query, system, mapError});
  };
  const run: SyncClient<LibsqlSyncDatabaseLike>['run'] = (query: SqlQuery) => {
    return runSqliteSync(
      () => {
        const statement = database.prepare(query.sql);
        const result = statement.run(...query.args);
        return {
          rowsAffected: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        };
      },
      {query, system, mapError},
    );
  };
  const raw: SyncClient<LibsqlSyncDatabaseLike>['raw'] = (sql: string) => {
    return runSqliteSync(
      () =>
        rawSqlWithSqlSplittingSync((singleQuery) => {
          const statement = database.prepare(singleQuery.sql);
          const result = statement.run(...singleQuery.args);
          return {
            rowsAffected: result.changes,
            lastInsertRowid: result.lastInsertRowid,
          };
        }, sql),
      {query: rawQueryContext(sql), system, mapError},
    );
  };
  const iterate: SyncClient<LibsqlSyncDatabaseLike>['iterate'] = function* <TRow extends ResultRow = ResultRow>(
    query: SqlQuery,
  ) {
    yield* all<TRow>(query);
  };
  const client: Omit<SyncClient<LibsqlSyncDatabaseLike>, 'sql'> & {sql: SyncClient<LibsqlSyncDatabaseLike>['sql']} = {
    driver: database,
    system,
    sync: true,
    all,
    run,
    raw,
    iterate,
    transaction<TResult>(fn: (tx: SyncClient<LibsqlSyncDatabaseLike>) => TResult | Promise<TResult>) {
      return surroundWithBeginCommitRollbackSync(client, fn);
    },
    sql: undefined as unknown as SyncClient<LibsqlSyncDatabaseLike>['sql'],
  } satisfies SyncClient<LibsqlSyncDatabaseLike>;

  client.sql = bindSyncSql(client);

  return client;
}

export const createLibsqlSyncDatabase = createLibsqlSyncClient;
