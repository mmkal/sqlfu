import {
  bindAsyncSql,
  rawSqlWithSqlSplittingAsync,
  surroundWithBeginCommitRollbackAsync,
} from 'sqlfu/browser';
import type {
  AsyncClient,
  ResultRow,
  SqlQuery,
  QueryArg,
} from 'sqlfu/browser';

import type {WasmSqliteClient} from './sqlite-wasm-client.js';

export function createWasmAsyncClient(wasm: WasmSqliteClient): AsyncClient<WasmSqliteClient> {
  const all: AsyncClient<WasmSqliteClient>['all'] = async <TRow extends ResultRow = ResultRow>(query: SqlQuery) => {
    return wasm.all<TRow>(query.sql, toPositionalArgs(query.args) as never);
  };
  const run: AsyncClient<WasmSqliteClient>['run'] = async (query: SqlQuery) => {
    const result = wasm.run(query.sql, toPositionalArgs(query.args) as never);
    return {
      rowsAffected: result.rowsAffected,
      lastInsertRowid: result.lastInsertRowid,
    };
  };
  const raw: AsyncClient<WasmSqliteClient>['raw'] = async (sql: string) => {
    return rawSqlWithSqlSplittingAsync(async (singleQuery) => {
      const result = wasm.run(singleQuery.sql, toPositionalArgs(singleQuery.args) as never);
      return {
        rowsAffected: result.rowsAffected,
        lastInsertRowid: result.lastInsertRowid,
      };
    }, sql);
  };
  const iterate: AsyncClient<WasmSqliteClient>['iterate'] = async function* <TRow extends ResultRow = ResultRow>(query: SqlQuery) {
    for (const row of await all<TRow>(query)) {
      yield row;
    }
  };
  const transaction: AsyncClient<WasmSqliteClient>['transaction'] = async <TResult>(
    fn: (tx: AsyncClient<WasmSqliteClient>) => Promise<TResult> | TResult,
  ) => {
    return surroundWithBeginCommitRollbackAsync(client, fn);
  };

  const client = {
    driver: wasm,
    all,
    run,
    raw,
    iterate,
    transaction,
    sql: undefined as unknown as AsyncClient<WasmSqliteClient>['sql'],
  } satisfies AsyncClient<WasmSqliteClient>;

  client.sql = bindAsyncSql(client);
  return client;
}

function toPositionalArgs(args: readonly QueryArg[]): unknown[] {
  return args.map((value) => {
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    return value;
  });
}
