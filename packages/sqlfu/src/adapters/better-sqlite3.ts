import {rawQueryContext, runSqliteSync} from '../core/adapter-errors.js';
import type {MapError} from '../core/errors.js';
import {bindSyncSql} from '../core/sql.js';
import {rawSqlWithSqlSplittingSync, surroundWithBeginCommitRollbackSync} from '../core/sqlite.js';
import type {ResultRow, SqlQuery, SyncClient} from '../core/types.js';

export interface BetterSqlite3StatementLike<TRow extends ResultRow = ResultRow> {
  reader: boolean;
  all(...params: unknown[]): TRow[];
  iterate?(...params: unknown[]): IterableIterator<TRow>;
  run(...params: unknown[]): {
    changes?: number;
    lastInsertRowid?: string | number | bigint | null;
  };
}

export interface BetterSqlite3DatabaseLike {
  prepare<TRow extends ResultRow = ResultRow>(query: string): BetterSqlite3StatementLike<TRow>;
}

export interface BetterSqlite3ClientOptions {
  mapError?: MapError;
}

export function createBetterSqlite3Client(
  database: BetterSqlite3DatabaseLike,
  options: BetterSqlite3ClientOptions = {},
): SyncClient<BetterSqlite3DatabaseLike> {
  const {mapError} = options;
  const system = 'sqlite';
  const client: Omit<SyncClient<BetterSqlite3DatabaseLike>, 'sql'> & {
    sql: SyncClient<BetterSqlite3DatabaseLike>['sql'];
  } = {
    driver: database,
    system,
    sync: true,
    all<TRow extends ResultRow = ResultRow>(query: SqlQuery) {
      return runSqliteSync(() => database.prepare<TRow>(query.sql).all(...query.args), {query, system, mapError});
    },
    run(query: SqlQuery) {
      return runSqliteSync(
        () => {
          const result = database.prepare(query.sql).run(...query.args);
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
            const result = database.prepare(singleQuery.sql).run(...singleQuery.args);
            return {
              rowsAffected: result.changes,
              lastInsertRowid: result.lastInsertRowid,
            };
          }, sql),
        {query: rawQueryContext(sql), system, mapError},
      );
    },
    *iterate<TRow extends ResultRow = ResultRow>(query: SqlQuery) {
      const statement = runSqliteSync(() => database.prepare<TRow>(query.sql), {query, system, mapError});
      const iterator = runSqliteSync(
        () => (statement.iterate ? statement.iterate(...query.args) : statement.all(...query.args)[Symbol.iterator]()),
        {query, system, mapError},
      );
      while (true) {
        const next = runSqliteSync(() => iterator.next(), {query, system, mapError});
        if (next.done) return;
        yield next.value;
      }
    },
    transaction<TResult>(fn: (tx: SyncClient<BetterSqlite3DatabaseLike>) => TResult | Promise<TResult>) {
      return surroundWithBeginCommitRollbackSync(client, fn);
    },
    sql: undefined as unknown as SyncClient<BetterSqlite3DatabaseLike>['sql'],
  } satisfies SyncClient<BetterSqlite3DatabaseLike>;

  client.sql = bindSyncSql(client);

  return client;
}

export const createBetterSqlite3Database = createBetterSqlite3Client;
