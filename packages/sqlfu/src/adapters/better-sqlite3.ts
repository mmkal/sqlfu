import {bindSyncSql} from '../core/sql.js';
import {rawSqlWithSqlSplittingSync, surroundWithBeginCommitRollbackSync} from '../core/sqlite.js';
import type {ResultRow, SqlQuery, SyncClient} from '../core/types.js';

export interface BetterSqlite3StatementLike<TRow extends ResultRow = ResultRow> {
  readonly reader: boolean;
  all(...params: readonly unknown[]): TRow[];
  iterate?(...params: readonly unknown[]): IterableIterator<TRow>;
  run(...params: readonly unknown[]): {
    readonly changes?: number;
    readonly lastInsertRowid?: string | number | bigint | null;
  };
}

export interface BetterSqlite3DatabaseLike {
  prepare<TRow extends ResultRow = ResultRow>(query: string): BetterSqlite3StatementLike<TRow>;
}

export function createBetterSqlite3Client(database: BetterSqlite3DatabaseLike): SyncClient<BetterSqlite3DatabaseLike> {
  const client: Omit<SyncClient<BetterSqlite3DatabaseLike>, 'sql'> & {sql: SyncClient<BetterSqlite3DatabaseLike>['sql']} = {
    driver: database,
    system: 'sqlite',
    all<TRow extends ResultRow = ResultRow>(query: SqlQuery) {
      return database.prepare<TRow>(query.sql).all(...query.args);
    },
    run(query: SqlQuery) {
      const result = database.prepare(query.sql).run(...query.args);
      return {
        rowsAffected: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    },
    raw(sql: string) {
      return rawSqlWithSqlSplittingSync((singleQuery) => {
        const result = database.prepare(singleQuery.sql).run(...singleQuery.args);
        return {
          rowsAffected: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        };
      }, sql);
    },
    *iterate<TRow extends ResultRow = ResultRow>(query: SqlQuery) {
      const statement = database.prepare<TRow>(query.sql);
      if (statement.iterate) {
        yield* statement.iterate(...query.args);
        return;
      }

      yield* statement.all(...query.args);
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
