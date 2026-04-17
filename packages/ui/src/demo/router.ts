import type {RouterClient} from '@orpc/server';
import type {UiRouter} from 'sqlfu/ui/browser';

import type {WasmSqliteClient} from './sqlite-wasm-client.js';

const DEMO_PROJECT_ROOT = 'demo.local.sqlfu.dev';
const DEMO_PROJECT_NAME = 'demo';
const PAGE_SIZE = 25;

const SEED_SCHEMA_SQL = `
create table posts (
  id integer primary key,
  slug text not null unique,
  title text not null,
  body text not null,
  published integer not null
);

create view post_cards as
select id, slug, title, published
from posts;
`.trim();

const SEED_DATA_SQL = `
insert into posts (slug, title, body, published) values
  ('hello-world', 'Hello World', 'First post body', 1),
  ('draft-notes', 'Draft Notes', 'Unpublished notes', 0);
`.trim();

function notSupported(feature: string): never {
  throw new Error(`${feature} is not available in demo mode. Open local.sqlfu.dev with a real sqlfu project to use this feature.`);
}

export function createDemoRouterClient(input: {
  client: WasmSqliteClient;
  onSchemaChange: () => void;
}): RouterClient<UiRouter> {
  seedDatabase(input.client);

  const client = input.client;
  const notifySchemaChange = input.onSchemaChange;

  const list = (relationName: string, page: number) => listTableRows(client, relationName, page);

  const router = {
    project: {
      async status() {
        return {
          initialized: true as const,
          projectRoot: DEMO_PROJECT_ROOT,
        };
      },
    },
    schema: {
      async get() {
        const relations = client.all<{name: string; type: string; sql: string | null}>(
          `select name, type, sql from sqlite_schema
           where type in ('table', 'view')
             and name not like 'sqlite_%'
           order by type, name`,
          [],
        );

        return {
          projectName: DEMO_PROJECT_NAME,
          projectRoot: DEMO_PROJECT_ROOT,
          relations: relations.map((relation) => ({
            name: String(relation.name),
            kind: (relation.type === 'view' ? 'view' : 'table') as 'table' | 'view',
            rowCount: relation.type === 'table' ? getRelationCount(client, String(relation.name)) : undefined,
            columns: getRelationColumns(client, String(relation.name)),
            sql: typeof relation.sql === 'string' ? relation.sql : undefined,
          })),
        };
      },
      async check() {
        return {
          cards: [],
          recommendations: [],
        };
      },
      authorities: {
        async get() {
          return {
            desiredSchemaSql: `${SEED_SCHEMA_SQL}\n`,
            migrations: [],
            migrationHistory: [],
            liveSchemaSql: `${SEED_SCHEMA_SQL}\n`,
          };
        },
        async resultantSchema() {
          return notSupported('Migration authorities');
        },
      },
      async command() {
        return notSupported('Schema commands');
      },
      async definitions() {
        return notSupported('Editing definitions.sql');
      },
    },
    catalog: async () => ({
      queries: [],
    }),
    table: {
      list: async ({relationName, page}: {relationName: string; page: number}) => list(relationName, page),
      save: async (input: {
        relationName: string;
        page: number;
        originalRows: readonly Record<string, unknown>[];
        rows: readonly Record<string, unknown>[];
        rowKeys: readonly TableRowKey[];
      }) => {
        saveTableRows(client, input);
        notifySchemaChange();
        return list(input.relationName, input.page);
      },
      delete: async (input: {
        relationName: string;
        page: number;
        originalRow: Record<string, unknown>;
        rowKey: TableRowKey;
      }) => {
        deleteTableRow(client, input);
        notifySchemaChange();
        return list(input.relationName, input.page);
      },
    },
    sql: {
      run: async ({sql, params}: {sql: string; params?: unknown}) => {
        const trimmedSql = sql.trim();
        if (!trimmedSql) {
          throw new Error('SQL is required');
        }
        const boundArgs = resolveBindings(params);
        const returnsRows = client.columnCount(trimmedSql) > 0;
        if (returnsRows) {
          const rows = client.all<Record<string, unknown>>(trimmedSql, boundArgs as never);
          notifySchemaChange();
          return {
            sql: trimmedSql,
            mode: 'rows' as const,
            rows,
          };
        }
        const result = client.run(trimmedSql, boundArgs as never);
        notifySchemaChange();
        return {
          sql: trimmedSql,
          mode: 'metadata' as const,
          metadata: {
            rowsAffected: result.rowsAffected,
            lastInsertRowid: result.lastInsertRowid,
          },
        };
      },
      analyze: async () => ({}),
      save: async () => notSupported('Saving queries'),
    },
    query: {
      execute: async () => notSupported('Executing saved queries'),
      update: async () => notSupported('Editing saved queries'),
      rename: async () => notSupported('Renaming saved queries'),
      delete: async () => notSupported('Deleting saved queries'),
    },
  };

  return router as unknown as RouterClient<UiRouter>;
}

