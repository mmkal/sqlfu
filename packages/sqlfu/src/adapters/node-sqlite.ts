import {bindSyncSql} from '../core/sql.js';
import {rawSqlWithSqlSplittingSync, surroundWithBeginCommitRollbackSync} from '../core/sqlite.js';
import type {ResultRow, SqlQuery, SyncClient} from '../core/types.js';

export interface NodeSqliteStatementLike<TRow extends ResultRow = ResultRow> {
  all(...params: readonly unknown[]): ResultRow[];
  iterate(...params: readonly unknown[]): IterableIterator<ResultRow>;
  run(...params: readonly unknown[]): {
    readonly changes?: number | bigint;
    readonly lastInsertRowid?: string | number | bigint | null;
  };
}

export interface NodeSqliteDatabaseLike {
  prepare(query: string): NodeSqliteStatementLike;
}

export function createNodeSqliteClient(database: NodeSqliteDatabaseLike): SyncClient<NodeSqliteDatabaseLike> {
  const client: Omit<SyncClient<NodeSqliteDatabaseLike>, 'sql'> & {sql: SyncClient<NodeSqliteDatabaseLike>['sql']} = {
    driver: database,
    system: 'sqlite',
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
    transaction<TResult>(fn: (tx: SyncClient<NodeSqliteDatabaseLike>) => TResult | Promise<TResult>) {
      return surroundWithBeginCommitRollbackSync(client, fn);
    },
    sql: undefined as unknown as SyncClient<NodeSqliteDatabaseLike>['sql'],
  } satisfies SyncClient<NodeSqliteDatabaseLike>;

  client.sql = bindSyncSql(client);

  return client;
}

export const createNodeSqliteDatabase = createNodeSqliteClient;

function materializeRows<TRow extends ResultRow>(rows: readonly TRow[]): TRow[] {
  return rows.map(materializeRow);
}

function materializeRow<TRow extends ResultRow>(row: TRow): TRow {
  return {...row};
}
