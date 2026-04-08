import {bindAsyncSql} from '../core/sql.js';
import type {AsyncExecutor, AsyncSqlClient, ResultRow, SqlQuery} from '../core/types.js';

export interface LibsqlStatementLike {
  readonly sql: string;
  readonly args?: readonly unknown[];
}

export interface LibsqlExecuteResultLike<TRow extends ResultRow = ResultRow> {
  readonly rows: TRow[];
  readonly rowsAffected?: number;
  readonly lastInsertRowid?: string | number | bigint | null;
}

export interface LibsqlClientLike {
  execute<TRow extends ResultRow = ResultRow>(
    statement: string | LibsqlStatementLike,
  ): Promise<LibsqlExecuteResultLike<TRow>>;
}

export interface LibsqlClient extends AsyncSqlClient {
  readonly client: LibsqlClientLike;
}

export function createLibsqlClient(client: LibsqlClientLike): LibsqlClient {
  const executor: AsyncExecutor = {
    async query<TRow extends ResultRow = ResultRow>(query: SqlQuery) {
      const result = await client.execute<TRow>(toStatement(query));
      const rows = result.rows.map(materializeRow);
      if (rows.length > 0) return rows;

      return Object.assign(rows, {
        rowsAffected: result.rowsAffected,
        lastInsertRowid: result.lastInsertRowid,
      });
    },
  };

  return {
    ...executor,
    client,
    sql: bindAsyncSql(executor),
  };
}

export const createLibsqlDatabase = createLibsqlClient;

function toStatement(query: SqlQuery): LibsqlStatementLike {
  return {
    sql: query.sql,
    args: [...query.args],
  };
}

function materializeRow<TRow extends ResultRow>(row: TRow): TRow {
  return {...row};
}
