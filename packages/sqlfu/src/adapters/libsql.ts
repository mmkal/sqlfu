import {createClient, type Client, type InStatement} from '@libsql/client';

import {bindSql} from '../core/sql.js';
import type {AsyncExecutor, QueryResult, ResultRow, SqlQuery} from '../core/types.js';

export interface LibsqlDatabase extends AsyncExecutor {
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

  const executor: AsyncExecutor = {
    async query<TRow extends ResultRow = ResultRow>(query: SqlQuery): Promise<QueryResult<TRow>> {
      const result = await client.execute(toStatement(query));
      return {
        rows: result.rows as unknown as TRow[],
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
