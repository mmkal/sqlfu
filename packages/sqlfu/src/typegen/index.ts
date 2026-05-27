import fs from 'node:fs/promises';
import path from 'node:path';

import {analyzeVendoredTypesqlQueries} from './analyze-vendored-typesql.js';
import {
  addParameterExpansion,
  expandedFieldName,
  findNamedParameterReferences,
  findSqlIgnoredRanges,
  parseInlineParameterExpansions,
  prepareSqlForAnalysis,
  replaceNamedParameters,
  stripSqlComments,
  type ParameterExpansion,
} from './query-parameters.js';
import {
  assertSqliteMaterialized,
  registerSqliteTypegenImpls,
  sqliteDialect,
  type DialectColumnInfo,
  type LogicalType,
  type RelationInfo,
} from '../dialect.js';
import {quoteIdentifier as sqliteQuoteIdentifier} from '../schemadiff/sqlite/identifiers.js';
import type {
  AdHocQueryAnalysis,
  JsonSchema,
  JsonSchemaObject,
  QueryCatalog,
  QueryCatalogArgument,
  QueryCatalogEntry,
  QueryCatalogField,
} from './query-catalog.js';
import {loadProjectConfig} from '../node/config.js';
import {createNodeHost} from '../node/host.js';
import type {Client, SqlfuGenerateCasing, SqlfuGenerateRuntime, SqlfuProjectConfig, SqlfuValidator} from '../types.js';
import type {SqlfuHost} from '../host.js';
import {excludeReservedSqliteObjects, extractSchema} from '../sqlite-text.js';
import {createBunClient, createNodeSqliteClient} from '../index.js';
import {migrationName, readMigrationHistory, type Migration} from '../migrations/index.js';
import {presetTableName} from '../migrations/preset-queries.js';
import {materializeDefinitionsSchemaFor, readMigrationFiles} from '../materialize.js';
import {queryIdentityFromPath, querySourceManifestEntry, renderQuerySourceManifest} from '../query-identity.js';
import {readInlineSqlfuSource, writeInlineQueryTypes} from '../node/inline-source.js';

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
  const host = await createNodeHost();
  await generateQueryTypesForConfig(config, host);
}

export type GenerateQueryTypesResult = {
  writtenFiles: string[];
};

export async function generateQueryTypesForConfig(
  config: SqlfuProjectConfig,
  host: SqlfuHost,
): Promise<GenerateQueryTypesResult> {
  const dialect = config.dialect;
  const sourceSql = await readSchemaForAuthority(config, host);
  await using materialized = await dialect.materializeTypegenSchema(host, {
    projectRoot: config.projectRoot,
    sourceSql,
    experimentalJsonTypes: config.generate.experimentalJsonTypes,
  });
  const schema = await dialect.loadSchemaForTypegen(materialized);
  const queryDocuments = await loadQueryDocuments(config.queries);
  const querySources = queryDocuments.flatMap((queryDocument) => queryDocument.queries);
  assertUniqueQueryFunctionNames(querySources);

  const queryAnalyses = await dialect.analyzeQueries(
    materialized,
    querySources.map((query) => ({
      sqlPath: query.sqlPath,
      sqlContent: query.analysisSqlContent,
    })),
  );

  const generatedDir = path.join(config.queries, '.generated');
  await fs.mkdir(generatedDir, {recursive: true});
  const writtenFiles: string[] = [];

  await Promise.all(
    queryDocuments.map(async (queryDocument) => {
      const wrapperPath = path.join(generatedDir, `${queryDocument.relativePath}.sql.ts`);
      await fs.mkdir(path.dirname(wrapperPath), {recursive: true});

      const contents = renderQueryDocument({
        queryDocument,
        queryAnalyses,
        schema,
        validator: config.generate.validator,
        prettyErrors: config.generate.prettyErrors,
        sync: config.generate.sync,
        casing: config.generate.casing,
        runtime: config.generate.runtime,
      });
      await fs.writeFile(wrapperPath, contents);
      writtenFiles.push(projectRelativePath(config, wrapperPath));
    }),
  );

  writtenFiles.push(await writeTablesFile(config, generatedDir, schema));
  writtenFiles.push(
    await writeGeneratedQueriesFile(config, generatedDir, queryDocuments, config.generate.importExtension),
  );
  writtenFiles.push(await writeGeneratedBarrel(config, generatedDir, config.generate.importExtension));
  writtenFiles.push(await writeQueryCatalog(config, querySources, queryAnalyses, schema));
  if (config.migrations) {
    writtenFiles.push(await writeMigrationsBundle(config));
  }

  return {writtenFiles: writtenFiles.sort((left, right) => left.localeCompare(right))};
}

export async function generateInlineSqlfuTypes(input: {
  modulePath: string;
  projectRoot: string;
  host: SqlfuHost;
}): Promise<GenerateQueryTypesResult> {
  const inline = await readInlineSqlfuSource(input.modulePath);
  if (!inline) {
    throw new Error(`No inlineSqlfu(...) call found in ${input.modulePath}.`);
  }

  const dialect = sqliteDialect();
  const sourceSql = await materializeDefinitionsSchemaFor(input.host, inline.definitions.sql, {dialect});
  await using materialized = await dialect.materializeTypegenSchema(input.host, {
    projectRoot: input.projectRoot,
    sourceSql,
    experimentalJsonTypes: false,
  });
  const schema = await dialect.loadSchemaForTypegen(materialized);
  const querySources = inline.queries.map((query) => inlineQuerySource(input.modulePath, query.name, query.content.sql));
  assertUniqueQueryFunctionNames(querySources);

  const queryAnalyses = await dialect.analyzeQueries(
    materialized,
    querySources.map((query) => ({
      sqlPath: query.sqlPath,
      sqlContent: query.analysisSqlContent,
    })),
  );

  const queryTypes = new Map<string, string>();
  for (const querySource of querySources) {
    const analysis = queryAnalyses.find((query) => query.sqlPath === querySource.sqlPath);
    if (!analysis) {
      throw new Error(`Missing vendored TypeSQL analysis for ${querySource.sqlPath}`);
    }
    if (!analysis.ok) {
      throw new Error(analysis.error.description);
    }
    const prepared = prepareQueryDescriptor({
      descriptor: refineDescriptor(analysis.descriptor, querySource.analysisSqlContent, schema),
      explicitParameterExpansions: querySource.parameterExpansions,
      sourceSql: querySource.sqlContent,
    });
    assertInlineSqlfuRuntimeSupported(querySource, prepared.descriptor, prepared.parameterExpansions);
    queryTypes.set(querySource.functionName, renderInlineSqlfuQueryType(prepared.descriptor, 'preserve'));
  }

  await writeInlineQueryTypes(input.modulePath, queryTypes);

  return {writtenFiles: [projectRelativePath(input, input.modulePath)]};
}

function inlineQuerySource(modulePath: string, functionName: string, sqlContent: string): QuerySource {
  const parameterExpansions = parseInlineParameterExpansions(sqlContent);
  return {
    sqlPath: `${modulePath}#${functionName}`,
    sourceSqlPath: modulePath,
    id: functionName,
    functionName,
    sqlContent,
    sqlFileContent: sqlContent,
    analysisSqlContent: prepareSqlForAnalysis(sqlContent, parameterExpansions),
    parameterExpansions,
  };
}

function renderInlineSqlfuQueryType(
  descriptor: GeneratedQueryDescriptor,
  casing: SqlfuGenerateCasing,
): string {
  const {descriptor: cased} = applyGeneratedInputCasing(descriptor, casing);
  const parts: string[] = [];
  const parameterFields = [...(cased.data || []), ...cased.parameters];
  if (parameterFields.length > 0) {
    parts.push(`parameters: ${renderInlineTypeLiteral(parameterFields, 'parameter')}`);
  }
  if (getResultMode(cased) !== 'metadata') {
    const resultFields = mapColumnDerivedFields(getResultFields(cased), casing).publicFields;
    parts.push(`result: ${renderInlineTypeLiteral(resultFields, 'result')}`);
  }
  return `{ ${parts.join('; ')} }`;
}

function renderInlineTypeLiteral(fields: GeneratedField[], fieldKind: 'parameter' | 'result'): string {
  const properties = fields.map((field) => {
    const optional = fieldKind === 'parameter' && Boolean(field.optional);
    return `${field.name}${optional ? '?' : ''}: ${inlineFieldTypeExpression(field, fieldKind)}`;
  });
  return `{ ${properties.join('; ')} }`;
}

function inlineFieldTypeExpression(field: GeneratedField, fieldKind: 'parameter' | 'result'): string {
  const typeExpression = fieldTypeExpression(field, fieldKind);
  if (fieldKind === 'result' && !field.notNull) {
    return `${typeExpression} | null`;
  }
  return typeExpression;
}

function assertInlineSqlfuRuntimeSupported(
  querySource: QuerySource,
  descriptor: GeneratedQueryDescriptor,
  parameterExpansions: ParameterExpansion[],
): void {
  const expansion = parameterExpansions[0];
  if (expansion) {
    throw new Error(
      `inlineSqlfu query ${querySource.functionName} cannot use ${expansion.kind} parameter "${expansion.name}" because inline runtime binds the SQL template directly.`,
    );
  }

  const convertedParameter = [...(descriptor.data || []), ...descriptor.parameters].find(
    (field) => inferDriverEncoding(field) !== 'identity',
  );
  if (convertedParameter) {
    throw new Error(
      `inlineSqlfu query ${querySource.functionName} cannot use non-identity driver parameter "${convertedParameter.name}" because inline runtime binds the SQL template directly.`,
    );
  }
}

function projectRelativePath(config: Pick<SqlfuProjectConfig, 'projectRoot'>, filePath: string) {
  return path.relative(config.projectRoot, filePath).split(path.sep).join('/');
}

function renderQueryDocument(input: {
  queryDocument: QueryDocument;
  queryAnalyses: Awaited<ReturnType<typeof analyzeVendoredTypesqlQueries>>;
  schema: ReadonlyMap<string, RelationInfo>;
  validator: SqlfuValidator | null;
  prettyErrors: boolean;
  sync: boolean;
  casing: SqlfuGenerateCasing;
  runtime: SqlfuGenerateRuntime;
}): string {
  const renderedQueries = input.queryDocument.queries.map((querySource) => {
    const analysis = input.queryAnalyses.find((query) => query.sqlPath === querySource.sqlPath);
    if (!analysis) {
      throw new Error(`Missing vendored TypeSQL analysis for ${querySource.sqlPath}`);
    }

    if (!analysis.ok) {
      return `//Invalid SQL\nexport {};\n`;
    }

    const useUniqueLocals = input.queryDocument.queries.length > 1;
    const localNames = useUniqueLocals
      ? {
          sql: `${querySource.functionName}Sql`,
          query: `${querySource.functionName}Query`,
          dataSchema: `${querySource.functionName}Data`,
          paramsSchema: `${querySource.functionName}Params`,
          resultSchema: `${querySource.functionName}Result`,
          resultMapper: `${querySource.functionName}MapResult`,
        }
      : undefined;

    // DDL / connection-control statements (create/drop/alter/pragma/vacuum/begin/...) get a
    // trivial wrapper that just runs the SQL — no params, no result columns. The vendored
    // typesql analyzer tags these as `queryType: 'Ddl'`; see the divergence note in
    // src/vendor/typesql/CLAUDE.md.
    if (analysis.descriptor.queryType === 'Ddl') {
      return renderDdlWrapper({
        functionName: querySource.functionName,
        sql: querySource.sqlContent,
        sync: input.sync,
        runtime: input.runtime,
        localNames,
      });
    }

    const {descriptor, parameterExpansions} = prepareQueryDescriptor({
      descriptor: refineDescriptor(analysis.descriptor, querySource.analysisSqlContent, input.schema),
      explicitParameterExpansions: querySource.parameterExpansions,
      sourceSql: querySource.sqlContent,
    });
    return renderQueryWrapper({
      functionName: querySource.functionName,
      sourceSql: querySource.sqlContent,
      descriptor,
      parameterExpansions,
      validator: input.validator,
      prettyErrors: input.prettyErrors,
      sync: input.sync,
      casing: input.casing,
      runtime: input.runtime,
      localNames,
    });
  });

  if (input.queryDocument.queries.length === 1) {
    return renderedQueries[0]!;
  }

  return combineRenderedQueryModules(renderedQueries);
}

function combineRenderedQueryModules(renderedQueries: string[]): string {
  const imports = new Set<string>();
  const bodies: string[] = [];

  for (const renderedQuery of renderedQueries) {
    const lines = renderedQuery.trimEnd().split('\n');
    let firstBodyLine = 0;
    while (firstBodyLine < lines.length && lines[firstBodyLine]!.startsWith('import ')) {
      imports.add(lines[firstBodyLine]!);
      firstBodyLine += 1;
    }
    if (lines[firstBodyLine] === '') {
      firstBodyLine += 1;
    }
    bodies.push(lines.slice(firstBodyLine).join('\n'));
  }

  return [...imports].sort().join('\n') + '\n\n' + bodies.join('\n\n') + '\n';
}

type LocalNames = {
  sql: string;
  query: string;
  dataSchema: string;
  paramsSchema: string;
  resultSchema: string;
  resultMapper: string;
};

function isEffectSqlRuntime(runtime: SqlfuGenerateRuntime): runtime is 'effect-v3' | 'effect-v4-unstable' {
  return runtime === 'effect-v3' || runtime === 'effect-v4-unstable';
}

function effectSqlImportSpecifier(runtime: 'effect-v3' | 'effect-v4-unstable'): string {
  return runtime === 'effect-v4-unstable' ? 'effect/unstable/sql' : '@effect/sql';
}

type NativeSqliteRuntime = 'node:sqlite' | 'better-sqlite3' | 'bun:sqlite' | 'libsql' | '@libsql/client';

function isNativeSqliteRuntime(runtime: SqlfuGenerateRuntime): runtime is NativeSqliteRuntime {
  return (
    runtime === 'node:sqlite' ||
    runtime === 'better-sqlite3' ||
    runtime === 'bun:sqlite' ||
    runtime === 'libsql' ||
    runtime === '@libsql/client'
  );
}

function isAsyncNativeSqliteRuntime(runtime: NativeSqliteRuntime): runtime is '@libsql/client' {
  return runtime === '@libsql/client';
}

function nativeSqliteImportLine(runtime: NativeSqliteRuntime): string {
  if (runtime === 'node:sqlite') return `import type {DatabaseSync as Database} from 'node:sqlite';`;
  if (runtime === 'better-sqlite3') return `import type Database from 'better-sqlite3';`;
  if (runtime === 'bun:sqlite') return `import type {Database} from 'bun:sqlite';`;
  if (runtime === 'libsql') return `import type {Database} from 'libsql';`;
  return `import type {Client} from '@libsql/client';`;
}

function nativeSqliteDriverType(runtime: NativeSqliteRuntime): string {
  return isAsyncNativeSqliteRuntime(runtime) ? 'Client' : 'Database';
}

function nativeSqliteDriverVariable(runtime: NativeSqliteRuntime): string {
  return isAsyncNativeSqliteRuntime(runtime) ? 'client' : 'database';
}

function renderDdlWrapper(input: {
  functionName: string;
  sql: string;
  sync: boolean;
  runtime: SqlfuGenerateRuntime;
  localNames?: LocalNames;
}): string {
  const functionName = input.functionName;
  const sqlName = input.localNames?.sql || 'sql';
  const queryName = input.localNames?.query || 'query';

  if (isEffectSqlRuntime(input.runtime)) {
    return [
      `import * as Effect from 'effect/Effect';`,
      `import {SqlClient} from '${effectSqlImportSpecifier(input.runtime)}';`,
      ``,
      ...renderSqlConstant(input.sql, sqlName),
      renderConstQueryObjectDeclaration({
        queryVariableName: queryName,
        queryName: functionName,
        sqlExpression: sqlName,
        argsExpression: '[]',
      }),
      ``,
      `export const ${functionName} = Object.assign(`,
      `\tfunction ${functionName}() {`,
      `\t\treturn Effect.gen(function*() {`,
      `\t\t\tconst sqlClient = yield* SqlClient.SqlClient;`,
      `\t\t\treturn yield* sqlClient.unsafe(${queryName}.sql, ${queryName}.args).raw;`,
      `\t\t});`,
      `\t},`,
      `\t{ ${objectProperty('sql', sqlName)}, ${objectProperty('query', queryName)} },`,
      `);`,
      ``,
    ].join('\n');
  }

  if (isNativeSqliteRuntime(input.runtime)) {
    const driverVariable = nativeSqliteDriverVariable(input.runtime);
    const maybeAsync = isAsyncNativeSqliteRuntime(input.runtime) ? 'async ' : '';
    return [
      nativeSqliteImportLine(input.runtime),
      ``,
      ...renderSqlConstant(input.sql, sqlName),
      renderConstQueryObjectDeclaration({
        queryVariableName: queryName,
        queryName: functionName,
        sqlExpression: sqlName,
        argsExpression: '[]',
      }),
      ``,
      `export const ${functionName} = Object.assign(`,
      `\t${maybeAsync}function ${functionName}(${driverVariable}: ${nativeSqliteDriverType(input.runtime)}) {`,
      ...buildNativeSqliteMetadataImplementation({
        runtime: input.runtime,
        driverVariable,
        resultFields: [],
        queryReference: queryName,
        indent: '\t\t',
      }),
      `\t},`,
      `\t{ ${objectProperty('sql', sqlName)}, ${objectProperty('query', queryName)} },`,
      `);`,
      ``,
    ].join('\n');
  }

  const clientType = input.sync ? 'SyncClient' : 'Client';
  const maybeAsync = input.sync ? '' : 'async ';

  return [
    `import type {${clientType}} from 'sqlfu';`,
    ``,
    ...renderSqlConstant(input.sql, sqlName),
    renderConstQueryObjectDeclaration({
      queryVariableName: queryName,
      queryName: functionName,
      sqlExpression: sqlName,
      argsExpression: '[]',
    }),
    ``,
    `export const ${functionName} = Object.assign(`,
    `\t${maybeAsync}function ${functionName}(client: ${clientType}) {`,
    `\t\treturn client.run(${queryName});`,
    `\t},`,
    `\t{ ${objectProperty('sql', sqlName)}, ${objectProperty('query', queryName)} },`,
    `);`,
    ``,
  ].join('\n');
}

