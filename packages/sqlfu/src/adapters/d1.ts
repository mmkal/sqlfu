import {bindSql} from '../core/sql.js';
import type {AsyncExecutor, QueryResult, ResultRow, SqlQuery} from '../core/types.js';

export interface D1ResultRow extends ResultRow {
  [key: string]: unknown;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = D1ResultRow>(): Promise<{results: T[]}>;
  first<T = D1ResultRow>(columnName?: string): Promise<T | null>;
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

export interface D1Database extends AsyncExecutor {
  readonly sql: ReturnType<typeof bindSql>;
}

export function createD1Database(database: D1DatabaseLike): D1Database {
  const executor: AsyncExecutor = {
    async query<TRow extends ResultRow = ResultRow>(query: SqlQuery): Promise<QueryResult<TRow>> {
      // TODO: This currently routes every D1 query through `.all()`, which means write metadata
      // such as affected rows and last insert rowid is not preserved yet. Revisit once the
      // sqlfu query/result contract for non-select statements is finalized.
      const result = await database.prepare(query.sql).bind(...query.args).all<TRow>();
      return {
        rows: result.results,
        rowsAffected: 0,
        lastInsertRowid: null,
      };
    },
  };

  return {
    ...executor,
    sql: bindSql(executor),
  };
}
