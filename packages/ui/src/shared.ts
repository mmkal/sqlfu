export type StudioSchemaResponse = {
  readonly relations: readonly StudioRelation[];
};

export type StudioRelation = {
  readonly name: string;
  readonly kind: 'table' | 'view';
  readonly columns: readonly StudioColumn[];
  readonly rowCount?: number;
  readonly sql?: string;
};

export type StudioColumn = {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly primaryKey: boolean;
};

export type TableRowsResponse = {
  readonly relation: string;
  readonly page: number;
  readonly pageSize: number;
  readonly rows: readonly Record<string, unknown>[];
  readonly columns: readonly string[];
};

export type QueryExecutionResponse = {
  readonly mode: 'rows' | 'metadata';
  readonly rows?: readonly Record<string, unknown>[];
  readonly metadata?: {
    readonly rowsAffected?: number;
    readonly lastInsertRowid?: string | number | bigint | null;
  };
};

export type SqlRunnerResponse = QueryExecutionResponse & {
  readonly sql: string;
};

export type SaveSqlResponse = {
  readonly savedPath: string;
};
