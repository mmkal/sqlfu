import type {JsonSchemaObject} from 'sqlfu/experimental';

export type StudioSchemaResponse = {
  readonly projectName: string;
  readonly projectRoot: string;
  readonly relations: readonly StudioRelation[];
};

export type SchemaCheckCard = {
  readonly key: 'repoDrift' | 'pendingMigrations' | 'historyDrift' | 'schemaDrift' | 'syncDrift';
  readonly title: string;
  readonly okTitle: string;
  readonly explainer: string;
  readonly ok: boolean;
  readonly summary: string;
  readonly recommendation?: string;
  readonly commands?: readonly string[];
};

export type SchemaCheckResponse = {
  readonly cards: readonly SchemaCheckCard[];
};

export type SchemaAuthorityMigration = {
  readonly id: string;
  readonly fileName: string | null;
  readonly timestamp?: string;
  readonly name: string;
  readonly content: string;
  readonly applied: boolean;
  readonly appliedAt: string | null;
  readonly integrity: 'ok' | 'checksum mismatch' | null;
};

export type SchemaAuthoritiesResponse = {
  readonly desiredSchemaSql: string;
  readonly migrations: readonly SchemaAuthorityMigration[];
  readonly migrationHistory: readonly SchemaAuthorityMigration[];
  readonly liveSchemaSql: string;
};

export type MigrationResultantSchemaResponse = {
  readonly sql: string;
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
  readonly editable: boolean;
  readonly rowKeys: readonly TableRowKey[];
  readonly rows: readonly Record<string, unknown>[];
  readonly columns: readonly string[];
};

export type TableRowKey =
  | {
      readonly kind: 'primaryKey';
      readonly values: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: 'new';
      readonly value: string;
    }
  | {
      readonly kind: 'rowid';
      readonly value: number;
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

export type SqlEditorDiagnostic = {
  readonly from: number;
  readonly to: number;
  readonly message: string;
};

export type SqlAnalysisResponse = {
  readonly paramsSchema?: JsonSchemaObject;
  readonly diagnostics?: readonly SqlEditorDiagnostic[];
};

export type QueryFileMutationResponse = {
  readonly id: string;
  readonly sqlFile: string;
};
