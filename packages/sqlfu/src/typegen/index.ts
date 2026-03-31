import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {createClient} from '@libsql/client';

import {loadProjectConfig} from '../core/config.js';
import {runPackageBinary} from '../core/tooling.js';
import type {ProjectConfigOverrides} from '../core/types.js';
import {materializeSchemaDatabase} from '../migrator/index.js';

export async function writeTypesqlConfig(overrides: ProjectConfigOverrides = {}): Promise<string> {
  const config = await loadProjectConfig(overrides);

  await fs.writeFile(
    config.typesqlConfigPath,
    JSON.stringify(
      {
        databaseUri: config.tempDbPath,
        sqlDir: relativeToCwd(config.cwd, config.sqlDir),
        client: 'libsql',
        includeCrudTables: [],
        target: 'node',
      },
      null,
      2,
    ) + '\n',
  );

  return config.typesqlConfigPath;
}

export async function generateQueryTypes(overrides: ProjectConfigOverrides = {}): Promise<void> {
  const config = await loadProjectConfig(overrides);
  await materializeSchemaDatabase(overrides, config.tempDbPath);
  const typesqlConfigPath = await writeTypesqlConfig(overrides);
  await runPackageBinary('typesql-cli', ['compile', '--config', typesqlConfigPath], packageRoot);
  await refineGeneratedTypes(config.tempDbPath, config.sqlDir);
  // TODO: If we need custom fs support (for example memfs), column-name transforms such as
  // snake_case -> camelCase, or direct access to TypeSQL's intermediate descriptors so sqlfu
  // can emit zod/custom nullability-aware output, we may need to vendor TypeSQL instead of
  // continuing to treat it as a black-box compiler plus post-processing step.
  await rewriteGeneratedWrappers(config.sqlDir);
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(new URL('../../package.json', import.meta.url))));

type TsColumn = {
  readonly name: string;
  readonly tsType: string;
  readonly notNull: boolean;
};

type RelationInfo = {
  readonly kind: 'table' | 'view';
  readonly name: string;
  readonly columns: ReadonlyMap<string, TsColumn>;
  readonly sql?: string;
};

async function refineGeneratedTypes(databasePath: string, sqlDir: string): Promise<void> {
  const schema = await loadSchema(databasePath);
  const sqlEntries = await fs.readdir(sqlDir, {withFileTypes: true});

  await Promise.all(
    sqlEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
      .map(async (entry) => {
        const sqlPath = path.join(sqlDir, entry.name);
        const resultColumns = inferQueryResultColumns(await fs.readFile(sqlPath, 'utf8'), schema);
        if (resultColumns.size === 0) {
          return;
        }

        await Promise.all([
          patchGeneratedTypeFile(path.join(sqlDir, replaceExtension(entry.name, '.ts')), resultColumns),
          patchGeneratedTypeFile(path.join(sqlDir, replaceExtension(entry.name, '.d.ts')), resultColumns),
        ]);
      }),
  );
}

async function rewriteGeneratedWrappers(sqlDir: string): Promise<void> {
  const sqlEntries = await fs.readdir(sqlDir, {withFileTypes: true});

  await Promise.all(
    sqlEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && entry.name !== 'index.ts')
      .map(async (entry) => {
        const filePath = path.join(sqlDir, entry.name);
        const contents = await fs.readFile(filePath, 'utf8');
        const nextContents = rewriteGeneratedWrapper(contents);
        if (nextContents !== contents) {
          await fs.writeFile(filePath, nextContents);
        }
      }),
  );
}

