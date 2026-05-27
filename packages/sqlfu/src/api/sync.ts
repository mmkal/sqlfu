import {quoteIdentifier} from '../schemadiff/sqlite/identifiers.js';
import {inspectSqliteSchema} from '../schemadiff/sqlite/inspect.js';
import {planSchemaDiff} from '../schemadiff/sqlite/plan.js';
import type {SqliteInspectedDatabase} from '../schemadiff/sqlite/types.js';
import {
  classifySqliteCreateStatement,
  replaceSqliteIdentifierSpan,
  type SqliteIdentifierSpan,
} from '../sqlite-parser.js';
import {splitSqlStatements} from '../sqlite-text.js';
import type {SyncClient} from '../types.js';

export interface RuntimeSyncOptions {
  definitions: string;
  allowDestructive?: boolean;
  scratchSchema?: RuntimeSyncScratchSchema;
}

export type RuntimeSyncScratchSchema = 'scratch-db' | 'prefix';

export function sync(client: SyncClient, input: RuntimeSyncOptions): void {
  const scratchSchema = input.scratchSchema || defaultScratchSchema(client);
  if (scratchSchema === 'prefix') {
    syncWithPrefix(client, input);
    return;
  }

  syncWithScratchDb(client, input);
}

function syncWithScratchDb(client: SyncClient, input: RuntimeSyncOptions): void {
  const schemaName = createScratchSchemaName();
  let attached = false;
  try {
    client.raw(`attach database ':memory:' as ${quoteIdentifier(schemaName)}`);
    attached = true;

    const baseline = excludeRuntimeSyncTables(inspectSqliteSchema(client));
    applyDefinitionsToAttachedSchema(client, input.definitions, schemaName);
    const desired = excludeRuntimeSyncTables(inspectSqliteSchema(client, schemaName));
    const diffLines = planSchemaDiff({
      baseline,
      desired,
      allowDestructive: input.allowDestructive !== false,
    });

    if (diffLines.length === 0) {
      return;
    }

    client.transaction((tx) => {
      tx.raw(diffLines.join('\n'));
    });
  } finally {
    if (attached) {
      client.raw(`detach database ${quoteIdentifier(schemaName)}`);
    }
  }
}

function syncWithPrefix(client: SyncClient, input: RuntimeSyncOptions): void {
  cleanupPrefixedObjects(client);
  try {
    const baseline = excludeRuntimeSyncTables(inspectSqliteSchema(client));
    applyDefinitionsToPrefixedSchema(client, input.definitions);
    const desired = excludeRuntimeSyncTables(unprefixInspectedSchema(inspectSqliteSchema(client)));
    const diffLines = planSchemaDiff({
      baseline,
      desired,
      allowDestructive: input.allowDestructive !== false,
    });

    if (diffLines.length === 0) {
      return;
    }

    client.transaction((tx) => {
      tx.raw(diffLines.join('\n'));
    });
  } finally {
    cleanupPrefixedObjects(client);
  }
}

function applyDefinitionsToAttachedSchema(client: SyncClient, definitions: string, schemaName: string): void {
  for (const statement of orderedSchemaStatements(definitions).map((value) =>
    toAttachedSchemaStatement(value, schemaName),
  )) {
    client.raw(statement);
  }
}

function applyDefinitionsToPrefixedSchema(client: SyncClient, definitions: string): void {
  for (const statement of orderedSchemaStatements(definitions).map(toPrefixedSchemaStatement)) {
    client.raw(statement);
  }
}

function orderedSchemaStatements(sql: string): string[] {
  const statements = splitSqlStatements(sql).map((statement) => ({
    statement,
    createStatement: classifySqliteCreateStatement(statement),
  }));
  return [
    ...statements.filter((entry) => entry.createStatement?.kind === 'table'),
    ...statements.filter((entry) => entry.createStatement?.kind === 'index'),
    ...statements.filter((entry) => entry.createStatement?.kind === 'view'),
    ...statements.filter(
      (entry) =>
        entry.createStatement?.kind !== 'table' &&
        entry.createStatement?.kind !== 'index' &&
        entry.createStatement?.kind !== 'view',
    ),
  ].map((entry) => entry.statement);
}