/**
 * Module-scoped `const sql = \`…\``, accessed externally via the Object.assign-merged
 * `whatever.sql`. Renders as a one-liner when the line fits under 80 characters,
 * otherwise splits across three lines with the SQL body on its own line and a trailing
 * `.trim()` so the runtime value has no leading/trailing whitespace from the indentation.
 */
function renderSqlConstant(sql: string, variableName: string = 'sql'): string[] {
  const trimmed = escapeTemplateLiteralChunk(normalizeSqlForTemplate(sql).join('\n').trim());
  const oneLiner = `const ${variableName} = \`${trimmed}\`;`;
  if (!trimmed.includes('\n') && oneLiner.length <= 80) {
    return [oneLiner];
  }
  return [`const ${variableName} = \``, trimmed, `\`.trim();`];
}

export async function analyzeAdHocSqlForConfig(
  config: SqlfuProjectConfig,
  host: SqlfuHost,
  sql: string,
): Promise<AdHocQueryAnalysis> {
  const dialect = config.dialect;
  const sourceSql = await readSchemaForAuthority(config, host);
  await using materialized = await dialect.materializeTypegenSchema(host, {
    projectRoot: config.projectRoot,
    sourceSql,
    experimentalJsonTypes: config.generate.experimentalJsonTypes,
  });
  const schema = await dialect.loadSchemaForTypegen(materialized);
  const [analysis] = await dialect.analyzeQueries(materialized, [
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
  client: Client;
  [Symbol.asyncDispose](): Promise<void>;
};

// `TsColumn` and `RelationInfo` are imported from `../dialect.js` as
// `DialectColumnInfo` and `RelationInfo` so both sqlite and pg dialects
// produce values of the same shape. Local alias keeps the rest of the
// file's identifier choices stable. `LogicalType` likewise lives on the
// dialect surface so sqlite (`declared-type=json`) and any future pg
// mapping (`json`/`jsonb`) agree on the column-encoding hint.
type TsColumn = DialectColumnInfo;

type LogicalTypeInfo = {
  logicalType: LogicalType;
  tsType: string;
};

type GeneratedField = {
  name: string;
  tsType: string;
  notNull: boolean;
  logicalType?: LogicalType;
  plainTsType?: boolean;
  optional?: boolean;
  objectFields?: GeneratedField[];
  driverObjectFields?: GeneratedField[];
  isArray?: boolean;
  acceptsSingleOrArray?: boolean;
};

type GeneratedQueryDescriptor = {
  sql: string;
  queryType: 'Select' | 'Insert' | 'Update' | 'Delete' | 'Copy' | 'Ddl';
  returning?: true;
  multipleRowsResult: boolean;
  columns: GeneratedField[];
  parameters: (GeneratedField & {
    toDriver: string;
    isArray: boolean;
  })[];
  data?: (GeneratedField & {
    toDriver: string;
    isArray: boolean;
  })[];
};

type FieldMapping<TField extends GeneratedField = GeneratedField> = {
  raw: TField;
  public: TField;
};

type FieldMappingPlan<TField extends GeneratedField = GeneratedField> = {
  rawFields: TField[];
  publicFields: TField[];
  mappings: FieldMapping<TField>[];
  hasNameChanges: boolean;
};

type DescriptorCasingPlan = {
  descriptor: GeneratedQueryDescriptor;
  dataMapping: FieldMappingPlan<GeneratedField & {toDriver: string; isArray: boolean}> | null;
};

type QueryFile = {
  /** absolute path to the .sql source file. */
  sqlPath: string;
  /** path without `.sql`, relative to `config.queries`, forward slashes. E.g. `"users/list-profiles"`. */
  relativePath: string;
  sqlContent: string;
};

type QueryDocument = QueryFile & {
  queries: QuerySource[];
};

type QuerySource = {
  /** unique path passed through the analyzer; can include an annotation suffix for multi-query files. */
  sqlPath: string;
  /** absolute path to the source .sql file. */
  sourceSqlPath: string;
  /** query id for catalogs and UI consumers. */
  id: string;
  /** generated export name. */
  functionName: string;
  /** the SQL statement without the annotation block. */
  sqlContent: string;
  /** full source file contents, preserved for UI display. */
  sqlFileContent: string;
  /** SQL passed to the analyzer after expanding object-shaped params into representative placeholders. */
  analysisSqlContent: string;
  parameterExpansions: ParameterExpansion[];
};

export async function materializeTypegenDatabase(input: {
  projectRoot: string;
  sourceSql: string;
  experimentalJsonTypes: boolean;
}) {
  const tempDbPath = path.join(input.projectRoot, '.sqlfu', 'typegen.db');

  await fs.mkdir(path.dirname(tempDbPath), {recursive: true});
  await fs.rm(tempDbPath, {force: true});
  await fs.rm(`${tempDbPath}-shm`, {force: true});
  await fs.rm(`${tempDbPath}-wal`, {force: true});

  await using typegenDatabase = await openMainDevDatabase(tempDbPath);
  await typegenDatabase.client.raw(input.sourceSql);

  return tempDbPath;
}

/**
 * Read the canonical schema source for the project's chosen typegen
 * authority. Used by sqlite's `materializeTypegenDatabase` and exported
 * for pg-side dialects to use for the same purpose. The result is a SQL
 * string ready to apply to a scratch DB.
 *
 * Each authority delegates through dialect methods
 * (`materializeSchemaSql` / `extractSchemaFromClient`), so the function
 * itself stays dialect-neutral — adding a new dialect doesn't require
 * touching this code.
 */
export async function readSchemaForAuthority(config: SqlfuProjectConfig, host: SqlfuHost): Promise<string> {
  const authority = config.generate.authority;
  switch (authority) {
    case 'desired_schema':
      return readDefinitionsAsSchemaSql(config, host);
    case 'migrations':
      return replayMigrationFilesAsSchemaSql(config, host);
    case 'migration_history':
      return replayMigrationHistoryAsSchemaSql(config, host);
    case 'live_schema':
      return readLiveSchema(config, host);
    default: {
      const never: never = authority;
      throw new Error(`Invalid generate.authority: ${JSON.stringify(never)}`);
    }
  }
}

async function readDefinitionsAsSchemaSql(config: SqlfuProjectConfig, host: SqlfuHost): Promise<string> {
  let definitionsSql: string;
  try {
    definitionsSql = await host.fs.readFile(config.definitions);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `sqlfu generate with authority 'desired_schema' needs ${config.definitions}, but the file was not found.`,
      );
    }
    throw error;
  }
  return materializeDefinitionsSchemaFor(host, definitionsSql, {dialect: config.dialect});
}

async function replayMigrationFilesAsSchemaSql(config: SqlfuProjectConfig, host: SqlfuHost): Promise<string> {
  if (!config.migrations) {
    throw new Error(
      "sqlfu generate with authority 'migrations' needs a `migrations` directory configured in sqlfu.config.ts.",
    );
  }
  const migrations = await readMigrationFiles(host, config);
  // Concatenate into one SQL blob and replay raw. The materializeSchemaSql
  // dialect method handles scratch-DB creation + schema extraction; no
  // `applyMigrations` round-trip means no bookkeeping table noise.
  return materializeDefinitionsSchemaFor(host, migrations.map((migration) => migration.content).join('\n'), {
    dialect: config.dialect,
  });
}

async function replayMigrationHistoryAsSchemaSql(config: SqlfuProjectConfig, host: SqlfuHost): Promise<string> {
  if (!config.migrations) {
    throw new Error(
      "sqlfu generate with authority 'migration_history' needs a `migrations` directory configured in sqlfu.config.ts.",
    );
  }
  await using live = await openLiveDb(config.db, 'migration_history');
  const history = await Promise.resolve(
    readMigrationHistory(live.client, {preset: config.migrations.preset, dialect: config.dialect}),
  );

  const migrations = await readMigrationFiles(host, config);
  const byName = new Map(migrations.map((migration) => [migrationName(migration), migration]));
  const matched: Migration[] = [];
  for (const row of history) {
    const file = byName.get(row.name);
    if (!file) {
      throw new Error(
        `sqlfu generate with authority 'migration_history': recorded migration "${row.name}" is missing from ${config.migrations.path}. ` +
          `Restore it from version control, or switch \`generate.authority\` to 'desired_schema' / 'migrations'.`,
      );
    }
    matched.push(file);
  }

  return materializeDefinitionsSchemaFor(host, matched.map((migration) => migration.content).join('\n'), {
    dialect: config.dialect,
  });
}

async function readLiveSchema(config: SqlfuProjectConfig, host: SqlfuHost): Promise<string> {
  await using source = await openLiveDb(config.db, 'live_schema');
  // Exclude the preset's bookkeeping table from the live schema — it's noise, not something
  // the user wrote. The other authorities replay raw SQL into an empty scratch DB so no
  // bookkeeping is created in the first place. Without a `migrations` block there's no
  // bookkeeping in play; default to sqlfu's table name so we still strip it if present.
  const excludedTable = presetTableName(config.migrations ? config.migrations.preset : 'sqlfu');
  const liveSchema = await config.dialect.extractSchemaFromClient(source.client, {excludedTables: [excludedTable]});
  if (liveSchema.trim()) return liveSchema;

  const expectedSources = await findExpectedLiveSchemaSources(config, host);
  if (!expectedSources.schemaDefinitions && !expectedSources.migrationFiles) return liveSchema;

  throw new Error(formatEmptyLiveSchemaGenerateError(expectedSources));
}

type ExpectedLiveSchemaSources = {
  schemaDefinitions: boolean;
  migrationFiles: boolean;
};

async function findExpectedLiveSchemaSources(
  config: SqlfuProjectConfig,
  host: SqlfuHost,
): Promise<ExpectedLiveSchemaSources> {
  const definitionsSql = await readDefinitionsFileIfPresent(config, host);
  const migrations = await readMigrationFiles(host, config);
  return {
    schemaDefinitions: definitionsSql.trim().length > 0,
    migrationFiles: migrations.length > 0,
  };
}

async function readDefinitionsFileIfPresent(config: SqlfuProjectConfig, host: SqlfuHost): Promise<string> {
  try {
    return await host.fs.readFile(config.definitions);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

function formatEmptyLiveSchemaGenerateError(expectedSources: ExpectedLiveSchemaSources): string {
  const sourceLabels: string[] = [];
  if (expectedSources.schemaDefinitions) sourceLabels.push('schema definitions');
  if (expectedSources.migrationFiles) sourceLabels.push('pending migrations');
  const sourceLabel = sourceLabels.length === 1 ? sourceLabels[0]! : `${sourceLabels[0]} and ${sourceLabels[1]}`;

  const nextStep = expectedSources.migrationFiles
    ? 'Run sqlfu migrate first, then run sqlfu generate again.'
    : 'Run sqlfu sync first, or otherwise apply your schema to the live database, then run sqlfu generate again.';
  const fallbackAuthorities: string[] = [];
  if (expectedSources.schemaDefinitions) fallbackAuthorities.push("'desired_schema'");
  if (expectedSources.migrationFiles) fallbackAuthorities.push("'migrations'");
  const fallbackAuthorityLabel =
    fallbackAuthorities.length === 1
      ? fallbackAuthorities[0]!
      : `${fallbackAuthorities[0]} or ${fallbackAuthorities[1]}`;
  return [
    'sqlfu generate cannot read your schema from an empty live database.',
    `Your project has ${sourceLabel}, but the configured database has no user tables or views.`,
    nextStep,
    `If this database is intentionally empty, switch \`generate.authority\` to ${fallbackAuthorityLabel}.`,
  ].join('\n');
}

async function openLiveDb(
  db: SqlfuProjectConfig['db'],
  authority: 'migration_history' | 'live_schema',
): Promise<DisposableClient> {
  if (db == null) {
    throw new Error(
      `sqlfu generate with authority '${authority}' needs a live database, but \`db\` is not set in sqlfu.config.ts.`,
    );
  }
  if (typeof db === 'function') {
    return db();
  }
  return openMainDevDatabase(db);
}

async function openMainDevDatabase(dbPath: string): Promise<DisposableClient> {
  if (dbPath !== ':memory:') {
    await fs.mkdir(path.dirname(dbPath), {recursive: true});
  }
  const runtime = 'Bun' in globalThis ? 'bun' : 'node';

  if (runtime === 'bun') {
    const {Database} = await import('bun:sqlite' as any);
    const database = new Database(dbPath);
    return {
      client: createBunClient(database as Parameters<typeof createBunClient>[0]),
      async [Symbol.asyncDispose]() {
        database.close();
      },
    };
  }

  const {DatabaseSync} = await import('node:sqlite');
  const database = new DatabaseSync(dbPath);
  return {
    client: createNodeSqliteClient(database as Parameters<typeof createNodeSqliteClient>[0]),
    async [Symbol.asyncDispose]() {
      database.close();
    },
  };
}

async function loadQueryDocuments(queriesDir: string): Promise<QueryDocument[]> {
  const files: QueryDocument[] = [];

  async function walk(currentDir: string, relativePrefix: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(currentDir, {withFileTypes: true});
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
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
        const sqlContent = await fs.readFile(childPath, 'utf8');
        const relativePath = childRelative.slice(0, -'.sql'.length);
        files.push({
          sqlPath: childPath,
          relativePath,
          sqlContent,
          queries: splitQueryDocument({
            sqlPath: childPath,
            relativePath,
            sqlContent,
          }),
        });
      }
    }
  }

  await walk(queriesDir, '');
  return files;
}

function splitQueryDocument(queryFile: QueryFile): QuerySource[] {
  const annotations = parseQueryAnnotations(queryFile.sqlContent);
  if (annotations.length === 0) {
    const parameterExpansions = parseInlineParameterExpansions(queryFile.sqlContent);
    return [
      {
        sqlPath: queryFile.sqlPath,
        sourceSqlPath: queryFile.sqlPath,
        id: queryFile.relativePath,
        functionName: queryIdentityFromPath(queryFile.relativePath),
        sqlContent: queryFile.sqlContent,
        sqlFileContent: queryFile.sqlContent,
        analysisSqlContent: prepareSqlForAnalysis(queryFile.sqlContent, parameterExpansions),
        parameterExpansions,
      },
    ];
  }

  const leadingContent = queryFile.sqlContent.slice(0, annotations[0]!.commentStart);
  if (hasExecutableSql(leadingContent)) {
    throw new Error(`${queryFile.sqlPath} has SQL before its first @name annotation`);
  }

  return annotations.map((annotation, index) => {
    const nextAnnotation = annotations[index + 1];
    const sqlContent = queryFile.sqlContent
      .slice(annotation.commentEnd, nextAnnotation ? nextAnnotation.commentStart : queryFile.sqlContent.length)
      .trim();
    if (!sqlContent) {
      throw new Error(`${queryFile.sqlPath} @name ${annotation.rawName} is not followed by a SQL statement`);
    }

    const parameterExpansions = parseInlineParameterExpansions(sqlContent);
    return {
      sqlPath: `${queryFile.sqlPath}#${annotation.functionName}`,
      sourceSqlPath: queryFile.sqlPath,
      id: `${queryFile.relativePath}#${annotation.functionName}`,
      functionName: annotation.functionName,
      sqlContent,
      sqlFileContent: queryFile.sqlContent,
      analysisSqlContent: prepareSqlForAnalysis(sqlContent, parameterExpansions),
      parameterExpansions,
    };
  });
}

type QueryAnnotation = {
  commentStart: number;
  commentEnd: number;
  rawName: string;
  functionName: string;
};

function parseQueryAnnotations(sqlContent: string): QueryAnnotation[] {
  const annotations: QueryAnnotation[] = [];
  for (const blockComment of findSqlIgnoredRanges(sqlContent).filter((range) => range.kind === 'block-comment')) {
    const comment = sqlContent.slice(blockComment.start, blockComment.end);
    if (!comment.includes('@name')) continue;

    const body = comment.replace(/^\/\*+/, '').replace(/\*+\/$/, '');
    const nameMatch = body.match(/@name\s+([A-Za-z_$][A-Za-z0-9_$-]*)/);
    if (!nameMatch) {
      throw new Error('Query annotation is missing a valid @name tag');
    }
    if (/@param\b/.test(body)) {
      throw new Error('Query annotations only support @name; use IN params such as (:ids) for scalar lists');
    }

    const rawName = nameMatch[1]!;
    const functionName = functionNameFromAnnotation(rawName);
    annotations.push({
      commentStart: blockComment.start,
      commentEnd: blockComment.end,
      rawName,
      functionName,
    });
  }
  return annotations;
}

function functionNameFromAnnotation(rawName: string): string {
  const candidate = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(rawName) ? rawName : queryIdentityFromPath(rawName);
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(candidate)) {
    throw new Error(`Query annotation @name ${rawName} does not produce a valid TypeScript identifier`);
  }
  return candidate;
}

function hasExecutableSql(sql: string): boolean {
  return stripSqlComments(sql).trim().length > 0;
}

function assertUniqueQueryFunctionNames(querySources: QuerySource[]): void {
  const seen = new Map<string, QuerySource>();
  for (const querySource of querySources) {
    const existing = seen.get(querySource.functionName);
    if (!existing) {
      seen.set(querySource.functionName, querySource);
      continue;
    }
    throw new Error(
      `Duplicate generated query name ${querySource.functionName} in ${existing.sourceSqlPath} and ${querySource.sourceSqlPath}`,
    );
  }
}

async function writeGeneratedQueriesFile(
  config: SqlfuProjectConfig,
  generatedDir: string,
  queryFiles: QueryFile[],
  importExtension: '.js' | '.ts',
): Promise<string> {
  const filePath = path.join(generatedDir, 'queries.ts');
  await fs.writeFile(
    filePath,
    renderQuerySourceManifest({
      entries: queryFiles.map((queryFile) => querySourceManifestEntry(queryFile)),
      importExtension,
    }),
  );
  return projectRelativePath(config, filePath);
}

