import {wrapSyncClientErrors} from '../adapter-errors.js';
import {bindSyncSql} from '../sql.js';
import {rawSqlWithSqlSplittingSync, surroundWithBeginCommitRollbackSync} from '../sqlite-text.js';
import type {ResultRow, SqlQuery, SyncClient} from '../types.js';

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
  const client: Omit<SyncClient<LibsqlSyncDatabaseLike>, 'sql'> & {sql: SyncClient<LibsqlSyncDatabaseLike>['sql']} = {
    driver: database,
    system: 'sqlite',
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

  return wrapSyncClientErrors(client);
}

export const createLibsqlSyncDatabase = createLibsqlSyncClient;
