/*
 * SQLite-specific schemadiff entrypoint.
 * This file wires together SQLite inspection, planning, and scratch-database execution, and is the main seam for future dialect entrypoints.
 *
 * Inspired by @pgkit/migra (https://github.com/mmkal/pgkit/tree/main/packages/migra), which is itself a TypeScript port of
 * djrobstep's Python `migra` (https://github.com/djrobstep/migra). See ../CLAUDE.md for the full inspiration notes. This file
 * does not copy code from those projects, but borrows the "materialize both schemas into scratch databases, inspect, diff the
 * inspected models, emit ordered statements" shape.
 */
import type {SqlfuHost} from '../../host.js';
import {splitSqlStatements} from '../../sqlite-text.js';
import type {AsyncClient} from '../../types.js';
import {inspectSqliteSchema} from './inspect.js';
import {planSchemaDiff} from './plan.js';
import type {SqliteInspectedDatabase} from './types.js';

export async function diffBaselineSqlToDesiredSql(
  host: SqlfuHost,
  input: {
    baselineSql: string;
    desiredSql: string;
    allowDestructive: boolean;
  },
): Promise<string[]> {
  assertNoUnsupportedSqlText(input.baselineSql, 'baselineSql');
  assertNoUnsupportedSqlText(input.desiredSql, 'desiredSql');

  await using baseline = await host.openScratchDb('baseline');
  await using desired = await host.openScratchDb('desired');

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

export async function inspectSqliteSchemaSql(host: SqlfuHost, sql: string): Promise<SqliteInspectedDatabase> {
  await using database = await host.openScratchDb('inspect');
  if (sql.trim()) {
    await applySchemaSql(database.client, sql);
  }
  return await inspectSqliteSchema(database.client);
}

export {inspectSqliteSchema};

export function schemasEqual(left: SqliteInspectedDatabase, right: SqliteInspectedDatabase): boolean {
  return stableStringify(toComparableSchema(left)) === stableStringify(toComparableSchema(right));
}

function assertNoUnsupportedSqlText(sql: string, source: 'baselineSql' | 'desiredSql'): void {
  const normalizedSql = sql.toLowerCase();
  if (/\bcreate\s+virtual\s+table\b/u.test(normalizedSql)) {
    throw new Error(
      `sqlite virtual tables are not supported by the native schema diff engine yet: found virtual table sql in ${source}`,
    );
  }
}

async function applySchemaSql(client: AsyncClient, sql: string): Promise<void> {
  const statements = splitSqlStatements(sql);
  const orderedStatements = [
    ...statements.filter((statement) => isCreateTableStatement(statement)),
    ...statements.filter((statement) => isCreateIndexStatement(statement)),
    ...statements.filter((statement) => isCreateViewStatement(statement)),
    ...statements.filter(
      (statement) =>
        !isCreateTableStatement(statement) && !isCreateIndexStatement(statement) && !isCreateViewStatement(statement),
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