async function writeGeneratedBarrel(
  config: SqlfuProjectConfig,
  generatedDir: string,
  importExtension: '.js' | '.ts',
): Promise<string> {
  const lines = [`export * from "./tables${importExtension}";`, `export * from "./queries${importExtension}";`];
  const filePath = path.join(generatedDir, 'index.ts');
  await fs.writeFile(filePath, lines.join('\n') + '\n');
  return projectRelativePath(config, filePath);
}

/**
 * Emit a TS file with a row type for every table and view in the live schema.
 *
 * Naming convention: `<RelationName in PascalCase>Row`. `posts` → `PostsRow`,
 * `post_events` → `PostEventsRow`, `post_summaries` → `PostSummariesRow`.
 *
 * Nullable columns are typed `T | null` (not `T?`). Every column is always
 * present on a row; a null-valued column is distinct from an absent key,
 * which is how query-result types treat it. Row types are literally what
 * SQLite hands back for `select * from <table>`.
 */
async function writeTablesFile(
  config: SqlfuProjectConfig,
  generatedDir: string,
  schema: ReadonlyMap<string, RelationInfo>,
): Promise<string> {
  const relations = Array.from(schema.values()).sort((left, right) => left.name.localeCompare(right.name));

  const blocks = relations.map((relation) => {
    const typeName = `${relationTypeName(relation.name)}Row`;
    const fieldLines: string[] = [];
    for (const column of relation.columns.values()) {
      const suffix = column.notNull ? '' : ' | null';
      fieldLines.push(...renderTypePropertyLines('\t', column.name, false, `${column.tsType}${suffix}`));
    }
    return [`export type ${typeName} = {`, ...fieldLines, `};`].join('\n');
  });

  const header = [
    `// Generated by \`sqlfu generate\`. Do not edit.`,
    `// Row types for every table and view in your project's schema.`,
    ``,
  ];
  const body =
    blocks.length === 0 ? [`export {};`] : blocks.flatMap((block, index) => (index === 0 ? [block] : ['', block]));

  const filePath = path.join(generatedDir, 'tables.ts');
  await fs.writeFile(filePath, [...header, ...body, ``].join('\n'));
  return projectRelativePath(config, filePath);
}

function relationTypeName(relationName: string): string {
  return relationName
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
}

async function writeMigrationsBundle(config: SqlfuProjectConfig): Promise<string> {
  if (!config.migrations) throw new Error('writeMigrationsBundle requires migrations config');
  const migrationsDir = config.migrations.path;

  let fileNames: string[];
  try {
    fileNames = (await fs.readdir(migrationsDir))
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      fileNames = [];
    } else {
      throw error;
    }
  }

  const entries: {key: string; content: string}[] = [];
  for (const fileName of fileNames) {
    const filePath = path.join(migrationsDir, fileName);
    const content = await fs.readFile(filePath, 'utf8');
    const key = path.relative(config.projectRoot, filePath).split(path.sep).join('/');
    entries.push({key, content});
  }

  const bundleDir = path.join(migrationsDir, '.generated');
  await fs.mkdir(bundleDir, {recursive: true});
  const bundleLines = [
    `// Generated by \`sqlfu generate\`. Do not edit.`,
    `// A bundle of every migration in ${path.relative(config.projectRoot, migrationsDir).split(path.sep).join('/')}/,`,
    `// importable from runtimes without filesystem access (durable objects, edge workers, browsers).`,
    `// Use \`migrate(client)\` for the common path, or \`migrations\` for lower-level control.`,
    ``,
    `import {applyMigrations, migrationsFromBundle, type AsyncClient, type Client, type SyncClient} from 'sqlfu';`,
    ``,
    `export const migrations = {`,
    ...entries.map((entry) => `  ${JSON.stringify(entry.key)}: ${JSON.stringify(entry.content)},`),
    `};`,
    ``,
    `export function migrate(client: SyncClient): void;`,
    `export function migrate(client: AsyncClient): Promise<void>;`,
    `export function migrate(client: Client): void | Promise<void> {`,
    `  return applyMigrations(client, {`,
    `    migrations: migrationsFromBundle(migrations),`,
    `    preset: ${JSON.stringify(config.migrations.preset)},`,
    `  });`,
    `}`,
    ``,
    `export type MigrationBundle = typeof migrations;`,
    ``,
  ];
  const filePath = path.join(bundleDir, 'migrations.ts');
  await fs.writeFile(filePath, bundleLines.join('\n'));
  return projectRelativePath(config, filePath);
}

async function writeQueryCatalog(
  config: SqlfuProjectConfig,
  querySources: QuerySource[],
  queryAnalyses: Awaited<ReturnType<typeof analyzeVendoredTypesqlQueries>>,
  schema: ReadonlyMap<string, RelationInfo>,
): Promise<string> {
  // DDL statements (e.g. `create table if not exists`) get trivial wrappers but have no
  // params / result columns / json schema — nothing to populate a form with. Leaving them out
  // of the catalog keeps UI consumers from rendering a meaningless "run" button for each one.
  const entries: QueryCatalogEntry[] = querySources.flatMap<QueryCatalogEntry>((querySource) => {
    const analysis = queryAnalyses.find((query) => query.sqlPath === querySource.sqlPath);
    if (!analysis) {
      throw new Error(`Missing vendored TypeSQL analysis for ${querySource.sqlPath}`);
    }

    const functionName = querySource.functionName;
    const id = querySource.id;
    const sqlFile = path.relative(config.projectRoot, querySource.sourceSqlPath).split(path.sep).join('/');

    if (!analysis.ok) {
      const errorEntry: QueryCatalogEntry = {
        kind: 'error',
        id,
        sqlFile,
        functionName,
        sql: querySource.sqlContent,
        sqlFileContent: querySource.sqlFileContent,
        error: analysis.error,
      };
      return [errorEntry];
    }

    if (analysis.descriptor.queryType === 'Ddl') {
      return [];
    }

    const prepared = prepareQueryDescriptor({
      descriptor: refineDescriptor(analysis.descriptor, querySource.analysisSqlContent, schema),
      explicitParameterExpansions: querySource.parameterExpansions,
      sourceSql: querySource.sqlContent,
    });
    const {descriptor, dataMapping} = applyGeneratedInputCasing(prepared.descriptor, config.generate.casing);
    const resultMapping = mapColumnDerivedFields(getResultFields(descriptor), config.generate.casing);
    const columns = resultMapping.mappings.map((mapping) => toCatalogField(mapping.public, mapping.raw.name));
    const args = [
      ...(dataMapping?.mappings.map((mapping) => toCatalogArgument('data', mapping.public, mapping.raw.name)) ?? []),
      ...descriptor.parameters.map((field) => toCatalogArgument('params', field)),
    ];

    const queryEntry: QueryCatalogEntry = {
      kind: 'query',
      id,
      sqlFile,
      functionName,
      sql: descriptor.sql,
      sqlFileContent: querySource.sqlFileContent,
      queryType: descriptor.queryType as Exclude<GeneratedQueryDescriptor['queryType'], 'Ddl'>,
      multipleRowsResult: descriptor.multipleRowsResult,
      resultMode: getResultMode(descriptor),
      args,
      dataSchema: descriptor.data?.length ? objectSchema(`${functionName} data`, descriptor.data) : undefined,
      paramsSchema: descriptor.parameters.length
        ? objectSchema(`${functionName} params`, descriptor.parameters)
        : undefined,
      resultSchema: objectSchema(`${functionName} result`, resultMapping.publicFields, {fieldKind: 'result'}),
      columns,
    };
    return [queryEntry];
  });

  const catalog: QueryCatalog = {
    generatedAt: new Date().toISOString(),
    queries: entries,
  };

  const outputPath = path.join(config.projectRoot, '.sqlfu', 'query-catalog.json');
  await fs.mkdir(path.dirname(outputPath), {recursive: true});
  await fs.writeFile(outputPath, JSON.stringify(catalog, null, 2) + '\n');
  return projectRelativePath(config, outputPath);
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
  functionName: string;
  sourceSql: string;
  descriptor: GeneratedQueryDescriptor;
  parameterExpansions: ParameterExpansion[];
  validator: SqlfuValidator | null;
  prettyErrors: boolean;
  sync: boolean;
  casing: SqlfuGenerateCasing;
  runtime: SqlfuGenerateRuntime;
  localNames?: LocalNames;
}): string {
  if (isEffectSqlRuntime(input.runtime)) {
    if (input.validator !== null) {
      throw new Error(`generate.runtime: '${input.runtime}' cannot be combined with generate.validator yet.`);
    }
    return renderEffectSqlQueryWrapper({
      functionName: input.functionName,
      sourceSql: input.sourceSql,
      descriptor: input.descriptor,
      parameterExpansions: input.parameterExpansions,
      casing: input.casing,
      runtime: input.runtime,
      localNames: input.localNames,
    });
  }

  if (isNativeSqliteRuntime(input.runtime)) {
    if (input.validator !== null) {
      throw new Error(`generate.runtime: '${input.runtime}' cannot be combined with generate.validator yet.`);
    }
    return renderNativeSqliteQueryWrapper({
      functionName: input.functionName,
      sourceSql: input.sourceSql,
      descriptor: input.descriptor,
      parameterExpansions: input.parameterExpansions,
      casing: input.casing,
      runtime: input.runtime,
      localNames: input.localNames,
    });
  }

  if (input.validator !== null) {
    return renderValidatorQueryWrapper({
      functionName: input.functionName,
      sourceSql: input.sourceSql,
      descriptor: input.descriptor,
      parameterExpansions: input.parameterExpansions,
      emitter: getValidatorEmitter(input.validator),
      prettyErrors: input.prettyErrors,
      sync: input.sync,
      casing: input.casing,
      localNames: input.localNames,
    });
  }

  const functionName = input.functionName;
  const sqlName = input.localNames?.sql || 'sql';
  const queryName = input.localNames?.query || 'query';

  const clientType = input.sync ? 'SyncClient' : 'Client';
  const maybeAsync = input.sync ? '' : 'async ';
  const {descriptor} = applyGeneratedInputCasing(input.descriptor, input.casing);
  const hasData = (descriptor.data?.length ?? 0) > 0;
  const hasParams = descriptor.parameters.length > 0;
  const resultMode = getResultMode(descriptor);
  // SELECT-like results (a row type users hand-wrote in their select list) get a named
  // Result type + reified shape. Non-SELECT without RETURNING (metadata mode) just passes
  // client.run's return through — the caller sees QueryMetadata directly. No Result type,
  // no guards, no reshape.
  const emitResultType = resultMode !== 'metadata';
  const dataTypeRef = `${functionName}.Data`;
  const paramsTypeRef = `${functionName}.Params`;
  const resultTypeRef = `${functionName}.Result`;
  const resultMapping = mapColumnDerivedFields(getResultFields(descriptor), input.casing);
  const resultFields = resultMapping.publicFields;
  const resultMapperName =
    resultMapping.hasNameChanges || hasJsonFields(resultFields) ? input.localNames?.resultMapper || 'mapResult' : null;
  const resultRawFields = resultMapperName ? resultMapping.mappings.map((mapping) => rawResultField(mapping.raw)) : [];
  const decodeJsonResults = hasJsonFields(resultFields) && !resultMapperName;

  const queryArgs = buildQueryArgs(descriptor);

  const functionSignatureArgs: string[] = [`client: ${clientType}`];
  if (hasData) functionSignatureArgs.push(`data: ${dataTypeRef}`);
  if (hasParams) functionSignatureArgs.push(`params: ${paramsTypeRef}`);

  const factoryArgs: string[] = [];
  if (hasData) factoryArgs.push(`data: ${dataTypeRef}`);
  if (hasParams) factoryArgs.push(`params: ${paramsTypeRef}`);
  const queryReference = buildQueryReference(hasData, hasParams, 'data', 'params', queryName);
  const queryDeclaration = !hasRuntimeParameterExpansions(input.parameterExpansions)
    ? renderQueryDeclaration({
        factoryArgs,
        queryArgs,
        queryName: functionName,
        sqlName,
        queryVariableName: queryName,
      })
    : renderExpandedQueryDeclaration({
        sourceSql: input.sourceSql,
        descriptor,
        parameterExpansions: input.parameterExpansions,
        factoryArgs,
        queryArgs,
        queryName: functionName,
        sqlName,
        queryVariableName: queryName,
      });

  const signatureReturnAnnotation = emitResultType
    ? input.sync
      ? `: ${getReturnType(input.descriptor, resultTypeRef)}`
      : `: Promise<${getReturnType(input.descriptor, resultTypeRef)}>`
    : '';
  const functionDeclaration = `\t${maybeAsync}function ${functionName}(${functionSignatureArgs.join(', ')})${signatureReturnAnnotation} {`;

  const namespaceLines: string[] = [];
  if (hasData) {
    namespaceLines.push(`\texport type Data = ${renderObjectTypeBody(descriptor.data!, 'parameter')};`);
  }
  if (hasParams) {
    namespaceLines.push(`\texport type Params = ${renderObjectTypeBody(descriptor.parameters, 'parameter')};`);
  }
  if (emitResultType) {
    if (resultMapperName) {
      namespaceLines.push(`\texport type RawResult = ${renderObjectTypeBody(resultRawFields, 'result')};`);
    }
    namespaceLines.push(`\texport type Result = ${renderObjectTypeBody(resultFields, 'result')};`);
  }

  const resultMapperLines =
    emitResultType && resultMapperName
      ? ['', ...renderResultMapper(resultMapperName, functionName, resultMapping.mappings, resultTypeRef)]
      : [];

  const implementationLines = emitResultType
    ? buildGeneratedImplementation({
        resultMode,
        resultType: resultTypeRef,
        rawResultType: resultMapperName ? `${functionName}.RawResult` : undefined,
        resultFields,
        decodeJsonResults,
        resultMapperName,
        queryReference,
        sync: input.sync,
        indent: '\t\t',
      })
    : [`\t\treturn client.run(${queryReference});`];

  return [
    `import type {${clientType}} from 'sqlfu';`,
    ``,
    ...renderSqlConstant(input.descriptor.sql, sqlName),
    queryDeclaration,
    ...resultMapperLines,
    ``,
    `export const ${functionName} = Object.assign(`,
    functionDeclaration,
    ...implementationLines,
    `\t},`,
    `\t{ ${[
      objectProperty('sql', sqlName),
      objectProperty('query', queryName),
      ...(resultMapperName ? [objectProperty('mapResult', resultMapperName)] : []),
    ].join(', ')} },`,
    `);`,
    ``,
    ...(namespaceLines.length === 0 ? [] : [`export namespace ${functionName} {`, ...namespaceLines, `}`, ``]),
  ].join('\n');
}

function renderEffectSqlQueryWrapper(input: {
  functionName: string;
  sourceSql: string;
  descriptor: GeneratedQueryDescriptor;
  parameterExpansions: ParameterExpansion[];
  casing: SqlfuGenerateCasing;
  runtime: 'effect-v3' | 'effect-v4-unstable';
  localNames?: LocalNames;
}): string {
  const functionName = input.functionName;
  const sqlName = input.localNames?.sql || 'sql';
  const queryName = input.localNames?.query || 'query';
  const {descriptor} = applyGeneratedInputCasing(input.descriptor, input.casing);
  const hasData = (descriptor.data?.length ?? 0) > 0;
  const hasParams = descriptor.parameters.length > 0;
  const resultMode = getResultMode(descriptor);
  const emitResultType = resultMode !== 'metadata';
  const dataTypeRef = `${functionName}.Data`;
  const paramsTypeRef = `${functionName}.Params`;
  const resultTypeRef = `${functionName}.Result`;
  const resultMapping = mapColumnDerivedFields(getResultFields(descriptor), input.casing);
  const resultFields = resultMapping.publicFields;
  const resultMapperName =
    resultMapping.hasNameChanges || hasJsonFields(resultFields) ? input.localNames?.resultMapper || 'mapResult' : null;
  const resultRawFields = resultMapperName ? resultMapping.mappings.map((mapping) => rawResultField(mapping.raw)) : [];
  const decodeJsonResults = hasJsonFields(resultFields) && !resultMapperName;

  const queryArgs = buildQueryArgs(descriptor);

  const functionSignatureArgs: string[] = [];
  if (hasData) functionSignatureArgs.push(`data: ${dataTypeRef}`);
  if (hasParams) functionSignatureArgs.push(`params: ${paramsTypeRef}`);

  const factoryArgs: string[] = [];
  if (hasData) factoryArgs.push(`data: ${dataTypeRef}`);
  if (hasParams) factoryArgs.push(`params: ${paramsTypeRef}`);
  const queryReference = buildQueryReference(hasData, hasParams, 'data', 'params', queryName);
  const queryDeclaration = !hasRuntimeParameterExpansions(input.parameterExpansions)
    ? renderQueryDeclaration({
        factoryArgs,
        queryArgs,
        queryName: functionName,
        sqlName,
        queryVariableName: queryName,
      })
    : renderExpandedQueryDeclaration({
        sourceSql: input.sourceSql,
        descriptor,
        parameterExpansions: input.parameterExpansions,
        factoryArgs,
        queryArgs,
        queryName: functionName,
        sqlName,
        queryVariableName: queryName,
      });

  const namespaceLines: string[] = [];
  if (hasData) {
    namespaceLines.push(`\texport type Data = ${renderObjectTypeBody(descriptor.data!, 'parameter')};`);
  }
  if (hasParams) {
    namespaceLines.push(`\texport type Params = ${renderObjectTypeBody(descriptor.parameters, 'parameter')};`);
  }
  if (emitResultType) {
    if (resultMapperName) {
      namespaceLines.push(`\texport type RawResult = ${renderObjectTypeBody(resultRawFields, 'result')};`);
    }
    namespaceLines.push(`\texport type Result = ${renderObjectTypeBody(resultFields, 'result')};`);
  }

  const resultMapperLines =
    emitResultType && resultMapperName
      ? ['', ...renderResultMapper(resultMapperName, functionName, resultMapping.mappings, resultTypeRef)]
      : [];

  return [
    `import * as Effect from 'effect/Effect';`,
    `import {SqlClient} from '${effectSqlImportSpecifier(input.runtime)}';`,
    ``,
    ...renderSqlConstant(input.descriptor.sql, sqlName),
    queryDeclaration,
    ...resultMapperLines,
    ``,
    `export const ${functionName} = Object.assign(`,
    `\tfunction ${functionName}(${functionSignatureArgs.join(', ')}) {`,
    ...buildEffectSqlImplementation({
      resultMode,
      resultType: resultTypeRef,
      rawResultType: resultMapperName ? `${functionName}.RawResult` : undefined,
      resultFields,
      decodeJsonResults,
      resultMapperName,
      queryReference,
      indent: '\t\t',
    }),
    `\t},`,
    `\t{ ${[
      objectProperty('sql', sqlName),
      objectProperty('query', queryName),
      ...(resultMapperName ? [objectProperty('mapResult', resultMapperName)] : []),
    ].join(', ')} },`,
    `);`,
    ``,
    ...(namespaceLines.length === 0 ? [] : [`export namespace ${functionName} {`, ...namespaceLines, `}`, ``]),
  ].join('\n');
}

