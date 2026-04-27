import {mapSqliteDriverError} from './errors.js';
import {bindAsyncSql, bindSyncSql} from './sql.js';
import type {
  AsyncClient,
  PreparedStatement,
  ResultRow,
  SqlQuery,
  SyncClient,
  SyncPreparedStatement,
} from './types.js';

/**
 * Wrap a `SyncClient` so every error from `all` / `run` / `raw` / `iterate`
 * is normalized via `mapSqliteDriverError`. Mirrors `instrumentClient`
 * structurally — applied once at adapter-factory exit rather than per call.
 *
 * The error's `system` comes from the client's own `.system` field, so
 * adapters don't have to pass it twice.
 *
 * Transactions re-wrap the inner client so queries inside a tx get the same
 * error contract as queries outside it.
 */
export function wrapSyncClientErrors<TDriver>(client: SyncClient<TDriver>): SyncClient<TDriver> {
  const mapQuery = (error: unknown, query: SqlQuery) =>
    mapSqliteDriverError(error, {query, system: client.system});

  const wrapped: Omit<SyncClient<TDriver>, 'sql'> & {sql: SyncClient<TDriver>['sql']} = {
    driver: client.driver,
    system: client.system,
    sync: true,
    all(query) {
      try {
        return client.all(query);
      } catch (error) {
        throw mapQuery(error, query);
      }
    },
    run(query) {
      try {
        return client.run(query);
      } catch (error) {
        throw mapQuery(error, query);
      }
    },
    raw(sql) {
      try {
        return client.raw(sql);
      } catch (error) {
        throw mapQuery(error, {sql, args: []});
      }
    },
    *iterate(query) {
      try {
        yield* client.iterate(query);
      } catch (error) {
        throw mapQuery(error, query);
      }
    },
    prepare<TRow extends ResultRow = ResultRow>(sql: string): SyncPreparedStatement<TRow> {
      let stmt: SyncPreparedStatement<TRow>;
      try {
        stmt = client.prepare<TRow>(sql);
      } catch (error) {
        throw mapQuery(error, {sql, args: []});
      }
      return {
        all(params) {
          try {
            return stmt.all(params);
          } catch (error) {
            throw mapQuery(error, {sql, args: []});
          }
        },
        run(params) {
          try {
            return stmt.run(params);
          } catch (error) {
            throw mapQuery(error, {sql, args: []});
          }
        },
        *iterate(params) {
          try {
            yield* stmt.iterate(params);
          } catch (error) {
            throw mapQuery(error, {sql, args: []});
          }
        },
        [Symbol.dispose]() {
          stmt[Symbol.dispose]();
        },
      };
    },
    transaction: (<TResult>(fn: (tx: SyncClient<TDriver>) => TResult) =>
      client.transaction((tx: SyncClient<TDriver>) => fn(wrapSyncClientErrors(tx)))) as SyncClient<TDriver>['transaction'],
    sql: undefined as unknown as SyncClient<TDriver>['sql'],
  };
  wrapped.sql = bindSyncSql(wrapped);
  return wrapped;
}

export function wrapAsyncClientErrors<TDriver>(client: AsyncClient<TDriver>): AsyncClient<TDriver> {
  const mapQuery = (error: unknown, query: SqlQuery) =>
    mapSqliteDriverError(error, {query, system: client.system});

  const wrapped: Omit<AsyncClient<TDriver>, 'sql'> & {sql: AsyncClient<TDriver>['sql']} = {
    driver: client.driver,
    system: client.system,
    sync: false,
    async all(query) {
      try {
        return await client.all(query);
      } catch (error) {
        throw mapQuery(error, query);
      }
    },
    async run(query) {
      try {
        return await client.run(query);
      } catch (error) {
        throw mapQuery(error, query);
      }
    },
    async raw(sql) {
      try {
        return await client.raw(sql);
      } catch (error) {
        throw mapQuery(error, {sql, args: []});
      }
    },
    async *iterate(query) {
      try {
        yield* client.iterate(query);
      } catch (error) {
        throw mapQuery(error, query);
      }
    },
    prepare<TRow extends ResultRow = ResultRow>(sql: string): PreparedStatement<TRow> {
      let stmt: PreparedStatement<TRow>;
      try {
        stmt = client.prepare<TRow>(sql);
      } catch (error) {
        throw mapQuery(error, {sql, args: []});
      }
      return {
        async all(params) {
          try {
            return await stmt.all(params);
          } catch (error) {
            throw mapQuery(error, {sql, args: []});
          }
        },
        async run(params) {
          try {
            return await stmt.run(params);
          } catch (error) {
            throw mapQuery(error, {sql, args: []});
          }
        },
        async *iterate(params) {
          try {
            yield* stmt.iterate(params);
          } catch (error) {
            throw mapQuery(error, {sql, args: []});
          }
        },
        async [Symbol.asyncDispose]() {
          await stmt[Symbol.asyncDispose]();
        },
      };
    },
    transaction: (fn) => client.transaction((tx) => fn(wrapAsyncClientErrors(tx))),
    sql: undefined as unknown as AsyncClient<TDriver>['sql'],
  };
  wrapped.sql = bindAsyncSql(wrapped);
  return wrapped;
}
