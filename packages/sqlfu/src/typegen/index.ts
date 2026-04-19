import fs from 'node:fs/promises';
import path from 'node:path';

import {analyzeVendoredTypesqlQueries} from './analyze-vendored-typesql.js';
import type {
  AdHocQueryAnalysis,
  JsonSchema,
  JsonSchemaObject,
  QueryCatalog,
  QueryCatalogArgument,
  QueryCatalogEntry,
  QueryCatalogField,
} from './query-catalog.js';
import {loadProjectConfig} from '../core/config.js';
import type {Client, SqlfuProjectConfig} from '../core/types.js';
import {extractSchema} from '../core/sqlite.js';
import {createBunClient, createNodeSqliteClient} from '../client.js';

export type {
  AdHocQueryAnalysis,
  JsonSchema,
  JsonSchemaObject,
  QueryCatalog,
  QueryCatalogArgument,
  QueryCatalogEntry,
  QueryCatalogField,
} from './query-catalog.js';

export async function generateQueryTypes(): Promise<void> {
  const config = await loadProjectConfig();
  await generateQueryTypesForConfig(config);
}

export async function generateQueryTypesForConfig(config: SqlfuProjectConfig): Promise<void> {
  const databasePath = await materializeTypegenDatabase(config);
  const schema = await loadSchema(databasePath);
  const queryFiles = await loadQueryFiles(config.queries);
  const queryAnalyses = await analyzeVendoredTypesqlQueries(
    databasePath,
    queryFiles.map((query) => ({
      sqlPath: query.sqlPath,
      sqlContent: query.sqlContent,
    })),
  );

  const generatedDir = path.join(config.queries, '.generated');
  await fs.mkdir(generatedDir, {recursive: true});

  await Promise.all(
    queryFiles.map(async (queryFile) => {
      const analysis = queryAnalyses.find((query) => query.sqlPath === queryFile.sqlPath);
      if (!analysis) {
        throw new Error(`Missing vendored TypeSQL analysis for ${queryFile.sqlPath}`);
      }

      const wrapperPath = path.join(generatedDir, `${queryFile.relativePath}.sql.ts`);
      await fs.mkdir(path.dirname(wrapperPath), {recursive: true});
      const contents = analysis.ok
        ? renderQueryWrapper({
          relativePath: queryFile.relativePath,
          descriptor: refineDescriptor(analysis.descriptor, queryFile.sqlContent, schema),
        })
        : `//Invalid SQL\nexport {};\n`;
      await fs.writeFile(wrapperPath, contents);
    }),
  );

  await writeGeneratedBarrel(generatedDir, queryFiles, config.generatedImportExtension);
  await writeQueryCatalog(config, queryFiles, queryAnalyses, schema);
}

export async function analyzeAdHocSqlForConfig(
  config: SqlfuProjectConfig,
  sql: string,
): Promise<AdHocQueryAnalysis> {
  const databasePath = await materializeTypegenDatabase(config);
  const schema = await loadSchema(databasePath);
  const [analysis] = await analyzeVendoredTypesqlQueries(databasePath, [
    {
      sqlPath: path.join(config.queries, '__sql_runner__.sql'),
      sqlContent: sql,
    },
  ]);

  if (!analysis) {
    throw new Error('Missing vendored TypeSQL analysis for ad hoc SQL');
  }

  if (!analysis.ok) {
    throw new Error(analysis.error.description);
  }

  const descriptor = refineDescriptor(analysis.descriptor, sql, schema);
  return toAdHocQueryAnalysis(descriptor);
}

type DisposableClient = {
  readonly client: Client;
  [Symbol.asyncDispose](): Promise<void>;
};

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

type GeneratedField = {
  readonly name: string;
  readonly tsType: string;
  readonly notNull: boolean;
  readonly optional?: boolean;
};

type GeneratedQueryDescriptor = {
  readonly sql: string;
  readonly queryType: 'Select' | 'Insert' | 'Update' | 'Delete' | 'Copy';
  readonly returning?: true;
  readonly multipleRowsResult: boolean;
  readonly columns: readonly GeneratedField[];
  readonly parameters: readonly (GeneratedField & {
    readonly toDriver: string;
    readonly isArray: boolean;
  })[];
  readonly data?: readonly (GeneratedField & {
    readonly toDriver: string;
    readonly isArray: boolean;
  })[];
};

type QueryFile = {
  /** absolute path to the .sql source file. */
  readonly sqlPath: string;
  /** path without `.sql`, relative to `config.queries`, forward slashes. E.g. `"users/list-profiles"`. */
  readonly relativePath: string;
  readonly sqlContent: string;
};

