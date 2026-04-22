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
import type {Client, SqlfuProjectConfig, SqlfuValidator} from '../core/types.js';
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
      const wrapperPath = path.join(generatedDir, `${queryFile.relativePath}.sql.ts`);
      await fs.mkdir(path.dirname(wrapperPath), {recursive: true});

      const analysis = queryAnalyses.find((query) => query.sqlPath === queryFile.sqlPath);
      if (!analysis) {
        throw new Error(`Missing vendored TypeSQL analysis for ${queryFile.sqlPath}`);
      }

      if (!analysis.ok) {
        await fs.writeFile(wrapperPath, `//Invalid SQL\nexport {};\n`);
        return;
      }

      // DDL / connection-control statements (create/drop/alter/pragma/vacuum/begin/...) get a
      // trivial wrapper that just runs the SQL — no params, no result columns. The vendored
      // typesql analyzer tags these as `queryType: 'Ddl'`; see the divergence note in
      // src/vendor/typesql/CLAUDE.md.
      if (analysis.descriptor.queryType === 'Ddl') {
        await fs.writeFile(
          wrapperPath,
          renderDdlWrapper({
            relativePath: queryFile.relativePath,
            sql: queryFile.sqlContent,
            sync: config.generate.sync,
          }),
        );
        return;
      }

      const contents = renderQueryWrapper({
        relativePath: queryFile.relativePath,
        descriptor: refineDescriptor(analysis.descriptor, queryFile.sqlContent, schema),
        validator: config.generate.validator,
        prettyErrors: config.generate.prettyErrors,
        sync: config.generate.sync,
      });
      await fs.writeFile(wrapperPath, contents);
    }),
  );

  await writeTablesFile(generatedDir, schema);
  await writeGeneratedBarrel(generatedDir, queryFiles, config.generate.importExtension);
  await writeQueryCatalog(config, queryFiles, queryAnalyses, schema);
  if (config.migrations) {
    await writeMigrationsBundle(config);
  }
}

