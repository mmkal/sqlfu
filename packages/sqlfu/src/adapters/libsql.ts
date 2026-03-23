import {createClient, type Client, type InStatement} from '@libsql/client';

import {bindSql} from '../core/sql.js';
import type {QueryExecutor, RunResult, SqlQuery} from '../core/types.js';

export interface LibsqlDatabase extends QueryExecutor {
  readonly sql: ReturnType<typeof bindSql>;
  readonly client: Client;
}

export interface CreateLibsqlDatabaseOptions {
  readonly url: string;
  readonly authToken?: string;
}

export function createLibsqlDatabase(options: CreateLibsqlDatabaseOptions): LibsqlDatabase {
  const client = createClient({
    url: options.url,
    authToken: options.authToken,
  });

  const executor: QueryExecutor = {
    async all<TRow extends Record<string, unknown>>(query: SqlQuery): Promise<readonly TRow[]> {
      const result = await client.execute(toStatement(query));
      return result.rows as unknown as TRow[];
    },
    async first<TRow extends Record<string, unknown>>(query: SqlQuery): Promise<TRow | null> {
      const result = await client.execute(toStatement(query));
      return (result.rows[0] as unknown as TRow | undefined) ?? null;
    },
    async run(query: SqlQuery): Promise<RunResult> {
      const result = await client.execute(toStatement(query));
      return {
        rowsAffected: result.rowsAffected,
        lastInsertRowid: result.lastInsertRowid ?? null,
      };
    },
  };

  return {
    ...executor,
    client,
    sql: bindSql(executor),
  };
}

function toStatement(query: SqlQuery): InStatement {
  return {
    sql: query.sql,
    args: [...query.args],
  };
}
