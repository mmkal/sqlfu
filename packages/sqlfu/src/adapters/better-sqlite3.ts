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

export interface BetterSqlite3StatementLike<TRow extends ResultRow = ResultRow> {
  reader: boolean;
  all(...params: unknown[]): TRow[];
  iterate?(...params: unknown[]): IterableIterator<TRow>;
  run(...params: unknown[]): {
    changes?: number;
    lastInsertRowid?: string | number | bigint | null;
  };
  /** Optional. Native better-sqlite3 statements expose `finalize`; structural mocks may not. */
  finalize?(): void;
}

export interface BetterSqlite3DatabaseLike {
  prepare<TRow extends ResultRow = ResultRow>(query: string): BetterSqlite3StatementLike<TRow>;
}

export function createBetterSqlite3Client(database: BetterSqlite3DatabaseLike): SyncClient<BetterSqlite3DatabaseLike> {
  const client: Omit<SyncClient<BetterSqlite3DatabaseLike>, 'sql'> & {
    sql: SyncClient<BetterSqlite3DatabaseLike>['sql'];
  } = {
    driver: database,
    system: 'sqlite',
    sync: true,
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
    prepare<TRow extends ResultRow = ResultRow>(sql: string): SyncPreparedStatement<TRow> {
      // better-sqlite3 statements natively accept either positional args
      // (`stmt.all(...args)`) or a single named-param object (`stmt.all({name})`).
      // bindArgs collapses both shapes into a spread the driver understands.
      const statement = database.prepare<TRow>(sql);
      return {
        all(params) {
          return statement.all(...bindArgs(params));
        },
        run(params) {
          const result = statement.run(...bindArgs(params));
          return {
            rowsAffected: result.changes,
            lastInsertRowid: result.lastInsertRowid,
          };
        },
        *iterate(params) {
          if (statement.iterate) {
            yield* statement.iterate(...bindArgs(params));
            return;
          }
          yield* statement.all(...bindArgs(params));
        },
        [Symbol.dispose]() {
          statement.finalize?.();
        },
      };
    },
    transaction<TResult>(fn: (tx: SyncClient<BetterSqlite3DatabaseLike>) => TResult | Promise<TResult>) {
      return surroundWithBeginCommitRollbackSync(client, fn);
    },
    sql: undefined as unknown as SyncClient<BetterSqlite3DatabaseLike>['sql'],
  } satisfies SyncClient<BetterSqlite3DatabaseLike>;

  client.sql = bindSyncSql(client);

  return wrapSyncClientErrors(client);
}

export const createBetterSqlite3Database = createBetterSqlite3Client;

function bindArgs(params: PreparedStatementParams | undefined): unknown[] {
  if (params == null) return [];
  if (Array.isArray(params)) return params;
  return [params];
}
