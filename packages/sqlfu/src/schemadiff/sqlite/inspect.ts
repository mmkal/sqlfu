/*
 * SQLite-specific schema inspection.
 * This file owns reading SQLite catalogs and PRAGMA output into normalized inspected objects, and is the seam for future non-SQLite inspectors.
 *
 * Inspired by @pgkit/schemainspect (https://github.com/mmkal/pgkit/tree/main/packages/schemainspect), which is itself a
 * TypeScript port of djrobstep's Python `schemainspect` (https://github.com/djrobstep/schemainspect). SQLite's catalog is
 * very different from Postgres', so the queries and the inspected model shape are sqlfu-specific. What is borrowed is the
 * idea of representing the database as a typed inspected object tree before diffing, rather than diffing SQL text directly.
 */
import type {Client} from '../../core/types.js';
import {quoteSqlString} from './identifiers.js';
import {
  extractWhereClause,
  normalizeComparableSql,
  normalizeIdentifierToken,
  normalizeStoredSql,
  normalizeViewDefinition,
  splitTopLevelCommaList,
} from './sqltext.js';
import type {
  SqliteForeignKey,
  SqliteInspectedDatabase,
  SqliteInspectedIndex,
  SqliteInspectedTrigger,
  SqliteUniqueConstraint,
} from './types.js';

export async function inspectSqliteSchema(client: Client, schemaName = 'main'): Promise<SqliteInspectedDatabase> {
  await assertNoUnsupportedSchemaFeatures(client, schemaName);

  const objects = await client.all<{
    type: 'table' | 'view';
    name: string;
    sql: string | null;
  }>({
    sql: `
      select type, name, sql
      from ${schemaName}.sqlite_schema
      where type in ('table', 'view')
        and name not like 'sqlite_%'
      order by type, name
    `,
    args: [],
  });

  const tables: SqliteInspectedDatabase['tables'] = {};
  const views: SqliteInspectedDatabase['views'] = {};
  const triggers: SqliteInspectedDatabase['triggers'] = {};

  for (const object of objects) {
    if (object.type === 'view') {
      const createSql = normalizeStoredSql(object.sql || '');
      views[object.name] = {
        name: object.name,
        createSql,
        definition: normalizeViewDefinition(createSql),
      };
      continue;
    }

    const tableNameLiteral = quoteSqlString(object.name);
    const columns = await client.all<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
      hidden: number;
    }>({
      sql: `select name, type, "notnull", dflt_value, pk, hidden from pragma_table_xinfo(${tableNameLiteral}) order by cid`,
      args: [],
    });
    const indexList = await client.all<{
      name: string;
      unique: number;
      origin: string;
      partial: number;
    }>({
      sql: `select name, "unique", origin, partial from pragma_index_list(${tableNameLiteral}) order by name`,
      args: [],
    });
    const foreignKeyRows = await client.all<{
      id: number;
      seq: number;
      table: string;
      from: string;
      to: string | null;
      on_update: string;
      on_delete: string;
      match: string;
    }>({
      sql: `select id, seq, "table", "from", "to", on_update, on_delete, match from pragma_foreign_key_list(${tableNameLiteral}) order by id, seq`,
      args: [],
    });

    const explicitIndexes: SqliteInspectedDatabase['tables'][string]['indexes'] = {};
    const uniqueConstraints: SqliteUniqueConstraint[] = [];
    const createSql = normalizeStoredSql(object.sql || '');
    const columnCollations = extractTableColumnCollations(createSql);

    for (const index of indexList) {
      const indexNameLiteral = quoteSqlString(index.name);
      const indexColumns = await client.all<{
        seqno: number;
        cid: number;
        name: string | null;
        key: number;
      }>({
        sql: `select seqno, cid, name, key from pragma_index_xinfo(${indexNameLiteral}) where key = 1 order by seqno`,
        args: [],
      });
      const createSqlRow = await client.all<{sql: string | null}>({
        sql: `select sql from ${schemaName}.sqlite_schema where type = 'index' and name = ${indexNameLiteral}`,
        args: [],
      });
      const indexInfo = {
        name: index.name,
        createSql: normalizeStoredSql(createSqlRow[0]?.sql || ''),
        unique: Boolean(index.unique),
        origin: index.origin,
        columns: indexColumns.map((column) => column.name || `expression:${column.seqno}`),
        where: extractWhereClause(createSqlRow[0]?.sql || ''),
      } satisfies SqliteInspectedIndex;

      if (indexInfo.unique && index.origin !== 'c') {
        uniqueConstraints.push({columns: [...indexInfo.columns]});
      }

      if (indexInfo.createSql) {
        explicitIndexes[indexInfo.name] = indexInfo;
      }
    }

    tables[object.name] = {
      name: object.name,
      createSql,
      columns: columns.map((column) => ({
        name: column.name,
        declaredType: normalizeDeclaredType(column.type),
        collation: columnCollations.get(column.name) || null,
        notNull: Boolean(column.notnull),
        defaultSql: normalizeDefaultSql(column.dflt_value),
        primaryKeyPosition: column.pk,
        hidden: column.hidden,
        generated: column.hidden > 1,
      })),
      primaryKey: columns
        .filter((column) => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map((column) => column.name),
      uniqueConstraints: sortUniqueConstraints(uniqueConstraints),
      indexes: explicitIndexes,
      foreignKeys: groupForeignKeys(foreignKeyRows),
    };
  }

  const triggerRows = await client.all<{
    name: string;
    tbl_name: string;
    sql: string | null;
  }>({
    sql: `
      select name, tbl_name, sql
      from ${schemaName}.sqlite_schema
      where type = 'trigger'
        and name not like 'sqlite_%'
      order by name
    `,
    args: [],
  });

  for (const trigger of triggerRows) {
    const createSql = normalizeStoredSql(trigger.sql || '');
    triggers[trigger.name] = {
      name: trigger.name,
      onName: trigger.tbl_name,
      createSql,
      normalizedSql: normalizeComparableSql(createSql),
    } satisfies SqliteInspectedTrigger;
  }

  return {tables, views, triggers};
}

