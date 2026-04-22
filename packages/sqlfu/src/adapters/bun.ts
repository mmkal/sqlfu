import {rawQueryContext, runSqliteSync} from '../core/adapter-errors.js';
import type {MapError} from '../core/errors.js';
import {bindSyncSql} from '../core/sql.js';
import {rawSqlWithSqlSplittingSync, surroundWithBeginCommitRollbackSync} from '../core/sqlite.js';
import type {ResultRow, SqlQuery, SyncClient} from '../core/types.js';

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

export interface BunClientOptions {
  mapError?: MapError;
}

export function createBunClient(
  database: BunSqliteDatabaseLike,
  options: BunClientOptions = {},
): SyncClient<BunSqliteDatabaseLike> {
  const {mapError} = options;
  const system = 'sqlite';
  const client: Omit<SyncClient<BunSqliteDatabaseLike>, 'sql'> & {sql: SyncClient<BunSqliteDatabaseLike>['sql']} = {
    driver: database,
    system,
    sync: true,
    all<TRow extends ResultRow = ResultRow>(query: SqlQuery) {
      return runSqliteSync(() => database.query<TRow>(query.sql).all(...query.args), {query, system, mapError});
    },
    run(query: SqlQuery) {
      return runSqliteSync(
        () => {
          const result = database.run(query.sql, [...query.args]);
          return {
            rowsAffected: result.changes,
            lastInsertRowid: result.lastInsertRowid,
          };
        },
        {query, system, mapError},
      );
    },
    raw(sql: string) {
      return runSqliteSync(
        () =>
          rawSqlWithSqlSplittingSync((singleQuery) => {
            const result = database.run(singleQuery.sql, [...singleQuery.args]);
            return {
              rowsAffected: result.changes,
              lastInsertRowid: result.lastInsertRowid,
            };
          }, sql),
        {query: rawQueryContext(sql), system, mapError},
      );
    },
    *iterate<TRow extends ResultRow = ResultRow>(query: SqlQuery) {
      const iterator = runSqliteSync(() => database.query<TRow>(query.sql).iterate(...query.args), {
        query,
        system,
        mapError,
      });
      while (true) {
        const next = runSqliteSync(() => iterator.next(), {query, system, mapError});
        if (next.done) return;
        yield next.value;
      }
    },
    transaction<TResult>(fn: (tx: SyncClient<BunSqliteDatabaseLike>) => TResult | Promise<TResult>) {
      return surroundWithBeginCommitRollbackSync(client, fn);
    },
    sql: undefined as unknown as SyncClient<BunSqliteDatabaseLike>['sql'],
  } satisfies SyncClient<BunSqliteDatabaseLike>;

  client.sql = bindSyncSql(client);

  return client;
}

export const createBunDatabase = createBunClient;
