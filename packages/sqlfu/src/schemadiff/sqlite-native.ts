import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

import {createBunClient, createNodeSqliteClient} from '../client.js';
import {splitSqlStatements} from '../core/sqlite.js';
import type {Client} from '../core/types.js';

export type SqliteInspectedDatabase = {
  readonly tables: Record<string, SqliteInspectedTable>;
  readonly views: Record<string, SqliteInspectedView>;
  readonly triggers: Record<string, SqliteInspectedTrigger>;
};

type SqliteInspectedTable = {
  readonly name: string;
  readonly createSql: string;
  readonly columns: readonly SqliteInspectedColumn[];
  readonly primaryKey: readonly string[];
  readonly uniqueConstraints: readonly SqliteUniqueConstraint[];
  readonly indexes: Record<string, SqliteInspectedIndex>;
  readonly foreignKeys: readonly SqliteForeignKey[];
};

type SqliteInspectedColumn = {
  readonly name: string;
  readonly declaredType: string;
  readonly collation: string | null;
  readonly notNull: boolean;
  readonly defaultSql: string | null;
  readonly primaryKeyPosition: number;
  readonly hidden: number;
  readonly generated: boolean;
};

type SqliteUniqueConstraint = {
  readonly columns: readonly string[];
};

type SqliteInspectedIndex = {
  readonly name: string;
  readonly createSql: string;
  readonly unique: boolean;
  readonly origin: string;
  readonly columns: readonly string[];
  readonly where: string | null;
};

type SqliteForeignKey = {
  readonly columns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  readonly onUpdate: string;
  readonly onDelete: string;
  readonly match: string;
};

type SqliteInspectedView = {
  readonly name: string;
  readonly createSql: string;
  readonly definition: string;
};

type SqliteInspectedTrigger = {
  readonly name: string;
  readonly onName: string;
  readonly createSql: string;
  readonly normalizedSql: string;
};

type DisposableClient = {
  readonly client: Client;
  [Symbol.asyncDispose](): Promise<void>;
};

export async function diffBaselineSqlToDesiredSqlNative(
  config: {projectRoot: string; tempDir?: string},
  input: {
    baselineSql: string;
    desiredSql: string;
    allowDestructive: boolean;
  },
): Promise<string[]> {
  assertNoUnsupportedSqlText(input.baselineSql, 'baselineSql');
  assertNoUnsupportedSqlText(input.desiredSql, 'desiredSql');

  await using baseline = await createScratchDatabase(config, 'baseline');
  await using desired = await createScratchDatabase(config, 'desired');

  if (input.baselineSql.trim()) {
    await applySchemaSql(baseline.client, input.baselineSql);
  }

  if (input.desiredSql.trim()) {
    await applySchemaSql(desired.client, input.desiredSql);
  }

  const [baselineSchema, desiredSchema] = await Promise.all([
    inspectSqliteSchema(baseline.client),
    inspectSqliteSchema(desired.client),
  ]);

  return planSchemaDiff({
    baseline: baselineSchema,
    desired: desiredSchema,
    allowDestructive: input.allowDestructive,
  });
}

export async function inspectSqliteSchemaSql(
  config: {projectRoot: string; tempDir?: string},
  sql: string,
): Promise<SqliteInspectedDatabase> {
  await using database = await createScratchDatabase(config, 'inspect');
  if (sql.trim()) {
    await applySchemaSql(database.client, sql);
  }
  return await inspectSqliteSchema(database.client);
}