function renderNativeSqliteQueryWrapper(input: {
  functionName: string;
  sourceSql: string;
  descriptor: GeneratedQueryDescriptor;
  parameterExpansions: ParameterExpansion[];
  casing: SqlfuGenerateCasing;
  runtime: NativeSqliteRuntime;
  localNames?: LocalNames;
}): string {
  const functionName = input.functionName;
  const sqlName = input.localNames?.sql || 'sql';
  const queryName = input.localNames?.query || 'query';
  const driverVariable = nativeSqliteDriverVariable(input.runtime);
  const {descriptor} = applyGeneratedInputCasing(input.descriptor, input.casing);
  const hasData = (descriptor.data?.length ?? 0) > 0;
  const hasParams = descriptor.parameters.length > 0;
  const resultMode = getResultMode(descriptor);
  const emitResultType = resultMode !== 'metadata';
  const dataTypeRef = `${functionName}.Data`;
  const paramsTypeRef = `${functionName}.Params`;
  const resultTypeRef = `${functionName}.Result`;
  const resultMapping = mapColumnDerivedFields(getResultFields(descriptor), input.casing);
  const resultFields = resultMapping.publicFields;
  const resultMapperName =
    resultMapping.hasNameChanges || hasJsonFields(resultFields) ? input.localNames?.resultMapper || 'mapResult' : null;
  const resultRawFields = resultMapperName ? resultMapping.mappings.map((mapping) => rawResultField(mapping.raw)) : [];
  const decodeJsonResults = hasJsonFields(resultFields) && !resultMapperName;

  const queryArgs = buildQueryArgs(descriptor);

  const functionSignatureArgs: string[] = [`${driverVariable}: ${nativeSqliteDriverType(input.runtime)}`];
  if (hasData) functionSignatureArgs.push(`data: ${dataTypeRef}`);
  if (hasParams) functionSignatureArgs.push(`params: ${paramsTypeRef}`);

  const factoryArgs: string[] = [];
  if (hasData) factoryArgs.push(`data: ${dataTypeRef}`);
  if (hasParams) factoryArgs.push(`params: ${paramsTypeRef}`);
  const queryReference = buildQueryReference(hasData, hasParams, 'data', 'params', queryName);
  const queryDeclaration = !hasRuntimeParameterExpansions(input.parameterExpansions)
    ? renderQueryDeclaration({
        factoryArgs,
        queryArgs,
        queryName: functionName,
        sqlName,
        queryVariableName: queryName,
      })
    : renderExpandedQueryDeclaration({
        sourceSql: input.sourceSql,
        descriptor,
        parameterExpansions: input.parameterExpansions,
        factoryArgs,
        queryArgs,
        queryName: functionName,
        sqlName,
        queryVariableName: queryName,
      });

  const namespaceLines: string[] = [];
  if (hasData) {
    namespaceLines.push(`\texport type Data = ${renderObjectTypeBody(descriptor.data!, 'parameter')};`);
  }
  if (hasParams) {
    namespaceLines.push(`\texport type Params = ${renderObjectTypeBody(descriptor.parameters, 'parameter')};`);
  }
  if (emitResultType) {
    if (resultMapperName) {
      namespaceLines.push(`\texport type RawResult = ${renderObjectTypeBody(resultRawFields, 'result')};`);
    }
    namespaceLines.push(`\texport type Result = ${renderObjectTypeBody(resultFields, 'result')};`);
  }

  const resultMapperLines =
    emitResultType && resultMapperName
      ? ['', ...renderResultMapper(resultMapperName, functionName, resultMapping.mappings, resultTypeRef)]
      : [];
  const isAsync = isAsyncNativeSqliteRuntime(input.runtime);
  const signatureReturnAnnotation = emitResultType
    ? isAsync
      ? `: Promise<${getReturnType(input.descriptor, resultTypeRef)}>`
      : `: ${getReturnType(input.descriptor, resultTypeRef)}`
    : '';
  const maybeAsync = isAsync ? 'async ' : '';

  const implementationLines = emitResultType
    ? buildNativeSqliteSelectImplementation({
        runtime: input.runtime,
        driverVariable,
        resultMode,
        resultType: resultTypeRef,
        rawResultType: resultMapperName ? `${functionName}.RawResult` : undefined,
        resultFields,
        decodeJsonResults,
        resultMapperName,
        queryReference,
        indent: '\t\t',
      })
    : buildNativeSqliteMetadataImplementation({
        runtime: input.runtime,
        driverVariable,
        resultFields,
        queryReference,
        indent: '\t\t',
      });

  return [
    nativeSqliteImportLine(input.runtime),
    ``,
    ...renderSqlConstant(input.descriptor.sql, sqlName),
    queryDeclaration,
    ...resultMapperLines,
    ``,
    `export const ${functionName} = Object.assign(`,
    `\t${maybeAsync}function ${functionName}(${functionSignatureArgs.join(', ')})${signatureReturnAnnotation} {`,
    ...implementationLines,
    `\t},`,
    `\t{ ${[
      objectProperty('sql', sqlName),
      objectProperty('query', queryName),
      ...(resultMapperName ? [objectProperty('mapResult', resultMapperName)] : []),
    ].join(', ')} },`,
    `);`,
    ``,
    ...(namespaceLines.length === 0 ? [] : [`export namespace ${functionName} {`, ...namespaceLines, `}`, ``]),
  ].join('\n');
}

/**
 * Top-level `query` declaration that lives alongside `sql`. When the query takes no
 * params/data, it's a plain `SqlQuery` object; otherwise it's an arrow factory whose
 * parameters mirror the wrapper's. The body uses `query` (object) or `query(...)` (factory).
 */
function renderQueryDeclaration(input: {
  factoryArgs: string[];
  queryArgs: string;
  queryName: string;
  sqlName?: string;
  queryVariableName?: string;
}): string {
  const sqlName = input.sqlName || 'sql';
  const queryVariableName = input.queryVariableName || 'query';
  if (input.factoryArgs.length === 0) {
    return renderConstQueryObjectDeclaration({
      queryVariableName,
      queryName: input.queryName,
      sqlExpression: sqlName,
      argsExpression: input.queryArgs,
    });
  }
  return renderQueryFactoryDeclaration({
    factoryArgs: input.factoryArgs,
    queryVariableName,
    queryName: input.queryName,
    sqlExpression: sqlName,
    argsExpression: input.queryArgs,
  });
}

function renderExpandedQueryDeclaration(input: {
  sourceSql: string;
  descriptor: GeneratedQueryDescriptor;
  parameterExpansions: ParameterExpansion[];
  factoryArgs: string[];
  queryArgs: string;
  queryName: string;
  sqlName: string;
  queryVariableName: string;
}): string {
  const expansionVariables = expansionVariableExpressions(input.descriptor);
  const dynamicSqlExpression = renderRuntimeSqlExpression(
    input.sourceSql,
    input.parameterExpansions,
    expansionVariables,
  );
  const guardLines = renderExpansionGuards(input.parameterExpansions, expansionVariables, '\t');
  return [
    `const ${input.queryVariableName} = (${input.factoryArgs.join(', ')}) => {`,
    ...guardLines,
    `\tconst expandedSql = ${dynamicSqlExpression};`,
    renderReturnQueryObject({
      indent: '\t',
      queryName: input.queryName,
      sqlExpression: 'expandedSql',
      argsExpression: input.queryArgs,
    }),
    `};`,
  ].join('\n');
}

function renderConstQueryObjectDeclaration(input: {
  queryVariableName: string;
  queryName: string;
  sqlExpression: string;
  argsExpression: string;
}): string {
  const inline = `const ${input.queryVariableName} = ${renderInlineQueryObject(input)};`;
  if (inline.length <= 100) {
    return inline;
  }
  return [
    `const ${input.queryVariableName} = {`,
    ...renderQueryObjectProperties(input, '\t').map((line) => `${line},`),
    `};`,
  ].join('\n');
}

function renderQueryFactoryDeclaration(input: {
  factoryArgs: string[];
  queryVariableName: string;
  queryName: string;
  sqlExpression: string;
  argsExpression: string;
}): string {
  const inline = `const ${input.queryVariableName} = (${input.factoryArgs.join(', ')}) => (${renderInlineQueryObject(input)});`;
  if (inline.length <= 100) {
    return inline;
  }
  return [
    `const ${input.queryVariableName} = (${input.factoryArgs.join(', ')}) => ({`,
    ...renderQueryObjectProperties(input, '\t').map((line) => `${line},`),
    `});`,
  ].join('\n');
}

function renderReturnQueryObject(input: {
  indent: string;
  queryName: string;
  sqlExpression: string;
  argsExpression: string;
}): string {
  const inline = `${input.indent}return ${renderInlineQueryObject(input)};`;
  if (inline.length <= 100) {
    return inline;
  }
  return [
    `${input.indent}return {`,
    ...renderQueryObjectProperties(input, `${input.indent}\t`).map((line) => `${line},`),
    `${input.indent}};`,
  ].join('\n');
}

function renderInlineQueryObject(input: {queryName: string; sqlExpression: string; argsExpression: string}): string {
  return `{ ${renderQueryObjectProperties(input, '').join(', ')} }`;
}

function renderQueryObjectProperties(
  input: {queryName: string; sqlExpression: string; argsExpression: string},
  indent: string,
): string[] {
  return [
    `${indent}name: ${JSON.stringify(input.queryName)}`,
    `${indent}${objectProperty('sql', input.sqlExpression)}`,
    `${indent}args: ${input.argsExpression}`,
  ];
}

function hasRuntimeParameterExpansions(expansions: ParameterExpansion[]): boolean {
  return expansions.some((expansion) => expansion.kind === 'scalar-array' || expansion.kind === 'object-array');
}

function expansionVariableExpressions(descriptor: GeneratedQueryDescriptor): ReadonlyMap<string, string> {
  const expressions = new Map<string, string>();
  for (const field of descriptor.data ?? []) {
    expressions.set(field.name, `data.${field.name}`);
  }
  for (const field of descriptor.parameters) {
    expressions.set(field.name, `params.${field.name}`);
  }
  return expressions;
}

function renderExpansionGuards(
  expansions: ParameterExpansion[],
  expansionVariables: ReadonlyMap<string, string>,
  indent: string,
): string[] {
  const lines: string[] = [];
  for (const expansion of expansions) {
    if (expansion.kind !== 'scalar-array' && expansion.kind !== 'object-array') continue;
    const variableExpression = expansionVariables.get(expansion.name);
    if (!variableExpression) continue;
    const emptyArrayCondition =
      expansion.kind === 'object-array' && expansion.acceptsSingleOrArray
        ? `Array.isArray(${variableExpression}) && ${variableExpression}.length === 0`
        : `${variableExpression}.length === 0`;
    lines.push(`${indent}if (${emptyArrayCondition}) {`);
    lines.push(
      `${indent}\tthrow new Error(${JSON.stringify(`Parameter "${expansion.name}" must be a non-empty array`)});`,
    );
    lines.push(`${indent}}`);
  }
  return lines;
}

function renderRuntimeSqlExpression(
  sql: string,
  expansions: ParameterExpansion[],
  expansionVariables: ReadonlyMap<string, string>,
): string {
  const expansionMap = new Map(expansions.map((expansion) => [expansion.name, expansion]));
  const chunks: string[] = [];
  let cursor = 0;
  for (const reference of findNamedParameterReferences(sql)) {
    chunks.push(escapeTemplateLiteralChunk(replaceNamedParameters(sql.slice(cursor, reference.start), () => '?')));
    if (reference.path.length > 0) {
      chunks.push('?');
      cursor = reference.end;
      continue;
    }

    const expansion = expansionMap.get(reference.name);
    if (!expansion) {
      chunks.push('?');
    } else {
      const variableExpression = expansionVariables.get(expansion.name) || `params.${expansion.name}`;
      chunks.push(runtimeExpansionTemplateChunk(expansion, variableExpression, reference.wrappedInParens));
    }
    cursor = reference.end;
  }
  chunks.push(escapeTemplateLiteralChunk(replaceNamedParameters(sql.slice(cursor), () => '?')));
  return `\`${chunks.join('')}\``;
}

function runtimeExpansionTemplateChunk(
  expansion: ParameterExpansion,
  variableExpression: string,
  wrappedInParens: boolean,
): string {
  if (expansion.kind === 'scalar-array') {
    const placeholders = `${variableExpression}.map(() => '?').join(', ')`;
    return wrappedInParens ? '${' + placeholders + '}' : '(${' + placeholders + '})';
  }
  if (expansion.kind !== 'object-array') {
    return '?';
  }

  const arrayExpression = expansion.acceptsSingleOrArray
    ? `(Array.isArray(${variableExpression}) ? ${variableExpression} : [${variableExpression}])`
    : variableExpression;
  const rowPlaceholders = expansion.fields.map(() => '?').join(', ');
  if (expansion.sqlShape === 'row-list') {
    return '${' + `${arrayExpression}.map(() => ${JSON.stringify(`(${rowPlaceholders})`)}).join(', ')` + '}';
  }

  if (wrappedInParens) {
    return '${' + `${arrayExpression}.map(() => ${JSON.stringify(rowPlaceholders)}).join('), (')` + '}';
  }
  return '${' + `${arrayExpression}.map(() => ${JSON.stringify(`(${rowPlaceholders})`)}).join(', ')` + '}';
}

function escapeTemplateLiteralChunk(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
}

/** `query` for object form, `query(data, params)` / `query(params)` / `query(data)` for factories. */
function buildQueryReference(
  hasData: boolean,
  hasParams: boolean,
  dataVar: string,
  paramsVar: string,
  queryVariableName: string = 'query',
): string {
  if (!hasData && !hasParams) return queryVariableName;
  const callArgs: string[] = [];
  if (hasData) callArgs.push(dataVar);
  if (hasParams) callArgs.push(paramsVar);
  return `${queryVariableName}(${callArgs.join(', ')})`;
}

/**
 * Abstracts the validator-library-specific concerns of emission so the wrapper renderer
 * itself is library-agnostic. Each validator has its own module spec to import, field-line
 * rendering, object-schema construction, inference helper, and parse-call shape — but the
 * overall file layout (schemas as module-scoped consts, namespace merging, Object.assign)
 * is identical across all of them.
 *
 * The emission split between `'zod'` and `'standard'` flavours mirrors the real divide:
 * zod has a first-class `safeParse` + `z.prettifyError`, so it doesn't need anything from
 * sqlfu at runtime. Valibot, zod-mini, and arktype share the Standard Schema
 * `~standard.validate` entry point — the generated wrapper inlines the result-guard
 * (promise-check, issues-check) and, when pretty errors are on, calls sqlfu's re-export of
 * `prettifyStandardSchemaError` on the failure result. When pretty errors are off, nothing
 * is imported from sqlfu.
 */
type ValidatorEmitter = {
  importLine: string;
  /** `'zod'` uses safeParse/z.prettifyError; `'standard'` uses `~standard.validate` + sqlfu helper. */
  parseFlavour: 'zod' | 'standard';
  /**
   * Render a single `"  name: expression,"` line for a schema object. Controls both the
   * key (for validators like arktype that express optionality via `"name?"`) and the value
   * (each validator's native nullable/enum/array/etc. encoding).
   */
  renderFieldLine: (field: GeneratedField, fieldKind: 'parameter' | 'result') => string;
  /** Build the `const Foo = object({...})` declaration lines. */
  objectSchemaDeclaration: (input: {schemaName: string; fieldLines: string[]}) => string[];
  /** The call used in function signatures and return types to infer a TS type from a schema. */
  inferExpression: (schemaName: string) => string;
};

/** Default field-line rendering for the zod/valibot/zod-mini emitters — key is plain, value is wrapped. */
function valueWrappedFieldLine(
  expressionForField: (field: GeneratedField) => string,
  nullable: (expression: string) => string,
  optional: (expression: string) => string,
): (field: GeneratedField, fieldKind: 'parameter' | 'result') => string {
  return (field, fieldKind) => {
    let expression = expressionForField(field);
    if (!field.notNull) {
      expression = nullable(expression);
    }
    if (fieldKind === 'parameter' && Boolean(field.optional)) {
      expression = optional(expression);
    }
    return `\t${field.name}: ${expression},`;
  };
}

const zodEmitter: ValidatorEmitter = {
  importLine: `import {z} from 'zod';`,
  parseFlavour: 'zod',
  renderFieldLine: valueWrappedFieldLine(
    (field) => zodExpressionForField(field, 'z'),
    (expression) => `${expression}.nullable()`,
    (expression) => `${expression}.optional()`,
  ),
  objectSchemaDeclaration: ({schemaName, fieldLines}) => [`const ${schemaName} = z.object({`, ...fieldLines, `});`],
  inferExpression: (schemaName) => `z.infer<typeof ${schemaName}>`,
};

