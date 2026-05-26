import type {JsonSchemaObject} from '../typegen/query-catalog.js';

export type StudioSchemaResponse = {
  projectName: string;
  projectRoot: string;
  relations: StudioRelation[];
};

export type SchemaCheckCard = {
  key: 'repoDrift' | 'pendingMigrations' | 'historyDrift' | 'schemaDrift' | 'syncDrift';
  variant: 'ok' | 'warn' | 'info';
  title: string;
  okTitle: string;
  explainer: string;
  ok: boolean;
  summary: string;
  details: string[];
};

export type SchemaCheckRecommendation = {
  kind: string;
  command?: [string, ...string[]];
  label: string;
  rationale?: string;
};

export type SchemaCheckResponse = {
  cards: SchemaCheckCard[];
  recommendations: SchemaCheckRecommendation[];
  error?: string;
};

export type SchemaAuthorityMigration = {
  id: string;
  fileName: string | null;
  timestamp?: string;
  name: string;
  content: string;
  applied: boolean;
  applied_at: string | null;
  integrity: 'ok' | 'checksum mismatch' | null;
};

export type SchemaAuthoritiesResponse = {
  desiredSchemaSql: string;
  migrations: SchemaAuthorityMigration[];
  migrationHistory: SchemaAuthorityMigration[];
  liveSchemaSql: string;
};

export type MigrationResultantSchemaResponse = {
  sql: string;
};

export type StudioRelation = {
  name: string;
  kind: 'table' | 'view';
  columns: StudioColumn[];
  foreignKeys: StudioForeignKey[];
  referencedBy: StudioReverseForeignKey[];
  rowCount?: number;
  sql?: string;
};

export type StudioColumn = {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
};

export type StudioForeignKey = {
  columns: string[];
  referencedRelation: string;
  referencedColumns: string[];
};

export type StudioReverseForeignKey = {
  relation: string;
  columns: string[];
  referencedColumns: string[];
};

export type TableRowsResponse = {
  relation: string;
  page: number;
  pageSize: number;
  editable: boolean;
  rowKeys: TableRowKey[];
  rows: Record<string, unknown>[];
  columns: string[];
};

export type TableRowKey =
  | {
      kind: 'primaryKey';
      values: Readonly<Record<string, unknown>>;
    }
  | {
      kind: 'new';
      value: string;
    }
  | {
      kind: 'rowid';
      value: number;
    };

export type QueryExecutionResponse = {
  mode: 'rows' | 'metadata';
  rows?: Record<string, unknown>[];
  metadata?: {
    rowsAffected?: number;
    lastInsertRowid?: string | number | bigint | null;
  };
};

export type SqlRunnerResponse = QueryExecutionResponse & {
  sql: string;
};

export type SaveSqlResponse = {
  savedPath: string;
};

export type SqlEditorDiagnostic = {
  from: number;
  to: number;
  message: string;
};

export type SqlAnalysisResponse = {
  paramsSchema?: JsonSchemaObject;
  diagnostics?: SqlEditorDiagnostic[];
};

export type QueryFileMutationResponse = {
  id: string;
  sqlFile: string;
};
