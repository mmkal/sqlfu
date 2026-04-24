import {wrapAsyncClientErrors} from '../adapter-errors.js';
import {bindAsyncSql} from '../sql.js';
import {rawSqlWithSqlSplittingAsync, rewriteNamedParamsToPositional} from '../sqlite-text.js';
import type {AsyncClient, PreparedStatement, ResultRow, SqlQuery} from '../types.js';

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = ResultRow>(): Promise<{results: T[]}>;
  first<T = ResultRow>(columnName?: string): Promise<T | null>;
  run(): Promise<{
    success: boolean;
    meta?: {
      changes?: number;
      last_row_id?: number | string;
    };
  }>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement;
}

export function createD1Client(database: D1DatabaseLike): AsyncClient<D1DatabaseLike> {
  const all: AsyncClient<D1DatabaseLike>['all'] = async <TRow extends ResultRow = ResultRow>(sqlQuery: SqlQuery) => {
    const result = await database
      .prepare(sqlQuery.sql)
      .bind(...sqlQuery.args)
      .all<TRow>();
    return result.results;
  };
  const run: AsyncClient<D1DatabaseLike>['run'] = async (sqlQuery: SqlQuery) => {
    const statement = database.prepare(sqlQuery.sql).bind(...sqlQuery.args);
    const result = await statement.run();
    return {
      rowsAffected: result.meta?.changes,
      lastInsertRowid: result.meta?.last_row_id,
    };
  };
  const raw: AsyncClient<D1DatabaseLike>['raw'] = async (sql: string) => {
    return rawSqlWithSqlSplittingAsync(async (singleQuery) => {
      const statement = database.prepare(singleQuery.sql).bind(...singleQuery.args);
      const result = await statement.run();
      return {
        rowsAffected: result.meta?.changes,
        lastInsertRowid: result.meta?.last_row_id,
      };
    }, sql);
  };
  const iterate: AsyncClient<D1DatabaseLike>['iterate'] = async function* <TRow extends ResultRow = ResultRow>(
    sqlQuery: SqlQuery,
  ) {
    for (const row of await all<TRow>(sqlQuery)) {
      yield row;
    }
  };
  const prepare: AsyncClient<D1DatabaseLike>['prepare'] = <TRow extends ResultRow = ResultRow>(
    sql: string,
  ): PreparedStatement<TRow> => {
    // D1's `prepare` returns a `D1PreparedStatement` that's reusable across
    // multiple `.bind(...).all/.run/.first` calls — but `.bind` only accepts
    // positional values. Named-param Records are routed through the shared
    // tokenizer; if the caller passes a `Record`, we re-prepare against the
    // rewritten SQL on first use and cache the rewritten statement so the
    // reuse contract still holds for repeat calls with the same shape.
    let positionalStatement: D1PreparedStatement | null = null;
    let positionalSql: string | null = null;

    const resolveStatement = (params: Parameters<PreparedStatement<TRow>['all']>[0]) => {
      if (params == null || Array.isArray(params)) {
        if (!positionalStatement) {
          positionalStatement = database.prepare(sql);
          positionalSql = sql;
        }
        const args = (params ?? []) as unknown[];
        return positionalStatement.bind(...args);
      }
      // Named-param Record — tokenize and (re)prepare against the rewritten SQL.
      // If the rewrite produces the same SQL we already prepared, reuse it.
      const rewritten = rewriteNamedParamsToPositional(sql, params);
      if (positionalSql !== rewritten.sql) {
        positionalStatement = database.prepare(rewritten.sql);
        positionalSql = rewritten.sql;
      }
      return positionalStatement!.bind(...rewritten.args);
    };

    return {
      async all(params) {
        const result = await resolveStatement(params).all<TRow>();
        return result.results;
      },
      async run(params) {
        const result = await resolveStatement(params).run();
        return {
          rowsAffected: result.meta?.changes,
          lastInsertRowid: result.meta?.last_row_id,
        };
      },
      async *iterate(params) {
        const result = await resolveStatement(params).all<TRow>();
        for (const row of result.results) {
          yield row;
        }
      },
      async [Symbol.asyncDispose]() {},
    };
  };
  const d1Client: Omit<AsyncClient<D1DatabaseLike>, 'sql'> & {sql: AsyncClient<D1DatabaseLike>['sql']} = {
    driver: database,
    system: 'sqlite',
    sync: false,
    all,
    run,
    raw,
    iterate,
    prepare,
    async transaction<TResult>(fn: (tx: AsyncClient<D1DatabaseLike>) => Promise<TResult> | TResult) {
      // D1 (like Durable Objects' built-in SQL) rejects `begin transaction` /
      // `savepoint` in raw SQL — the workerd D1 binding only exposes
      // `db.batch([...])` for atomicity, which requires collecting statements
      // upfront and doesn't compose with sqlfu's callback-based transaction.
      // Invoke the callback directly; the weaker guarantee (partial writes on
      // error) mirrors the DO adapter and is the only shape that runs at all
      // against a live D1 binding.
      return fn(d1Client);
    },
    sql: undefined as unknown as AsyncClient<D1DatabaseLike>['sql'],
  } satisfies AsyncClient<D1DatabaseLike>;

  d1Client.sql = bindAsyncSql(d1Client);

  return wrapAsyncClientErrors(d1Client);
}

export const createD1Database = createD1Client;
