import {rawQueryContext, runSqliteSync} from '../core/adapter-errors.js';
import type {MapError} from '../core/errors.js';
import {bindSyncSql} from '../core/sql.js';
import {rawSqlWithSqlSplittingSync, surroundWithBeginCommitRollbackSync} from '../core/sqlite.js';
import type {ResultRow, SqlQuery, SyncClient} from '../core/types.js';

export interface NodeSqliteStatementLike<TRow extends ResultRow = ResultRow> {
  all(...params: unknown[]): ResultRow[];
  iterate(...params: unknown[]): IterableIterator<ResultRow>;
  run(...params: unknown[]): {
    changes?: number | bigint;
    lastInsertRowid?: string | number | bigint | null;
  };
}

export interface NodeSqliteDatabaseLike {
  prepare(query: string): NodeSqliteStatementLike;
}

export interface NodeSqliteClientOptions {
  mapError?: MapError;
}

export function createNodeSqliteClient(
  database: NodeSqliteDatabaseLike,
  options: NodeSqliteClientOptions = {},
): SyncClient<NodeSqliteDatabaseLike> {
  const {mapError} = options;
  const system = 'sqlite';
  const client: Omit<SyncClient<NodeSqliteDatabaseLike>, 'sql'> & {sql: SyncClient<NodeSqliteDatabaseLike>['sql']} = {
    driver: database,
    system,
    sync: true,
    all<TRow extends ResultRow = ResultRow>(query: SqlQuery) {
      return runSqliteSync(() => materializeRows(database.prepare(query.sql).all(...query.args)) as TRow[], {
        query,
        system,
        mapError,
      });
    },
    run(query: SqlQuery) {
      return runSqliteSync(
        () => {
          const result = database.prepare(query.sql).run(...query.args);
          return {
            rowsAffected: result.changes == null ? undefined : Number(result.changes),
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
              rowsAffected: result.changes == null ? undefined : Number(result.changes),
              lastInsertRowid: result.lastInsertRowid,
            };
          }, sql),
        {query: rawQueryContext(sql), system, mapError},
      );
    },
    *iterate<TRow extends ResultRow = ResultRow>(query: SqlQuery) {
      const iterator = runSqliteSync(() => database.prepare(query.sql).iterate(...query.args), {
        query,
        system,
        mapError,
      });
      while (true) {
        const next = runSqliteSync(() => iterator.next(), {query, system, mapError});
        if (next.done) return;
        yield materializeRow(next.value) as TRow;
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

function materializeRows<TRow extends ResultRow>(rows: TRow[]): TRow[] {
  return rows.map(materializeRow);
}

function materializeRow<TRow extends ResultRow>(row: TRow): TRow {
  return {...row};
}
