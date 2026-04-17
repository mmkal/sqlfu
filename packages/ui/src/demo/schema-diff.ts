import {
  inspectSqliteSchema,
  planSchemaDiff,
  splitSqlStatements,
} from 'sqlfu/browser';
import type {AsyncClient, SqliteInspectedDatabase} from 'sqlfu/browser';

import {createScratchDb} from './scratch-db.js';

export async function diffBaselineSqlToDesiredSql(input: {
  baselineSql: string;
  desiredSql: string;
  allowDestructive: boolean;
}): Promise<string[]> {
  assertNoUnsupportedSqlText(input.baselineSql, 'baselineSql');
  assertNoUnsupportedSqlText(input.desiredSql, 'desiredSql');

  await using baseline = await createScratchDb();
  await using desired = await createScratchDb();

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

export async function inspectSchemaFromSql(sql: string): Promise<SqliteInspectedDatabase> {
  await using scratch = await createScratchDb();
  if (sql.trim()) {
    await applySchemaSql(scratch.client, sql);
  }
  return await inspectSqliteSchema(scratch.client);
}

export function schemasEqual(left: SqliteInspectedDatabase, right: SqliteInspectedDatabase): boolean {
  return stableStringify(toComparableSchema(left)) === stableStringify(toComparableSchema(right));
}

export async function schemasCompareSyncable(input: {
  left: SqliteInspectedDatabase;
  right: SqliteInspectedDatabase;
  allowDestructive: boolean;
}) {
  const isDifferent = !schemasEqual(input.left, input.right);
  if (!isDifferent) {
    return {isDifferent: false, isSyncable: false};
  }
  try {
    const plan = planSchemaDiff({
      baseline: input.right,
      desired: input.left,
      allowDestructive: input.allowDestructive,
    });
    return {isDifferent: true, isSyncable: plan.length > 0};
  } catch {
    return {isDifferent: true, isSyncable: false};
  }
}

async function applySchemaSql(client: AsyncClient, sql: string): Promise<void> {
  const statements = splitSqlStatements(sql);
  const orderedStatements = [
    ...statements.filter((statement) => /^\s*create\s+table\b/iu.test(statement)),
    ...statements.filter((statement) => /^\s*create\s+(?:unique\s+)?index\b/iu.test(statement)),
    ...statements.filter((statement) => /^\s*create\s+view\b/iu.test(statement)),
    ...statements.filter(
      (statement) =>
        !/^\s*create\s+table\b/iu.test(statement) &&
        !/^\s*create\s+(?:unique\s+)?index\b/iu.test(statement) &&
        !/^\s*create\s+view\b/iu.test(statement),
    ),
  ];

  for (const statement of orderedStatements) {
    await client.raw(statement);
  }
}

function assertNoUnsupportedSqlText(sql: string, source: 'baselineSql' | 'desiredSql'): void {
  if (/\bcreate\s+virtual\s+table\b/iu.test(sql)) {
    throw new Error(`sqlite virtual tables are not supported by the demo schema diff engine: found virtual table sql in ${source}`);
  }
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
          {name: view.name, definition: view.definition},
        ]),
    ),
    triggers: Object.fromEntries(
      Object.entries(schema.triggers)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([triggerName, trigger]) => [
          triggerName,
          {name: trigger.name, onName: trigger.onName, normalizedSql: trigger.normalizedSql},
        ]),
    ),
  };
}