async function materializeTypegenDatabase(config: SqlfuProjectConfig) {
  const tempDbPath = path.join(config.projectRoot, '.sqlfu', 'typegen.db');
  const mainDatabase = await openMainDevDatabase(config.db);
  await using ownedMainDatabase = mainDatabase;
  const schemaSql = await extractSchema(ownedMainDatabase.client);

  await fs.mkdir(path.dirname(tempDbPath), {recursive: true});
  await fs.rm(tempDbPath, {force: true});
  await fs.rm(`${tempDbPath}-shm`, {force: true});
  await fs.rm(`${tempDbPath}-wal`, {force: true});

  await using typegenDatabase = await openMainDevDatabase(tempDbPath);
  await typegenDatabase.client.raw(schemaSql);

  return tempDbPath;
}

async function openMainDevDatabase(dbPath: string): Promise<DisposableClient> {
  await fs.mkdir(path.dirname(dbPath), {recursive: true});
  const runtime = 'Bun' in globalThis ? 'bun' : 'node';

  if (runtime === 'bun') {
    const {Database} = await import('bun:sqlite' as any)
    const database = new Database(dbPath);
    return {
      client: createBunClient(database as Parameters<typeof createBunClient>[0]),
      async [Symbol.asyncDispose]() {
        database.close();
      },
    };
  }

  const {DatabaseSync} = await import('node:sqlite')
  const database = new DatabaseSync(dbPath);
  return {
    client: createNodeSqliteClient(database as Parameters<typeof createNodeSqliteClient>[0]),
    async [Symbol.asyncDispose]() {
      database.close();
    },
  };
}

async function loadQueryFiles(queriesDir: string): Promise<readonly QueryFile[]> {
  const files: QueryFile[] = [];

  async function walk(currentDir: string, relativePrefix: string): Promise<void> {
    const entries = await fs.readdir(currentDir, {withFileTypes: true});
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      // `.generated` is where typegen writes its output; don't recurse into it.
      if (entry.name === '.generated') continue;

      const childPath = path.join(currentDir, entry.name);
      const childRelative = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await walk(childPath, childRelative);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.sql')) {
        files.push({
          sqlPath: childPath,
          relativePath: childRelative.slice(0, -'.sql'.length),
          sqlContent: await fs.readFile(childPath, 'utf8'),
        });
      }
    }
  }

  await walk(queriesDir, '');
  return files;
}

async function writeGeneratedBarrel(
  generatedDir: string,
  queryFiles: readonly QueryFile[],
  generatedImportExtension: '.js' | '.ts',
): Promise<void> {
  const lines = queryFiles
    .map((queryFile) => queryFile.relativePath)
    .sort((left, right) => left.localeCompare(right))
    .map((relativePath) => `export * from "./${relativePath}.sql${generatedImportExtension}";`);
  await fs.writeFile(path.join(generatedDir, 'index.ts'), lines.join('\n') + (lines.length > 0 ? '\n' : ''));
}

async function writeQueryCatalog(
  config: SqlfuProjectConfig,
  queryFiles: readonly QueryFile[],
  queryAnalyses: Awaited<ReturnType<typeof analyzeVendoredTypesqlQueries>>,
  schema: ReadonlyMap<string, RelationInfo>,
): Promise<void> {
  const entries: QueryCatalogEntry[] = queryFiles.map((queryFile) => {
    const analysis = queryAnalyses.find((query) => query.sqlPath === queryFile.sqlPath);
    if (!analysis) {
      throw new Error(`Missing vendored TypeSQL analysis for ${queryFile.sqlPath}`);
    }

    const functionName = toCamelCase(queryFile.relativePath);
    const id = queryFile.relativePath;

    if (!analysis.ok) {
      return {
        kind: 'error',
        id,
        sqlFile: path.relative(config.projectRoot, queryFile.sqlPath).split(path.sep).join('/'),
        functionName,
        sql: queryFile.sqlContent,
        error: analysis.error,
      };
    }

    const descriptor = refineDescriptor(analysis.descriptor, queryFile.sqlContent, schema);
    const columns = getResultFields(descriptor).map((field) => toCatalogField(field));
    const args = [
      ...(descriptor.data ?? []).map((field) => toCatalogArgument('data', field)),
      ...descriptor.parameters.map((field) => toCatalogArgument('params', field)),
    ];

    return {
      kind: 'query',
      id,
      sqlFile: path.relative(config.projectRoot, queryFile.sqlPath).split(path.sep).join('/'),
      functionName,
      sql: descriptor.sql,
      queryType: descriptor.queryType,
      multipleRowsResult: descriptor.multipleRowsResult,
      resultMode: getResultMode(descriptor),
      args,
      dataSchema: descriptor.data?.length ? objectSchema(`${functionName} data`, descriptor.data) : undefined,
      paramsSchema: descriptor.parameters.length ? objectSchema(`${functionName} params`, descriptor.parameters) : undefined,
      resultSchema: objectSchema(`${functionName} result`, getResultFields(descriptor), {fieldKind: 'result'}),
      columns,
    };
  });

  const catalog: QueryCatalog = {
    generatedAt: new Date().toISOString(),
    queries: entries,
  };

  const outputPath = path.join(config.projectRoot, '.sqlfu', 'query-catalog.json');
  await fs.mkdir(path.dirname(outputPath), {recursive: true});
  await fs.writeFile(outputPath, JSON.stringify(catalog, null, 2) + '\n');
}

