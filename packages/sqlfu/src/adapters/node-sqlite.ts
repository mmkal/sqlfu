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

export interface NodeSqliteStatementLike<TRow extends ResultRow = ResultRow> {
  all(...params: unknown[]): ResultRow[];
  iterate(...params: unknown[]): IterableIterator<ResultRow>;
  run(...params: unknown[]): {
    changes?: number | bigint;
    lastInsertRowid?: string | number | bigint | null;
  };
  /** Optional. Native node:sqlite `StatementSync` exposes `finalize`; structural mocks may not. */
  finalize?(): void;
}

export interface NodeSqliteDatabaseLike {
  prepare(query: string): NodeSqliteStatementLike;
}

export function createNodeSqliteClient(database: NodeSqliteDatabaseLike): SyncClient<NodeSqliteDatabaseLike> {
  const client: Omit<SyncClient<NodeSqliteDatabaseLike>, 'sql'> & {sql: SyncClient<NodeSqliteDatabaseLike>['sql']} = {
    driver: database,
    system: 'sqlite',
    sync: true,
    all<TRow extends ResultRow = ResultRow>(query: SqlQuery) {
      return materializeRows(database.prepare(query.sql).all(...query.args)) as TRow[];
    },
    run(query: SqlQuery) {
      const result = database.prepare(query.sql).run(...query.args);
      return {
        rowsAffected: result.changes == null ? undefined : Number(result.changes),
        lastInsertRowid: result.lastInsertRowid,
      };
    },
    raw(sql: string) {
      return rawSqlWithSqlSplittingSync((singleQuery) => {
        const result = database.prepare(singleQuery.sql).run(...singleQuery.args);
        return {
          rowsAffected: result.changes == null ? undefined : Number(result.changes),
          lastInsertRowid: result.lastInsertRowid,
        };
      }, sql);
    },
    *iterate<TRow extends ResultRow = ResultRow>(query: SqlQuery) {
      for (const row of database.prepare(query.sql).iterate(...query.args)) {
        yield materializeRow(row) as TRow;
      }
    },
    prepare<TRow extends ResultRow = ResultRow>(sql: string): SyncPreparedStatement<TRow> {
      // node:sqlite `StatementSync.all/run/iterate` accept either positional
      // args via the rest spread or a single named-param object as the only
      // arg. bindArgs collapses both shapes into the spread.
      const statement = database.prepare(sql);
      return {
        all(params) {
          return materializeRows(statement.all(...bindArgs(params))) as TRow[];
        },
        run(params) {
          const result = statement.run(...bindArgs(params));
          return {
            rowsAffected: result.changes == null ? undefined : Number(result.changes),
            lastInsertRowid: result.lastInsertRowid,
          };
        },
        *iterate(params) {
          for (const row of statement.iterate(...bindArgs(params))) {
            yield materializeRow(row) as TRow;
          }
        },
        [Symbol.dispose]() {
          statement.finalize?.();
        },
      };
    },
    transaction<TResult>(fn: (tx: SyncClient<NodeSqliteDatabaseLike>) => TResult | Promise<TResult>) {
      return surroundWithBeginCommitRollbackSync(client, fn);
    },
    sql: undefined as unknown as SyncClient<NodeSqliteDatabaseLike>['sql'],
  } satisfies SyncClient<NodeSqliteDatabaseLike>;

  client.sql = bindSyncSql(client);

  return wrapSyncClientErrors(client);
}

export const createNodeSqliteDatabase = createNodeSqliteClient;

function materializeRows<TRow extends ResultRow>(rows: TRow[]): TRow[] {
  return rows.map(materializeRow);
}

function materializeRow<TRow extends ResultRow>(row: TRow): TRow {
  return {...row};
}

function bindArgs(params: PreparedStatementParams | undefined): unknown[] {
  if (params == null) return [];
  if (Array.isArray(params)) return params;
  return [params];
}
