import {quoteIdentifier} from '../schemadiff/sqlite/identifiers.js';
import {inspectSqliteSchema} from '../schemadiff/sqlite/inspect.js';
import {planSchemaDiff} from '../schemadiff/sqlite/plan.js';
import type {SqliteInspectedDatabase} from '../schemadiff/sqlite/types.js';
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
  const statements = splitSqlStatements(sql);
  return [
    ...statements.filter((statement) => isCreateTableStatement(statement)),
    ...statements.filter((statement) => isCreateIndexStatement(statement)),
    ...statements.filter((statement) => isCreateViewStatement(statement)),
    ...statements.filter(
      (statement) =>
        !isCreateTableStatement(statement) && !isCreateIndexStatement(statement) && !isCreateViewStatement(statement),
    ),
  ];
}

function toPrefixedSchemaStatement(statement: string): string {
  if (/^create\s+virtual\s+table\b/iu.test(stripLeadingComments(statement))) {
    throw new Error('runtime sync does not support sqlite virtual tables yet');
  }
  if (isCreateTableStatement(statement)) {
    return prefixCreateObjectName(statement, 'table');
  }
  if (isCreateIndexStatement(statement)) {
    return prefixCreateIndexStatement(statement);
  }
  if (isCreateViewStatement(statement)) {
    return prefixCreateObjectName(statement, 'view');
  }
  if (isCreateTriggerStatement(statement)) {
    return prefixCreateTriggerStatement(statement);
  }
  throw new Error('runtime sync definitions only support create table, create index, create view, and create trigger');
}

function toAttachedSchemaStatement(statement: string, schemaName: string): string {
  const stripped = stripLeadingComments(statement);
  if (/^create\s+virtual\s+table\b/iu.test(stripped)) {
    throw new Error('runtime sync does not support sqlite virtual tables yet');
  }
  if (/^create\s+(?:temp|temporary)\s+/iu.test(stripped)) {
    throw new Error('runtime sync scratch-db definitions do not support temp schema objects');
  }
  if (isCreateTableStatement(statement)) {
    return qualifyCreateObjectName(statement, 'table', schemaName);
  }
  if (isCreateIndexStatement(statement)) {
    return qualifyCreateIndexStatement(statement, schemaName);
  }
  if (isCreateViewStatement(statement)) {
    return qualifyCreateObjectName(statement, 'view', schemaName);
  }
  if (isCreateTriggerStatement(statement)) {
    return qualifyCreateTriggerStatement(statement, schemaName);
  }
  throw new Error('runtime sync definitions only support create table, create index, create view, and create trigger');
}

function isCreateTableStatement(statement: string): boolean {
  return /^create\s+(?:(?:temp|temporary)\s+)?table\b/iu.test(stripLeadingComments(statement));
}

function isCreateIndexStatement(statement: string): boolean {
  return /^create\s+(?:unique\s+)?index\b/iu.test(stripLeadingComments(statement));
}

function isCreateViewStatement(statement: string): boolean {
  return /^create\s+(?:(?:temp|temporary)\s+)?view\b/iu.test(stripLeadingComments(statement));
}

function isCreateTriggerStatement(statement: string): boolean {
  return /^create\s+(?:(?:temp|temporary)\s+)?trigger\b/iu.test(stripLeadingComments(statement));
}

function stripLeadingComments(statement: string): string {
  return statement.replace(/^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/u, '');
}

function prefixCreateObjectName(statement: string, kind: 'table' | 'view'): string {
  return replaceMatchedIdentifier(
    statement,
    new RegExp(
      `^(${leadingCommentPattern}create\\s+(?:(?:temp|temporary)\\s+)?${kind}\\s+(?:if\\s+not\\s+exists\\s+)?)(?<name>${identifierPattern})`,
      'iu',
    ),
    'name',
    (name) => quoteIdentifier(`${syncObjectPrefix}${name}`),
  );
}

function prefixCreateIndexStatement(statement: string): string {
  return replaceMatchedIdentifier(
    replaceMatchedIdentifier(
      statement,
      new RegExp(
        `^(${leadingCommentPattern}create\\s+(?:unique\\s+)?index\\s+(?:if\\s+not\\s+exists\\s+)?)(?<name>${identifierPattern})(?<tail>\\s+on\\s+)(?<table>${identifierPattern})`,
        'iu',
      ),
      'name',
      (name) => quoteIdentifier(`${syncObjectPrefix}${name}`),
    ),
    new RegExp(
      `^(${leadingCommentPattern}create\\s+(?:unique\\s+)?index\\s+(?:if\\s+not\\s+exists\\s+)?${identifierPattern}\\s+on\\s+)(?<table>${identifierPattern})`,
      'iu',
    ),
    'table',
    (name) => quoteIdentifier(`${syncObjectPrefix}${name}`),
  );
}

