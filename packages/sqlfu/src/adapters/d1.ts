import {bindSql} from '../core/sql.js';
import type {D1DatabaseLike, QueryExecutor, RunResult, SqlQuery} from '../core/types.js';

export interface D1Database extends QueryExecutor {
  readonly sql: ReturnType<typeof bindSql>;
}

export function createD1Database(database: D1DatabaseLike): D1Database {
  const executor: QueryExecutor = {
    async all<TRow extends Record<string, unknown>>(query: SqlQuery): Promise<readonly TRow[]> {
      const result = await database.prepare(query.sql).bind(...query.args).all<TRow>();
      return result.results;
    },
    async first<TRow extends Record<string, unknown>>(query: SqlQuery): Promise<TRow | null> {
      return database.prepare(query.sql).bind(...query.args).first<TRow>();
    },
    async run(query: SqlQuery): Promise<RunResult> {
      const result = await database.prepare(query.sql).bind(...query.args).run();
      return {
        rowsAffected: result.meta?.changes ?? 0,
        lastInsertRowid: result.meta?.last_row_id ?? null,
      };
    },
  };

  return {
    ...executor,
    sql: bindSql(executor),
  };
}
