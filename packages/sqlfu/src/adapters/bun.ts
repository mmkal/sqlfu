import {wrapSyncClientErrors} from '../adapter-errors.js';
import {bindSyncSql} from '../sql.js';
import {rawSqlWithSqlSplittingSync, surroundWithBeginCommitRollbackSync} from '../sqlite-text.js';
import type {ResultRow, SqlQuery, SyncClient} from '../types.js';

export interface BunSqliteStatementLike<TRow extends ResultRow = ResultRow> {
  all(...params: unknown[]): TRow[];
  iterate(...params: unknown[]): IterableIterator<TRow>;
}

export interface BunSqliteDatabaseLike {
  query<TRow extends ResultRow = ResultRow>(query: string): BunSqliteStatementLike<TRow>;
  run(
    query: string,
    params?: unknown[],
  ): {
    changes?: number;
    lastInsertRowid?: string | number | bigint | null;
  };
}

export function createBunClient(database: BunSqliteDatabaseLike): SyncClient<BunSqliteDatabaseLike> {
  const client: Omit<SyncClient<BunSqliteDatabaseLike>, 'sql'> & {sql: SyncClient<BunSqliteDatabaseLike>['sql']} = {
    driver: database,
    system: 'sqlite',
    sync: true,
    all<TRow extends ResultRow = ResultRow>(query: SqlQuery) {
      return database.query<TRow>(query.sql).all(...query.args);
    },
    run(query: SqlQuery) {
      const result = database.run(query.sql, [...query.args]);
      return {
        rowsAffected: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    },
    raw(sql: string) {
      return rawSqlWithSqlSplittingSync((singleQuery) => {
        const result = database.run(singleQuery.sql, [...singleQuery.args]);
        return {
          rowsAffected: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        };
      }, sql);
    },
    *iterate<TRow extends ResultRow = ResultRow>(query: SqlQuery) {
      yield* database.query<TRow>(query.sql).iterate(...query.args);
    },
    transaction<TResult>(fn: (tx: SyncClient<BunSqliteDatabaseLike>) => TResult | Promise<TResult>) {
      return surroundWithBeginCommitRollbackSync(client, fn);
    },
    sql: undefined as unknown as SyncClient<BunSqliteDatabaseLike>['sql'],
  } satisfies SyncClient<BunSqliteDatabaseLike>;

  client.sql = bindSyncSql(client);

  return wrapSyncClientErrors(client);
}

export const createBunDatabase = createBunClient;