function renderDdlWrapper(input: {relativePath: string; sql: string; sync: boolean}): string {
  const queryName = input.relativePath;
  const functionName = toCamelCase(queryName);
  const clientType = input.sync ? 'SyncClient' : 'Client';
  const maybeAsync = input.sync ? '' : 'async ';

  return [
    `import type {${clientType}} from 'sqlfu';`,
    ``,
    ...renderSqlConstant(input.sql),
    `const query = { sql, args: [], name: ${JSON.stringify(queryName)} };`,
    ``,
    `export const ${functionName} = Object.assign(`,
    `\t${maybeAsync}function ${functionName}(client: ${clientType}) {`,
    `\t\treturn client.run(query);`,
    `\t},`,
    `\t{ sql, query },`,
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
function renderSqlConstant(sql: string): string[] {
  const trimmed = normalizeSqlForTemplate(sql).join('\n').trim();
  const oneLiner = `const sql = \`${trimmed}\`;`;
  if (!trimmed.includes('\n') && oneLiner.length <= 80) {
    return [oneLiner];
  }
  return [
    `const sql = \``,
    trimmed,
    `\`.trim();`,
  ];
}

export async function analyzeAdHocSqlForConfig(config: SqlfuProjectConfig, sql: string): Promise<AdHocQueryAnalysis> {
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
  client: Client;
  [Symbol.asyncDispose](): Promise<void>;
};

type TsColumn = {
  name: string;
  tsType: string;
  notNull: boolean;
};

type RelationInfo = {
  kind: 'table' | 'view';
  name: string;
  columns: ReadonlyMap<string, TsColumn>;
  sql?: string;
};

type GeneratedField = {
  name: string;
  tsType: string;
  notNull: boolean;
  optional?: boolean;
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

type QueryFile = {
  /** absolute path to the .sql source file. */
  sqlPath: string;
  /** path without `.sql`, relative to `config.queries`, forward slashes. E.g. `"users/list-profiles"`. */
  relativePath: string;
  sqlContent: string;
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
    const {Database} = await import('bun:sqlite' as any);
    const database = new Database(dbPath);
    return {
      client: createBunClient(database as Parameters<typeof createBunClient>[0]),
      async [Symbol.asyncDispose]() {
        database.close();
      },
    };
  }

  // `node:sqlite` landed in Node 22. On Node 20 we fall back to better-sqlite3, which is already
  // used by the vendored typesql analyzer and works across every Node version sqlfu supports.
  // The fallback keeps `sqlfu generate` working for users (and our own build job) before they
  // upgrade to Node 22.
  try {
    const {DatabaseSync} = await import('node:sqlite');
    const database = new DatabaseSync(dbPath);
    return {
      client: createNodeSqliteClient(database as Parameters<typeof createNodeSqliteClient>[0]),
      async [Symbol.asyncDispose]() {
        database.close();
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ERR_UNKNOWN_BUILTIN_MODULE') throw error;
    const {default: BetterSqlite3} = (await import('better-sqlite3' as any)) as {
      default: new (path: string) => unknown;
    };
    const {createBetterSqlite3Client} = await import('../adapters/better-sqlite3.js');
    const database = new BetterSqlite3(dbPath) as Parameters<typeof createBetterSqlite3Client>[0] & {close(): void};
    return {
      client: createBetterSqlite3Client(database),
      async [Symbol.asyncDispose]() {
        database.close();
      },
    };
  }
}

async function loadQueryFiles(queriesDir: string): Promise<QueryFile[]> {
  const files: QueryFile[] = [];

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
  queryFiles: QueryFile[],
  importExtension: '.js' | '.ts',
): Promise<void> {
  const lines = [
    `export * from "./tables${importExtension}";`,
    ...queryFiles
      .map((queryFile) => queryFile.relativePath)
      .sort((left, right) => left.localeCompare(right))
      .map((relativePath) => `export * from "./${relativePath}.sql${importExtension}";`),
  ];
  await fs.writeFile(path.join(generatedDir, 'index.ts'), lines.join('\n') + '\n');
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
  generatedDir: string,
  schema: ReadonlyMap<string, RelationInfo>,
): Promise<void> {
  const relations = Array.from(schema.values()).sort((left, right) => left.name.localeCompare(right.name));

  const blocks = relations.map((relation) => {
    const typeName = `${relationTypeName(relation.name)}Row`;
    const fieldLines: string[] = [];
    for (const column of relation.columns.values()) {
      const suffix = column.notNull ? '' : ' | null';
      fieldLines.push(`\t${column.name}: ${column.tsType}${suffix};`);
    }
    return [`export type ${typeName} = {`, ...fieldLines, `};`].join('\n');
  });

  const header = [
    `// Generated by \`sqlfu generate\`. Do not edit.`,
    `// Row types for every table and view in your project's schema.`,
    ``,
  ];
  const body = blocks.length === 0 ? [`export {};`] : blocks.flatMap((block, index) => (index === 0 ? [block] : ['', block]));

  await fs.writeFile(path.join(generatedDir, 'tables.ts'), [...header, ...body, ``].join('\n'));
}

function relationTypeName(relationName: string): string {
  return relationName
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
}

async function writeMigrationsBundle(config: SqlfuProjectConfig): Promise<void> {
  if (!config.migrations) return;
  const migrationsDir = config.migrations;

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
    `// Pair with \`migrationsFromBundle\` + \`applyMigrations\` from 'sqlfu'.`,
    ``,
    `const bundle = {`,
    ...entries.map((entry) => `  ${JSON.stringify(entry.key)}: ${JSON.stringify(entry.content)},`),
    `};`,
    ``,
    `export default bundle;`,
    ``,
    `export type MigrationBundle = typeof bundle;`,
    ``,
  ];
  await fs.writeFile(path.join(bundleDir, 'migrations.ts'), bundleLines.join('\n'));
}

async function writeQueryCatalog(
  config: SqlfuProjectConfig,
  queryFiles: QueryFile[],
  queryAnalyses: Awaited<ReturnType<typeof analyzeVendoredTypesqlQueries>>,
  schema: ReadonlyMap<string, RelationInfo>,
): Promise<void> {
  // DDL statements (e.g. `create table if not exists`) get trivial wrappers but have no
  // params / result columns / json schema — nothing to populate a form with. Leaving them out
  // of the catalog keeps UI consumers from rendering a meaningless "run" button for each one.
  const entries: QueryCatalogEntry[] = queryFiles.flatMap<QueryCatalogEntry>((queryFile) => {
    const analysis = queryAnalyses.find((query) => query.sqlPath === queryFile.sqlPath);
    if (!analysis) {
      throw new Error(`Missing vendored TypeSQL analysis for ${queryFile.sqlPath}`);
    }

    const functionName = toCamelCase(queryFile.relativePath);
    const id = queryFile.relativePath;
    const sqlFile = path.relative(config.projectRoot, queryFile.sqlPath).split(path.sep).join('/');

    if (!analysis.ok) {
      const errorEntry: QueryCatalogEntry = {
        kind: 'error',
        id,
        sqlFile,
        functionName,
        sql: queryFile.sqlContent,
        sqlFileContent: queryFile.sqlContent,
        error: analysis.error,
      };
      return [errorEntry];
    }

    if (analysis.descriptor.queryType === 'Ddl') {
      return [];
    }

    const descriptor = refineDescriptor(analysis.descriptor, queryFile.sqlContent, schema);
    const columns = getResultFields(descriptor).map((field) => toCatalogField(field));
    const args = [
      ...(descriptor.data ?? []).map((field) => toCatalogArgument('data', field)),
      ...descriptor.parameters.map((field) => toCatalogArgument('params', field)),
    ];

    const queryEntry: QueryCatalogEntry = {
      kind: 'query',
      id,
      sqlFile,
      functionName,
      sql: descriptor.sql,
      sqlFileContent: queryFile.sqlContent,
      queryType: descriptor.queryType as Exclude<GeneratedQueryDescriptor['queryType'], 'Ddl'>,
      multipleRowsResult: descriptor.multipleRowsResult,
      resultMode: getResultMode(descriptor),
      args,
      dataSchema: descriptor.data?.length ? objectSchema(`${functionName} data`, descriptor.data) : undefined,
      paramsSchema: descriptor.parameters.length
        ? objectSchema(`${functionName} params`, descriptor.parameters)
        : undefined,
      resultSchema: objectSchema(`${functionName} result`, getResultFields(descriptor), {fieldKind: 'result'}),
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
  validator: SqlfuValidator | null;
  prettyErrors: boolean;
  sync: boolean;
}): string {
  if (input.validator !== null) {
    return renderValidatorQueryWrapper({
      relativePath: input.relativePath,
      descriptor: input.descriptor,
      emitter: getValidatorEmitter(input.validator),
      prettyErrors: input.prettyErrors,
      sync: input.sync,
    });
  }

  const queryName = input.relativePath;
  const functionName = toCamelCase(queryName);

  const clientType = input.sync ? 'SyncClient' : 'Client';
  const maybeAsync = input.sync ? '' : 'async ';
  const hasData = (input.descriptor.data?.length ?? 0) > 0;
  const hasParams = input.descriptor.parameters.length > 0;
  const resultMode = getResultMode(input.descriptor);
  // SELECT-like results (a row type users hand-wrote in their select list) get a named
  // Result type + reified shape. Non-SELECT without RETURNING (metadata mode) just passes
  // client.run's return through — the caller sees QueryMetadata directly. No Result type,
  // no guards, no reshape.
  const emitResultType = resultMode !== 'metadata';
  const dataTypeRef = `${functionName}.Data`;
  const paramsTypeRef = `${functionName}.Params`;
  const resultTypeRef = `${functionName}.Result`;

  const queryArgs = buildQueryArgs(input.descriptor);

  const functionSignatureArgs: string[] = [`client: ${clientType}`];
  if (hasData) functionSignatureArgs.push(`data: ${dataTypeRef}`);
  if (hasParams) functionSignatureArgs.push(`params: ${paramsTypeRef}`);

  const factoryArgs: string[] = [];
  if (hasData) factoryArgs.push(`data: ${dataTypeRef}`);
  if (hasParams) factoryArgs.push(`params: ${paramsTypeRef}`);
  const queryReference = buildQueryReference(hasData, hasParams, 'data', 'params');
  const queryDeclaration = renderQueryDeclaration({
    factoryArgs,
    queryArgs,
    queryName,
  });

  const signatureReturnAnnotation = emitResultType
    ? input.sync
      ? `: ${getReturnType(input.descriptor, resultTypeRef)}`
      : `: Promise<${getReturnType(input.descriptor, resultTypeRef)}>`
    : '';
  const functionDeclaration = `\t${maybeAsync}function ${functionName}(${functionSignatureArgs.join(', ')})${signatureReturnAnnotation} {`;

  const namespaceLines: string[] = [];
  if (hasData) {
    namespaceLines.push(`\texport type Data = ${renderObjectTypeBody(input.descriptor.data!, 'parameter')};`);
  }
  if (hasParams) {
    namespaceLines.push(`\texport type Params = ${renderObjectTypeBody(input.descriptor.parameters, 'parameter')};`);
  }
  if (emitResultType) {
    namespaceLines.push(`\texport type Result = ${renderObjectTypeBody(getResultFields(input.descriptor), 'result')};`);
  }

  const implementationLines = emitResultType
    ? buildGeneratedImplementation({
        resultMode,
        resultType: resultTypeRef,
        queryReference,
        sync: input.sync,
        indent: '\t\t',
      })
    : [`\t\treturn client.run(${queryReference});`];

  return [
    `import type {${clientType}} from 'sqlfu';`,
    ``,
    ...renderSqlConstant(input.descriptor.sql),
    queryDeclaration,
    ``,
    `export const ${functionName} = Object.assign(`,
    functionDeclaration,
    ...implementationLines,
    `\t},`,
    `\t{ sql, query },`,
    `);`,
    ``,
    ...(namespaceLines.length === 0
      ? []
      : [`export namespace ${functionName} {`, ...namespaceLines, `}`, ``]),
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
}): string {
  const payload = `{ sql, args: ${input.queryArgs}, name: ${JSON.stringify(input.queryName)} }`;
  if (input.factoryArgs.length === 0) {
    return `const query = ${payload};`;
  }
  return `const query = (${input.factoryArgs.join(', ')}) => (${payload});`;
}

/** `query` for object form, `query(data, params)` / `query(params)` / `query(data)` for factories. */
function buildQueryReference(
  hasData: boolean,
  hasParams: boolean,
  dataVar: string,
  paramsVar: string,
): string {
  if (!hasData && !hasParams) return 'query';
  const callArgs: string[] = [];
  if (hasData) callArgs.push(dataVar);
  if (hasParams) callArgs.push(paramsVar);
  return `query(${callArgs.join(', ')})`;
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
  expressionForTsType: (tsType: string) => string,
  nullable: (expression: string) => string,
  optional: (expression: string) => string,
): (field: GeneratedField, fieldKind: 'parameter' | 'result') => string {
  return (field, fieldKind) => {
    let expression = expressionForTsType(field.tsType);
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
    (tsType) => zodExpressionForTsType(tsType, 'z'),
    (expression) => `${expression}.nullable()`,
    (expression) => `${expression}.optional()`,
  ),
  objectSchemaDeclaration: ({schemaName, fieldLines}) => [
    `const ${schemaName} = z.object({`,
    ...fieldLines,
    `});`,
  ],
  inferExpression: (schemaName) => `z.infer<typeof ${schemaName}>`,
};

const zodMiniEmitter: ValidatorEmitter = {
  importLine: `import * as z from 'zod/mini';`,
  parseFlavour: 'standard',
  // zod-mini keeps the same nullable/optional wrapper calls as standard zod — the same schema
  // object, a smaller bundle path.
  renderFieldLine: valueWrappedFieldLine(
    (tsType) => zodExpressionForTsType(tsType, 'z'),
    (expression) => `z.nullable(${expression})`,
    (expression) => `z.optional(${expression})`,
  ),
  objectSchemaDeclaration: ({schemaName, fieldLines}) => [
    `const ${schemaName} = z.object({`,
    ...fieldLines,
    `});`,
  ],
  inferExpression: (schemaName) => `z.infer<typeof ${schemaName}>`,
};

const valibotEmitter: ValidatorEmitter = {
  importLine: `import * as v from 'valibot';`,
  parseFlavour: 'standard',
  renderFieldLine: valueWrappedFieldLine(
    (tsType) => valibotExpressionForTsType(tsType),
    (expression) => `v.nullable(${expression})`,
    (expression) => `v.optional(${expression})`,
  ),
  objectSchemaDeclaration: ({schemaName, fieldLines}) => [
    `const ${schemaName} = v.object({`,
    ...fieldLines,
    `});`,
  ],
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
    const keyText = keySuffix
      ? JSON.stringify(`${field.name}${keySuffix}`)
      : field.name;
    return `\t${keyText}: ${arktypeFieldExpression(field.tsType, field.notNull)},`;
  },
  objectSchemaDeclaration: ({schemaName, fieldLines}) => [
    `const ${schemaName} = type({`,
    ...fieldLines,
    `});`,
  ],
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
function arktypeFieldExpression(tsType: string, notNull: boolean): string {
  const baseExpression = arktypeBaseExpression(tsType);
  if (notNull) return baseExpression;

  // Nullable: for the string form we widen the union; for the escape-hatch form
  // (`type.instanceOf(...)`) we fall back to the Type-value form with a union.
  if (baseExpression.startsWith('"') && baseExpression.endsWith('"')) {
    const innerDefinition = baseExpression.slice(1, -1);
    return JSON.stringify(`${innerDefinition} | null`);
  }
  return `type(${baseExpression}, '|', 'null')`;
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
  relativePath: string;
  descriptor: GeneratedQueryDescriptor;
  emitter: ValidatorEmitter;
  prettyErrors: boolean;
  sync: boolean;
}): string {
  const queryName = input.relativePath;
  const functionName = toCamelCase(queryName);
  const {descriptor, emitter, prettyErrors, sync} = input;
  const clientType = sync ? 'SyncClient' : 'Client';
  const resultMode = getResultMode(descriptor);
  const resultFields = getResultFields(descriptor);
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
    schemaDeclarations.push(...renderObjectSchemaDeclaration(emitter, 'Data', descriptor.data!, 'parameter'));
  }
  if (hasParams) {
    schemaDeclarations.push(...renderObjectSchemaDeclaration(emitter, 'Params', descriptor.parameters, 'parameter'));
  }
  if (emitResultSchema) {
    schemaDeclarations.push(...renderObjectSchemaDeclaration(emitter, 'Result', resultFields, 'result'));
  }

  const sqlLines = renderSqlConstant(descriptor.sql);

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
    const dataValidation = buildInputValidation(emitter, 'Data', 'data', prettyErrors);
    validationLines.push(...dataValidation.statements);
    dataExpression = dataValidation.expression;
  }
  if (hasParams) {
    const paramsValidation = buildInputValidation(emitter, 'Params', 'params', prettyErrors);
    validationLines.push(...paramsValidation.statements);
    paramsExpression = paramsValidation.expression;
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
  const queryDeclaration = renderQueryDeclaration({
    factoryArgs,
    queryArgs: factoryArgsExpression,
    queryName,
  });
  const queryReference = buildQueryReference(hasData, hasParams, dataExpression!, paramsExpression!);

  const implementationLines = emitResultSchema
    ? buildValidatorImplementation({
        resultMode,
        resultFields,
        emitter,
        prettyErrors,
        queryReference,
        sync,
      })
    : [`\t\treturn client.run(${queryReference});`];

  const attachedProperties: string[] = [];
  if (hasData) attachedProperties.push('Data');
  if (hasParams) attachedProperties.push('Params');
  if (emitResultSchema) attachedProperties.push('Result');
  attachedProperties.push('sql', 'query');

  const namespaceLines: string[] = [];
  if (hasData) {
    namespaceLines.push(`\texport type Data = ${emitter.inferExpression(`${functionName}.Data`)};`);
  }
  if (hasParams) {
    namespaceLines.push(`\texport type Params = ${emitter.inferExpression(`${functionName}.Params`)};`);
  }
  if (emitResultSchema) {
    namespaceLines.push(`\texport type Result = ${emitter.inferExpression(`${functionName}.Result`)};`);
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
    ``,
    `export const ${functionName} = Object.assign(`,
    functionDeclaration,
    ...validationLines,
    ...implementationLines,
    `\t},`,
    `\t{ ${attachedProperties.join(', ')} },`,
    `);`,
    ``,
    ...(namespaceLines.length === 0
      ? []
      : [`export namespace ${functionName} {`, ...namespaceLines, `}`, ``]),
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

function renderObjectSchemaDeclaration(
  emitter: ValidatorEmitter,
  schemaName: 'Data' | 'Params' | 'Result',
  fields: GeneratedField[],
  fieldKind: 'parameter' | 'result',
): string[] {
  // see tasks/typegen-extensibility.md — future user-provided validator plugins and per-column overrides would hook in here.
  const fieldLines = fields.map((field) => emitter.renderFieldLine(field, fieldKind));
  return emitter.objectSchemaDeclaration({schemaName, fieldLines});
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
  schemaName: 'Data' | 'Params',
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
  rowExpression: string,
  prettyErrors: boolean,
): string | null {
  if (emitter.parseFlavour === 'zod' && !prettyErrors) {
    return `Result.parse(${rowExpression})`;
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
  rowExpression: string,
  prettyErrors: boolean,
  indent: string,
): string[] {
  if (emitter.parseFlavour === 'zod') {
    // zod + pretty.
    return [
      `${indent}const parsed = Result.safeParse(${rowExpression});`,
      `${indent}if (!parsed.success) throw new Error(z.prettifyError(parsed.error));`,
      `${indent}return parsed.data;`,
    ];
  }
  // Standard Schema — same inline 3-step guard as for params, flipped to prettyErrors.
  return [
    `${indent}const parsed = Result['~standard'].validate(${rowExpression});`,
    `${indent}if ('then' in parsed) throw new Error('Unexpected async validation from Result.');`,
    prettyErrors
      ? `${indent}if ('issues' in parsed) throw new Error(prettifyStandardSchemaError(parsed) || 'Validation failed');`
      : `${indent}if ('issues' in parsed) throw Object.assign(new Error('Validation failed'), {issues: parsed.issues});`,
    `${indent}return parsed.value;`,
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
  resultFields: GeneratedField[];
  emitter: ValidatorEmitter;
  prettyErrors: boolean;
  queryReference: string;
  sync: boolean;
}): string[] {
  const {emitter, prettyErrors, queryReference, sync} = input;
  const maybeAwait = sync ? '' : 'await ';
  const q = queryReference;
  const rowExpr = (rowExpression: string) => rowParseExpressionOrNull(emitter, rowExpression, prettyErrors);
  const rowBlock = (rowExpression: string, indent: string) =>
    rowParseStatements(emitter, rowExpression, prettyErrors, indent);

  if (input.resultMode === 'many') {
    const expr = rowExpr('row');
    if (expr) {
      return [
        `\t\tconst rows = ${maybeAwait}client.all(${q});`,
        `\t\treturn rows.map((row) => ${expr});`,
      ];
    }
    return [
      `\t\tconst rows = ${maybeAwait}client.all(${q});`,
      `\t\treturn rows.map((row) => {`,
      ...rowBlock('row', '\t\t\t'),
      `\t\t});`,
    ];
  }

  if (input.resultMode === 'nullableOne') {
    const expr = rowExpr('rows[0]');
    if (expr) {
      return [
        `\t\tconst rows = ${maybeAwait}client.all(${q});`,
        `\t\treturn rows.length > 0 ? ${expr} : null;`,
      ];
    }
    return [
      `\t\tconst rows = ${maybeAwait}client.all(${q});`,
      `\t\tif (rows.length === 0) return null;`,
      ...rowBlock('rows[0]', '\t\t'),
    ];
  }

  if (input.resultMode === 'one') {
    const expr = rowExpr('rows[0]');
    if (expr) {
      return [
        `\t\tconst rows = ${maybeAwait}client.all(${q});`,
        `\t\treturn ${expr};`,
      ];
    }
    return [
      `\t\tconst rows = ${maybeAwait}client.all(${q});`,
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

  return [
    `\t\tconst result = ${maybeAwait}client.run(${q});`,
    ...guards,
    ...rawResultLines,
    ...resultReturnLines,
  ];
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
function renderObjectTypeBody(
  fields: GeneratedField[],
  fieldKind: 'parameter' | 'result',
): string {
  const lines = fields.map((field) => {
    const optional = fieldKind === 'parameter' ? Boolean(field.optional) : !field.notNull;
    const orNull = fieldKind === 'parameter' && !field.notNull ? ' | null' : '';
    return `\t\t${field.name}${optional ? '?' : ''}: ${field.tsType}${orNull};`;
  });
  return [`{`, ...lines, `\t}`].join('\n');
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
  tsType: string;
  toDriver: string;
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
  variableName: string,
  param: GeneratedField & {
    toDriver: string;
    isArray: boolean;
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

function toCamelCase(value: string): string {
  const parts = value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
  if (parts.length === 0) {
    return '';
  }
  return (
    parts[0]! +
    parts
      .slice(1)
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join('')
  );
}

/**
 * SELECT-like bodies only (`many` / `nullableOne` / `one` — i.e. every mode except `metadata`).
 * Metadata mode is rendered as a plain `return client.run(query);` pass-through at the call site.
 */
function buildGeneratedImplementation(input: {
  resultMode: 'many' | 'nullableOne' | 'one';
  resultType: string;
  queryReference: string;
  sync: boolean;
  indent: string;
}): string[] {
  const maybeAwait = input.sync ? '' : 'await ';
  const i = input.indent;
  const q = input.queryReference;

  if (input.resultMode === 'many') {
    // `many` returns the client's result directly — the outer function's Promise<T[]> / T[] return
    // type already matches client.all's return type, so there's no need to await and re-wrap.
    return [`${i}return client.all<${input.resultType}>(${q});`];
  }

  if (input.resultMode === 'nullableOne') {
    return [
      `${i}const rows = ${maybeAwait}client.all<${input.resultType}>(${q});`,
      `${i}return rows.length > 0 ? rows[0] : null;`,
    ];
  }

  return [`${i}const rows = ${maybeAwait}client.all<${input.resultType}>(${q});`, `${i}return rows[0];`];
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
  } finally {
  }
}

async function loadRelationColumns(client: Client, relationName: string): Promise<ReadonlyMap<string, TsColumn>> {
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