const zodMiniEmitter: ValidatorEmitter = {
  importLine: `import * as z from 'zod/mini';`,
  parseFlavour: 'standard',
  // zod-mini keeps the same nullable/optional wrapper calls as standard zod — the same schema
  // object, a smaller bundle path.
  renderFieldLine: valueWrappedFieldLine(
    (field) => zodExpressionForField(field, 'z'),
    (expression) => `z.nullable(${expression})`,
    (expression) => `z.optional(${expression})`,
  ),
  objectSchemaDeclaration: ({schemaName, fieldLines}) => [`const ${schemaName} = z.object({`, ...fieldLines, `});`],
  inferExpression: (schemaName) => `z.infer<typeof ${schemaName}>`,
};

const valibotEmitter: ValidatorEmitter = {
  importLine: `import * as v from 'valibot';`,
  parseFlavour: 'standard',
  renderFieldLine: valueWrappedFieldLine(
    (field) => valibotExpressionForField(field),
    (expression) => `v.nullable(${expression})`,
    (expression) => `v.optional(${expression})`,
  ),
  objectSchemaDeclaration: ({schemaName, fieldLines}) => [`const ${schemaName} = v.object({`, ...fieldLines, `});`],
  inferExpression: (schemaName) => `v.InferOutput<typeof ${schemaName}>`,
};

/**
 * Arktype's idiomatic shape is TS-syntax-as-schema: `type({slug: "string", title: "string | null"})`.
 * Optional fields are expressed by suffixing `"?"` on the *key*, not by wrapping the value. Primitive
 * types, arrays, and string-literal unions fit naturally in the string form. `Uint8Array` isn't a
 * reserved keyword, so we fall back to `type.instanceOf(Uint8Array)` (arktype accepts a Type value
 * as an object-literal field).
 */
const arktypeEmitter: ValidatorEmitter = {
  importLine: `import {type} from 'arktype';`,
  parseFlavour: 'standard',
  renderFieldLine: (field, fieldKind) => {
    const keySuffix = fieldKind === 'parameter' && Boolean(field.optional) ? '?' : '';
    const keyText = keySuffix ? JSON.stringify(`${field.name}${keySuffix}`) : field.name;
    return `\t${keyText}: ${arktypeFieldExpression(field, field.notNull)},`;
  },
  objectSchemaDeclaration: ({schemaName, fieldLines}) => [`const ${schemaName} = type({`, ...fieldLines, `});`],
  inferExpression: (schemaName) => `typeof ${schemaName}.infer`,
};

function getValidatorEmitter(validator: SqlfuValidator): ValidatorEmitter {
  if (validator === 'zod') return zodEmitter;
  if (validator === 'zod-mini') return zodMiniEmitter;
  if (validator === 'valibot') return valibotEmitter;
  return arktypeEmitter;
}

/**
 * Render the value side of an arktype object-literal field. Primitive keywords, arrays, and
 * string-literal unions stay in the arktype string grammar; `Uint8Array` escapes to the
 * `type.instanceOf(...)` helper (arktype accepts a Type value in an object literal alongside
 * string definitions).
 */
function arktypeFieldExpression(field: GeneratedField, notNull: boolean): string {
  const baseExpression = arktypeBaseExpressionForField(field);
  if (notNull) return baseExpression;

  // Nullable: for the string form we widen the union; for the escape-hatch form
  // (`type.instanceOf(...)`) we fall back to the Type-value form with a union.
  if (baseExpression.startsWith('"') && baseExpression.endsWith('"')) {
    const innerDefinition = baseExpression.slice(1, -1);
    return JSON.stringify(`${innerDefinition} | null`);
  }
  return `type(${baseExpression}, '|', 'null')`;
}

function arktypeBaseExpressionForField(field: GeneratedField): string {
  if (field.objectFields) {
    const fields = field.objectFields
      .map((objectField) => `${objectField.name}: ${arktypeFieldExpression(objectField, objectField.notNull)}`)
      .join(', ');
    const objectExpression = `type({ ${fields} })`;
    if (field.acceptsSingleOrArray) {
      return `type(${objectExpression}, '|', ${objectExpression}.array())`;
    }
    return field.isArray ? `${objectExpression}.array()` : objectExpression;
  }
  return arktypeBaseExpression(field.tsType);
}

function arktypeBaseExpression(tsType: string): string {
  if (tsType === 'string') return '"string"';
  if (tsType === 'number') return '"number"';
  if (tsType === 'boolean') return '"boolean"';
  if (tsType === 'Date') return '"Date"';
  if (tsType === 'Uint8Array' || tsType === 'ArrayBuffer') return 'type.instanceOf(Uint8Array)';
  if (tsType === 'any') return '"unknown"';
  if (tsType.endsWith('[]')) {
    const innerBase = arktypeBaseExpression(tsType.slice(0, -2));
    if (innerBase.startsWith('"') && innerBase.endsWith('"')) {
      const innerDefinition = innerBase.slice(1, -1);
      return JSON.stringify(`${innerDefinition}[]`);
    }
    // Escape-hatch: wrap the Type value in an array via the chainable helper.
    return `${innerBase}.array()`;
  }

  const enumValues = parseStringLiteralUnion(tsType);
  if (enumValues) {
    return JSON.stringify(enumValues.map((value) => JSON.stringify(value)).join(' | '));
  }

  return '"unknown"';
}

function renderValidatorQueryWrapper(input: {
  functionName: string;
  sourceSql: string;
  descriptor: GeneratedQueryDescriptor;
  parameterExpansions: ParameterExpansion[];
  emitter: ValidatorEmitter;
  prettyErrors: boolean;
  sync: boolean;
  casing: SqlfuGenerateCasing;
  localNames?: LocalNames;
}): string {
  const functionName = input.functionName;
  const sqlName = input.localNames?.sql || 'sql';
  const queryName = input.localNames?.query || 'query';
  const dataSchemaName = input.localNames?.dataSchema || 'Data';
  const paramsSchemaName = input.localNames?.paramsSchema || 'Params';
  const resultSchemaName = input.localNames?.resultSchema || 'Result';
  const {emitter, prettyErrors, sync} = input;
  const {descriptor} = applyGeneratedInputCasing(input.descriptor, input.casing);
  const clientType = sync ? 'SyncClient' : 'Client';
  const resultMode = getResultMode(descriptor);
  const resultMapping = mapColumnDerivedFields(getResultFields(descriptor), input.casing);
  const resultFields = resultMapping.publicFields;
  const resultMapperName =
    resultMapping.hasNameChanges || hasJsonFields(resultFields) ? input.localNames?.resultMapper || 'mapResult' : null;
  const resultRawFields = resultMapperName ? resultMapping.mappings.map((mapping) => rawResultField(mapping.raw)) : [];
  const decodeJsonResults = hasJsonFields(resultFields) && !resultMapperName;
  const hasData = (descriptor.data?.length ?? 0) > 0;
  const hasParams = descriptor.parameters.length > 0;
  // Same logic as plain-TS: only SELECT-like queries declare a Result schema and get their rows
  // run through `.parse()`. Non-SELECT without RETURNING (metadata mode) passes client.run's
  // return type through — no schema, no guards, no reshape, caller sees QueryMetadata directly.
  const emitResultSchema = resultMode !== 'metadata';

  // Local schemas declared as module-scoped consts, so the function signature
  // can reference the inferred type without a circular dependency on the
  // namespace-merged `${functionName}.Params` type. The namespace types below
  // point at the same schemas through the merged export.
  const schemaDeclarations: string[] = [];
  if (hasData) {
    schemaDeclarations.push(...renderObjectSchemaDeclaration(emitter, dataSchemaName, descriptor.data!, 'parameter'));
  }
  if (hasParams) {
    schemaDeclarations.push(
      ...renderObjectSchemaDeclaration(emitter, paramsSchemaName, descriptor.parameters, 'parameter'),
    );
  }
  if (emitResultSchema) {
    schemaDeclarations.push(...renderObjectSchemaDeclaration(emitter, resultSchemaName, resultFields, 'result'));
  }

  const sqlLines = renderSqlConstant(descriptor.sql, sqlName);

  const dataTypeRef = `${functionName}.Data`;
  const paramsTypeRef = `${functionName}.Params`;
  const resultTypeRef = `${functionName}.Result`;

  const functionSignatureArgs: string[] = [`client: ${clientType}`];
  if (hasData) functionSignatureArgs.push(`data: ${dataTypeRef}`);
  if (hasParams) functionSignatureArgs.push(`params: ${paramsTypeRef}`);

  const validationLines: string[] = [];
  let dataExpression: string | null = null;
  let paramsExpression: string | null = null;
  if (hasData) {
    const dataValidation = buildInputValidation(emitter, dataSchemaName, 'data', prettyErrors);
    validationLines.push(...dataValidation.statements);
    dataExpression = hasPlainTsTypes(descriptor.data!)
      ? `(${dataValidation.expression} as ${dataTypeRef})`
      : dataValidation.expression;
  }
  if (hasParams) {
    const paramsValidation = buildInputValidation(emitter, paramsSchemaName, 'params', prettyErrors);
    validationLines.push(...paramsValidation.statements);
    paramsExpression = hasPlainTsTypes(descriptor.parameters)
      ? `(${paramsValidation.expression} as ${paramsTypeRef})`
      : paramsValidation.expression;
  }

  // The top-level `query` factory's own parameters are named `data` / `params` (the natural
  // names for the user-facing surface), so arg encoding inside it uses those same names.
  const factoryArgs: string[] = [];
  if (hasData) factoryArgs.push(`data: ${dataTypeRef}`);
  if (hasParams) factoryArgs.push(`params: ${paramsTypeRef}`);
  const factoryArgsExpression = buildValidatorQueryArgs(descriptor, {
    dataVariable: hasData ? 'data' : null,
    paramsVariable: hasParams ? 'params' : null,
  });
  const queryDeclaration = !hasRuntimeParameterExpansions(input.parameterExpansions)
    ? renderQueryDeclaration({
        factoryArgs,
        queryArgs: factoryArgsExpression,
        queryName: functionName,
        sqlName,
        queryVariableName: queryName,
      })
    : renderExpandedQueryDeclaration({
        sourceSql: input.sourceSql,
        descriptor,
        parameterExpansions: input.parameterExpansions,
        factoryArgs,
        queryArgs: factoryArgsExpression,
        queryName: functionName,
        sqlName,
        queryVariableName: queryName,
      });
  const queryReference = buildQueryReference(hasData, hasParams, dataExpression!, paramsExpression!, queryName);
  const resultMapperLines =
    emitResultSchema && resultMapperName
      ? ['', ...renderResultMapper(resultMapperName, functionName, resultMapping.mappings, resultTypeRef)]
      : [];

  const implementationLines = emitResultSchema
    ? buildValidatorImplementation({
        resultMode,
        resultSchemaName,
        resultTypeRef,
        rawResultTypeRef: resultMapperName ? `${functionName}.RawResult` : undefined,
        castResult: hasPlainTsTypes(resultFields),
        resultFields,
        emitter,
        prettyErrors,
        decodeJsonResults,
        resultMapperName,
        queryReference,
        sync,
      })
    : [`\t\treturn client.run(${queryReference});`];

  const attachedProperties: string[] = [];
  if (hasData) attachedProperties.push(objectProperty('Data', dataSchemaName));
  if (hasParams) attachedProperties.push(objectProperty('Params', paramsSchemaName));
  if (emitResultSchema) attachedProperties.push(objectProperty('Result', resultSchemaName));
  if (resultMapperName) attachedProperties.push(objectProperty('mapResult', resultMapperName));
  attachedProperties.push(objectProperty('sql', sqlName), objectProperty('query', queryName));

  const namespaceLines: string[] = [];
  if (hasData) {
    namespaceLines.push(
      `\texport type Data = ${validatorNamespaceType(
        descriptor.data!,
        'parameter',
        emitter.inferExpression(`${functionName}.Data`),
      )};`,
    );
  }
  if (hasParams) {
    namespaceLines.push(
      `\texport type Params = ${validatorNamespaceType(
        descriptor.parameters,
        'parameter',
        emitter.inferExpression(`${functionName}.Params`),
      )};`,
    );
  }
  if (emitResultSchema) {
    if (resultMapperName) {
      namespaceLines.push(`\texport type RawResult = ${renderObjectTypeBody(resultRawFields, 'result')};`);
    }
    namespaceLines.push(
      `\texport type Result = ${validatorNamespaceType(
        resultFields,
        'result',
        emitter.inferExpression(`${functionName}.Result`),
      )};`,
    );
  }

  const runtimeImports = buildRuntimeImports(emitter, prettyErrors, clientType);

  const signatureReturnAnnotation = emitResultSchema
    ? sync
      ? `: ${getReturnType(descriptor, resultTypeRef)}`
      : `: Promise<${getReturnType(descriptor, resultTypeRef)}>`
    : '';
  const functionDeclaration = sync
    ? `\tfunction ${functionName}(${functionSignatureArgs.join(', ')})${signatureReturnAnnotation} {`
    : `\tasync function ${functionName}(${functionSignatureArgs.join(', ')})${signatureReturnAnnotation} {`;

  return [
    runtimeImports,
    emitter.importLine,
    ``,
    ...schemaDeclarations,
    ...sqlLines,
    queryDeclaration,
    ...resultMapperLines,
    ``,
    `export const ${functionName} = Object.assign(`,
    functionDeclaration,
    ...validationLines,
    ...implementationLines,
    `\t},`,
    `\t{ ${attachedProperties.join(', ')} },`,
    `);`,
    ``,
    ...(namespaceLines.length === 0 ? [] : [`export namespace ${functionName} {`, ...namespaceLines, `}`, ``]),
  ].join('\n');
}

/**
 * What to import from `'sqlfu'` in the generated wrapper:
 *  - zod path never needs a runtime helper (uses `z.prettifyError` directly).
 *  - standard-schema path pulls in `prettifyStandardSchemaError` when pretty errors are on,
 *    so the inline failure branch can turn issues into a readable message.
 *  - with pretty errors off, no runtime value is imported from sqlfu in either path — the
 *    generated file is fully self-contained apart from its validator library.
 */
function buildRuntimeImports(emitter: ValidatorEmitter, prettyErrors: boolean, clientType: string): string {
  if (emitter.parseFlavour === 'standard' && prettyErrors) {
    return `import {type ${clientType}, prettifyStandardSchemaError} from 'sqlfu';`;
  }
  return `import type {${clientType}} from 'sqlfu';`;
}

function validatorNamespaceType(
  fields: GeneratedField[],
  fieldKind: 'parameter' | 'result',
  fallbackType: string,
): string {
  return hasPlainTsTypes(fields) ? renderObjectTypeBody(fields, fieldKind) : fallbackType;
}

function objectProperty(propertyName: string, variableName: string): string {
  return propertyName === variableName ? propertyName : `${propertyName}: ${variableName}`;
}

function isTsIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

function propertyAccess(objectExpression: string, propertyName: string): string {
  return isTsIdentifier(propertyName)
    ? `${objectExpression}.${propertyName}`
    : `${objectExpression}[${JSON.stringify(propertyName)}]`;
}

function objectLiteralProperty(propertyName: string, valueExpression: string): string {
  return isTsIdentifier(propertyName)
    ? `${propertyName}: ${valueExpression}`
    : `${JSON.stringify(propertyName)}: ${valueExpression}`;
}

function renderObjectSchemaDeclaration(
  emitter: ValidatorEmitter,
  schemaName: string,
  fields: GeneratedField[],
  fieldKind: 'parameter' | 'result',
): string[] {
  // see tasks/typegen-extensibility.md — future user-provided validator plugins and per-column overrides would hook in here.
  const fieldLines = fields.map((field) => emitter.renderFieldLine(field, fieldKind));
  return emitter.objectSchemaDeclaration({schemaName, fieldLines});
}

function zodExpressionForField(field: GeneratedField, namespace: 'z'): string {
  if (field.objectFields) {
    const objectExpression = `${namespace}.object({ ${field.objectFields
      .map((objectField) => {
        let expression = zodExpressionForField(objectField, namespace);
        if (!objectField.notNull) expression = `${expression}.nullable()`;
        return `${objectField.name}: ${expression}`;
      })
      .join(', ')} })`;
    if (field.acceptsSingleOrArray) {
      return `${namespace}.union([${objectExpression}, ${namespace}.array(${objectExpression})])`;
    }
    return field.isArray ? `${namespace}.array(${objectExpression})` : objectExpression;
  }
  return zodExpressionForTsType(field.tsType, namespace);
}

function zodExpressionForTsType(tsType: string, namespace: 'z'): string {
  if (tsType === 'string') return `${namespace}.string()`;
  if (tsType === 'number') return `${namespace}.number()`;
  if (tsType === 'boolean') return `${namespace}.boolean()`;
  if (tsType === 'Date') return `${namespace}.date()`;
  if (tsType === 'Uint8Array' || tsType === 'ArrayBuffer') return `${namespace}.instanceof(Uint8Array)`;
  if (tsType === 'any') return `${namespace}.unknown()`;
  if (tsType.endsWith('[]')) {
    return `${namespace}.array(${zodExpressionForTsType(tsType.slice(0, -2), namespace)})`;
  }

  const enumValues = parseStringLiteralUnion(tsType);
  if (enumValues) {
    return `${namespace}.enum([${enumValues.map((value) => JSON.stringify(value)).join(', ')}])`;
  }

  return `${namespace}.unknown()`;
}

function valibotExpressionForField(field: GeneratedField): string {
  if (field.objectFields) {
    const objectExpression = `v.object({ ${field.objectFields
      .map((objectField) => {
        let expression = valibotExpressionForField(objectField);
        if (!objectField.notNull) expression = `v.nullable(${expression})`;
        return `${objectField.name}: ${expression}`;
      })
      .join(', ')} })`;
    if (field.acceptsSingleOrArray) {
      return `v.union([${objectExpression}, v.array(${objectExpression})])`;
    }
    return field.isArray ? `v.array(${objectExpression})` : objectExpression;
  }
  return valibotExpressionForTsType(field.tsType);
}