function toPrefixedSchemaStatement(statement: string): string {
  const createStatement = classifySqliteCreateStatement(statement);
  if (!createStatement) {
    throw new Error(
      'runtime sync definitions only support create table, create index, create view, and create trigger',
    );
  }
  switch (createStatement.kind) {
    case 'virtual-table':
      throw new Error('runtime sync does not support sqlite virtual tables yet');
    case 'table':
    case 'view':
      return replaceRequiredIdentifier(statement, createStatement.name, (name) =>
        quoteIdentifier(`${syncObjectPrefix}${name}`),
      );
    case 'index':
    case 'trigger':
      return replaceRequiredIdentifiers(statement, [
        {identifier: createStatement.name, replacement: (name) => quoteIdentifier(`${syncObjectPrefix}${name}`)},
        {identifier: createStatement.onName, replacement: (name) => quoteIdentifier(`${syncObjectPrefix}${name}`)},
      ]);
  }
}

function toAttachedSchemaStatement(statement: string, schemaName: string): string {
  const createStatement = classifySqliteCreateStatement(statement);
  if (!createStatement) {
    throw new Error(
      'runtime sync definitions only support create table, create index, create view, and create trigger',
    );
  }
  if (createStatement.kind === 'virtual-table') {
    throw new Error('runtime sync does not support sqlite virtual tables yet');
  }
  if (createStatement.temporary) {
    throw new Error('runtime sync scratch-db definitions do not support temp schema objects');
  }
  switch (createStatement.kind) {
    case 'table':
    case 'view':
      return replaceRequiredIdentifier(
        statement,
        createStatement.name,
        (name) => `${quoteIdentifier(schemaName)}.${quoteIdentifier(name)}`,
      );
    case 'index':
    case 'trigger':
      return replaceRequiredIdentifiers(statement, [
        {
          identifier: createStatement.name,
          replacement: (name) => `${quoteIdentifier(schemaName)}.${quoteIdentifier(name)}`,
        },
        {identifier: createStatement.onName, replacement: (name) => quoteIdentifier(name)},
      ]);
  }
}

function replaceRequiredIdentifier(
  statement: string,
  identifier: SqliteIdentifierSpan | null,
  replacement: (name: string) => string,
): string {
  if (!identifier) {
    throw new Error(`runtime sync could not parse schema definition statement: ${statement}`);
  }
  return replaceSqliteIdentifierSpan(statement, identifier, replacement(identifier.name));
}

function replaceRequiredIdentifiers(
  statement: string,
  replacements: {
    identifier: SqliteIdentifierSpan | null;
    replacement: (name: string) => string;
  }[],
): string {
  let output = statement;
  const sorted = replacements
    .map((replacement) => {
      if (!replacement.identifier) {
        throw new Error(`runtime sync could not parse schema definition statement: ${statement}`);
      }
      return {identifier: replacement.identifier, value: replacement.replacement(replacement.identifier.name)};
    })
    .sort((left, right) => right.identifier.start - left.identifier.start);

  for (const replacement of sorted) {
    output = replaceSqliteIdentifierSpan(output, replacement.identifier, replacement.value);
  }
  return output;
}

