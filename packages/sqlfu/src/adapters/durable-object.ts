import {bindSyncSql} from '../core/sql.js';
import {rawSqlWithSqlSplittingSync} from '../core/sqlite.js';
import type {ResultRow, SqlQuery, SyncClient} from '../core/types.js';

export interface DurableObjectSqlStorageLike {
  exec<TRow extends ResultRow = ResultRow>(
    query: string,
    ...bindings: readonly unknown[]
  ): {
    toArray(): TRow[];
    readonly rowsWritten?: number;
  };
}

export function createDurableObjectClient(
  storage: DurableObjectSqlStorageLike,
): SyncClient<DurableObjectSqlStorageLike> {
  const client: Omit<SyncClient<DurableObjectSqlStorageLike>, 'sql'> & {
    sql: SyncClient<DurableObjectSqlStorageLike>['sql'];
  } = {
    driver: storage,
    system: 'sqlite',
    sync: true,
    all<TRow extends ResultRow = ResultRow>(query: SqlQuery) {
      return storage.exec<TRow>(query.sql, ...query.args).toArray();
    },
    run(query: SqlQuery) {
      const cursor = storage.exec(query.sql, ...query.args);
      return {
        rowsAffected: cursor.rowsWritten,
      };
    },
    raw(sql: string) {
      return rawSqlWithSqlSplittingSync((singleQuery) => {
        const cursor = storage.exec(singleQuery.sql, ...singleQuery.args);
        return {
          rowsAffected: cursor.rowsWritten,
        };
      }, sql);
    },
    *iterate<TRow extends ResultRow = ResultRow>(query: SqlQuery) {
      const rows = storage.exec<TRow>(query.sql, ...query.args).toArray();
      yield* rows;
    },
    transaction<TResult>(fn: (tx: SyncClient<DurableObjectSqlStorageLike>) => TResult | Promise<TResult>) {
      // Durable Objects reject `begin transaction` / `savepoint` in raw SQL and
      // rely on the request-level output gate for atomicity: writes buffered
      // within one invocation either all commit or all roll back if the handler
      // throws. Fine-grained nested transactions are available via
      // `state.storage.transactionSync`, but that requires a synchronous
      // callback and would not compose with the async callbacks sqlfu's
      // migrate/baseline paths use. So we just invoke the callback directly
      // and trust the enclosing request/blockConcurrencyWhile boundary.
      return fn(client);
    },
    sql: undefined as unknown as SyncClient<DurableObjectSqlStorageLike>['sql'],
  } satisfies SyncClient<DurableObjectSqlStorageLike>;

  client.sql = bindSyncSql(client);

  return client;
}

export const createDurableObjectDatabase = createDurableObjectClient;