export async function inspectSqliteSchema(client: Client, schemaName = 'main'): Promise<SqliteInspectedDatabase> {
  await assertNoUnsupportedSchemaFeatures(client, schemaName);

  const objects = await client.all<{
    readonly type: 'table' | 'view';
    readonly name: string;
    readonly sql: string | null;
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

  const tables: Record<string, SqliteInspectedTable> = {};
  const views: Record<string, SqliteInspectedView> = {};
  const triggers: Record<string, SqliteInspectedTrigger> = {};

  for (const object of objects) {
    if (object.type === 'view') {
      const createSql = normalizeStoredSql(object.sql ?? '');
      views[object.name] = {
        name: object.name,
        createSql,
        definition: normalizeViewDefinition(createSql),
      };
      continue;
    }

    const tableNameLiteral = quoteSqlString(object.name);
    const columns = await client.all<{
      readonly name: string;
      readonly type: string;
      readonly notnull: number;
      readonly dflt_value: string | null;
      readonly pk: number;
      readonly hidden: number;
    }>({
      sql: `select name, type, "notnull", dflt_value, pk, hidden from pragma_table_xinfo(${tableNameLiteral}) order by cid`,
      args: [],
    });
    const indexList = await client.all<{
      readonly name: string;
      readonly unique: number;
      readonly origin: string;
      readonly partial: number;
    }>({
      sql: `select name, "unique", origin, partial from pragma_index_list(${tableNameLiteral}) order by name`,
      args: [],
    });
    const foreignKeyRows = await client.all<{
      readonly id: number;
      readonly seq: number;
      readonly table: string;
      readonly from: string;
      readonly to: string | null;
      readonly on_update: string;
      readonly on_delete: string;
      readonly match: string;
    }>({
      sql: `select id, seq, "table", "from", "to", on_update, on_delete, match from pragma_foreign_key_list(${tableNameLiteral}) order by id, seq`,
      args: [],
    });

    const explicitIndexes: Record<string, SqliteInspectedIndex> = {};
    const uniqueConstraints: SqliteUniqueConstraint[] = [];
    const createSql = normalizeStoredSql(object.sql ?? '');
    const columnCollations = extractTableColumnCollations(createSql);

    for (const index of indexList) {
      const indexNameLiteral = quoteSqlString(index.name);
      const indexColumns = await client.all<{
        readonly seqno: number;
        readonly cid: number;
        readonly name: string | null;
        readonly key: number;
      }>({
        sql: `select seqno, cid, name, key from pragma_index_xinfo(${indexNameLiteral}) where key = 1 order by seqno`,
        args: [],
      });
      const createSqlRow = await client.all<{readonly sql: string | null}>({
        sql: `select sql from ${schemaName}.sqlite_schema where type = 'index' and name = ${indexNameLiteral}`,
        args: [],
      });
      const indexInfo = {
        name: index.name,
        createSql: normalizeStoredSql(createSqlRow[0]?.sql ?? ''),
        unique: Boolean(index.unique),
        origin: index.origin,
        columns: indexColumns.map((column) => column.name ?? `expression:${column.seqno}`),
        where: extractWhereClause(createSqlRow[0]?.sql ?? ''),
      } satisfies SqliteInspectedIndex;

      if (indexInfo.unique && index.origin !== 'c') {
        uniqueConstraints.push({columns: [...indexInfo.columns]});
      }

      if (indexInfo.createSql) {
        explicitIndexes[indexInfo.name] = indexInfo;
      }
    }

    const foreignKeys = groupForeignKeys(foreignKeyRows);

    tables[object.name] = {
      name: object.name,
      createSql,
      columns: columns.map((column) => ({
        name: column.name,
        declaredType: normalizeDeclaredType(column.type),
        collation: columnCollations.get(column.name) ?? null,
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
      foreignKeys,
    };
  }

  const triggerRows = await client.all<{
    readonly name: string;
    readonly tbl_name: string;
    readonly sql: string | null;
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
    const createSql = normalizeStoredSql(trigger.sql ?? '');
    triggers[trigger.name] = {
      name: trigger.name,
      onName: trigger.tbl_name,
      createSql,
      normalizedSql: normalizeComparableSql(createSql),
    };
  }

  return {tables, views, triggers};
}

export function schemasEqual(left: SqliteInspectedDatabase, right: SqliteInspectedDatabase): boolean {
  return stableStringify(toComparableSchema(left)) === stableStringify(toComparableSchema(right));
}

function planSchemaDiff(input: {
  baseline: SqliteInspectedDatabase;
  desired: SqliteInspectedDatabase;
  allowDestructive: boolean;
}): string[] {
  const statements: string[] = [];
  const removedViewNames = sortedRemovedKeys(input.baseline.views, input.desired.views);
  const addedViewNames = sortedAddedKeys(input.baseline.views, input.desired.views);
  const modifiedViewNames = sortedModifiedKeys(input.baseline.views, input.desired.views, viewEquals);
  const removedTriggerNames = sortedRemovedKeys(input.baseline.triggers, input.desired.triggers);
  const addedTriggerNames = sortedAddedKeys(input.baseline.triggers, input.desired.triggers);
  const modifiedTriggerNames = sortedModifiedKeys(input.baseline.triggers, input.desired.triggers, triggerEquals);

  const removedTableNames = Object.keys(input.baseline.tables)
    .filter((name) => !(name in input.desired.tables))
    .sort((left, right) => left.localeCompare(right));
  const addedTableNames = topologicallySortTables(input.desired.tables)
    .filter((name) => !(name in input.baseline.tables));
  const commonTableNames = Object.keys(input.desired.tables)
    .filter((name) => name in input.baseline.tables)
    .sort((left, right) => left.localeCompare(right));

  const changedTables = new Set<string>();
  const explicitIndexDrops: string[] = [];
  const explicitIndexCreates: string[] = [];

  for (const tableName of commonTableNames) {
    const baselineTable = input.baseline.tables[tableName]!;
    const desiredTable = input.desired.tables[tableName]!;
    const classification = classifyTableChange(baselineTable, desiredTable);

    if (classification.kind !== 'none') {
      changedTables.add(tableName);
    }

    if (classification.kind === 'add-columns') {
      for (const column of classification.columns) {
        statements.push(`alter table ${quoteIdentifier(tableName)} add column ${columnDefinition(column)};`);
      }
      continue;
    }

    if (classification.kind === 'rebuild') {
      if (!input.allowDestructive) {
        throw new Error(`destructive schema change required for table ${tableName}`);
      }
      pushStatements(statements, planTableRebuild(baselineTable, desiredTable));
    }
  }

  const recreatedTriggerNames = Object.entries(input.desired.triggers)
    .filter(([, trigger]) => changedTables.has(trigger.onName) || modifiedViewNames.includes(trigger.onName))
    .map(([triggerName]) => triggerName)
    .sort((left, right) => left.localeCompare(right));

  for (const tableName of commonTableNames) {
    if (changedTables.has(tableName)) {
      continue;
    }
    const baselineTable = input.baseline.tables[tableName]!;
    const desiredTable = input.desired.tables[tableName]!;
    const baselineIndexes = baselineTable.indexes;
    const desiredIndexes = desiredTable.indexes;

    for (const indexName of sortedRemovedKeys(baselineIndexes, desiredIndexes)) {
      explicitIndexDrops.push(`drop index ${quoteIdentifier(indexName)};`);
    }

    for (const indexName of sortedModifiedKeys(baselineIndexes, desiredIndexes, indexEquals)) {
      explicitIndexDrops.push(`drop index ${quoteIdentifier(indexName)};`);
      explicitIndexCreates.push(withSemicolon(desiredIndexes[indexName]!.createSql));
    }

    for (const indexName of sortedAddedKeys(baselineIndexes, desiredIndexes)) {
      explicitIndexCreates.push(withSemicolon(desiredIndexes[indexName]!.createSql));
    }
  }

  const needsDestructive =
    removedTriggerNames.length > 0 ||
    removedViewNames.length > 0 ||
    removedTableNames.length > 0 ||
    modifiedViewNames.length > 0 ||
    modifiedTriggerNames.length > 0 ||
    explicitIndexDrops.length > 0;

  if (needsDestructive && !input.allowDestructive) {
    throw new Error('destructive schema changes are not allowed');
  }

  const prefixes: string[] = [];

  for (const triggerName of new Set([...removedTriggerNames, ...modifiedTriggerNames, ...recreatedTriggerNames].sort((left, right) => left.localeCompare(right)))) {
    prefixes.push(`drop trigger ${quoteIdentifier(triggerName)};`);
  }

  for (const viewName of [...removedViewNames, ...modifiedViewNames].sort((left, right) => left.localeCompare(right))) {
    prefixes.push(`drop view ${quoteIdentifier(viewName)};`);
  }

  for (const indexStatement of explicitIndexDrops.sort((left, right) => left.localeCompare(right))) {
    prefixes.push(indexStatement);
  }

  for (const tableName of addedTableNames) {
    statements.push(withSemicolon(input.desired.tables[tableName]!.createSql));
    for (const index of Object.values(input.desired.tables[tableName]!.indexes).sort((left, right) => left.name.localeCompare(right.name))) {
      explicitIndexCreates.push(withSemicolon(index.createSql));
    }
  }

  for (const tableName of removedTableNames) {
    statements.push(`drop table ${quoteIdentifier(tableName)};`);
  }

  for (const createIndex of explicitIndexCreates) {
    statements.push(createIndex);
  }

  for (const viewName of [...addedViewNames, ...modifiedViewNames].sort((left, right) => left.localeCompare(right))) {
    statements.push(withSemicolon(input.desired.views[viewName]!.createSql));
  }

  for (const triggerName of new Set([...addedTriggerNames, ...modifiedTriggerNames, ...recreatedTriggerNames].sort((left, right) => left.localeCompare(right)))) {
    statements.push(withSemicolon(input.desired.triggers[triggerName]!.createSql));
  }

  return [...prefixes, ...statements].flatMap(splitStatementForOutput).filter(Boolean);
}

function classifyTableChange(
  baseline: SqliteInspectedTable,
  desired: SqliteInspectedTable,
):
  | {kind: 'none'}
  | {kind: 'add-columns'; columns: readonly SqliteInspectedColumn[]}
  | {kind: 'rebuild'} {
  if (tableCoreEquals(baseline, desired)) {
    return {kind: 'none'};
  }

  if (
    arraysEqual(baseline.primaryKey, desired.primaryKey) &&
    stableStringify(baseline.uniqueConstraints) === stableStringify(desired.uniqueConstraints) &&
    stableStringify(baseline.foreignKeys) === stableStringify(desired.foreignKeys) &&
    baseline.columns.length <= desired.columns.length &&
    baseline.columns.every((column, index) => columnEquals(column, desired.columns[index]!))
  ) {
    const addedColumns = desired.columns.slice(baseline.columns.length);
    const canAddColumns = addedColumns.every((column) => !column.generated && column.hidden === 0);
    if (canAddColumns) {
      return {kind: 'add-columns', columns: addedColumns};
    }
  }

  return {kind: 'rebuild'};
}

function planTableRebuild(baseline: SqliteInspectedTable, desired: SqliteInspectedTable): string[] {
  const tempName = `__sqlfu_old_${desired.name}`;
  const introducedPrimaryKeyColumns = desired.primaryKey.filter(
    (columnName) => !baseline.primaryKey.includes(columnName) && !baseline.columns.some((column) => column.name === columnName),
  );
  if (introducedPrimaryKeyColumns.length > 0) {
    throw new Error(
      `automatic table rebuild for ${desired.name} would invent values for new primary key columns: ${introducedPrimaryKeyColumns.join(', ')}`,
    );
  }
  const copyableColumns = desired.columns.filter((desiredColumn) => {
    if (desiredColumn.generated || desiredColumn.hidden !== 0) {
      return false;
    }

    return baseline.columns.some((baselineColumn) => baselineColumn.name === desiredColumn.name && baselineColumn.hidden === 0);
  });

  const statements = [`alter table ${renderTableName(baseline.name)} rename to ${renderTableName(tempName)};`];
  statements.push(withSemicolon(desired.createSql));

  if (copyableColumns.length > 0) {
    const columnList = copyableColumns.map((column) => quoteIdentifier(column.name)).join(', ');
    statements.push(
      `insert into ${renderTableName(desired.name)}(${columnList}) select ${columnList} from ${renderTableName(tempName)};`,
    );
  }

  statements.push(`drop table ${renderTableName(tempName)};`);

  for (const index of Object.values(desired.indexes).sort((left, right) => left.name.localeCompare(right.name))) {
    statements.push(withSemicolon(index.createSql));
  }

  return statements;
}

function tableCoreEquals(left: SqliteInspectedTable, right: SqliteInspectedTable): boolean {
  return (
    left.columns.length === right.columns.length &&
    left.columns.every((column, index) => columnEquals(column, right.columns[index]!)) &&
    arraysEqual(left.primaryKey, right.primaryKey) &&
    stableStringify(left.uniqueConstraints) === stableStringify(right.uniqueConstraints) &&
    stableStringify(left.foreignKeys) === stableStringify(right.foreignKeys)
  );
}

function columnEquals(left: SqliteInspectedColumn, right: SqliteInspectedColumn): boolean {
  return stableStringify(left) === stableStringify(right);
}

function indexEquals(left: SqliteInspectedIndex, right: SqliteInspectedIndex): boolean {
  return stableStringify({
    createSql: normalizeComparableSql(left.createSql),
    unique: left.unique,
    origin: left.origin,
    columns: left.columns,
    where: left.where,
  }) === stableStringify({
    createSql: normalizeComparableSql(right.createSql),
    unique: right.unique,
    origin: right.origin,
    columns: right.columns,
    where: right.where,
  });
}

function viewEquals(left: SqliteInspectedView, right: SqliteInspectedView): boolean {
  return left.definition === right.definition;
}

function triggerEquals(left: SqliteInspectedTrigger, right: SqliteInspectedTrigger): boolean {
  return left.onName === right.onName && left.normalizedSql === right.normalizedSql;
}

function columnDefinition(column: SqliteInspectedColumn): string {
  let sql = `${quoteIdentifier(column.name)} ${column.declaredType}`.trimEnd();
  if (column.collation) {
    sql += ` collate ${column.collation}`;
  }
  if (column.notNull) {
    sql += ' not null';
  }
  if (column.defaultSql != null) {
    sql += ` default ${column.defaultSql}`;
  }
  return sql;
}

function topologicallySortTables(tables: Record<string, SqliteInspectedTable>): string[] {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const output: string[] = [];

  const visit = (tableName: string) => {
    if (visited.has(tableName)) {
      return;
    }
    if (visiting.has(tableName)) {
      return;
    }

    visiting.add(tableName);
    for (const foreignKey of tables[tableName]!.foreignKeys) {
      if (foreignKey.referencedTable in tables && foreignKey.referencedTable !== tableName) {
        visit(foreignKey.referencedTable);
      }
    }
    visiting.delete(tableName);
    visited.add(tableName);
    output.push(tableName);
  };

  for (const tableName of Object.keys(tables).sort((left, right) => left.localeCompare(right))) {
    visit(tableName);
  }

  return output;
}

function groupForeignKeys(rows: readonly {
  readonly id: number;
  readonly seq: number;
  readonly table: string;
  readonly from: string;
  readonly to: string | null;
  readonly on_update: string;
  readonly on_delete: string;
  readonly match: string;
}[]): readonly SqliteForeignKey[] {
  const grouped = new Map<number, SqliteForeignKey & {columns: string[]; referencedColumns: string[]}>();

  for (const row of rows) {
    const existing = grouped.get(row.id);
    if (existing) {
      existing.columns.push(row.from);
      existing.referencedColumns.push(row.to ?? row.from);
      continue;
    }

    grouped.set(row.id, {
      columns: [row.from],
      referencedTable: row.table,
      referencedColumns: [row.to ?? row.from],
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

function sortUniqueConstraints(uniqueConstraints: readonly SqliteUniqueConstraint[]): readonly SqliteUniqueConstraint[] {
  return [...uniqueConstraints].sort((left, right) => left.columns.join('\u0000').localeCompare(right.columns.join('\u0000')));
}

function sortedRemovedKeys<T>(baseline: Record<string, T>, desired: Record<string, T>): string[] {
  return Object.keys(baseline)
    .filter((key) => !(key in desired))
    .sort((left, right) => left.localeCompare(right));
}

function sortedAddedKeys<T>(baseline: Record<string, T>, desired: Record<string, T>): string[] {
  return Object.keys(desired)
    .filter((key) => !(key in baseline))
    .sort((left, right) => left.localeCompare(right));
}

function sortedModifiedKeys<T>(
  baseline: Record<string, T>,
  desired: Record<string, T>,
  equals: (left: T, right: T) => boolean,
): string[] {
  return Object.keys(desired)
    .filter((key) => key in baseline)
    .filter((key) => !equals(baseline[key]!, desired[key]!))
    .sort((left, right) => left.localeCompare(right));
}

async function createScratchDatabase(
  config: {projectRoot: string; tempDir?: string},
  slug: string,
): Promise<DisposableClient> {
  const tempRoot = config.tempDir ?? path.join(config.projectRoot, '.sqlfu', 'schemadiff-native');
  await fs.mkdir(tempRoot, {recursive: true});
  const dbPath = path.join(tempRoot, `${slug}-${randomUUID()}.db`);

  if ('Bun' in globalThis) {
    const {Database} = await import('bun:sqlite' as never);
    const database = new Database(dbPath);
    return {
      client: createBunClient(database as Parameters<typeof createBunClient>[0]),
      async [Symbol.asyncDispose]() {
        database.close();
        await cleanupDbFiles(dbPath);
      },
    };
  }

  const {DatabaseSync} = await import('node:sqlite');
  const database = new DatabaseSync(dbPath);
  return {
    client: createNodeSqliteClient(database as Parameters<typeof createNodeSqliteClient>[0]),
    async [Symbol.asyncDispose]() {
      database.close();
      await cleanupDbFiles(dbPath);
    },
  };
}

async function cleanupDbFiles(dbPath: string) {
  await Promise.allSettled([
    fs.rm(dbPath, {force: true}),
    fs.rm(`${dbPath}-shm`, {force: true}),
    fs.rm(`${dbPath}-wal`, {force: true}),
  ]);
}

function normalizeStoredSql(sql: string): string {
  return sql.trim().replace(/;+$/u, '').toLowerCase();
}

function normalizeViewDefinition(createSql: string): string {
  const normalized = createSql.replace(/\s+/gu, ' ').trim().toLowerCase();
  const match = normalized.match(/\bas\s+(.+)$/u);
  return match?.[1] ?? normalized;
}

function normalizeDeclaredType(type: string | null | undefined): string {
  return String(type ?? '').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function normalizeDefaultSql(value: string | null): string | null {
  if (value == null) {
    return null;
  }
  return value.trim().replace(/\s+/gu, ' ');
}

function extractWhereClause(sql: string): string | null {
  if (!sql) {
    return null;
  }
  const match = sql.match(/\bwhere\b([\s\S]+)$/iu);
  return match?.[1]?.trim().replace(/\s+/gu, ' ') ?? null;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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

function toComparableSchema(schema: SqliteInspectedDatabase) {
  return {
    tables: Object.fromEntries(
      Object.entries(schema.tables)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([tableName, table]) => [
          tableName,
          {
            name: table.name,
            columns: table.columns,
            primaryKey: table.primaryKey,
            uniqueConstraints: table.uniqueConstraints,
            foreignKeys: table.foreignKeys,
            indexes: Object.fromEntries(
              Object.entries(table.indexes)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([indexName, index]) => [
                  indexName,
                  {
                    name: index.name,
                    unique: index.unique,
                    origin: index.origin,
                    columns: index.columns,
                    where: index.where,
                  },
                ]),
            ),
          },
        ]),
    ),
    views: Object.fromEntries(
      Object.entries(schema.views)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([viewName, view]) => [
          viewName,
          {
            name: view.name,
            definition: view.definition,
          },
        ]),
    ),
    triggers: Object.fromEntries(
      Object.entries(schema.triggers)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([triggerName, trigger]) => [
          triggerName,
          {
            name: trigger.name,
            onName: trigger.onName,
            normalizedSql: trigger.normalizedSql,
          },
        ]),
    ),
  };
}

async function assertNoUnsupportedSchemaFeatures(client: Client, schemaName: string): Promise<void> {
  const unsupportedSqlRows = await client.all<{
    readonly type: string;
    readonly name: string;
    readonly sql: string | null;
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
    const normalizedSql = row.sql?.toLowerCase() ?? '';
    if (/^create\s+virtual\s+table\b/u.test(normalizedSql)) {
      throw new Error(`sqlite virtual tables are not supported by the native schema diff engine yet: ${row.name}`);
    }
  }
}

function assertNoUnsupportedSqlText(sql: string, source: 'baselineSql' | 'desiredSql'): void {
  const normalizedSql = sql.toLowerCase();
  if (/\bcreate\s+virtual\s+table\b/u.test(normalizedSql)) {
    throw new Error(`sqlite virtual tables are not supported by the native schema diff engine yet: found virtual table sql in ${source}`);
  }
}

function normalizeComparableSql(sql: string): string {
  return sql.replace(/\s+/gu, ' ').trim().toLowerCase();
}

async function applySchemaSql(client: Client, sql: string): Promise<void> {
  const statements = splitSqlStatements(sql);
  const orderedStatements = [
    ...statements.filter((statement) => isCreateTableStatement(statement)),
    ...statements.filter((statement) => isCreateIndexStatement(statement)),
    ...statements.filter((statement) => isCreateViewStatement(statement)),
    ...statements.filter(
      (statement) =>
        !isCreateTableStatement(statement) &&
        !isCreateIndexStatement(statement) &&
        !isCreateViewStatement(statement),
    ),
  ];

  for (const statement of orderedStatements) {
    await client.raw(statement);
  }
}

function isCreateTableStatement(statement: string): boolean {
  return /^\s*create\s+table\b/iu.test(statement);
}

function isCreateIndexStatement(statement: string): boolean {
  return /^\s*create\s+(?:unique\s+)?index\b/iu.test(statement);
}

function isCreateViewStatement(statement: string): boolean {
  return /^\s*create\s+view\b/iu.test(statement);
}

function withSemicolon(sql: string): string {
  return sql.trimEnd().endsWith(';') ? sql.trimEnd() : `${sql.trimEnd()};`;
}

function splitStatementForOutput(statement: string): string[] {
  return statement
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.trim().length > 0);
}

function pushStatements(target: string[], source: readonly string[]) {
  target.push(...source);
}

function renderTableName(value: string): string {
  return /^[a-z_][a-z0-9_]*$/u.test(value) ? value : quoteIdentifier(value);
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

    const columnName = normalizeIdentifierToken(nameMatch[1] ?? nameMatch[2] ?? nameMatch[3] ?? nameMatch[4] ?? '');
    const collationMatch = trimmed.match(/\bcollate\s+("(?:(?:[^"]|"")*)"|`[^`]+`|\[[^\]]+\]|[a-z0-9_]+)/iu);
    if (columnName && collationMatch) {
      collations.set(columnName, normalizeIdentifierToken(collationMatch[1]!));
    }
  }

  return collations;
}

function splitTopLevelCommaList(sql: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inBracket = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!;
    const next = sql[index + 1];

    current += char;

    if (inSingleQuote) {
      if (char === "'" && next === "'") {
        current += next;
        index += 1;
        continue;
      }
      if (char === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (char === '"' && next === '"') {
        current += next;
        index += 1;
        continue;
      }
      if (char === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (inBacktick) {
      if (char === '`') {
        inBacktick = false;
      }
      continue;
    }

    if (inBracket) {
      if (char === ']') {
        inBracket = false;
      }
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (char === '`') {
      inBacktick = true;
      continue;
    }
    if (char === '[') {
      inBracket = true;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      continue;
    }
    if (char === ',' && depth === 0) {
      parts.push(current.slice(0, -1));
      current = '';
    }
  }

  if (current.trim()) {
    parts.push(current);
  }

  return parts;
}

function normalizeIdentifierToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replaceAll('""', '"').toLowerCase();
  }
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return trimmed.slice(1, -1).toLowerCase();
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).toLowerCase();
  }
  return trimmed.toLowerCase();
}