type TableRowKey =
  | {kind: 'primaryKey'; values: Record<string, unknown>}
  | {kind: 'new'; value: string}
  | {kind: 'rowid'; value: number};

function seedDatabase(client: WasmSqliteClient) {
  client.exec(SEED_SCHEMA_SQL);
  client.exec(SEED_DATA_SQL);
}

function getRelationColumns(client: WasmSqliteClient, relationName: string) {
  const rows = client.all<Record<string, unknown>>(
    `pragma table_xinfo("${escapeIdentifier(relationName)}")`,
    [],
  );
  return rows
    .filter((row) => Number(row.hidden ?? 0) === 0)
    .map((row) => ({
      name: String(row.name),
      type: typeof row.type === 'string' ? row.type : '',
      notNull: Number(row.notnull ?? 0) === 1,
      primaryKey: Number(row.pk ?? 0) >= 1,
    }));
}

function getRelationCount(client: WasmSqliteClient, relationName: string) {
  const rows = client.all<{count: number}>(
    `select count(*) as count from "${escapeIdentifier(relationName)}"`,
    [],
  );
  return Number(rows[0]?.count ?? 0);
}

function getRelationInfo(client: WasmSqliteClient, relationName: string) {
  const rows = client.all<{name: string; type: string}>(
    `select name, type from sqlite_schema where name = ?`,
    [relationName],
  );
  const relation = rows[0];
  if (!relation || (relation.type !== 'table' && relation.type !== 'view')) {
    throw new Error(`Unknown relation "${relationName}"`);
  }
  return relation;
}

function listTableRows(client: WasmSqliteClient, relationName: string, page: number) {
  const safePage = Math.max(0, page);
  const relation = getRelationInfo(client, relationName);
  const relationColumns = getRelationColumns(client, relationName);
  const columns = relationColumns.map((column) => column.name);
  const primaryKeyColumns = relationColumns.filter((column) => column.primaryKey).map((column) => column.name);
  const includeRowid = relation.type === 'table' && primaryKeyColumns.length === 0;
  const rows = client.all<Record<string, unknown>>(
    `select ${includeRowid ? 'rowid as "__sqlfu_rowid__", ' : ''}* from "${escapeIdentifier(relationName)}" limit ? offset ?`,
    [PAGE_SIZE, safePage * PAGE_SIZE],
  );

  return {
    relation: relationName,
    page: safePage,
    pageSize: PAGE_SIZE,
    editable: relation.type === 'table',
    rowKeys: relation.type === 'table'
      ? rows.map((row) => buildTableRowKey(row, primaryKeyColumns))
      : [],
    columns,
    rows: rows.map(stripInternalRowValues),
  };
}

function saveTableRows(
  client: WasmSqliteClient,
  input: {
    relationName: string;
    originalRows: readonly Record<string, unknown>[];
    rows: readonly Record<string, unknown>[];
    rowKeys: readonly TableRowKey[];
  },
) {
  const relation = getRelationInfo(client, input.relationName);
  if (relation.type !== 'table') {
    throw new Error(`Relation "${input.relationName}" is not editable`);
  }

  if (input.originalRows.length !== input.rows.length || input.rows.length !== input.rowKeys.length) {
    throw new Error('Edited rows payload is malformed');
  }

  for (let index = 0; index < input.rows.length; index += 1) {
    const nextRow = input.rows[index]!;
    const originalRow = input.originalRows[index]!;
    const normalizedNextRow = normalizeEditedRow(nextRow, originalRow);
    const changedColumns = Object.keys(normalizedNextRow).filter(
      (column) => !isSameValue(normalizedNextRow[column], originalRow[column]),
    );
    if (changedColumns.length === 0) {
      continue;
    }

    const rowKey = input.rowKeys[index]!;
    const statement = rowKey.kind === 'new'
      ? buildInsertRowStatement(input.relationName, normalizedNextRow, changedColumns)
      : buildUpdateRowStatement(input.relationName, rowKey, normalizedNextRow, changedColumns);
    client.run(statement.sql, statement.args as never);
  }
}

