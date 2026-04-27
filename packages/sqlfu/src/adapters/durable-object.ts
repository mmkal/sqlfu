import {wrapSyncClientErrors} from '../adapter-errors.js';
import {bindSyncSql} from '../sql.js';
import {
  rawSqlWithSqlSplittingSync,
  rewriteNamedParamsToPositional,
} from '../sqlite-text.js';
import type {ResultRow, SqlQuery, SyncClient, SyncPreparedStatement} from '../types.js';

// Intentionally non-generic and bindings-typed-as-`any[]` so this interface
// accepts Cloudflare's real `SqlStorage` (`exec<T extends Record<string,
// SqlStorageValue>>`) without forcing consumers to import
// `@cloudflare/workers-types`. CF's stricter row-type constraint is not
// representable here; we narrow inside `all` / `iterate` instead. See the
// type-test in `test/adapters/durable-object.test-d.ts`.
export interface DurableObjectSqlStorageLike {
  exec(
    query: string,
    ...bindings: any[]
  ): {
    toArray(): unknown[];
    rowsWritten?: number;
  };
}

export type DurableObjectTransactionSync = <TResult>(callback: () => TResult) => TResult;

export interface DurableObjectClientInput {
  sql: DurableObjectSqlStorageLike;
  transactionSync?: DurableObjectTransactionSync;
}

export interface DurableObjectStorageLike extends DurableObjectClientInput {
  transactionSync: DurableObjectTransactionSync;
}

export function createDurableObjectClient<TStorage extends DurableObjectClientInput>(
  storage: TStorage,
): SyncClient<TStorage> {
  const sqlStorage = getSqlStorage(storage);
  const transactionSync = getTransactionSync(storage);
  const client: Omit<SyncClient<TStorage>, 'sql'> & {
    sql: SyncClient<TStorage>['sql'];
  } = {
    driver: storage,
    system: 'sqlite',
    sync: true,
    all<TRow extends ResultRow = ResultRow>(query: SqlQuery) {
      return sqlStorage.exec(query.sql, ...query.args).toArray() as TRow[];
    },
    run(query: SqlQuery) {
      const cursor = sqlStorage.exec(query.sql, ...query.args);
      return {
        rowsAffected: cursor.rowsWritten,
      };
    },
    raw(sql: string) {
      return rawSqlWithSqlSplittingSync((singleQuery) => {
        const cursor = sqlStorage.exec(singleQuery.sql, ...singleQuery.args);
        return {
          rowsAffected: cursor.rowsWritten,
        };
      }, sql);
    },
    *iterate<TRow extends ResultRow = ResultRow>(query: SqlQuery) {
      const rows = sqlStorage.exec(query.sql, ...query.args).toArray() as TRow[];
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
          return sqlStorage.exec(rewritten.sql, ...rewritten.args).toArray() as TRow[];
        },
        run(params) {
          const rewritten = rewriteNamedParamsToPositional(sql, params);
          const cursor = sqlStorage.exec(rewritten.sql, ...rewritten.args);
          return {rowsAffected: cursor.rowsWritten};
        },
        *iterate(params) {
          const rewritten = rewriteNamedParamsToPositional(sql, params);
          yield* (sqlStorage.exec(rewritten.sql, ...rewritten.args).toArray() as TRow[]);
        },
        [Symbol.dispose]() {},
      };
    },
    transaction<TResult>(fn: (tx: SyncClient<TStorage>) => TResult | Promise<TResult>) {
      // Durable Objects reject transaction-control SQL. When callers pass full
      // ctx.storage we can use the storage-native synchronous transaction API.
      // Passing {sql: ctx.storage.sql} is still supported for query-only
      // clients, but sqlfu cannot call transactionSync from that narrower
      // handle.
      if (!transactionSync) {
        return fn(client);
      }

      return transactionSync(() => {
        const result = fn(client);
        if (isPromiseLike(result)) {
          throw new Error(
            'Durable Object transactions must be synchronous. Pass a synchronous callback or run async work outside client.transaction().',
          );
        }
        return result;
      });
    },
    sql: undefined as unknown as SyncClient<TStorage>['sql'],
  } satisfies SyncClient<TStorage>;

  client.sql = bindSyncSql(client);

  return wrapSyncClientErrors(client);
}

export const createDurableObjectDatabase = createDurableObjectClient;

function getSqlStorage(storage: DurableObjectClientInput): DurableObjectSqlStorageLike {
  if (isObject(storage) && 'sql' in storage) {
    return storage.sql as DurableObjectSqlStorageLike;
  }
  throw new Error(
    'createDurableObjectClient expects ctx.storage or {sql, transactionSync}; pass ctx.storage.sql as {sql}.',
  );
}

function getTransactionSync(storage: DurableObjectClientInput): DurableObjectStorageLike['transactionSync'] | null {
  if (typeof storage.transactionSync === 'function') {
    return storage.transactionSync.bind(storage);
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPromiseLike<TResult>(value: TResult | Promise<TResult>): value is Promise<TResult> {
  return typeof value === 'object' && value !== null && 'then' in value;
}