function toAdHocQueryAnalysis(descriptor: GeneratedQueryDescriptor): AdHocQueryAnalysis {
  const columns = getResultFields(descriptor).map((field) => toCatalogField(field));
  const args = [
    ...(descriptor.data ?? []).map((field) => toCatalogArgument('data', field)),
    ...descriptor.parameters.map((field) => toCatalogArgument('params', field)),
  ];

  return {
    sql: descriptor.sql,
    queryType: descriptor.queryType,
    multipleRowsResult: descriptor.multipleRowsResult,
    resultMode: getResultMode(descriptor),
    args,
    dataSchema: descriptor.data?.length ? objectSchema('sqlRunner data', descriptor.data) : undefined,
    paramsSchema: descriptor.parameters.length ? objectSchema('sqlRunner params', descriptor.parameters) : undefined,
    resultSchema: objectSchema('sqlRunner result', getResultFields(descriptor), {fieldKind: 'result'}),
    columns,
  };
}

function renderQueryWrapper(input: {
  relativePath: string;
  descriptor: GeneratedQueryDescriptor;
}): string {
  const queryName = input.relativePath;
  const functionName = toCamelCase(queryName);
  const capitalizedName = functionName[0]!.toUpperCase() + functionName.slice(1);
  const dataTypeName = `${capitalizedName}Data`;
  const paramsTypeName = `${capitalizedName}Params`;
  const resultTypeName = `${capitalizedName}Result`;
  const sqlConstantName = `${capitalizedName}Sql`;
  const returnType = getReturnType(input.descriptor, resultTypeName);
  const typeBlocks = buildTypeBlocks(input.descriptor, {
    dataTypeName,
    paramsTypeName,
    resultTypeName,
  });
  const queryArgs = buildQueryArgs(input.descriptor);
  const restParameters = buildFunctionParameters(input.descriptor, {
    dataTypeName,
    paramsTypeName,
  });

  return [
    `import type {Client, SqlQuery} from 'sqlfu';`,
    ``,
    ...typeBlocks,
    ``,
    `const ${sqlConstantName} = \``,
    normalizeSqlForTemplate(input.descriptor.sql).join('\n').trim(),
    `\``,
    ``,
    `export async function ${functionName}(client: Client${restParameters ? `, ${restParameters}` : ''}): Promise<${returnType}> {`,
    `\tconst query: SqlQuery = { sql: ${sqlConstantName}, args: ${queryArgs}, name: ${JSON.stringify(queryName)} };`,
    ...buildGeneratedImplementation({
      resultMode: getResultMode(input.descriptor),
      resultType: resultTypeName,
      resultProperties: getResultProperties(input.descriptor),
    }),
    `}`,
    ``,
  ].join('\n');
}

function getReturnType(descriptor: GeneratedQueryDescriptor, resultTypeName: string): string {
  const resultMode = getResultMode(descriptor);
  if (resultMode === 'many') {
    return `${resultTypeName}[]`;
  }
  if (resultMode === 'nullableOne') {
    return `${resultTypeName} | null`;
  }
  return resultTypeName;
}

function getResultMode(descriptor: GeneratedQueryDescriptor): 'many' | 'nullableOne' | 'one' | 'metadata' {
  if (!descriptor.returning && descriptor.queryType !== 'Select') {
    return 'metadata';
  }
  if (descriptor.multipleRowsResult) {
    return 'many';
  }
  if (descriptor.queryType === 'Select') {
    return 'nullableOne';
  }
  return 'one';
}