function unprefixInspectedSchema(schema: SqliteInspectedDatabase): SqliteInspectedDatabase {
  return {
    tables: Object.fromEntries(
      Object.entries(schema.tables)
        .filter(([name]) => name.startsWith(syncObjectPrefix))
        .map(([name, table]) => [
          removeSyncPrefix(name),
          {
            ...table,
            name: removeSyncPrefix(table.name),
            createSql: removeSyncPrefixes(table.createSql),
            indexes: Object.fromEntries(
              Object.entries(table.indexes)
                .filter(([indexName]) => indexName.startsWith(syncObjectPrefix))
                .map(([indexName, index]) => [
                  removeSyncPrefix(indexName),
                  {
                    ...index,
                    name: removeSyncPrefix(index.name),
                    createSql: removeSyncPrefixes(index.createSql),
                  },
                ]),
            ),
            foreignKeys: table.foreignKeys.map((foreignKey) => ({
              ...foreignKey,
              referencedTable: removeSyncPrefix(foreignKey.referencedTable),
            })),
          },
        ]),
    ),
    views: Object.fromEntries(
      Object.entries(schema.views)
        .filter(([name]) => name.startsWith(syncObjectPrefix))
        .map(([name, view]) => [
          removeSyncPrefix(name),
          {
            ...view,
            name: removeSyncPrefix(view.name),
            createSql: removeSyncPrefixes(view.createSql),
            definition: removeSyncPrefixes(view.definition),
          },
        ]),
    ),
    triggers: Object.fromEntries(
      Object.entries(schema.triggers)
        .filter(([name]) => name.startsWith(syncObjectPrefix))
        .map(([name, trigger]) => [
          removeSyncPrefix(name),
          {
            ...trigger,
            name: removeSyncPrefix(trigger.name),
            onName: removeSyncPrefix(trigger.onName),
            createSql: removeSyncPrefixes(trigger.createSql),
            normalizedSql: removeSyncPrefixes(trigger.normalizedSql),
          },
        ]),
    ),
  };
}

function removeSyncPrefix(value: string): string {
  return value.startsWith(syncObjectPrefix) ? value.slice(syncObjectPrefix.length) : value;
}

function removeSyncPrefixes(value: string): string {
  return value.replaceAll(syncObjectPrefix, '');
}

function cleanupPrefixedObjects(client: SyncClient): void {
  const rows = client
    .all<{type: 'index' | 'table' | 'trigger' | 'view'; name: string}>({
      sql: `
      select type, name
      from main.sqlite_schema
      where type in ('index', 'table', 'trigger', 'view')
        and name not like 'sqlite\\_%' escape '\\'
      order by type, name
    `,
      args: [],
    })
    .filter((row) => row.name.startsWith(syncObjectPrefix));
  const typeOrder = ['trigger', 'view', 'index', 'table'] as const;
  for (const type of typeOrder) {
    for (const row of rows.filter((candidate) => candidate.type === type)) {
      client.run({sql: `drop ${type} if exists main.${quoteIdentifier(row.name)}`, args: []});
    }
  }
}

function excludeRuntimeSyncTables(schema: SqliteInspectedDatabase): SqliteInspectedDatabase {
  return {
    ...schema,
    tables: Object.fromEntries(Object.entries(schema.tables).filter(([name]) => !runtimeSyncExcludedTables.has(name))),
    triggers: Object.fromEntries(
      Object.entries(schema.triggers).filter(([, trigger]) => !runtimeSyncExcludedTables.has(trigger.onName)),
    ),
  };
}

function defaultScratchSchema(client: SyncClient): RuntimeSyncScratchSchema {
  return isDurableObjectClient(client) ? 'prefix' : 'scratch-db';
}

function isDurableObjectClient(client: SyncClient): boolean {
  const driver = client.driver;
  if (!isObject(driver) || !('sql' in driver)) {
    return false;
  }
  const sqlStorage = driver.sql;
  return isObject(sqlStorage) && typeof sqlStorage.exec === 'function';
}

let scratchSchemaSequence = 0;

function createScratchSchemaName(): string {
  scratchSchemaSequence += 1;
  return `sqlfu_sync_${scratchSchemaSequence}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const syncObjectPrefix = '__sqlfu_sync_';
const runtimeSyncExcludedTables = new Set(['sqlfu_migrations', 'd1_migrations']);