function prefixCreateTriggerStatement(statement: string): string {
  return replaceMatchedIdentifier(
    replaceMatchedIdentifier(
      statement,
      new RegExp(
        `^(${leadingCommentPattern}create\\s+(?:(?:temp|temporary)\\s+)?trigger\\s+(?:if\\s+not\\s+exists\\s+)?)(?<name>${identifierPattern})`,
        'iu',
      ),
      'name',
      (name) => quoteIdentifier(`${syncObjectPrefix}${name}`),
    ),
    new RegExp(
      `^(${leadingCommentPattern}create\\s+(?:(?:temp|temporary)\\s+)?trigger\\s+(?:if\\s+not\\s+exists\\s+)?${identifierPattern}[\\s\\S]*?\\bon\\s+)(?<table>${identifierPattern})`,
      'iu',
    ),
    'table',
    (name) => quoteIdentifier(`${syncObjectPrefix}${name}`),
  );
}

function qualifyCreateObjectName(statement: string, kind: 'table' | 'view', schemaName: string): string {
  return replaceMatchedIdentifier(
    statement,
    new RegExp(
      `^(${leadingCommentPattern}create\\s+${kind}\\s+(?:if\\s+not\\s+exists\\s+)?)(?<name>${identifierPattern})`,
      'iu',
    ),
    'name',
    (name) => `${quoteIdentifier(schemaName)}.${quoteIdentifier(name)}`,
  );
}

function qualifyCreateIndexStatement(statement: string, schemaName: string): string {
  return replaceMatchedIdentifier(
    statement,
    new RegExp(
      `^(${leadingCommentPattern}create\\s+(?:unique\\s+)?index\\s+(?:if\\s+not\\s+exists\\s+)?)(?<name>${identifierPattern})`,
      'iu',
    ),
    'name',
    (name) => `${quoteIdentifier(schemaName)}.${quoteIdentifier(name)}`,
  );
}

function qualifyCreateTriggerStatement(statement: string, schemaName: string): string {
  return replaceMatchedIdentifier(
    statement,
    new RegExp(
      `^(${leadingCommentPattern}create\\s+trigger\\s+(?:if\\s+not\\s+exists\\s+)?)(?<name>${identifierPattern})`,
      'iu',
    ),
    'name',
    (name) => `${quoteIdentifier(schemaName)}.${quoteIdentifier(name)}`,
  );
}

function replaceMatchedIdentifier(
  statement: string,
  pattern: RegExp,
  groupName: string,
  replacement: (name: string) => string,
): string {
  const match = pattern.exec(statement);
  const rawIdentifier = match?.groups?.[groupName];
  const beforeIdentifier = match?.[1];
  if (!match || !rawIdentifier || !beforeIdentifier) {
    throw new Error(`runtime sync could not parse schema definition statement: ${statement}`);
  }
  const start = match.index + beforeIdentifier.length;
  return `${statement.slice(0, start)}${replacement(parseIdentifierName(rawIdentifier))}${statement.slice(start + rawIdentifier.length)}`;
}

function parseIdentifierName(rawIdentifier: string): string {
  if (rawIdentifier.startsWith('"') && rawIdentifier.endsWith('"')) {
    return rawIdentifier.slice(1, -1).replaceAll('""', '"');
  }
  if (rawIdentifier.startsWith('`') && rawIdentifier.endsWith('`')) {
    return rawIdentifier.slice(1, -1).replaceAll('``', '`');
  }
  if (rawIdentifier.startsWith('[') && rawIdentifier.endsWith(']')) {
    return rawIdentifier.slice(1, -1);
  }
  return rawIdentifier;
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
  const rows = client.all<{type: 'index' | 'table' | 'trigger' | 'view'; name: string}>({
    sql: `
      select type, name
      from main.sqlite_schema
      where type in ('index', 'table', 'trigger', 'view')
        and name not like 'sqlite\\_%' escape '\\'
      order by type, name
    `,
    args: [],
  }).filter((row) => row.name.startsWith(syncObjectPrefix));
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
    tables: Object.fromEntries(
      Object.entries(schema.tables).filter(([name]) => !runtimeSyncExcludedTables.has(name)),
    ),
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
const leadingCommentPattern = String.raw`(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*`;
const identifierPattern =
  String.raw`(?:"(?:[^"]|"")+"|` + '`(?:[^`]|``)+`' + String.raw`|\[[^\]]+\]|[a-z_][a-z0-9_$]*)`;
