import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {createClient} from '@libsql/client';

import {loadProjectConfig} from '../core/config.js';
import {runPackageBinary} from '../core/tooling.js';
import {materializeSchemaDatabase} from '../schemadiff/index.js';

export async function writeTypesqlConfig(): Promise<string> {
  const config = await loadProjectConfig();
  const tempDir = path.join(config.projectRoot, '.sqlfu');
  const typesqlConfigPath = path.join(tempDir, 'typesql.json');
  const tempDbPath = path.join(tempDir, 'typegen.db');
  await fs.mkdir(path.dirname(typesqlConfigPath), {recursive: true});

  await fs.writeFile(
    typesqlConfigPath,
    JSON.stringify(
      {
        databaseUri: tempDbPath,
        sqlDir: relativeToConfigFile(typesqlConfigPath, config.sqlDir),
        client: 'libsql',
        includeCrudTables: [],
        target: 'node',
      },
      null,
      2,
    ) + '\n',
  );

  return typesqlConfigPath;
}

export async function generateQueryTypes(): Promise<void> {
  const config = await loadProjectConfig();
  const tempDbPath = path.join(config.projectRoot, '.sqlfu', 'typegen.db');
  const typesqlConfigPath = path.join(config.projectRoot, '.sqlfu', 'typesql.json');
  await materializeSchemaDatabase(tempDbPath);
  await writeTypesqlConfig();
  await runPackageBinary('typesql-cli', ['compile', '--config', typesqlConfigPath], config.projectRoot);
  await refineGeneratedTypes(tempDbPath, config.sqlDir);
  // TODO: If we need custom fs support (for example memfs), column-name transforms such as
  // snake_case -> camelCase, direct access to TypeSQL's intermediate descriptors so sqlfu can
  // emit zod/custom nullability-aware output, or a first-class way to expose the generated SQL
  // itself instead of hiding it inside wrapper functions, we may need to vendor TypeSQL instead
  // of continuing to treat it as a black-box compiler plus post-processing step. Another concrete
  // reason: TypeSQL currently falls over on writable CTE shapes; if sqlfu owns the parser/analyzer
  // path we could AST-rewrite `insert/update ... returning ...` branches into equivalent select-ish
  // analysis queries, similar to how pgkit handles those cases. Also, `sqlfu generate` currently
  // depends on consumers having `typesql-cli` available even though it is an internal implementation
  // detail; that's another reason to eventually vendor the TypeSQL pieces we rely on.
  await rewriteGeneratedWrappers(config.sqlDir, config.generatedImportExtension);
  await writeTypesqlConfig();
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

async function rewriteGeneratedWrappers(sqlDir: string, generatedImportExtension: '.js' | '.ts'): Promise<void> {
  const sqlEntries = await fs.readdir(sqlDir, {withFileTypes: true});

  await Promise.all(
    sqlEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map(async (entry) => {
        const filePath = path.join(sqlDir, entry.name);
        const contents = await fs.readFile(filePath, 'utf8');
        const nextContents =
          entry.name === 'index.ts'
            ? rewriteGeneratedBarrel(contents, generatedImportExtension)
            : rewriteGeneratedWrapper(contents);
        if (nextContents !== contents) {
          await fs.writeFile(filePath, nextContents);
        }
      }),
  );
}

function rewriteGeneratedBarrel(contents: string, generatedImportExtension: '.js' | '.ts'): string {
  return contents.replace(/(?<=export \* from "\.\/[^"]+)\.js(?=";)/g, generatedImportExtension);
}

function rewriteGeneratedWrapper(contents: string): string {
  if (contents.trim() === '//Invalid SQL') {
    return `//Invalid SQL\nexport {};\n`;
  }

  if (!contents.startsWith(`import type { Client, Transaction } from '@libsql/client';\n\n`)) {
    return contents;
  }

  const functionLine = contents
    .split('\n')
    .find((line) => line.startsWith('export async function '));
  if (!functionLine) {
    return contents;
  }

  const signature = parseGeneratedFunctionSignature(functionLine);
  const typeBlocks = extractExportedTypeBlocks(contents);
  const sqlBlock = extractSqlBlock(contents);
  const executeArg = extractExecuteArgument(contents);
  const resultMode = extractResultMode(contents);
  const queryExpression = executeArg === 'sql' ? '{ sql, args: [] }' : executeArg;
  const resultType = signature.returnType.endsWith('[]')
    ? signature.returnType.slice(0, -2)
    : signature.returnType.endsWith(' | null')
      ? signature.returnType.slice(0, -7)
      : signature.returnType;

  return [
    `import type {Client, SqlQuery} from 'sqlfu';`,
    ``,
    typeBlocks,
    ``,
    `export async function ${signature.name}(client: Client${signature.restParameters.length > 0 ? `, ${signature.restParameters}` : ''}): Promise<${signature.returnType}> {`,
    indent(sqlBlock),
    `\tconst query: SqlQuery = ${queryExpression};`,
    ...buildGeneratedImplementation({
      resultMode,
      resultType,
      resultProperties: extractTypeProperties(typeBlocks, resultType),
    }),
    `}`,
    ``,
  ].join('\n');
}

function parseGeneratedFunctionSignature(functionLine: string): {
  readonly name: string;
  readonly restParameters: string;
  readonly returnType: string;
} {
  const nameStart = 'export async function '.length;
  const openParen = functionLine.indexOf('(', nameStart);
  const promiseStart = functionLine.lastIndexOf('): Promise<');
  const promiseEnd = functionLine.lastIndexOf('> {');
  const name = functionLine.slice(nameStart, openParen);
  const parameters = functionLine.slice(openParen + 1, promiseStart);
  const restParameters =
    parameters === 'client: Client | Transaction'
      ? ''
      : parameters.slice('client: Client | Transaction, '.length);
  const returnType = functionLine.slice(promiseStart + '): Promise<'.length, promiseEnd);
  return {name, restParameters, returnType};
}

function extractExportedTypeBlocks(contents: string): string {
  const lines = contents.split('\n');
  const firstTypeIndex = lines.findIndex((line) => line.startsWith('export type '));
  const functionIndex = lines.findIndex((line) => line.startsWith('export async function '));
  return lines.slice(firstTypeIndex, functionIndex).join('\n').trimEnd();
}

function extractSqlBlock(contents: string): string {
  const lines = contents.split('\n');
  const sqlStart = lines.findIndex((line) => line.trimStart().startsWith('const sql = `'));
  const sqlEnd = lines.findIndex((line, index) => index > sqlStart && line.trim() === '`');
  return lines
    .slice(sqlStart, sqlEnd + 1)
    .map((line) => line.replace(/^\t/, ''))
    .join('\n');
}

function extractExecuteArgument(contents: string): string {
  const executeLine = contents
    .split('\n')
    .find((line) => line.includes('return client.execute('));
  if (!executeLine) {
    throw new Error('Could not find client.execute(...) in generated wrapper');
  }

  return executeLine.slice(executeLine.indexOf('return client.execute(') + 'return client.execute('.length, -1);
}

function extractResultMode(contents: string): 'many' | 'nullableOne' | 'one' | 'metadata' {
  if (!contents.includes(`.then(res => res.rows)`)) {
    return 'metadata';
  }

  if (contents.includes(`.then(rows => rows.map(`)) {
    return 'many';
  }

  if (contents.includes(`.then(rows => rows.length > 0 ?`)) {
    return 'nullableOne';
  }

  if (contents.includes(`.then(rows => mapArrayTo`)) {
    return 'one';
  }

  throw new Error('Could not determine generated wrapper result mode');
}

function buildGeneratedImplementation(input: {
  resultMode: 'many' | 'nullableOne' | 'one' | 'metadata';
  resultType: string;
  resultProperties: ReadonlyArray<{
    readonly name: string;
    readonly optional: boolean;
  }>;
}): string[] {
  if (input.resultMode === 'many') {
    return [`\treturn client.all<${input.resultType}>(query);`];
  }

  if (input.resultMode === 'nullableOne') {
    return [
      `\tconst rows = await client.all<${input.resultType}>(query);`,
      `\treturn rows.length > 0 ? rows[0] : null;`,
    ];
  }

  if (input.resultMode === 'one') {
    return [
      `\tconst rows = await client.all<${input.resultType}>(query);`,
      `\treturn rows[0];`,
    ];
  }

  const guards = input.resultProperties.flatMap((property) => {
    if (property.optional) {
      return [];
    }

    return [
      `\tif (result.${property.name} === undefined${property.name === 'lastInsertRowid' ? ' || result.lastInsertRowid === null' : ''}) {`,
      `\t\tthrow new Error('Expected ${property.name} to be present on query result');`,
      `\t}`,
    ];
  });
  const resultAssignments = input.resultProperties.map((property) => {
    if (property.name === 'lastInsertRowid') {
      return `\t\tlastInsertRowid: Number(result.lastInsertRowid),`;
    }

    return `\t\t${property.name}: result.${property.name},`;
  });
  return [
    `\tconst result = await client.run(query);`,
    ...guards,
    `\treturn {`,
    ...resultAssignments,
    `\t};`,
  ];
}

function extractTypeProperties(typeBlocks: string, typeName: string): ReadonlyArray<{
  readonly name: string;
  readonly optional: boolean;
}> {
  const lines = typeBlocks.split('\n');
  const typeStart = lines.findIndex((line) => line === `export type ${typeName} = {`);
  const typeEnd = lines.findIndex((line, index) => index > typeStart && line === `}`);
  return lines
    .slice(typeStart + 1, typeEnd)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(0, line.indexOf(':')))
    .map((name) => ({
      name: name.replace(/\?$/, ''),
      optional: name.endsWith('?'),
    }));
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `\t${line}`)
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

function relativeToConfigFile(configFilePath: string, targetPath: string): string {
  const relative = path.relative(path.dirname(configFilePath), targetPath);
  return relative.length > 0 ? relative : '.';
}

function replaceExtension(fileName: string, nextExtension: '.ts' | '.d.ts'): string {
  return fileName.replace(/\.sql$/, nextExtension);
}

function escapeSqliteIdentifier(value: string): string {
  return value.replaceAll('"', '""');
}
