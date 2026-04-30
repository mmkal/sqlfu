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
import {loadProjectConfig} from '../node/config.js';
import {createNodeHost} from '../node/host.js';
import type {Client, SqlfuProjectConfig, SqlfuValidator} from '../types.js';
import type {SqlfuHost} from '../host.js';
import {excludeReservedSqliteObjects, extractSchema} from '../sqlite-text.js';
import {createBunClient, createNodeSqliteClient} from '../index.js';
import {migrationName, readMigrationHistory, type Migration} from '../migrations/index.js';
import {presetTableName} from '../migrations/preset-queries.js';
import {materializeDefinitionsSchemaFor, readMigrationFiles} from '../materialize.js';

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

export async function generateQueryTypesForConfig(config: SqlfuProjectConfig, host: SqlfuHost): Promise<void> {
  const databasePath = await materializeTypegenDatabase(config, host);
  const schema = await loadSchema(databasePath);
  const queryDocuments = await loadQueryDocuments(config.queries);
  const querySources = queryDocuments.flatMap((queryDocument) => queryDocument.queries);
  assertUniqueQueryFunctionNames(querySources);

  const queryAnalyses = await analyzeVendoredTypesqlQueries(
    databasePath,
    querySources.map((query) => ({
      sqlPath: query.sqlPath,
      sqlContent: query.analysisSqlContent,
    })),
  );

  const generatedDir = path.join(config.queries, '.generated');
  await fs.mkdir(generatedDir, {recursive: true});

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
      });
      await fs.writeFile(wrapperPath, contents);
    }),
  );

  await writeTablesFile(generatedDir, schema);
  await writeGeneratedQueriesFile(generatedDir, queryDocuments, config.generate.importExtension);
  await writeGeneratedBarrel(generatedDir, config.generate.importExtension);
  await writeQueryCatalog(config, querySources, queryAnalyses, schema);
  if (config.migrations) {
    await writeMigrationsBundle(config);
  }
}

