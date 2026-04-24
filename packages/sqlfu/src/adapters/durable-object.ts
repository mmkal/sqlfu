import {wrapSyncClientErrors} from '../adapter-errors.js';
import {bindSyncSql} from '../sql.js';
import {
  rawSqlWithSqlSplittingSync,
  rewriteNamedParamsToPositional,
} from '../sqlite-text.js';
import type {ResultRow, SqlQuery, SyncClient, SyncPreparedStatement} from '../types.js';

export interface DurableObjectSqlStorageLike {
  exec<TRow extends ResultRow = ResultRow>(
    query: string,
    ...bindings: unknown[]
  ): {
    toArray(): TRow[];
    rowsWritten?: number;
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
    prepare<TRow extends ResultRow = ResultRow>(sql: string): SyncPreparedStatement<TRow> {
      // DO storage has no native prepared-statement concept; this shim
      // captures the SQL string and re-issues `storage.exec` on every call.
      // workerd parses the SQL fresh each time — tolerable for DO writes,
      // which the design grills already declared cheap. Named params are
      // tokenized to positional because `storage.exec` only accepts a
      // positional `...bindings` spread.
      return {
        all(params) {
          const rewritten = rewriteNamedParamsToPositional(sql, params);
          return storage.exec<TRow>(rewritten.sql, ...rewritten.args).toArray();
        },
        run(params) {
          const rewritten = rewriteNamedParamsToPositional(sql, params);
          const cursor = storage.exec(rewritten.sql, ...rewritten.args);
          return {rowsAffected: cursor.rowsWritten};
        },
        *iterate(params) {
          const rewritten = rewriteNamedParamsToPositional(sql, params);
          yield* storage.exec<TRow>(rewritten.sql, ...rewritten.args).toArray();
        },
        [Symbol.dispose]() {},
      };
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

  return wrapSyncClientErrors(client);
}

export const createDurableObjectDatabase = createDurableObjectClient;