function buildTypeBlocks(
  descriptor: GeneratedQueryDescriptor,
  names: {
    dataTypeName: string;
    paramsTypeName: string;
    resultTypeName: string;
  },
): string[] {
  const blocks: string[] = [];
  if ((descriptor.data?.length ?? 0) > 0) {
    blocks.push(renderObjectType(names.dataTypeName, descriptor.data!, 'parameter'));
  }
  if (descriptor.parameters.length > 0) {
    blocks.push(renderObjectType(names.paramsTypeName, descriptor.parameters, 'parameter'));
  }
  blocks.push(renderObjectType(names.resultTypeName, getResultFields(descriptor), 'result'));
  return blocks.flatMap((block, index) => (index === 0 ? [block] : ['', block]));
}

function renderObjectType(
  typeName: string,
  fields: readonly GeneratedField[],
  fieldKind: 'parameter' | 'result',
): string {
  const lines = fields.map((field) => {
    const optional = fieldKind === 'parameter' ? Boolean(field.optional) : !field.notNull;
    const orNull = fieldKind === 'parameter' && !field.notNull ? ' | null' : '';
    return `\t${field.name}${optional ? '?' : ''}: ${field.tsType}${orNull};`;
  });
  return [`export type ${typeName} = {`, ...lines, `}`].join('\n');
}

function objectSchema(
  title: string,
  fields: readonly GeneratedField[],
  input: {
    fieldKind?: 'parameter' | 'result';
  } = {},
): JsonSchemaObject {
  const fieldKind = input.fieldKind ?? 'parameter';
  const properties = Object.fromEntries(fields.map((field) => [field.name, schemaForField(field)]));
  const required = fields
    .filter((field) => fieldKind === 'parameter' ? !Boolean(field.optional) : field.notNull)
    .map((field) => field.name);

  return {
    type: 'object',
    title,
    properties,
    required,
    additionalProperties: false,
  };
}

function schemaForField(field: GeneratedField): JsonSchema {
  const schema = schemaForTsType(field.tsType);
  if (field.notNull) {
    return schema;
  }

  return {
    anyOf: [schema, {type: 'null'}],
  };
}

function schemaForTsType(tsType: string): JsonSchemaObject {
  if (tsType === 'string') {
    return {type: 'string'};
  }
  if (tsType === 'number') {
    return {type: 'number'};
  }
  if (tsType === 'boolean') {
    return {type: 'boolean'};
  }
  if (tsType === 'Date') {
    return {type: 'string', format: 'date-time'};
  }
  if (tsType === 'Uint8Array' || tsType === 'ArrayBuffer') {
    return {type: 'string'};
  }
  if (tsType.endsWith('[]')) {
    return {
      type: 'array',
      items: schemaForTsType(tsType.slice(0, -2)),
    };
  }

  const enumValues = parseStringLiteralUnion(tsType);
  if (enumValues) {
    return {
      type: 'string',
      enum: enumValues,
    };
  }

  return {};
}