function renderQueryDocument(input: {
  queryDocument: QueryDocument;
  queryAnalyses: Awaited<ReturnType<typeof analyzeVendoredTypesqlQueries>>;
  schema: ReadonlyMap<string, RelationInfo>;
  validator: SqlfuValidator | null;
  prettyErrors: boolean;
  sync: boolean;
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
};

function renderDdlWrapper(input: {
  functionName: string;
  sql: string;
  sync: boolean;
  localNames?: LocalNames;
}): string {
  const functionName = input.functionName;
  const sqlName = input.localNames?.sql || 'sql';
  const queryName = input.localNames?.query || 'query';
  const clientType = input.sync ? 'SyncClient' : 'Client';
  const maybeAsync = input.sync ? '' : 'async ';

  return [
    `import type {${clientType}} from 'sqlfu';`,
    ``,
    ...renderSqlConstant(input.sql, sqlName),
    `const ${queryName} = { ${objectProperty('sql', sqlName)}, args: [], name: ${JSON.stringify(functionName)} };`,
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
  return [
    `const ${variableName} = \``,
    trimmed,
    `\`.trim();`,
  ];
}

export async function analyzeAdHocSqlForConfig(
  config: SqlfuProjectConfig,
  host: SqlfuHost,
  sql: string,
): Promise<AdHocQueryAnalysis> {
  const databasePath = await materializeTypegenDatabase(config, host);
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

type ParameterExpansion =
  | {
      kind: 'scalar-array';
      name: string;
    }
  | {
      kind: 'object-fields';
      name: string;
      fields: string[];
      driverFields: string[];
    }
  | {
      kind: 'object-array';
      name: string;
      fields: string[];
      sqlShape: 'values' | 'row-list';
      acceptsSingleOrArray: boolean;
    };

async function materializeTypegenDatabase(config: SqlfuProjectConfig, host: SqlfuHost) {
  const tempDbPath = path.join(config.projectRoot, '.sqlfu', 'typegen.db');
  const schemaSql = await readSchemaForAuthority(config, host);

  await fs.mkdir(path.dirname(tempDbPath), {recursive: true});
  await fs.rm(tempDbPath, {force: true});
  await fs.rm(`${tempDbPath}-shm`, {force: true});
  await fs.rm(`${tempDbPath}-wal`, {force: true});

  await using typegenDatabase = await openMainDevDatabase(tempDbPath);
  await typegenDatabase.client.raw(schemaSql);

  return tempDbPath;
}

async function readSchemaForAuthority(config: SqlfuProjectConfig, host: SqlfuHost): Promise<string> {
  const authority = config.generate.authority;
  switch (authority) {
    case 'desired_schema':
      return readDefinitionsAsSchemaSql(config, host);
    case 'migrations':
      return replayMigrationFilesAsSchemaSql(config, host);
    case 'migration_history':
      return replayMigrationHistoryAsSchemaSql(config, host);
    case 'live_schema':
      return readLiveSchema(config);
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
  return materializeDefinitionsSchemaFor(host, definitionsSql);
}

async function replayMigrationFilesAsSchemaSql(config: SqlfuProjectConfig, host: SqlfuHost): Promise<string> {
  if (!config.migrations) {
    throw new Error(
      "sqlfu generate with authority 'migrations' needs a `migrations` directory configured in sqlfu.config.ts.",
    );
  }
  const migrations = await readMigrationFiles(host, config);
  // Concatenate into one SQL blob and replay raw. Going through `materializeMigrationsSchemaFor`
  // would apply through `applyMigrations`, which creates the `sqlfu_migrations` bookkeeping
  // table — noise for typegen, which wants the user's schema reflected as-is.
  return materializeDefinitionsSchemaFor(host, migrations.map((migration) => migration.content).join('\n'));
}

async function replayMigrationHistoryAsSchemaSql(config: SqlfuProjectConfig, host: SqlfuHost): Promise<string> {
  if (!config.migrations) {
    throw new Error(
      "sqlfu generate with authority 'migration_history' needs a `migrations` directory configured in sqlfu.config.ts.",
    );
  }
  await using live = await openLiveDb(config.db, 'migration_history');
  const history = await Promise.resolve(readMigrationHistory(live.client, {preset: config.migrations.preset}));

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

  return materializeDefinitionsSchemaFor(host, matched.map((migration) => migration.content).join('\n'));
}

async function readLiveSchema(config: SqlfuProjectConfig): Promise<string> {
  await using source = await openLiveDb(config.db, 'live_schema');
  // Exclude the preset's bookkeeping table from the live schema — it's noise, not something
  // the user wrote. The other authorities replay raw SQL into an empty scratch DB so no
  // bookkeeping is created in the first place. Without a `migrations` block there's no
  // bookkeeping in play; default to sqlfu's table name so we still strip it if present.
  const excludedTable = presetTableName(config.migrations?.preset ?? 'sqlfu');
  return extractSchema(source.client, 'main', {excludedTables: [excludedTable]});
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
        functionName: toCamelCase(queryFile.relativePath),
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

function prepareSqlForAnalysis(sql: string, parameterExpansions: ParameterExpansion[]): string {
  return stripSqlComments(applyParameterExpansionsForAnalysis(sql, parameterExpansions));
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
  const candidate = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(rawName) ? rawName : toCamelCase(rawName);
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(candidate)) {
    throw new Error(`Query annotation @name ${rawName} does not produce a valid TypeScript identifier`);
  }
  return candidate;
}

function hasExecutableSql(sql: string): boolean {
  return stripSqlComments(sql).trim().length > 0;
}

function stripSqlComments(sql: string): string {
  const chars = sql.split('');
  for (const comment of findSqlIgnoredRanges(sql).filter((range) => range.kind !== 'string')) {
    for (let index = comment.start; index < comment.end; index += 1) {
      if (chars[index] !== '\n' && chars[index] !== '\r') {
        chars[index] = ' ';
      }
    }
  }
  return chars.join('');
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

function applyParameterExpansionsForAnalysis(sql: string, expansions: ParameterExpansion[]): string {
  if (expansions.length === 0) return sql;
  sql = rewriteRowListExpansionsForAnalysis(sql, expansions);
  const expansionMap = new Map(expansions.map((expansion) => [expansion.name, expansion]));
  return replaceNamedParameters(sql, (reference) => {
    if (reference.path.length > 0) {
      return `:${expandedFieldName(reference.name, reference.path[0]!)}`;
    }

    const expansion = expansionMap.get(reference.name);
    if (!expansion) return reference.raw;

    if (expansion.kind === 'scalar-array') {
      const placeholder = `:${reference.name}`;
      return reference.wrappedInParens ? placeholder : `(${placeholder})`;
    }

    if (expansion.kind === 'object-fields') {
      return reference.raw;
    }

    const replacement = expansion.fields.map((field) => `:${expandedFieldName(expansion.name, field)}`).join(', ');
    if (reference.wrappedInParens) return replacement;
    return `(${replacement})`;
  });
}

function rewriteRowListExpansionsForAnalysis(sql: string, expansions: ParameterExpansion[]): string {
  let output = sql;
  for (const expansion of expansions) {
    if (expansion.kind !== 'object-array' || expansion.sqlShape !== 'row-list') continue;
    const pattern = new RegExp(
      `\\(([^()]+)\\)\\s+(?:not\\s+)?in\\s*\\(\\s*:${expansion.name}\\s*\\)`,
      'gi',
    );
    output = replaceSqlPatternOutsideCommentsAndStrings(output, pattern, (match, [rawFields = '']) => {
      const fields = parseSimpleSqlFieldList(rawFields, 'inferred row IN parameter');
      if (fields.join('\0') !== expansion.fields.join('\0')) return match;
      const predicates = rawFields
        .split(',')
        .map((field) => field.trim())
        .map((field, index) => `${field} = :${expandedFieldName(expansion.name, fields[index]!)}`)
        .join(' and ');
      return `(${predicates})`;
    });
  }
  return output;
}

type NamedParameterReference = {
  raw: string;
  name: string;
  path: string[];
  start: number;
  end: number;
  wrappedInParens: boolean;
};

function replaceNamedParameters(
  sql: string,
  replace: (reference: NamedParameterReference) => string,
): string {
  let output = '';
  let cursor = 0;
  for (const reference of findNamedParameterReferences(sql)) {
    output += sql.slice(cursor, reference.start);
    output += replace(reference);
    cursor = reference.end;
  }
  return output + sql.slice(cursor);
}

function findNamedParameterReferences(sql: string): NamedParameterReference[] {
  const references: NamedParameterReference[] = [];
  let quote: "'" | '"' | '`' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!;
    const next = sql[index + 1];

    if (lineComment) {
      if (char === '\n' || char === '\r') lineComment = false;
      continue;
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (char === quote) {
        if (sql[index + 1] === quote) {
          index += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }

    if (char === '-' && next === '-') {
      lineComment = true;
      index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }

    if (char !== ':') continue;
    if (next === ':') {
      index += 1;
      continue;
    }

    const match = sql.slice(index).match(/^:([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (!match) continue;

    const start = index;
    let cursor = index + match[0]!.length;
    const referencePath: string[] = [];
    while (sql[cursor] === '.') {
      const fieldMatch = sql.slice(cursor).match(/^\.([A-Za-z_$][A-Za-z0-9_$]*)/);
      if (!fieldMatch) break;
      referencePath.push(fieldMatch[1]!);
      cursor += fieldMatch[0]!.length;
    }

    cursor = assertNoParameterModifier(sql, cursor);

    const raw = sql.slice(start, cursor);
    references.push({
      raw,
      name: match[1]!,
      path: referencePath,
      start,
      end: cursor,
      wrappedInParens: isWrappedInParens(sql, start, cursor),
    });
    index = cursor - 1;
  }

  return references;
}

function assertNoParameterModifier(sql: string, index: number): number {
  if (sql[index] !== ':' || sql[index + 1] === ':') return index;

  const match = sql.slice(index).match(/^:([A-Za-z_$][A-Za-z0-9_$]*)/);
  throw new Error(`Unsupported parameter modifier: ${match ? match[0] : sql.slice(index, index + 1)}`);
}

function parseInlineParameterExpansions(sql: string): ParameterExpansion[] {
  const expansions = new Map<string, ParameterExpansion>();
  const references = findNamedParameterReferences(sql);

  for (const expansion of inferInsertValuesParameterExpansions(sql)) {
    addParameterExpansion(expansions, expansion);
  }
  for (const expansion of inferRowInParameterExpansions(sql)) {
    addParameterExpansion(expansions, expansion);
  }

  for (const reference of references) {
    if (reference.path.length > 1) {
      throw new Error(`Nested parameter paths are not supported yet: ${reference.raw}`);
    }

    if (reference.path.length === 1) {
      const fieldName = reference.path[0]!;
      addParameterExpansion(expansions, {
        kind: 'object-fields',
        name: reference.name,
        fields: [fieldName],
        driverFields: [fieldName],
      });
    }
  }

  for (const reference of references) {
    if (reference.path.length > 0) continue;
    const expansion = expansions.get(reference.name);
    if (expansion?.kind === 'object-fields') {
      throw new Error(
        `Parameter ${JSON.stringify(reference.name)} cannot be used both as ${reference.raw} and ${expansion.kind}`,
      );
    }
  }

  return Array.from(expansions.values());
}

function inferInsertValuesParameterExpansions(sql: string): ParameterExpansion[] {
  const expansions: ParameterExpansion[] = [];
  const searchableSql = maskSqlCommentsAndStrings(sql);
  const identifier = `[A-Za-z_$][A-Za-z0-9_$]*`;
  const tableName = `${identifier}(?:\\s*\\.\\s*${identifier})?`;
  const pattern = new RegExp(
    `\\binsert\\s+(?:or\\s+${identifier}\\s+)?into\\s+${tableName}\\s*\\(([^)]*)\\)\\s+values\\s+:(${identifier})\\b`,
    'gi',
  );

  for (const match of searchableSql.matchAll(pattern)) {
    expansions.push({
      kind: 'object-array',
      name: match[2]!,
      fields: parseSimpleSqlFieldList(match[1]!, 'inferred INSERT values parameter'),
      sqlShape: 'values',
      acceptsSingleOrArray: true,
    });
  }
  return expansions;
}

function inferRowInParameterExpansions(sql: string): ParameterExpansion[] {
  const expansions: ParameterExpansion[] = [];
  const searchableSql = maskSqlCommentsAndStrings(sql);
  const pattern = /\(([^()]+)\)\s+(?:not\s+)?in\s*\(\s*:([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/gi;

  for (const match of searchableSql.matchAll(pattern)) {
    const fields = parseSimpleSqlFieldList(match[1]!, 'inferred row IN parameter');
    if (fields.length < 2) continue;
    expansions.push({
      kind: 'object-array',
      name: match[2]!,
      fields,
      sqlShape: 'row-list',
      acceptsSingleOrArray: false,
    });
  }
  return expansions;
}

function parseSimpleSqlFieldList(rawFields: string, syntaxName: string): string[] {
  const fields = rawFields.split(',').map((field) => field.trim()).filter(Boolean);
  if (fields.length === 0) {
    throw new Error(`${syntaxName} needs at least one field`);
  }

  const names = fields.map((field) => {
    const match = field.match(/^(?:(?:[A-Za-z_$][A-Za-z0-9_$]*)\.)?([A-Za-z_$][A-Za-z0-9_$]*)$/);
    if (!match) {
      throw new Error(`${syntaxName} only supports simple column names: ${JSON.stringify(field)}`);
    }
    return match[1]!;
  });

  const duplicate = names.find((field, index) => names.indexOf(field) !== index);
  if (duplicate) {
    throw new Error(`${syntaxName} cannot infer duplicate field ${JSON.stringify(duplicate)}`);
  }
  return names;
}

function addParameterExpansion(expansions: Map<string, ParameterExpansion>, expansion: ParameterExpansion): void {
  const existing = expansions.get(expansion.name);
  if (!existing) {
    expansions.set(expansion.name, expansion);
    return;
  }

  if (existing.kind !== expansion.kind) {
    throw new Error(
      `Parameter ${JSON.stringify(expansion.name)} cannot use both ${existing.kind} and ${expansion.kind}`,
    );
  }

  if (existing.kind === 'object-fields' && expansion.kind === 'object-fields') {
    for (const fieldName of expansion.fields) {
      if (!existing.fields.includes(fieldName)) {
        existing.fields.push(fieldName);
      }
    }
    existing.driverFields.push(...expansion.driverFields);
    return;
  }

  if (existing.kind === 'object-array' && expansion.kind === 'object-array') {
    if (
      existing.fields.join('\0') !== expansion.fields.join('\0') ||
      existing.sqlShape !== expansion.sqlShape ||
      existing.acceptsSingleOrArray !== expansion.acceptsSingleOrArray
    ) {
      throw new Error(`Parameter ${JSON.stringify(expansion.name)} cannot use multiple inferred field sets`);
    }
    return;
  }
}

function isWrappedInParens(sql: string, start: number, end: number): boolean {
  return previousNonWhitespace(sql, start) === '(' && nextNonWhitespace(sql, end) === ')';
}

function previousNonWhitespace(sql: string, index: number): string | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const char = sql[cursor]!;
    if (!/\s/.test(char)) return char;
  }
  return undefined;
}

function nextNonWhitespace(sql: string, index: number): string | undefined {
  for (let cursor = index; cursor < sql.length; cursor += 1) {
    const char = sql[cursor]!;
    if (!/\s/.test(char)) return char;
  }
  return undefined;
}

function expandedFieldName(parameterName: string, fieldName: string): string {
  return `${parameterName}__${fieldName}`;
}

type SqlIgnoredRange = {
  kind: 'line-comment' | 'block-comment' | 'string';
  start: number;
  end: number;
};

function findSqlIgnoredRanges(sql: string): SqlIgnoredRange[] {
  const ranges: SqlIgnoredRange[] = [];
  let quote: "'" | '"' | '`' | null = null;
  let quoteStart = 0;
  let lineCommentStart: number | null = null;
  let blockCommentStart: number | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!;
    const next = sql[index + 1];

    if (lineCommentStart !== null) {
      if (char === '\n' || char === '\r') {
        ranges.push({kind: 'line-comment', start: lineCommentStart, end: index});
        lineCommentStart = null;
      }
      continue;
    }

    if (blockCommentStart !== null) {
      if (char === '*' && next === '/') {
        ranges.push({kind: 'block-comment', start: blockCommentStart, end: index + 2});
        blockCommentStart = null;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (char === quote) {
        if (next === quote) {
          index += 1;
          continue;
        }
        ranges.push({kind: 'string', start: quoteStart, end: index + 1});
        quote = null;
      }
      continue;
    }

    if (char === '-' && next === '-') {
      lineCommentStart = index;
      index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      blockCommentStart = index;
      index += 1;
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      quoteStart = index;
    }
  }

  if (lineCommentStart !== null) {
    ranges.push({kind: 'line-comment', start: lineCommentStart, end: sql.length});
  }
  if (blockCommentStart !== null) {
    ranges.push({kind: 'block-comment', start: blockCommentStart, end: sql.length});
  }
  if (quote) {
    ranges.push({kind: 'string', start: quoteStart, end: sql.length});
  }

  return ranges;
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

function replaceSqlPatternOutsideCommentsAndStrings(
  sql: string,
  pattern: RegExp,
  replace: (match: string, groups: string[]) => string,
): string {
  const searchableSql = maskSqlCommentsAndStrings(sql);
  let output = '';
  let cursor = 0;
  for (const match of searchableSql.matchAll(pattern)) {
    const start = match.index!;
    const end = start + match[0]!.length;
    output += sql.slice(cursor, start);
    output += replace(sql.slice(start, end), match.slice(1).map((group) => group || ''));
    cursor = end;
  }
  return output + sql.slice(cursor);
}

async function writeGeneratedQueriesFile(
  generatedDir: string,
  queryFiles: QueryFile[],
  importExtension: '.js' | '.ts',
): Promise<void> {
  const sortedQueryFiles = [...queryFiles].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const lines = [
    `// Generated by \`sqlfu generate\`. Do not edit.`,
    ``,
    ...sortedQueryFiles.map((queryFile) => `export * from "./${queryFile.relativePath}.sql${importExtension}";`),
    ...(sortedQueryFiles.length === 0 ? [] : [``]),
    `export const sqlfuQuerySources = [`,
    ...sortedQueryFiles.map(
      (queryFile) =>
        `\t{ sqlFile: ${JSON.stringify(`${queryFile.relativePath}.sql`)}, generatedFile: ${JSON.stringify(`${queryFile.relativePath}.sql.ts`)}, sourceSql: ${JSON.stringify(queryFile.sqlContent)} },`,
    ),
    `];`,
  ];
  await fs.writeFile(path.join(generatedDir, 'queries.ts'), lines.join('\n') + '\n');
}

async function writeGeneratedBarrel(generatedDir: string, importExtension: '.js' | '.ts'): Promise<void> {
  const lines = [
    `export * from "./tables${importExtension}";`,
    `export * from "./queries${importExtension}";`,
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
  await fs.writeFile(path.join(bundleDir, 'migrations.ts'), bundleLines.join('\n'));
}

async function writeQueryCatalog(
  config: SqlfuProjectConfig,
  querySources: QuerySource[],
  queryAnalyses: Awaited<ReturnType<typeof analyzeVendoredTypesqlQueries>>,
  schema: ReadonlyMap<string, RelationInfo>,
): Promise<void> {
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

    const {descriptor} = prepareQueryDescriptor({
      descriptor: refineDescriptor(analysis.descriptor, querySource.analysisSqlContent, schema),
      explicitParameterExpansions: querySource.parameterExpansions,
      sourceSql: querySource.sqlContent,
    });
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
      sqlFileContent: querySource.sqlFileContent,
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
  functionName: string;
  sourceSql: string;
  descriptor: GeneratedQueryDescriptor;
  parameterExpansions: ParameterExpansion[];
  validator: SqlfuValidator | null;
  prettyErrors: boolean;
  sync: boolean;
  localNames?: LocalNames;
}): string {
  if (input.validator !== null) {
    return renderValidatorQueryWrapper({
      functionName: input.functionName,
      sourceSql: input.sourceSql,
      descriptor: input.descriptor,
      parameterExpansions: input.parameterExpansions,
      emitter: getValidatorEmitter(input.validator),
      prettyErrors: input.prettyErrors,
      sync: input.sync,
      localNames: input.localNames,
    });
  }

  const functionName = input.functionName;
  const sqlName = input.localNames?.sql || 'sql';
  const queryName = input.localNames?.query || 'query';

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
  const queryReference = buildQueryReference(hasData, hasParams, 'data', 'params', queryName);
  const queryDeclaration =
    !hasRuntimeParameterExpansions(input.parameterExpansions)
      ? renderQueryDeclaration({
          factoryArgs,
          queryArgs,
          queryName: functionName,
          sqlName,
          queryVariableName: queryName,
        })
      : renderExpandedQueryDeclaration({
          sourceSql: input.sourceSql,
          descriptor: input.descriptor,
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
    ...renderSqlConstant(input.descriptor.sql, sqlName),
    queryDeclaration,
    ``,
    `export const ${functionName} = Object.assign(`,
    functionDeclaration,
    ...implementationLines,
    `\t},`,
    `\t{ ${objectProperty('sql', sqlName)}, ${objectProperty('query', queryName)} },`,
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
  sqlName?: string;
  queryVariableName?: string;
}): string {
  const sqlName = input.sqlName || 'sql';
  const queryVariableName = input.queryVariableName || 'query';
  const payload = `{ ${objectProperty('sql', sqlName)}, args: ${input.queryArgs}, name: ${JSON.stringify(input.queryName)} }`;
  if (input.factoryArgs.length === 0) {
    return `const ${queryVariableName} = ${payload};`;
  }
  return `const ${queryVariableName} = (${input.factoryArgs.join(', ')}) => (${payload});`;
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
    `\treturn { sql: expandedSql, args: ${input.queryArgs}, name: ${JSON.stringify(input.queryName)} };`,
    `};`,
  ].join('\n');
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
    lines.push(`${indent}\tthrow new Error(${JSON.stringify(`Parameter "${expansion.name}" must be a non-empty array`)});`);
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
    (field) => zodExpressionForField(field, 'z'),
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
    (field) => valibotExpressionForField(field),
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
    return `\t${keyText}: ${arktypeFieldExpression(field, field.notNull)},`;
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
  localNames?: LocalNames;
}): string {
  const functionName = input.functionName;
  const sqlName = input.localNames?.sql || 'sql';
  const queryName = input.localNames?.query || 'query';
  const dataSchemaName = input.localNames?.dataSchema || 'Data';
  const paramsSchemaName = input.localNames?.paramsSchema || 'Params';
  const resultSchemaName = input.localNames?.resultSchema || 'Result';
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
    schemaDeclarations.push(...renderObjectSchemaDeclaration(emitter, dataSchemaName, descriptor.data!, 'parameter'));
  }
  if (hasParams) {
    schemaDeclarations.push(...renderObjectSchemaDeclaration(emitter, paramsSchemaName, descriptor.parameters, 'parameter'));
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
    dataExpression = dataValidation.expression;
  }
  if (hasParams) {
    const paramsValidation = buildInputValidation(emitter, paramsSchemaName, 'params', prettyErrors);
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
  const queryDeclaration =
    !hasRuntimeParameterExpansions(input.parameterExpansions)
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
  if (hasData) attachedProperties.push(objectProperty('Data', dataSchemaName));
  if (hasParams) attachedProperties.push(objectProperty('Params', paramsSchemaName));
  if (emitResultSchema) attachedProperties.push(objectProperty('Result', resultSchemaName));
  attachedProperties.push(objectProperty('sql', sqlName), objectProperty('query', queryName));

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

function objectProperty(propertyName: string, variableName: string): string {
  return propertyName === variableName ? propertyName : `${propertyName}: ${variableName}`;
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
    return `\t\t${field.name}${optional ? '?' : ''}: ${fieldTypeExpression(field, fieldKind)};`;
  });
  return [`{`, ...lines, `\t}`].join('\n');
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
    ? {
        type: field.isArray ? 'array' : 'object',
        ...(field.isArray
          ? {items: objectSchema(field.name, field.objectFields)}
          : objectSchema(field.name, field.objectFields)),
      } satisfies JsonSchemaObject
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
  const expansions = new Map(
    input.explicitParameterExpansions.map((expansion) => [expansion.name, expansion]),
  );
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
  const expansion = expansions.find(
    (candidate) => candidate.kind === 'object-array' && candidate.acceptsSingleOrArray,
  );
  if (!expansion) return;
  throw new Error(
    `Inferred INSERT values parameter ${JSON.stringify(expansion.name)} does not support RETURNING yet`,
  );
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
          and ${excludeReservedSqliteObjects}
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
