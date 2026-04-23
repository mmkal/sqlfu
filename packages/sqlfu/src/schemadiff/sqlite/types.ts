/*
 * SQLite-specific schemadiff types.
 * These types describe SQLite inspection output and SQLite planner operations; other dialects should define their own sibling models.
 */
import type {Client} from '../../types.js';

export type SqliteInspectedDatabase = {
  tables: Record<string, SqliteInspectedTable>;
  views: Record<string, SqliteInspectedView>;
  triggers: Record<string, SqliteInspectedTrigger>;
};

export type SqliteInspectedTable = {
  name: string;
  createSql: string;
  columns: SqliteInspectedColumn[];
  primaryKey: string[];
  uniqueConstraints: SqliteUniqueConstraint[];
  indexes: Record<string, SqliteInspectedIndex>;
  foreignKeys: SqliteForeignKey[];
};

export type SqliteInspectedColumn = {
  name: string;
  declaredType: string;
  collation: string | null;
  notNull: boolean;
  defaultSql: string | null;
  primaryKeyPosition: number;
  hidden: number;
  generated: boolean;
};

export type SqliteUniqueConstraint = {
  columns: string[];
};

export type SqliteInspectedIndex = {
  name: string;
  createSql: string;
  unique: boolean;
  origin: string;
  columns: string[];
  where: string | null;
};

export type SqliteForeignKey = {
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onUpdate: string;
  onDelete: string;
  match: string;
};

export type SqliteInspectedView = {
  name: string;
  createSql: string;
  definition: string;
};

export type SqliteInspectedTrigger = {
  name: string;
  onName: string;
  createSql: string;
  normalizedSql: string;
};

export type DisposableClient = {
  client: Client;
  [Symbol.asyncDispose](): Promise<void>;
};

export type SchemadiffOperationKind =
  | 'drop-index'
  | 'drop-column'
  | 'create-index'
  | 'drop-view'
  | 'create-view'
  | 'drop-trigger'
  | 'create-trigger';

export type SchemadiffOperation = {
  id: string;
  kind: SchemadiffOperationKind;
  sql: string;
  dependencies: string[];
};

export type SqliteDependencyFactKind = 'view-dependency' | 'trigger-dependency';

export type SqliteDependencyFact = {
  kind: SqliteDependencyFactKind;
  ownerId: string;
  ownerName: string;
  dependsOnNames: string[];
  referencedColumnNames: string[];
};

export type SqliteExternalBlockerKind = 'index' | 'view' | 'trigger';

export type SqliteExternalBlockerRecord = {
  kind: SqliteExternalBlockerKind;
  objectId: string;
  objectName: string;
  tableName: string;
  referencedColumnNames: string[];
  dependencyNames: string[];
};

export type SqliteColumnDropDependencyAnalysis = {
  tableName: string;
  removedColumnNames: string[];
  viewDependencyFacts: SqliteDependencyFact[];
  triggerDependencyFacts: SqliteDependencyFact[];
  affectedViewNames: string[];
  affectedTriggerNames: string[];
  externalBlockers: SqliteExternalBlockerRecord[];
};