function parseStringLiteralUnion(tsType: string): readonly string[] | undefined {
  const parts = tsType
    .replace(/^\(/, '')
    .replace(/\)$/, '')
    .split('|')
    .map((part) => part.trim());

  if (parts.length === 0 || parts.some((part) => !/^(['"]).*\1$/.test(part))) {
    return undefined;
  }

  return parts.map((part) => part.slice(1, -1));
}

function getResultFields(descriptor: GeneratedQueryDescriptor): readonly GeneratedField[] {
  if (descriptor.returning || descriptor.queryType === 'Select') {
    return descriptor.columns;
  }
  if (descriptor.queryType === 'Insert') {
    return [
      {name: 'rowsAffected', tsType: 'number', notNull: true},
      {name: 'lastInsertRowid', tsType: 'number', notNull: true},
    ];
  }
  return [
    {name: 'rowsAffected', tsType: 'number', notNull: true},
  ];
}

function buildFunctionParameters(
  descriptor: GeneratedQueryDescriptor,
  names: {
    dataTypeName: string;
    paramsTypeName: string;
  },
): string {
  const parameters: string[] = [];
  if ((descriptor.data?.length ?? 0) > 0) {
    parameters.push(`data: ${names.dataTypeName}`);
  }
  if (descriptor.parameters.length > 0) {
    parameters.push(`params: ${names.paramsTypeName}`);
  }
  return parameters.join(', ');
}

function buildQueryArgs(descriptor: GeneratedQueryDescriptor): string {
  const args = [
    ...(descriptor.data ?? []).map((field) => toDriver('data', field)),
    ...descriptor.parameters.map((field) => toDriver('params', field)),
  ];
  return args.length > 0 ? `[${args.join(', ')}]` : '[]';
}

function toCatalogArgument(
  scope: 'data' | 'params',
  field: GeneratedField & {
    readonly toDriver: string;
    readonly isArray: boolean;
  },
): QueryCatalogArgument {
  return {
    scope,
    name: field.name,
    tsType: field.tsType,
    notNull: field.notNull,
    optional: Boolean(field.optional),
    isArray: field.isArray || field.tsType.endsWith('[]'),
    driverEncoding: inferDriverEncoding(field),
  };
}

function inferDriverEncoding(field: {
  readonly tsType: string;
  readonly toDriver: string;
}): QueryCatalogArgument['driverEncoding'] {
  if (field.tsType === 'boolean') {
    return 'boolean-number';
  }
  if (field.tsType === 'Date') {
    return field.toDriver.includes(`split('T')[0]`) && !field.toDriver.includes(`replace('T', ' ')`)
      ? 'date'
      : 'datetime';
  }
  return 'identity';
}

function toCatalogField(field: GeneratedField): QueryCatalogField {
  return {
    name: field.name,
    tsType: field.tsType,
    notNull: field.notNull,
    optional: Boolean(field.optional),
  };
}

function toDriver(
  variableName: 'data' | 'params',
  param: GeneratedField & {
    readonly toDriver: string;
    readonly isArray: boolean;
  },
): string {
  if (param.tsType === 'Date') {
    return `${variableName}.${param.toDriver}`;
  }
  if (param.tsType === 'boolean') {
    const variable = `${variableName}.${param.name}`;
    return `${variable} != null ? Number(${variable}) : ${variable}`;
  }
  if (param.tsType.endsWith('[]')) {
    return `...${variableName}.${param.name}`;
  }
  return `${variableName}.${param.name}`;
}

function normalizeSqlForTemplate(sql: string): string[] {
  return `${sql.trimEnd()}\n`.split('\n');
}

function refineDescriptor(
  descriptor: GeneratedQueryDescriptor,
  sql: string,
  schema: ReadonlyMap<string, RelationInfo>,
): GeneratedQueryDescriptor {
  const inferredColumns = inferQueryResultColumns(sql, schema);
  if (inferredColumns.size === 0) {
    return descriptor;
  }

  return {
    ...descriptor,
    columns: descriptor.columns.map((column) => {
      const inferredColumn = inferredColumns.get(column.name.replaceAll('"', ''));
      if (!inferredColumn) {
        return column;
      }
      return {
        ...column,
        tsType: column.tsType === 'any' ? inferredColumn.tsType : column.tsType,
        notNull: column.notNull || inferredColumn.notNull,
      };
    }),
  };
}

function getResultProperties(descriptor: GeneratedQueryDescriptor): ReadonlyArray<{
  readonly name: string;
  readonly optional: boolean;
}> {
  return getResultFields(descriptor).map((field) => ({
    name: field.name,
    optional: !field.notNull,
  }));
}

function toCamelCase(value: string): string {
  const parts = value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
  if (parts.length === 0) {
    return '';
  }
  return parts[0]! + parts.slice(1).map((part) => part[0]!.toUpperCase() + part.slice(1)).join('');
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

async function loadSchema(databasePath: string): Promise<ReadonlyMap<string, RelationInfo>> {
  await using database = await openMainDevDatabase(databasePath);
  const client = database.client;

  try {
    const schemaResult = await client.all<{name: string; type: string; sql: string | null}>({
      sql: `
        select name, type, sql
        from sqlite_schema
        where type in ('table', 'view')
          and name not like 'sqlite_%'
        order by name
      `,
      args: [],
    });

    const relations = new Map<string, RelationInfo>();

    for (const row of schemaResult) {
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
  } finally {}
}

async function loadRelationColumns(
  client: Client,
  relationName: string,
): Promise<ReadonlyMap<string, TsColumn>> {
  const pragmaResult = await client.all<Record<string, unknown>>({
    sql: `PRAGMA table_xinfo("${escapeSqliteIdentifier(relationName)}")`,
    args: [],
  });

  const columns = new Map<string, TsColumn>();

  for (const row of pragmaResult) {
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

function escapeSqliteIdentifier(value: string): string {
  return value.replaceAll('"', '""');
}