async function assertNoUnsupportedSchemaFeatures(client: Client, schemaName: string): Promise<void> {
  const unsupportedSqlRows = await client.all<{
    type: string;
    name: string;
    sql: string | null;
  }>({
    sql: `
      select type, name, sql
      from ${schemaName}.sqlite_schema
      where sql is not null
        and name not like 'sqlite_%'
      order by type, name
    `,
    args: [],
  });

  for (const row of unsupportedSqlRows) {
    const normalizedSql = row.sql?.toLowerCase() || '';
    if (/^create\s+virtual\s+table\b/u.test(normalizedSql)) {
      throw new Error(`sqlite virtual tables are not supported by the native schema diff engine yet: ${row.name}`);
    }
  }
}

function extractTableColumnCollations(createSql: string): Map<string, string> {
  const match = createSql.match(/\(([\s\S]*)\)$/u);
  if (!match) {
    return new Map();
  }

  const definitions = splitTopLevelCommaList(match[1]!);
  const collations = new Map<string, string>();

  for (const definition of definitions) {
    const trimmed = definition.trim();
    if (!trimmed || /^(constraint|primary\s+key|unique|foreign\s+key|check)\b/iu.test(trimmed)) {
      continue;
    }

    const nameMatch = trimmed.match(/^(?:"((?:[^"]|"")*)"|`([^`]+)`|\[([^\]]+)\]|([^\s]+))(?:\s+|$)/u);
    if (!nameMatch) {
      continue;
    }

    const columnName = normalizeIdentifierToken(nameMatch[1] || nameMatch[2] || nameMatch[3] || nameMatch[4] || '');
    const collationMatch = trimmed.match(/\bcollate\s+("(?:(?:[^"]|"")*)"|`[^`]+`|\[[^\]]+\]|[a-z0-9_]+)/iu);
    if (columnName && collationMatch) {
      collations.set(columnName, normalizeIdentifierToken(collationMatch[1]!));
    }
  }

  return collations;
}

function groupForeignKeys(
  rows: {
    id: number;
    seq: number;
    table: string;
    from: string;
    to: string | null;
    on_update: string;
    on_delete: string;
    match: string;
  }[],
): SqliteForeignKey[] {
  const grouped = new Map<number, SqliteForeignKey & {columns: string[]; referencedColumns: string[]}>();

  for (const row of rows) {
    const existing = grouped.get(row.id);
    if (existing) {
      existing.columns.push(row.from);
      existing.referencedColumns.push(row.to || row.from);
      continue;
    }

    grouped.set(row.id, {
      columns: [row.from],
      referencedTable: row.table,
      referencedColumns: [row.to || row.from],
      onUpdate: row.on_update.toLowerCase(),
      onDelete: row.on_delete.toLowerCase(),
      match: row.match.toLowerCase(),
    });
  }

  return [...grouped.values()]
    .map((foreignKey) => ({
      ...foreignKey,
      columns: [...foreignKey.columns],
      referencedColumns: [...foreignKey.referencedColumns],
    }))
    .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
}

function sortUniqueConstraints(
  uniqueConstraints: SqliteUniqueConstraint[],
): SqliteUniqueConstraint[] {
  return [...uniqueConstraints].sort((left, right) =>
    left.columns.join('\u0000').localeCompare(right.columns.join('\u0000')),
  );
}

function normalizeDeclaredType(type: string | null | undefined): string {
  return String(type || '')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

function normalizeDefaultSql(value: string | null): string | null {
  if (value == null) {
    return null;
  }
  return value.trim().replace(/\s+/gu, ' ');
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, currentValue: unknown) => {
    if (Array.isArray(currentValue) || currentValue == null || typeof currentValue !== 'object') {
      return currentValue;
    }
    return Object.fromEntries(
      Object.entries(currentValue as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)),
    );
  });
}