function deleteTableRow(
  client: WasmSqliteClient,
  input: {
    relationName: string;
    originalRow: Record<string, unknown>;
    rowKey: TableRowKey;
  },
) {
  const relation = getRelationInfo(client, input.relationName);
  if (relation.type !== 'table') {
    throw new Error(`Relation "${input.relationName}" is not editable`);
  }
  if (input.rowKey.kind === 'new') {
    throw new Error('Cannot delete a new row');
  }

  const whereClauseParts = buildRowWhereClause(input.rowKey);
  const exactMatchParts = buildExactRowMatchClause(input.originalRow);
  const result = client.run(
    `delete from "${escapeIdentifier(input.relationName)}" where (${whereClauseParts.sql}) and (${exactMatchParts.sql})`,
    [...whereClauseParts.args, ...exactMatchParts.args] as never,
  );
  if (result.rowsAffected !== 1) {
    throw new Error(`Delete affected ${result.rowsAffected} rows`);
  }
}

function buildTableRowKey(row: Record<string, unknown>, primaryKeyColumns: readonly string[]): TableRowKey {
  if (primaryKeyColumns.length > 0) {
    return {
      kind: 'primaryKey',
      values: Object.fromEntries(primaryKeyColumns.map((column) => [column, row[column]])),
    };
  }
  const rowid = row.__sqlfu_rowid__;
  if (typeof rowid !== 'number') {
    throw new Error('Editable table row is missing rowid');
  }
  return {
    kind: 'rowid',
    value: rowid,
  };
}

function stripInternalRowValues(row: Record<string, unknown>) {
  const nextRow = {...row};
  delete nextRow.__sqlfu_rowid__;
  return nextRow;
}

function buildRowWhereClause(rowKey: Exclude<TableRowKey, {kind: 'new'}>) {
  if (rowKey.kind === 'rowid') {
    return {sql: 'rowid = ?', args: [rowKey.value] as unknown[]};
  }
  const entries = Object.entries(rowKey.values);
  return {
    sql: entries.map(([column, value]) => (value == null ? `"${escapeIdentifier(column)}" is null` : `"${escapeIdentifier(column)}" = ?`)).join(' and '),
    args: entries.flatMap(([, value]) => (value == null ? [] : [normalizeDbValue(value)])),
  };
}

function buildExactRowMatchClause(row: Record<string, unknown>) {
  const entries = Object.entries(row);
  return {
    sql: entries.map(([column, value]) => (value == null ? `"${escapeIdentifier(column)}" is null` : `"${escapeIdentifier(column)}" = ?`)).join(' and '),
    args: entries.flatMap(([, value]) => (value == null ? [] : [normalizeDbValue(value)])),
  };
}

function buildInsertRowStatement(
  relationName: string,
  nextRow: Record<string, unknown>,
  changedColumns: readonly string[],
) {
  const columns = changedColumns.map((column) => `"${escapeIdentifier(column)}"`).join(', ');
  const placeholders = changedColumns.map(() => '?').join(', ');
  return {
    sql: `insert into "${escapeIdentifier(relationName)}" (${columns}) values (${placeholders})`,
    args: changedColumns.map((column) => normalizeDbValue(nextRow[column])),
  };
}

function buildUpdateRowStatement(
  relationName: string,
  rowKey: Exclude<TableRowKey, {kind: 'new'}>,
  nextRow: Record<string, unknown>,
  changedColumns: readonly string[],
) {
  const setSql = changedColumns.map((column) => `"${escapeIdentifier(column)}" = ?`).join(', ');
  const setArgs = changedColumns.map((column) => normalizeDbValue(nextRow[column]));
  const whereClause = buildRowWhereClause(rowKey);
  return {
    sql: `update "${escapeIdentifier(relationName)}" set ${setSql} where ${whereClause.sql}`,
    args: [...setArgs, ...whereClause.args],
  };
}

function normalizeEditedRow(nextRow: Record<string, unknown>, originalRow: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(nextRow).map(([column, value]) => [column, coerceEditedValue(value, originalRow[column])]),
  );
}

function coerceEditedValue(value: unknown, originalValue: unknown) {
  if (typeof originalValue === 'number' && typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  return value;
}

function normalizeDbValue(value: unknown) {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return value;
}

function isSameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function escapeIdentifier(value: string) {
  return value.replaceAll('"', '""');
}

function resolveBindings(params: unknown): unknown[] | Record<string, unknown> {
  if (params == null || params === '') {
    return [];
  }
  if (Array.isArray(params)) {
    return params.map((value) => normalizeDbValue(value));
  }
  if (typeof params !== 'object') {
    throw new Error('SQL runner params must be an object or array');
  }
  const paramsRecord = params as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(paramsRecord).map(([name, value]) => [`:${name.replace(/^[:@$]/, '')}`, normalizeDbValue(value)]),
  );
}