function rewriteGeneratedWrapper(contents: string): string {
  if (contents.trim() === '//Invalid SQL') {
    return contents;
  }

  const importPattern = /^import type \{ Client, Transaction \} from '@libsql\/client';\n\n/;
  if (!importPattern.test(contents)) {
    return contents;
  }

  const resultTypeName = contents.match(/export type ([A-Za-z0-9_]+Result) = \{/m)?.[1];
  const functionPattern =
    /export async function ([A-Za-z0-9_]+)\(client: Client \| Transaction(, params: [A-Za-z0-9_]+)?\): Promise<([^>]+)>\s*\{\n([\s\S]*?)\n\}\n\nfunction mapArrayTo[A-Za-z0-9_]+\([\s\S]*$/m;
  const match = contents.match(functionPattern);

  if (!match || !resultTypeName) {
    return contents.replace(importPattern, `import type {AsyncExecutor} from 'sqlfu';\n\n`);
  }

  const [, functionName, paramsClause = '', returnType, functionBody] = match;
  const sqlMatch = functionBody.match(/const sql = `[\s\S]*?`/m);
  const executeMatch = functionBody.match(/return client\.execute\(([\s\S]*?)\)\n([\s\S]*)$/m);

  if (!sqlMatch || !executeMatch) {
    return contents.replace(importPattern, `import type {AsyncExecutor} from 'sqlfu';\n\n`);
  }

  const executeArgs = normalizeExecuteArgs(executeMatch[1].trim());
  const returnStatement = buildExecutorReturn(executeMatch[2], resultTypeName, executeArgs);
  if (!returnStatement) {
    return contents.replace(importPattern, `import type {AsyncExecutor} from 'sqlfu';\n\n`);
  }

  const header = contents.slice(0, match.index).replace(importPattern, `import type {AsyncExecutor} from 'sqlfu';\n\n`);
  const rewrittenFunction = [
    `export async function ${functionName}(executor: AsyncExecutor${paramsClause}): Promise<${returnType}> {`,
    indentLines(sqlMatch[0], '\t'),
    `\t${returnStatement.replaceAll('\n', '\n\t')}`,
    `}`,
    '',
  ].join('\n');

  return `${header}${rewrittenFunction}`;
}

function normalizeExecuteArgs(value: string): string {
  return value === 'sql' ? '{ sql, args: [] }' : value;
}

function buildExecutorReturn(chainedCalls: string, resultTypeName: string, executeArgs: string): string | undefined {
  const normalized = chainedCalls.trim();

  if (/^\.then\(res => res\.rows\)\s*\.then\(rows => rows\.map\(row => mapArrayTo[A-Za-z0-9_]+\(row\)\)\);$/m.test(normalized)) {
    return `return executor.query<${resultTypeName}>(${executeArgs});`;
  }

  if (/^\.then\(res => res\.rows\)\s*\.then\(rows => rows\.length > 0 \? mapArrayTo[A-Za-z0-9_]+\(\s*rows\[0\]\s*\) : null\);$/m.test(normalized)) {
    return [
      `return executor.query<${resultTypeName}>(${executeArgs})`,
      `.then(result => result.rows[0] ?? null);`,
    ].join('\n');
  }

  return undefined;
}

function indentLines(value: string, indent: string): string {
  return value
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n');
}

async function loadSchema(databasePath: string): Promise<ReadonlyMap<string, RelationInfo>> {
  const client = createClient({url: `file:${databasePath}`});

  try {
    const schemaResult = await client.execute({
      sql: `
        SELECT name, type, sql
        FROM sqlite_schema
        WHERE type IN ('table', 'view')
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `,
      args: [],
    });

    const relations = new Map<string, RelationInfo>();

    for (const row of schemaResult.rows as Array<Record<string, unknown>>) {
      const name = String(row.name);
      const kind = row.type === 'view' ? 'view' : 'table';
      const columns = await loadRelationColumns(client, name);
      relations.set(name, {
        kind,
        name,
        columns,
        sql: typeof row.sql === 'string' ? row.sql : undefined,
      });
    }

    for (const relation of relations.values()) {
      if (relation.kind !== 'view' || !relation.sql) {
        continue;
      }

      const inferredView = inferViewColumns(relation.sql, relations);
      if (inferredView.size === 0) {
        continue;
      }

      relations.set(relation.name, {
        ...relation,
        columns: inferredView,
      });
    }

    return relations;
  } finally {
    client.close();
  }
}

async function loadRelationColumns(
  client: ReturnType<typeof createClient>,
  relationName: string,
): Promise<ReadonlyMap<string, TsColumn>> {
  const pragmaResult = await client.execute({
    sql: `PRAGMA table_xinfo("${escapeSqliteIdentifier(relationName)}")`,
    args: [],
  });

  const columns = new Map<string, TsColumn>();

  for (const row of pragmaResult.rows as Array<Record<string, unknown>>) {
    if (Number(row.hidden ?? 0) !== 0) {
      continue;
    }

    const name = String(row.name);
    columns.set(name, {
      name,
      tsType: mapSqliteTypeToTs(typeof row.type === 'string' ? row.type : ''),
      notNull: Number(row.notnull ?? 0) === 1 || Number(row.pk ?? 0) >= 1,
    });
  }

  return columns;
}

function inferViewColumns(sql: string, schema: ReadonlyMap<string, RelationInfo>): ReadonlyMap<string, TsColumn> {
  const sourceName = extractSingleSourceName(sql);
  const sourceColumns = sourceName ? schema.get(sourceName)?.columns : undefined;
  const selectClause = extractSelectClause(sql);

  if (!selectClause || !sourceColumns) {
    return new Map();
  }

  return inferSelectColumns(selectClause, sourceColumns);
}

function inferQueryResultColumns(sql: string, schema: ReadonlyMap<string, RelationInfo>): ReadonlyMap<string, TsColumn> {
  const sourceName = extractSingleSourceName(sql);
  const sourceColumns = sourceName ? schema.get(sourceName)?.columns : undefined;
  const selectClause = extractSelectClause(sql);

  if (!selectClause || !sourceColumns) {
    return new Map();
  }

  const columns = new Map(inferSelectColumns(selectClause, sourceColumns));
  for (const narrowedColumnName of extractNonNullColumns(sql)) {
    const column = columns.get(narrowedColumnName);
    if (!column) {
      continue;
    }

    columns.set(narrowedColumnName, {
      ...column,
      notNull: true,
    });
  }

  return columns;
}

function inferSelectColumns(selectClause: string, sourceColumns: ReadonlyMap<string, TsColumn>): ReadonlyMap<string, TsColumn> {
  const columns = new Map<string, TsColumn>();

  for (const rawItem of splitTopLevelComma(selectClause)) {
    const item = rawItem.trim();
    if (!item) {
      continue;
    }

    const aliasMatch = item.match(/^(.*?)(?:\s+AS\s+([A-Za-z_][A-Za-z0-9_]*))$/i);
    const expression = aliasMatch?.[1]?.trim() ?? item;
    const alias = aliasMatch?.[2] ?? inferImplicitAlias(expression);
    if (!alias) {
      continue;
    }

    const inferred = inferExpressionColumn(expression, alias, sourceColumns);
    columns.set(alias, inferred);
  }

  return columns;
}

function inferExpressionColumn(
  expression: string,
  alias: string,
  sourceColumns: ReadonlyMap<string, TsColumn>,
): TsColumn {
  const directColumnName = getReferencedColumnName(expression);
  if (directColumnName) {
    const directColumn = sourceColumns.get(directColumnName);
    if (directColumn) {
      return {
        name: alias,
        tsType: directColumn.tsType,
        notNull: directColumn.notNull,
      };
    }
  }

  const lowerExpression = expression.trim().toLowerCase();
  if (lowerExpression.startsWith('substr(')) {
    const firstArg = splitTopLevelComma(expression.slice(expression.indexOf('(') + 1, expression.lastIndexOf(')')))[0]?.trim();
    const referenced = firstArg ? getReferencedColumnName(firstArg) : undefined;
    const sourceColumn = referenced ? sourceColumns.get(referenced) : undefined;

    return {
      name: alias,
      tsType: 'string',
      notNull: sourceColumn?.notNull ?? false,
    };
  }

  if (/^'.*'$/.test(expression.trim())) {
    return {name: alias, tsType: 'string', notNull: true};
  }

  if (/^\d+(?:\.\d+)?$/.test(expression.trim())) {
    return {name: alias, tsType: 'number', notNull: true};
  }

  return {name: alias, tsType: 'any', notNull: false};
}

function inferImplicitAlias(expression: string): string | undefined {
  const columnName = getReferencedColumnName(expression);
  return columnName ?? undefined;
}

function getReferencedColumnName(expression: string): string | undefined {
  const match = expression.trim().match(/^(?:"?([A-Za-z_][A-Za-z0-9_]*)"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?$/);
  return match?.[2];
}

function extractSelectClause(sql: string): string | undefined {
  const upper = sql.toUpperCase();
  const selectIndex = upper.indexOf('SELECT');
  if (selectIndex < 0) {
    return undefined;
  }

  const fromIndex = findKeywordAtTopLevel(upper, 'FROM', selectIndex + 'SELECT'.length);
  if (fromIndex < 0) {
    return undefined;
  }

  return sql.slice(selectIndex + 'SELECT'.length, fromIndex).trim();
}

function extractSingleSourceName(sql: string): string | undefined {
  const upper = sql.toUpperCase();
  const fromIndex = findKeywordAtTopLevel(upper, 'FROM');
  if (fromIndex < 0) {
    return undefined;
  }

  const afterFrom = sql.slice(fromIndex + 'FROM'.length).trim();
  const match = afterFrom.match(/^"?([A-Za-z_][A-Za-z0-9_]*)"?/);
  return match?.[1];
}

function extractNonNullColumns(sql: string): ReadonlySet<string> {
  const matches = sql.matchAll(/\b("?([A-Za-z_][A-Za-z0-9_]*)"?)\s+IS\s+NOT\s+NULL\b/gi);
  const names = new Set<string>();
  for (const match of matches) {
    if (match[2]) {
      names.add(match[2]);
    }
  }
  return names;
}

function findKeywordAtTopLevel(value: string, keyword: string, startIndex = 0): number {
  let depth = 0;
  let quote: "'" | '"' | null = null;

  for (let index = startIndex; index <= value.length - keyword.length; index += 1) {
    const char = value[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === '(') {
      depth += 1;
      continue;
    }

    if (char === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0 && value.slice(index, index + keyword.length) === keyword) {
      const previous = index === 0 ? ' ' : value[index - 1];
      const next = value[index + keyword.length] ?? ' ';
      if (!isIdentifierCharacter(previous) && !isIdentifierCharacter(next)) {
        return index;
      }
    }
  }

  return -1;
}

function splitTopLevelComma(value: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === '(') {
      depth += 1;
      continue;
    }

    if (char === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (char === ',' && depth === 0) {
      items.push(value.slice(start, index));
      start = index + 1;
    }
  }

  items.push(value.slice(start));
  return items;
}

function isIdentifierCharacter(value: string): boolean {
  return /[A-Z0-9_]/i.test(value);
}

function mapSqliteTypeToTs(columnType: string): string {
  const normalized = columnType.trim().toUpperCase();
  if (normalized.includes('INT')) {
    return 'number';
  }
  if (normalized.includes('CHAR') || normalized.includes('CLOB') || normalized.includes('TEXT')) {
    return 'string';
  }
  if (normalized.includes('REAL') || normalized.includes('FLOA') || normalized.includes('DOUB')) {
    return 'number';
  }
  if (normalized === '' || normalized.includes('BLOB')) {
    return 'ArrayBuffer';
  }
  if (normalized === 'BOOLEAN') {
    return 'boolean';
  }
  if (normalized === 'DATE' || normalized === 'DATE_TIME') {
    return 'Date';
  }
  return 'number';
}

async function patchGeneratedTypeFile(filePath: string, columns: ReadonlyMap<string, TsColumn>): Promise<void> {
  let contents: string;
  try {
    contents = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }

  const nextContents = contents.replace(
    /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\??:\s*any;$/gm,
    (match, indentation: string, fieldName: string) => {
      const column = columns.get(fieldName);
      if (!column || column.tsType === 'any') {
        return match;
      }

      return `${indentation}${fieldName}${column.notNull ? '' : '?'}: ${column.tsType};`;
    },
  );

  if (nextContents !== contents) {
    await fs.writeFile(filePath, nextContents);
  }
}

function relativeToCwd(cwd: string, targetPath: string): string {
  const relative = targetPath.startsWith(cwd) ? targetPath.slice(cwd.length + 1) : targetPath;
  return relative.length > 0 ? relative : '.';
}

function replaceExtension(fileName: string, nextExtension: '.ts' | '.d.ts'): string {
  return fileName.replace(/\.sql$/, nextExtension);
}

function escapeSqliteIdentifier(value: string): string {
  return value.replaceAll('"', '""');
}