function valibotExpressionForTsType(tsType: string): string {
  if (tsType === 'string') return 'v.string()';
  if (tsType === 'number') return 'v.number()';
  if (tsType === 'boolean') return 'v.boolean()';
  if (tsType === 'Date') return 'v.date()';
  if (tsType === 'Uint8Array' || tsType === 'ArrayBuffer') return 'v.instance(Uint8Array)';
  if (tsType === 'any') return 'v.unknown()';
  if (tsType.endsWith('[]')) {
    return `v.array(${valibotExpressionForTsType(tsType.slice(0, -2))})`;
  }

  const enumValues = parseStringLiteralUnion(tsType);
  if (enumValues) {
    return `v.picklist([${enumValues.map((value) => JSON.stringify(value)).join(', ')}])`;
  }

  return 'v.unknown()';
}

type InputValidation = {
  /** Preamble statements to emit before the `query(...)` call (guards / throws). */
  statements: string[];
  /** Expression that evaluates to the validated value — fed directly to `query(...)`. */
  expression: string;
};

/**
 * Build the statements that validate a wrapper input (`data`, `params`) and the expression
 * that yields the validated value. Shape depends on the validator flavour and whether
 * pretty errors are on:
 *
 *   - zod + pretty: `safeParse` guard + `parsedX.data` expression.
 *   - zod + !pretty: no guard statements, expression is `Schema.parse(x)` itself.
 *   - standard + either: inline promise/issues guard + `parsedXResult.value` expression.
 *
 * The caller splices `statements` into the function body and uses `expression` directly in
 * the `query(...)` call, so there's no single-use `validatedX` intermediate.
 */
function buildInputValidation(
  emitter: ValidatorEmitter,
  schemaName: string,
  rawVariable: string,
  prettyErrors: boolean,
  indent: string = '\t\t',
): InputValidation {
  if (emitter.parseFlavour === 'zod') {
    if (!prettyErrors) {
      return {
        statements: [],
        expression: `${schemaName}.parse(${rawVariable})`,
      };
    }
    const parsedName = `parsed${schemaName}`;
    return {
      statements: [
        `${indent}const ${parsedName} = ${schemaName}.safeParse(${rawVariable});`,
        `${indent}if (!${parsedName}.success) throw new Error(z.prettifyError(${parsedName}.error));`,
      ],
      expression: `${parsedName}.data`,
    };
  }

  // Standard Schema flavour (valibot, zod-mini). Inline result-guard either way.
  const resultName = `parsed${schemaName}Result`;
  return {
    statements: [
      `${indent}const ${resultName} = ${schemaName}['~standard'].validate(${rawVariable});`,
      `${indent}if ('then' in ${resultName}) throw new Error('Unexpected async validation from ${schemaName}.');`,
      prettyErrors
        ? `${indent}if ('issues' in ${resultName}) throw new Error(prettifyStandardSchemaError(${resultName}) || 'Validation failed');`
        : `${indent}if ('issues' in ${resultName}) throw Object.assign(new Error('Validation failed'), {issues: ${resultName}.issues});`,
    ],
    expression: `${resultName}.value`,
  };
}

/**
 * The row-parsing expression for validator flavours where a single-expression form exists
 * (zod + no pretty errors). Returns `null` when the flavour needs a multi-statement form.
 * Standard Schema always needs the multi-statement form now — the promise-check +
 * issues-check is inline in the generated file, so there's no one-liner for it.
 */
function rowParseExpressionOrNull(
  emitter: ValidatorEmitter,
  schemaName: string,
  rowExpression: string,
  prettyErrors: boolean,
): string | null {
  if (emitter.parseFlavour === 'zod' && !prettyErrors) {
    return `${schemaName}.parse(${rowExpression})`;
  }
  return null;
}

/**
 * Multi-statement body for parsing a row into its validated form. Used for zod + pretty
 * (safeParse/prettifyError) and both standard-flavour variants (always — since there is no
 * one-liner helper on the standard path anymore). The last statement is `return <value>;`.
 */
function rowParseStatements(
  emitter: ValidatorEmitter,
  schemaName: string,
  rowExpression: string,
  prettyErrors: boolean,
  indent: string,
  returnType: string | null,
): string[] {
  const parsedData = returnType ? `(parsed.data as ${returnType})` : 'parsed.data';
  const parsedValue = returnType ? `(parsed.value as ${returnType})` : 'parsed.value';
  if (emitter.parseFlavour === 'zod') {
    // zod + pretty.
    return [
      `${indent}const parsed = ${schemaName}.safeParse(${rowExpression});`,
      `${indent}if (!parsed.success) throw new Error(z.prettifyError(parsed.error));`,
      `${indent}return ${parsedData};`,
    ];
  }
  // Standard Schema — same inline 3-step guard as for params, flipped to prettyErrors.
  return [
    `${indent}const parsed = ${schemaName}['~standard'].validate(${rowExpression});`,
    `${indent}if ('then' in parsed) throw new Error('Unexpected async validation from ${schemaName}.');`,
    prettyErrors
      ? `${indent}if ('issues' in parsed) throw new Error(prettifyStandardSchemaError(parsed) || 'Validation failed');`
      : `${indent}if ('issues' in parsed) throw Object.assign(new Error('Validation failed'), {issues: parsed.issues});`,
    `${indent}return ${parsedValue};`,
  ];
}

function buildValidatorQueryArgs(
  descriptor: GeneratedQueryDescriptor,
  variables: {dataVariable: string | null; paramsVariable: string | null},
): string {
  const args: string[] = [];
  for (const field of descriptor.data ?? []) {
    args.push(toDriver(variables.dataVariable!, field));
  }
  for (const field of descriptor.parameters) {
    args.push(toDriver(variables.paramsVariable!, field));
  }
  return args.length > 0 ? `[${args.join(', ')}]` : '[]';
}

function buildValidatorImplementation(input: {
  resultMode: 'many' | 'nullableOne' | 'one' | 'metadata';
  resultSchemaName: string;
  resultTypeRef: string;
  rawResultTypeRef?: string;
  castResult: boolean;
  resultFields: GeneratedField[];
  emitter: ValidatorEmitter;
  prettyErrors: boolean;
  decodeJsonResults: boolean;
  resultMapperName: string | null;
  queryReference: string;
  sync: boolean;
}): string[] {
  const {emitter, prettyErrors, queryReference, sync} = input;
  const maybeAwait = sync ? '' : 'await ';
  const q = queryReference;
  const resultRowsType = input.resultMapperName ? `<${input.rawResultTypeRef!}>` : '';
  const rawRowsAnnotation = input.decodeJsonResults && !input.resultMapperName ? ': any[]' : '';
  const returnType = input.castResult ? input.resultTypeRef : null;
  const publicRowExpression = (rowExpression: string) =>
    input.resultMapperName
      ? `${input.resultMapperName}(${rowExpression})`
      : jsonDecodedRowExpression(rowExpression, input.resultFields, input.resultTypeRef);
  const rowExpr = (rowExpression: string) =>
    rowParseExpressionOrNull(
      emitter,
      input.resultSchemaName,
      publicRowExpression(rowExpression),
      prettyErrors,
    );
  const rowBlock = (rowExpression: string, indent: string) =>
    rowParseStatements(
      emitter,
      input.resultSchemaName,
      publicRowExpression(rowExpression),
      prettyErrors,
      indent,
      returnType,
    );

  if (input.resultMode === 'many') {
    const parsedExpression = rowExpr('row');
    const expr = parsedExpression && returnType ? `(${parsedExpression} as ${returnType})` : parsedExpression;
    if (expr) {
      return [
        `\t\tconst rows${rawRowsAnnotation} = ${maybeAwait}client.all${resultRowsType}(${q});`,
        `\t\treturn rows.map((row) => ${expr});`,
      ];
    }
    return [
      `\t\tconst rows${rawRowsAnnotation} = ${maybeAwait}client.all${resultRowsType}(${q});`,
      `\t\treturn rows.map((row) => {`,
      ...rowBlock('row', '\t\t\t'),
      `\t\t});`,
    ];
  }

  if (input.resultMode === 'nullableOne') {
    const parsedExpression = rowExpr('rows[0]');
    const expr = parsedExpression && returnType ? `(${parsedExpression} as ${returnType})` : parsedExpression;
    if (expr) {
      return [
        `\t\tconst rows${rawRowsAnnotation} = ${maybeAwait}client.all${resultRowsType}(${q});`,
        `\t\treturn rows.length > 0 ? ${expr} : null;`,
      ];
    }
    return [
      `\t\tconst rows${rawRowsAnnotation} = ${maybeAwait}client.all${resultRowsType}(${q});`,
      `\t\tif (rows.length === 0) return null;`,
      ...rowBlock('rows[0]', '\t\t'),
    ];
  }

  if (input.resultMode === 'one') {
    const parsedExpression = rowExpr('rows[0]');
    const expr = parsedExpression && returnType ? `(${parsedExpression} as ${returnType})` : parsedExpression;
    if (expr) {
      return [`\t\tconst rows${rawRowsAnnotation} = ${maybeAwait}client.all${resultRowsType}(${q});`, `\t\treturn ${expr};`];
    }
    return [
      `\t\tconst rows${rawRowsAnnotation} = ${maybeAwait}client.all${resultRowsType}(${q});`,
      ...rowBlock('rows[0]', '\t\t'),
    ];
  }

  // metadata mode: call client.run(), guard expected keys, then parse the assembled object.
  const guards = input.resultFields.flatMap((field) => {
    if (field.name === 'lastInsertRowid') {
      return [
        `\t\tif (result.lastInsertRowid === undefined || result.lastInsertRowid === null) {`,
        `\t\t\tthrow new Error('Expected lastInsertRowid to be present on query result');`,
        `\t\t}`,
      ];
    }
    return [
      `\t\tif (result.${field.name} === undefined) {`,
      `\t\t\tthrow new Error('Expected ${field.name} to be present on query result');`,
      `\t\t}`,
    ];
  });
  const rawResultLines = [
    `\t\tconst rawResult = {`,
    ...input.resultFields.map((field) => {
      if (field.name === 'lastInsertRowid') {
        return `\t\t\tlastInsertRowid: Number(result.lastInsertRowid),`;
      }
      return `\t\t\t${field.name}: result.${field.name},`;
    }),
    `\t\t};`,
  ];

  const metadataExpr = rowExpr('rawResult');
  const resultReturnLines = metadataExpr ? [`\t\treturn ${metadataExpr};`] : rowBlock('rawResult', '\t\t');

  return [`\t\tconst result = ${maybeAwait}client.run(${q});`, ...guards, ...rawResultLines, ...resultReturnLines];
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

/**
 * Inline `{ foo: string; bar: number | null }` for use as the RHS of a namespace-scoped
 * `export type Foo = …;`. Indentation is two tabs — one for the namespace, one for the fields.
 */
function renderObjectTypeBody(fields: GeneratedField[], fieldKind: 'parameter' | 'result'): string {
  const lines = fields.flatMap((field) => {
    const optional = fieldKind === 'parameter' ? Boolean(field.optional) : !field.notNull;
    return renderTypePropertyLines('\t\t', field.name, optional, fieldTypeExpression(field, fieldKind));
  });
  return [`{`, ...lines, `\t}`].join('\n');
}

function renderTypePropertyLines(indent: string, name: string, optional: boolean, typeExpression: string): string[] {
  const lines = typeExpression.split('\n');
  if (lines.length === 1) {
    return [`${indent}${name}${optional ? '?' : ''}: ${typeExpression};`];
  }

  return [
    `${indent}${name}${optional ? '?' : ''}: ${lines[0]}`,
    ...lines.slice(1, -1).map((line) => `${indent}${line}`),
    `${indent}${lines[lines.length - 1]};`,
  ];
}

function fieldTypeExpression(field: GeneratedField, fieldKind: 'parameter' | 'result'): string {
  let typeExpression = field.tsType;
  if (field.objectFields) {
    const objectType = renderInlineObjectTsType(field.objectFields);
    if (field.acceptsSingleOrArray) {
      typeExpression = `${objectType} | Array<${objectType}>`;
    } else {
      typeExpression = field.isArray ? `Array<${objectType}>` : objectType;
    }
  }
  if (fieldKind === 'parameter' && !field.notNull) {
    return `${typeExpression} | null`;
  }
  return typeExpression;
}

function objectSchema(
  title: string,
  fields: GeneratedField[],
  input: {
    fieldKind?: 'parameter' | 'result';
  } = {},
): JsonSchemaObject {
  const fieldKind = input.fieldKind ?? 'parameter';
  const properties = Object.fromEntries(fields.map((field) => [field.name, schemaForField(field)]));
  const required = fields
    .filter((field) => (fieldKind === 'parameter' ? !Boolean(field.optional) : field.notNull))
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
  if (field.objectFields && field.acceptsSingleOrArray) {
    const object = objectSchema(field.name, field.objectFields);
    return {
      anyOf: [
        object,
        {
          type: 'array',
          items: object,
        },
      ],
    };
  }

  const schema = field.objectFields
    ? ({
        type: field.isArray ? 'array' : 'object',
        ...(field.isArray
          ? {items: objectSchema(field.name, field.objectFields)}
          : objectSchema(field.name, field.objectFields)),
      } satisfies JsonSchemaObject)
    : schemaForTsType(field.tsType);
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

function parseStringLiteralUnion(tsType: string): string[] | undefined {
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

function prepareQueryDescriptor(input: {
  descriptor: GeneratedQueryDescriptor;
  explicitParameterExpansions: ParameterExpansion[];
  sourceSql: string;
}): {
  descriptor: GeneratedQueryDescriptor;
  parameterExpansions: ParameterExpansion[];
} {
  const expansions = new Map(input.explicitParameterExpansions.map((expansion) => [expansion.name, expansion]));
  const sourceReferences = findNamedParameterReferences(input.sourceSql);
  const descriptorFields = [...(input.descriptor.data || []), ...input.descriptor.parameters];

  // TypeSQL already infers `IN (:ids)` / `NOT IN (:ids)` params as arrays. sqlfu
  // only adapts that descriptor fact into its existing runtime SQL/args expansion path.
  for (const field of descriptorFields) {
    if (field.objectFields) continue;
    if (!field.isArray && !field.tsType.endsWith('[]')) continue;
    const hasTopLevelReference = sourceReferences.some(
      (reference) => reference.name === field.name && reference.path.length === 0,
    );
    if (!hasTopLevelReference) continue;
    addParameterExpansion(expansions, {kind: 'scalar-array', name: field.name});
  }

  const parameterExpansions = Array.from(expansions.values());
  assertNoUnsupportedInferredReturning(input.descriptor, parameterExpansions);
  assertRuntimeExpansionReferences(input.sourceSql, parameterExpansions);
  return {
    descriptor: applyParameterExpansionDescriptor(input.descriptor, parameterExpansions, input.sourceSql),
    parameterExpansions,
  };
}

function assertNoUnsupportedInferredReturning(
  descriptor: GeneratedQueryDescriptor,
  expansions: ParameterExpansion[],
): void {
  if (!descriptor.returning) return;
  const expansion = expansions.find((candidate) => candidate.kind === 'object-array' && candidate.acceptsSingleOrArray);
  if (!expansion) return;
  throw new Error(`Inferred INSERT values parameter ${JSON.stringify(expansion.name)} does not support RETURNING yet`);
}

function assertRuntimeExpansionReferences(sql: string, expansions: ParameterExpansion[]): void {
  const runtimeExpansionNames = new Set(
    expansions
      .filter((expansion) => expansion.kind === 'scalar-array' || expansion.kind === 'object-array')
      .map((expansion) => expansion.name),
  );
  if (runtimeExpansionNames.size === 0) return;

  const counts = new Map<string, {count: number; rawReference: string}>();
  for (const reference of findNamedParameterReferences(sql)) {
    if (!runtimeExpansionNames.has(reference.name) || reference.path.length > 0) continue;
    const existing = counts.get(reference.name);
    counts.set(reference.name, {
      count: (existing?.count || 0) + 1,
      rawReference: reference.raw,
    });
  }

  for (const [name, entry] of counts) {
    if (entry.count > 1) {
      throw new Error(`Runtime-expanded parameter ${JSON.stringify(name)} can only appear once: ${entry.rawReference}`);
    }
  }
}

function applyParameterExpansionDescriptor(
  descriptor: GeneratedQueryDescriptor,
  expansions: ParameterExpansion[],
  sourceSql: string,
): GeneratedQueryDescriptor {
  if (expansions.length === 0) return descriptor;
  return {
    ...descriptor,
    sql: staticSqlForExpandedQuery(sourceSql, expansions),
    parameters: mergeExpandedParameterFields(descriptor.parameters, expansions),
    data: descriptor.data ? mergeExpandedParameterFields(descriptor.data, expansions) : undefined,
  };
}

function staticSqlForExpandedQuery(sql: string, expansions: ParameterExpansion[]): string {
  const expansionMap = new Map(expansions.map((expansion) => [expansion.name, expansion]));
  return replaceNamedParameters(sql, (reference) => {
    if (reference.path.length > 0) return '?';

    const expansion = expansionMap.get(reference.name);
    if (!expansion) return '?';

    if (expansion.kind === 'scalar-array') {
      return reference.wrappedInParens ? '?' : '(?)';
    }

    if (expansion.kind === 'object-fields') {
      return '?';
    }

    const placeholders = expansion.fields.map(() => '?').join(', ');
    if (expansion.sqlShape === 'row-list') {
      return `(${placeholders})`;
    }
    if (reference.wrappedInParens) return placeholders;
    return `(${placeholders})`;
  });
}

function mergeExpandedParameterFields<T extends GeneratedField & {toDriver: string; isArray: boolean}>(
  fields: T[],
  expansions: ParameterExpansion[],
): T[] {
  const expansionByName = new Map(expansions.map((expansion) => [expansion.name, expansion]));
  const output: T[] = [];
  const fieldByName = new Map(fields.map((field) => [field.name, field]));
  const emittedObjectExpansions = new Set<string>();
  for (const field of fields) {
    const childExpansion = expansions
      .filter(isObjectLikeParameterExpansion)
      .find((expansion) =>
        expansion.fields.some((fieldName) => expandedFieldName(expansion.name, fieldName) === field.name),
      );
    if (childExpansion) {
      if (!emittedObjectExpansions.has(childExpansion.name)) {
        const objectField = buildObjectExpansionField(childExpansion, fieldByName);
        if (objectField) output.push(objectField as T);
        emittedObjectExpansions.add(childExpansion.name);
      }
      continue;
    }

    const expansion = expansionByName.get(field.name);
    if (expansion?.kind === 'scalar-array') {
      const scalarTsType = field.tsType.endsWith('[]') ? field.tsType : `${field.tsType}[]`;
      output.push({
        ...field,
        tsType: scalarTsType,
        notNull: true,
        optional: false,
        isArray: true,
      });
      continue;
    }

    output.push(field);
  }

  return output;
}

function isObjectLikeParameterExpansion(
  expansion: ParameterExpansion,
): expansion is Exclude<ParameterExpansion, {kind: 'scalar-array'}> {
  return expansion.kind !== 'scalar-array';
}

function buildObjectExpansionField<T extends GeneratedField & {toDriver: string; isArray: boolean}>(
  expansion: Exclude<ParameterExpansion, {kind: 'scalar-array'}>,
  fieldByName: ReadonlyMap<string, T>,
): T | undefined {
  const objectFields = expansion.fields.map((fieldName) => {
    const field = fieldByName.get(expandedFieldName(expansion.name, fieldName));
    if (!field) {
      return {
        name: fieldName,
        tsType: 'any',
        notNull: false,
        optional: false,
      };
    }
    return {
      ...field,
      name: fieldName,
    };
  });
  const driverObjectFields = (expansion.kind === 'object-fields' ? expansion.driverFields : expansion.fields).map(
    (fieldName) => {
      const field = objectFields.find((candidate) => candidate.name === fieldName);
      if (!field) {
        return {
          name: fieldName,
          tsType: 'any',
          notNull: false,
          optional: false,
        };
      }
      return field;
    },
  );
  if (objectFields.length === 0) return undefined;

  const tsType = renderInlineObjectTsType(objectFields);
  const fieldTsType =
    expansion.kind === 'object-array'
      ? expansion.acceptsSingleOrArray
        ? `${tsType} | Array<${tsType}>`
        : `Array<${tsType}>`
      : tsType;
  return {
    name: expansion.name,
    tsType: fieldTsType,
    notNull: true,
    optional: false,
    toDriver: expansion.name,
    isArray: expansion.kind === 'object-array' && !expansion.acceptsSingleOrArray,
    acceptsSingleOrArray: expansion.kind === 'object-array' ? expansion.acceptsSingleOrArray : false,
    objectFields,
    driverObjectFields,
  } as T;
}

function renderInlineObjectTsType(fields: GeneratedField[]): string {
  return `{ ${fields.map((field) => `${field.name}: ${fieldTypeExpression(field, 'parameter')}`).join('; ')} }`;
}

function getResultFields(descriptor: GeneratedQueryDescriptor): GeneratedField[] {
  if (descriptor.returning || descriptor.queryType === 'Select') {
    return descriptor.columns;
  }
  if (descriptor.queryType === 'Insert') {
    return [
      {name: 'rowsAffected', tsType: 'number', notNull: true},
      {name: 'lastInsertRowid', tsType: 'number', notNull: true},
    ];
  }
  // DDL / connection-control statements don't return rows and we don't synthesize
  // the insert/update-style `rowsAffected` metadata row for them either — there's
  // nothing meaningful to report for a `create table` or `pragma`.
  if (descriptor.queryType === 'Ddl') {
    return [];
  }
  return [{name: 'rowsAffected', tsType: 'number', notNull: true}];
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
    toDriver: string;
    isArray: boolean;
  },
  rawName?: string,
): QueryCatalogArgument {
  return {
    scope,
    name: field.name,
    ...(rawName && rawName !== field.name ? {rawName} : {}),
    tsType: field.tsType,
    notNull: field.notNull,
    optional: Boolean(field.optional),
    isArray: field.isArray || field.tsType.endsWith('[]'),
    driverEncoding: inferDriverEncoding(field),
  };
}

function inferDriverEncoding(field: {
  tsType: string;
  toDriver: string;
  logicalType?: LogicalType;
}): QueryCatalogArgument['driverEncoding'] {
  if (field.logicalType === 'json') {
    return 'json';
  }
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

function toCatalogField(field: GeneratedField, rawName?: string): QueryCatalogField {
  return {
    name: field.name,
    ...(rawName && rawName !== field.name ? {rawName} : {}),
    tsType: field.tsType,
    notNull: field.notNull,
    optional: Boolean(field.optional),
  };
}

function toDriver(
  variableName: string,
  param: GeneratedField & {
    toDriver: string;
    isArray: boolean;
  },
): string {
  if (param.logicalType === 'json') {
    return toDriverValue(`${variableName}.${param.name}`, param);
  }
  if (param.objectFields && (param.isArray || param.acceptsSingleOrArray)) {
    const collectionExpression = param.acceptsSingleOrArray
      ? `(Array.isArray(${variableName}.${param.name}) ? ${variableName}.${param.name} : [${variableName}.${param.name}])`
      : `${variableName}.${param.name}`;
    const values = (param.driverObjectFields || param.objectFields).map((field) =>
      toDriverValue(`item.${field.name}`, field),
    );
    return `...${collectionExpression}.flatMap((item) => [${values.join(', ')}])`;
  }
  if (param.objectFields) {
    const values = (param.driverObjectFields || param.objectFields).map((field) =>
      toDriverValue(`${variableName}.${param.name}.${field.name}`, field),
    );
    return values.join(', ');
  }
  if (param.tsType.endsWith('[]')) {
    const itemField = {
      ...param,
      name: 'item',
      tsType: param.tsType.slice(0, -2),
    };
    const itemExpression = toDriverValue('item', itemField);
    if (itemExpression === 'item') {
      return `...${variableName}.${param.name}`;
    }
    return `...${variableName}.${param.name}.map((item) => ${itemExpression})`;
  }
  return toDriverValue(`${variableName}.${param.name}`, param);
}

function toDriverValue(
  valueExpression: string,
  field: GeneratedField & {
    toDriver?: string;
  },
): string {
  if (field.logicalType === 'json') {
    return `JSON.stringify(${valueExpression}, null, 2)`;
  }
  if (field.tsType === 'Date') {
    if (field.toDriver?.includes(`split('T')[0]`) && !field.toDriver.includes(`replace('T', ' ')`)) {
      return `${valueExpression}?.toISOString().split('T')[0]`;
    }
    return `${valueExpression}?.toISOString().split('.')[0].replace('T', ' ')`;
  }
  if (field.tsType === 'boolean') {
    return `${valueExpression} != null ? Number(${valueExpression}) : ${valueExpression}`;
  }
  return valueExpression;
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
  const inferredInputColumns = inferQueryInputColumns(sql, schema);
  if (inferredColumns.size === 0 && inferredInputColumns.size === 0) {
    return descriptor;
  }

  return {
    ...descriptor,
    columns: descriptor.columns.map((column) => {
      const inferredColumn = inferredColumns.get(column.name.replaceAll('"', ''));
      if (!inferredColumn) {
        return column;
      }
      return refineFieldFromColumn(column, inferredColumn);
    }),
    parameters: descriptor.parameters.map((field) => {
      const inferredColumn = inferredInputColumns.get(field.name);
      return inferredColumn ? refineFieldFromColumn(field, inferredColumn) : field;
    }),
    data: descriptor.data?.map((field) => {
      const inferredColumn = inferredInputColumns.get(field.name);
      return inferredColumn ? refineFieldFromColumn(field, inferredColumn) : field;
    }),
  };
}

function refineFieldFromColumn<T extends GeneratedField>(field: T, column: TsColumn): T {
  return {
    ...field,
    tsType: column.logicalType === 'json' ? column.tsType : field.tsType === 'any' ? column.tsType : field.tsType,
    notNull: field.notNull || column.notNull,
    logicalType: column.logicalType || field.logicalType,
    plainTsType: column.plainTsType || field.plainTsType,
  };
}

function mapColumnDerivedFields<TField extends GeneratedField>(
  fields: TField[],
  casing: SqlfuGenerateCasing,
): FieldMappingPlan<TField> {
  const candidates = fields.map((field) => (casing === 'camel' ? toPropertyCamelCase(field.name) : field.name));
  const candidateCounts = new Map<string, number>();
  for (const candidate of candidates) {
    candidateCounts.set(candidate, (candidateCounts.get(candidate) || 0) + 1);
  }

  const mappings = fields.map((field, index): FieldMapping<TField> => {
    const candidate = candidates[index]!;
    const publicName = candidateCounts.get(candidate)! > 1 ? field.name : candidate;
    return {
      raw: field,
      public: renameGeneratedField(field, publicName),
    };
  });

  return {
    rawFields: mappings.map((mapping) => mapping.raw),
    publicFields: mappings.map((mapping) => mapping.public),
    mappings,
    hasNameChanges: mappings.some((mapping) => mapping.raw.name !== mapping.public.name),
  };
}

function applyGeneratedInputCasing(descriptor: GeneratedQueryDescriptor, casing: SqlfuGenerateCasing): DescriptorCasingPlan {
  const parameters = descriptor.parameters.map((field) => mapColumnDerivedObjectFields(field, casing));
  const dataWithPublicObjectFields = descriptor.data?.map((field) => mapColumnDerivedObjectFields(field, casing));
  const dataMapping = dataWithPublicObjectFields ? mapColumnDerivedFields(dataWithPublicObjectFields, casing) : null;
  return {
    descriptor: {
      ...descriptor,
      parameters,
      data: dataMapping?.publicFields,
    },
    dataMapping,
  };
}

function mapColumnDerivedObjectFields<TField extends GeneratedField>(field: TField, casing: SqlfuGenerateCasing): TField {
  if (!field.objectFields) {
    return field;
  }

  const objectMapping = mapColumnDerivedFields(field.objectFields, casing);
  const publicFieldByRawName = new Map(
    objectMapping.mappings.map((mapping) => [mapping.raw.name, mapping.public] as const),
  );
  const driverObjectFields = field.driverObjectFields?.map(
    (driverField) => publicFieldByRawName.get(driverField.name) || mapColumnDerivedFields([driverField], casing).publicFields[0]!,
  );
  return {
    ...field,
    objectFields: objectMapping.publicFields,
    driverObjectFields,
    tsType: objectFieldTypeExpression(field, objectMapping.publicFields),
  };
}

function objectFieldTypeExpression(field: GeneratedField, objectFields: GeneratedField[]): string {
  const objectType = renderInlineObjectTsType(objectFields);
  if (field.acceptsSingleOrArray) {
    return `${objectType} | Array<${objectType}>`;
  }
  return field.isArray ? `Array<${objectType}>` : objectType;
}

function renameGeneratedField<TField extends GeneratedField>(field: TField, name: string): TField {
  return {
    ...field,
    name,
  };
}

function renderResultMapper(
  resultMapperName: string,
  functionName: string,
  mappings: FieldMapping[],
  resultTypeRef: string,
): string[] {
  return [
    `function ${resultMapperName}(row: ${functionName}.RawResult): ${resultTypeRef} {`,
    `\treturn {`,
    ...mappings.map(
      (mapping) => `\t\t${objectLiteralProperty(mapping.public.name, resultMapperValue(mapping, resultTypeRef))},`,
    ),
    `\t};`,
    `}`,
  ];
}

function resultMapperValue(mapping: FieldMapping, resultTypeRef: string): string {
  const rawValue = propertyAccess('row', mapping.raw.name);
  if (mapping.public.logicalType !== 'json') {
    return rawValue;
  }
  const parsedValue = `JSON.parse(${rawValue})`;
  if (mapping.public.tsType === 'unknown') {
    return parsedValue;
  }
  return `(${parsedValue} as ${resultTypeRef}[${JSON.stringify(mapping.public.name)}])`;
}

function rawResultField(field: GeneratedField): GeneratedField {
  if (field.logicalType !== 'json') {
    return field;
  }
  return {
    ...field,
    tsType: 'string',
    logicalType: undefined,
    plainTsType: undefined,
  };
}

function toPropertyCamelCase(value: string): string {
  const parts = value.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0) {
    return '';
  }
  if (parts.length === 1) {
    const [part] = parts;
    return `${part![0]!.toLowerCase()}${part!.slice(1)}`;
  }
  return (
    parts[0]!.toLowerCase() +
    parts
      .slice(1)
      .map((part) => `${part[0]!.toUpperCase()}${part.slice(1).toLowerCase()}`)
      .join('')
  );
}

/**
 * SELECT-like bodies only (`many` / `nullableOne` / `one` — i.e. every mode except `metadata`).
 * Metadata mode is rendered as a plain `return client.run(query);` pass-through at the call site.
 */
function buildNativeSqliteSelectImplementation(input: {
  runtime: NativeSqliteRuntime;
  driverVariable: string;
  resultMode: 'many' | 'nullableOne' | 'one' | 'metadata';
  resultType: string;
  rawResultType?: string;
  resultFields: GeneratedField[];
  decodeJsonResults: boolean;
  resultMapperName: string | null;
  queryReference: string;
  indent: string;
}): string[] {
  const i = input.indent;
  const rowType = input.resultMapperName ? input.rawResultType! : input.decodeJsonResults ? 'any' : input.resultType;
  const lines = [
    `${i}const generatedQuery = ${input.queryReference};`,
    ...nativeSqliteRowsLines(input.runtime, input.driverVariable, rowType, i),
  ];
  const rowExpression = (row: string) => jsonDecodedRowExpression(row, input.resultFields, input.resultType);

  if (input.resultMode === 'many') {
    if (input.resultMapperName) return [...lines, `${i}return rows.map(${input.resultMapperName});`];
    if (input.decodeJsonResults) {
      return [...lines, `${i}return rows.map((row): ${input.resultType} => ${rowExpression('row')});`];
    }
    return [...lines, `${i}return rows;`];
  }

  if (input.resultMode === 'nullableOne') {
    if (input.resultMapperName) {
      return [...lines, `${i}return rows.length > 0 ? ${input.resultMapperName}(rows[0]!) : null;`];
    }
    if (input.decodeJsonResults) {
      return [...lines, `${i}return rows.length > 0 ? (${rowExpression('rows[0]')} as ${input.resultType}) : null;`];
    }
    return [...lines, `${i}return rows.length > 0 ? rows[0]! : null;`];
  }

  if (input.resultMapperName) return [...lines, `${i}return ${input.resultMapperName}(rows[0]!);`];
  if (input.decodeJsonResults) {
    return [...lines, `${i}return (${rowExpression('rows[0]')} as ${input.resultType});`];
  }
  return [...lines, `${i}return rows[0]!;`];
}

function nativeSqliteRowsLines(
  runtime: NativeSqliteRuntime,
  driverVariable: string,
  rowType: string,
  indent: string,
): string[] {
  if (runtime === '@libsql/client') {
    return [
      `${indent}const result = await ${driverVariable}.execute({sql: generatedQuery.sql, args: [...generatedQuery.args]});`,
      `${indent}const rows = result.rows.map((row) => ({...row})) as unknown as ${rowType}[];`,
    ];
  }
  if (runtime === 'bun:sqlite') {
    return [
      `${indent}const rows = ${driverVariable}.query(generatedQuery.sql).all(...generatedQuery.args) as ${rowType}[];`,
    ];
  }
  return [
    `${indent}const rows = ${driverVariable}.prepare(generatedQuery.sql).all(...generatedQuery.args) as ${rowType}[];`,
  ];
}

function buildNativeSqliteMetadataImplementation(input: {
  runtime: NativeSqliteRuntime;
  driverVariable: string;
  resultFields: GeneratedField[];
  queryReference: string;
  indent: string;
}): string[] {
  const i = input.indent;
  return [
    `${i}const generatedQuery = ${input.queryReference};`,
    ...nativeSqliteRunLines(input.runtime, input.driverVariable, i),
    `${i}return ${nativeSqliteMetadataExpression(input.runtime, input.resultFields)};`,
  ];
}

function nativeSqliteRunLines(runtime: NativeSqliteRuntime, driverVariable: string, indent: string): string[] {
  if (runtime === '@libsql/client') {
    return [
      `${indent}const result = await ${driverVariable}.execute({sql: generatedQuery.sql, args: [...generatedQuery.args]});`,
    ];
  }
  if (runtime === 'bun:sqlite') {
    return [`${indent}const result = ${driverVariable}.run(generatedQuery.sql, [...generatedQuery.args]);`];
  }
  return [`${indent}const result = ${driverVariable}.prepare(generatedQuery.sql).run(...generatedQuery.args);`];
}

function nativeSqliteMetadataExpression(runtime: NativeSqliteRuntime, resultFields: GeneratedField[]): string {
  const fieldNames = new Set(resultFields.map((field) => field.name));
  const rowsAffectedExpression =
    runtime === '@libsql/client'
      ? 'result.rowsAffected'
      : 'result.changes == null ? undefined : Number(result.changes)';
  const lastInsertRowidExpression =
    'result.lastInsertRowid == null ? result.lastInsertRowid : Number(result.lastInsertRowid)';
  if (fieldNames.size === 0) {
    return `{rowsAffected: ${rowsAffectedExpression}, lastInsertRowid: ${lastInsertRowidExpression}}`;
  }
  const properties = [];
  if (fieldNames.has('rowsAffected')) {
    properties.push(`rowsAffected: ${rowsAffectedExpression}`);
  }
  if (fieldNames.has('lastInsertRowid')) {
    properties.push(`lastInsertRowid: ${lastInsertRowidExpression}`);
  }
  return `{${properties.join(', ')}}`;
}

function buildGeneratedImplementation(input: {
  resultMode: 'many' | 'nullableOne' | 'one';
  resultType: string;
  rawResultType?: string;
  resultFields: GeneratedField[];
  decodeJsonResults: boolean;
  resultMapperName: string | null;
  queryReference: string;
  sync: boolean;
  indent: string;
}): string[] {
  const maybeAwait = input.sync ? '' : 'await ';
  const i = input.indent;
  const q = input.queryReference;

  if (input.resultMapperName) {
    const rawResultType = input.rawResultType!;
    if (input.resultMode === 'many') {
      return [
        `${i}const rows = ${maybeAwait}client.all<${rawResultType}>(${q});`,
        `${i}return rows.map(${input.resultMapperName});`,
      ];
    }
    if (input.resultMode === 'nullableOne') {
      return [
        `${i}const rows = ${maybeAwait}client.all<${rawResultType}>(${q});`,
        `${i}return rows.length > 0 ? ${input.resultMapperName}(rows[0]!) : null;`,
      ];
    }
    return [
      `${i}const rows = ${maybeAwait}client.all<${rawResultType}>(${q});`,
      `${i}return ${input.resultMapperName}(rows[0]!);`,
    ];
  }

  if (input.resultMode === 'many') {
    if (input.decodeJsonResults) {
      return [
        `${i}const rows: any[] = ${maybeAwait}client.all(${q});`,
        `${i}return rows.map((row) => ${jsonDecodedRowExpression('row', input.resultFields, input.resultType)});`,
      ];
    }
    // `many` returns the client's result directly — the outer function's Promise<T[]> / T[] return
    // type already matches client.all's return type, so there's no need to await and re-wrap.
    return [`${i}return client.all<${input.resultType}>(${q});`];
  }

  if (input.resultMode === 'nullableOne') {
    if (input.decodeJsonResults) {
      return [
        `${i}const rows: any[] = ${maybeAwait}client.all(${q});`,
        `${i}return rows.length > 0 ? ${jsonDecodedRowExpression('rows[0]', input.resultFields, input.resultType)} : null;`,
      ];
    }
    return [
      `${i}const rows = ${maybeAwait}client.all<${input.resultType}>(${q});`,
      `${i}return rows.length > 0 ? rows[0] : null;`,
    ];
  }

  if (input.decodeJsonResults) {
    return [
      `${i}const rows: any[] = ${maybeAwait}client.all(${q});`,
      `${i}return ${jsonDecodedRowExpression('rows[0]', input.resultFields, input.resultType)};`,
    ];
  }
  return [`${i}const rows = ${maybeAwait}client.all<${input.resultType}>(${q});`, `${i}return rows[0];`];
}

function buildEffectSqlImplementation(input: {
  resultMode: 'many' | 'nullableOne' | 'one' | 'metadata';
  resultType: string;
  rawResultType?: string;
  resultFields: GeneratedField[];
  decodeJsonResults: boolean;
  resultMapperName: string | null;
  queryReference: string;
  indent: string;
}): string[] {
  const i = input.indent;
  const bodyIndent = `${i}\t`;
  const rowExpression = (row: string) => jsonDecodedRowExpression(row, input.resultFields, input.resultType);

  const lines = [
    `${i}return Effect.gen(function*() {`,
    `${bodyIndent}const sqlClient = yield* SqlClient.SqlClient;`,
    `${bodyIndent}const generatedQuery = ${input.queryReference};`,
  ];

  if (input.resultMode === 'metadata') {
    lines.push(`${bodyIndent}return yield* sqlClient.unsafe(generatedQuery.sql, generatedQuery.args).raw;`);
    lines.push(`${i}});`);
    return lines;
  }

  lines.push(
    `${bodyIndent}const rows = yield* sqlClient.unsafe<${input.resultMapperName ? input.rawResultType : input.decodeJsonResults ? 'any' : input.resultType}>(generatedQuery.sql, generatedQuery.args);`,
  );

  if (input.resultMode === 'many') {
    if (input.resultMapperName) {
      lines.push(`${bodyIndent}return rows.map(${input.resultMapperName});`);
      lines.push(`${i}});`);
      return lines;
    }
    if (input.decodeJsonResults) {
      lines.push(`${bodyIndent}return rows.map((row): ${input.resultType} => ${rowExpression('row')});`);
    } else {
      lines.push(`${bodyIndent}return rows;`);
    }
    lines.push(`${i}});`);
    return lines;
  }

  if (input.resultMode === 'nullableOne') {
    if (input.resultMapperName) {
      lines.push(`${bodyIndent}return rows.length > 0 ? ${input.resultMapperName}(rows[0]!) : null;`);
      lines.push(`${i}});`);
      return lines;
    }
    const value = input.decodeJsonResults
      ? `(${rowExpression('rows[0]')} as ${input.resultType})`
      : rowExpression('rows[0]');
    lines.push(`${bodyIndent}return rows.length > 0 ? ${value} : null;`);
    lines.push(`${i}});`);
    return lines;
  }

  if (input.resultMapperName) {
    lines.push(`${bodyIndent}return ${input.resultMapperName}(rows[0]!);`);
    lines.push(`${i}});`);
    return lines;
  }
  const value = input.decodeJsonResults
    ? `(${rowExpression('rows[0]')} as ${input.resultType})`
    : rowExpression('rows[0]');
  lines.push(`${bodyIndent}return ${value};`);
  lines.push(`${i}});`);
  return lines;
}

type LoadSchemaOptions = {
  experimentalJsonTypes: boolean;
};

async function loadSchema(
  databasePath: string,
  options: LoadSchemaOptions,
): Promise<ReadonlyMap<string, RelationInfo>> {
  await using database = await openMainDevDatabase(databasePath);
  const client = database.client;

  try {
    const logicalTypes = options.experimentalJsonTypes
      ? await loadSqlfuTypes(client)
      : new Map<string, LogicalTypeInfo>();
    const schemaResult = await client.all<{name: string; type: string; sql: string | null}>({
      sql: `
        select name, type, sql
        from sqlite_schema
        where type in ('table', 'view')
          and ${excludeReservedSqliteObjects}
        order by name
      `,
      args: [],
    });

    const relations = new Map<string, RelationInfo>();

    for (const row of schemaResult) {
      const name = String(row.name);
      if (name.toLowerCase() === 'sqlfu_types') {
        continue;
      }
      const kind = row.type === 'view' ? 'view' : 'table';
      const columns = await loadRelationColumns(client, name, options, logicalTypes);
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
  }
}

/**
 * @experimental `sqlfu_types` is an early metadata hook for schema-level
 * logical types. Its view shape and generated encode/decode output may change
 * before sqlfu's first stable release.
 */
async function loadSqlfuTypes(client: Client): Promise<ReadonlyMap<string, LogicalTypeInfo>> {
  const metadataObjects = await client.all<{name: string; type: string}>({
    sql: `
      select name, type
      from sqlite_schema
      where lower(name) = 'sqlfu_types'
        and type in ('table', 'view')
      order by name
    `,
    args: [],
  });

  const logicalTypes = new Map<string, LogicalTypeInfo>();
  if (metadataObjects.length === 0) {
    return logicalTypes;
  }

  const metadataObject = metadataObjects[0]!;
  if (metadataObject.type !== 'view') {
    throw new Error('sqlfu_types must be a view that selects name, encoding, format, and definition columns.');
  }

  const typeRows = await client.all<Record<string, unknown>>({
    sql: `select name, encoding, format, definition from sqlfu_types`,
    args: [],
  });

  for (let index = 0; index < typeRows.length; index += 1) {
    const row = typeRows[index]!;
    const location = `sqlfu_types row ${index + 1}`;
    const name = requireString(row.name, `${location}.name`);
    const encoding = requireString(row.encoding, `${location}.encoding`);
    const format = requireString(row.format, `${location}.format`);
    const tsType = normalizePlainTsType(
      requireString(row.definition, `${location}.definition`),
      `${location}.definition`,
    );

    if (encoding !== 'json') {
      throw new Error(`${location}.encoding must be "json"; got ${JSON.stringify(encoding)}.`);
    }

    if (format !== 'typescript') {
      throw new Error(`${location}.format must be "typescript"; got ${JSON.stringify(format)}.`);
    }

    const key = normalizeDeclaredType(name);
    if (logicalTypes.has(key)) {
      throw new Error(`${location}.name duplicates sqlfu_types logical type ${JSON.stringify(name)}.`);
    }

    logicalTypes.set(key, {
      logicalType: 'json',
      tsType,
    });
  }

  return logicalTypes;
}

async function loadRelationColumns(
  client: Client,
  relationName: string,
  options: LoadSchemaOptions,
  logicalTypes: ReadonlyMap<string, LogicalTypeInfo>,
): Promise<ReadonlyMap<string, TsColumn>> {
  const pragmaResult = await client.all<Record<string, unknown>>({
    sql: `PRAGMA table_xinfo(${sqliteQuoteIdentifier(relationName)})`,
    args: [],
  });

  const columns = new Map<string, TsColumn>();

  for (const row of pragmaResult) {
    if (Number(row.hidden ?? 0) !== 0) {
      continue;
    }

    const name = String(row.name);
    const declaredType = typeof row.type === 'string' ? row.type : '';
    const logicalTypeInfo = logicalTypes.get(normalizeDeclaredType(declaredType));
    const logicalType = logicalTypeInfo?.logicalType || logicalTypeForDeclaredSqliteType(declaredType, options);
    columns.set(name, {
      name,
      tsType: logicalTypeInfo?.tsType || (logicalType === 'json' ? 'unknown' : mapSqliteTypeToTs(declaredType)),
      notNull: Number(row.notnull ?? 0) === 1 || Number(row.pk ?? 0) >= 1,
      logicalType,
      plainTsType: Boolean(logicalTypeInfo),
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

function inferQueryResultColumns(
  sql: string,
  schema: ReadonlyMap<string, RelationInfo>,
): ReadonlyMap<string, TsColumn> {
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

function inferQueryInputColumns(sql: string, schema: ReadonlyMap<string, RelationInfo>): ReadonlyMap<string, TsColumn> {
  return new Map([...inferInsertInputColumns(sql, schema), ...inferUpdateInputColumns(sql, schema)]);
}

function inferInsertInputColumns(
  sql: string,
  schema: ReadonlyMap<string, RelationInfo>,
): ReadonlyMap<string, TsColumn> {
  const searchableSql = maskSqlCommentsAndStrings(sql);
  const match = searchableSql.match(
    /\binsert\s+(?:or\s+[A-Za-z_][A-Za-z0-9_]*\s+)?into\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(([^)]*)\)\s+values\s*\(([^)]*)\)/i,
  );
  if (!match) {
    return new Map();
  }

  const sourceColumns = schema.get(match[1]!)?.columns;
  if (!sourceColumns) {
    return new Map();
  }

  const columnNames = parseSimpleSqlFieldListForRefinement(match[2]!);
  if (!columnNames) {
    return new Map();
  }
  const values = splitTopLevelComma(match[3]!);
  return inferInputColumnsFromAssignments(columnNames, values, sourceColumns);
}

function inferUpdateInputColumns(
  sql: string,
  schema: ReadonlyMap<string, RelationInfo>,
): ReadonlyMap<string, TsColumn> {
  const searchableSql = maskSqlCommentsAndStrings(sql);
  const match = searchableSql.match(
    /\bupdate\s+(?:or\s+[A-Za-z_][A-Za-z0-9_]*\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s+set\s+([\s\S]*?)(?:\s+where\b|\s+returning\b|$)/i,
  );
  if (!match) {
    return new Map();
  }

  const sourceColumns = schema.get(match[1]!)?.columns;
  if (!sourceColumns) {
    return new Map();
  }

  const inferred = new Map<string, TsColumn>();
  for (const assignment of splitTopLevelComma(match[2]!)) {
    const assignmentMatch = assignment.match(/^\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s*=\s*(:[A-Za-z_$][A-Za-z0-9_$]*)\s*$/);
    if (!assignmentMatch) {
      continue;
    }
    const column = sourceColumns.get(assignmentMatch[1]!);
    const parameterName = assignmentMatch[2]!.slice(1);
    if (column) {
      inferred.set(parameterName, column);
    }
  }
  return inferred;
}

function inferInputColumnsFromAssignments(
  columnNames: string[],
  values: string[],
  sourceColumns: ReadonlyMap<string, TsColumn>,
): ReadonlyMap<string, TsColumn> {
  const inferred = new Map<string, TsColumn>();
  for (let index = 0; index < columnNames.length; index += 1) {
    const column = sourceColumns.get(columnNames[index]!);
    const parameterName = extractSingleNamedParameterName(values[index] || '');
    if (column && parameterName) {
      inferred.set(parameterName, column);
    }
  }
  return inferred;
}

function extractSingleNamedParameterName(expression: string): string | undefined {
  return expression.trim().match(/^:([A-Za-z_$][A-Za-z0-9_$]*)$/)?.[1];
}

function parseSimpleSqlFieldListForRefinement(rawFields: string): string[] | undefined {
  const names: string[] = [];
  for (const rawField of rawFields.split(',')) {
    const field = rawField.trim();
    if (!field) continue;
    const match = field.match(/^(?:(?:[A-Za-z_$][A-Za-z0-9_$]*)\.)?([A-Za-z_$][A-Za-z0-9_$]*)$/);
    if (!match) {
      return undefined;
    }
    names.push(match[1]!);
  }
  const duplicate = names.find((field, index) => names.indexOf(field) !== index);
  if (names.length === 0 || duplicate) {
    return undefined;
  }
  return names;
}

function maskSqlCommentsAndStrings(sql: string): string {
  const chars = sql.split('');
  for (const range of findSqlIgnoredRanges(sql)) {
    for (let index = range.start; index < range.end; index += 1) {
      chars[index] = ' ';
    }
  }
  return chars.join('');
}

function inferSelectColumns(
  selectClause: string,
  sourceColumns: ReadonlyMap<string, TsColumn>,
): ReadonlyMap<string, TsColumn> {
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
        logicalType: directColumn.logicalType,
        plainTsType: directColumn.plainTsType,
      };
    }
  }

  const lowerExpression = expression.trim().toLowerCase();
  if (lowerExpression.startsWith('substr(')) {
    const firstArg = splitTopLevelComma(
      expression.slice(expression.indexOf('(') + 1, expression.lastIndexOf(')')),
    )[0]?.trim();
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

function hasJsonFields(fields: GeneratedField[]): boolean {
  return fields.some((field) => field.logicalType === 'json');
}

function hasPlainTsTypes(fields: GeneratedField[]): boolean {
  return fields.some(
    (field) =>
      Boolean(field.plainTsType) ||
      (field.objectFields ? hasPlainTsTypes(field.objectFields) : false) ||
      (field.driverObjectFields ? hasPlainTsTypes(field.driverObjectFields) : false),
  );
}

function jsonDecodedRowExpression(rowExpression: string, fields: GeneratedField[], resultTypeRef: string): string {
  const jsonFields = fields.filter((field) => field.logicalType === 'json');
  if (jsonFields.length === 0) {
    return rowExpression;
  }
  const decodedFields = jsonFields
    .map((field) => {
      const parsedValue = `JSON.parse(${rowExpression}.${field.name})`;
      const value =
        field.tsType === 'unknown'
          ? parsedValue
          : `(${parsedValue} as ${resultTypeRef}[${JSON.stringify(field.name)}])`;
      return `${field.name}: ${value}`;
    })
    .join(', ');
  return `({...${rowExpression}, ${decodedFields}})`;
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

// Side-effect registration: install real sqlite typegen impls so they're
// baked into every dialect produced by `sqliteDialect()` after this module
// loads. See dialect.ts header for why this lives here. Heavy entries (CLI,
// api/exports, ui/server) all transitively load this module, so the real
// methods are in place before any caller invokes them.
registerSqliteTypegenImpls({
  materializeTypegenSchema: async (_host, input) => {
    const databasePath = await materializeTypegenDatabase(input);
    return {
      dialect: 'sqlite',
      databasePath,
      experimentalJsonTypes: input.experimentalJsonTypes,
      [Symbol.asyncDispose]: async () => {
        // Sqlite leaves the typegen db on disk between runs — the next
        // materialize wipes it. No active disposal needed.
      },
    } satisfies AsyncDisposable & {dialect: string; databasePath: string; experimentalJsonTypes: boolean};
  },
  loadSchemaForTypegen: async (materialized) => {
    const sqliteMaterialized = assertSqliteMaterialized(materialized);
    return loadSchema(sqliteMaterialized.databasePath, {
      experimentalJsonTypes: sqliteMaterialized.experimentalJsonTypes,
    });
  },
  analyzeQueries: async (materialized, queries) =>
    analyzeVendoredTypesqlQueries(assertSqliteMaterialized(materialized).databasePath, queries),
});

function logicalTypeForDeclaredSqliteType(columnType: string, options: LoadSchemaOptions): LogicalType | undefined {
  if (!options.experimentalJsonTypes) {
    return undefined;
  }
  return normalizeDeclaredType(columnType) === 'json' ? 'json' : undefined;
}

function normalizeDeclaredType(columnType: string): string {
  return columnType.trim().toLowerCase();
}

function requireString(value: unknown, location: string): string {
  if (typeof value === 'string') {
    return value;
  }
  throw new Error(`${location} must be a string.`);
}

function normalizePlainTsType(value: string, location: string): string {
  const lines = value.replaceAll('\r\n', '\n').trim().split('\n');
  const nonBlankTailLines = lines.slice(1).filter((line) => line.trim());
  const commonIndent =
    nonBlankTailLines.length > 0
      ? Math.min(...nonBlankTailLines.map((line) => line.match(/^\s*/)?.[0].length || 0))
      : 0;
  const normalized = [
    lines[0]!.trimEnd(),
    ...lines.slice(1).map((line) => {
      if (!line.trim()) {
        return '';
      }
      return line.slice(Math.min(commonIndent, line.match(/^\s*/)?.[0].length || 0)).trimEnd();
    }),
  ]
    .join('\n')
    .trim();

  if (normalized) {
    return normalized;
  }
  throw new Error(`${location} must be a non-empty TypeScript type string.`);
}
