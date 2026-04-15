import fs from 'node:fs/promises';
import path from 'node:path';
import {Database} from 'bun:sqlite';

import type {QueryCatalog, QueryCatalogEntry, QueryArg, SqlfuProjectConfig, SqlfuRouterContext} from 'sqlfu/experimental';
import {analyzeAdHocSqlForConfig, createBunClient, getCheckMismatches, getMigrationResultantSchema, getSchemaAuthorities, loadProjectConfig, runSqlfuCommand, splitSqlStatements, writeDefinitionsSql} from 'sqlfu/experimental';
import type {MigrationResultantSchemaResponse, QueryFileMutationResponse, SaveSqlResponse, SchemaAuthoritiesResponse, SchemaCheckCard, SchemaCheckResponse, SqlAnalysisResponse, SqlEditorDiagnostic, StudioColumn, StudioRelation, StudioSchemaResponse, TableRowKey, TableRowsResponse} from './shared.js';

const clientEntryPath = path.join(import.meta.dir, 'client.tsx');
const stylesPath = path.join(import.meta.dir, 'styles.css');
const generateCatalogScriptPath = path.join(import.meta.dir, 'generate-catalog.ts');

export async function startSqlfuUiServer(input: {
  port?: number;
  projectRoot?: string;
}) {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  process.chdir(projectRoot);
  const config = await loadProjectConfig();

  const server = Bun.serve({
    port: input.port ?? 3017,
    async fetch(request: Request) {
      try {
        const url = new URL(request.url);

        if (url.pathname === '/api/schema') {
          return json(await getSchemaResponse(config.db));
        }

        if (url.pathname === '/api/catalog') {
          return json(await loadCatalog(config));
        }

        if (url.pathname === '/api/schema/check') {
          return json(await getSchemaCheckResponse(config));
        }

        if (url.pathname === '/api/schema/authorities') {
          return json(await getSchemaAuthoritiesResponse(config));
        }

        if (url.pathname === '/api/schema/authorities/resultant-schema') {
          return json(await getMigrationResultantSchemaResponse(config, {
            source: url.searchParams.get('source') === 'history' ? 'history' : 'migrations',
            id: url.searchParams.get('id') ?? '',
          }));
        }

        if (url.pathname.startsWith('/api/table/')) {
          const relationName = decodeURIComponent(url.pathname.replace('/api/table/', ''));
          const page = Number(url.searchParams.get('page') ?? '0');
          if (request.method === 'PUT') {
            const body = await request.json() as {
              originalRows?: unknown;
              rows?: unknown;
              rowKeys?: unknown;
            };
            return json(await saveTableRows(config.db, relationName, {
              page: Number.isFinite(page) ? page : 0,
              originalRows: Array.isArray(body.originalRows) ? body.originalRows : [],
              rows: Array.isArray(body.rows) ? body.rows : [],
              rowKeys: Array.isArray(body.rowKeys) ? body.rowKeys as TableRowKey[] : [],
            }));
          }
          return json(await getTableRows(config.db, relationName, Number.isFinite(page) ? page : 0));
        }

        if (url.pathname === '/api/sql' && request.method === 'POST') {
          const body = await request.json() as {sql?: unknown; params?: unknown};
          return json(await executeSql(config.db, {
            sql: typeof body.sql === 'string' ? body.sql : '',
            params: body.params,
          }));
        }

        if (url.pathname === '/api/sql/analyze' && request.method === 'POST') {
          const body = await request.json() as {sql?: unknown};
          return json(await analyzeSql(config, {
            sql: typeof body.sql === 'string' ? body.sql : '',
          }));
        }

        if (url.pathname === '/api/sql/save' && request.method === 'POST') {
          const body = await request.json() as {sql?: unknown; name?: unknown};
          return json(await saveSqlQuery(config, {
            sql: typeof body.sql === 'string' ? body.sql : '',
            name: typeof body.name === 'string' ? body.name : '',
          }));
        }

        if (url.pathname === '/api/schema/command' && request.method === 'POST') {
          const body = await request.json() as {command?: unknown};
          return json(await runSchemaCommand(config, {
            command: typeof body.command === 'string' ? body.command : '',
          }));
        }

        if (url.pathname === '/api/schema/definitions' && request.method === 'PUT') {
          const body = await request.json() as {sql?: unknown};
          return json(await saveDefinitionsSql(config, {
            sql: typeof body.sql === 'string' ? body.sql : '',
          }));
        }

        if (url.pathname.startsWith('/api/query/') && request.method === 'POST') {
          const queryId = decodeURIComponent(url.pathname.replace('/api/query/', ''));
          const body = await request.json() as {data?: Record<string, unknown>; params?: Record<string, unknown>};
          return json(await executeCatalogQuery(config, queryId, body));
        }

        if (url.pathname.startsWith('/api/query/') && request.method === 'PUT') {
          const queryId = decodeURIComponent(url.pathname.replace('/api/query/', ''));
          const body = await request.json() as {sql?: unknown};
          return json(await updateQueryFile(config, queryId, {
            sql: typeof body.sql === 'string' ? body.sql : '',
          }));
        }

        if (url.pathname.startsWith('/api/query/') && request.method === 'PATCH') {
          const queryId = decodeURIComponent(url.pathname.replace('/api/query/', ''));
          const body = await request.json() as {name?: unknown};
          return json(await renameQueryFile(config, queryId, {
            name: typeof body.name === 'string' ? body.name : '',
          }));
        }

        if (url.pathname.startsWith('/api/query/') && request.method === 'DELETE') {
          const queryId = decodeURIComponent(url.pathname.replace('/api/query/', ''));
          return json(await deleteQueryFile(config, queryId));
        }

        if (url.pathname === '/assets/app.js') {
          return javascript(await buildClientBundle());
        }

        if (url.pathname === '/assets/app.css') {
          return css(await fs.readFile(stylesPath, 'utf8'));
        }

        return html(renderIndexHtml());
      } catch (error) {
        return apiError(error);
      }
    },
  });

  return server;
}

if (import.meta.main) {
  const projectRoot = readOption('--project-root');
  const port = readOption('--port');
  const server = await startSqlfuUiServer({
    projectRoot,
    port: port ? Number(port) : undefined,
  });
  console.log(`sqlfu/ui listening on http://localhost:${server.port}`);
}

async function buildClientBundle() {
  const result = await Bun.build({
    entrypoints: [clientEntryPath],
    target: 'browser',
    format: 'esm',
    minify: false,
    sourcemap: 'inline',
    naming: 'app.js',
  });

  if (!result.success) {
    const details = result.logs.map((log: {message: string}) => log.message).join('\n');
    throw new Error(`Failed to build client bundle:\n${details}`);
  }

  const output = result.outputs.find((item: {path: string}) => item.path.endsWith('.js'));
  if (!output) {
    throw new Error('Missing built client bundle');
  }

  return output.text();
}

async function loadCatalog(config: SqlfuProjectConfig): Promise<QueryCatalog> {
  await generateCatalogForProject(config.projectRoot);
  const catalogPath = path.join(config.projectRoot, '.sqlfu', 'query-catalog.json');
  return JSON.parse(await fs.readFile(catalogPath, 'utf8')) as QueryCatalog;
}

async function analyzeSql(
  config: SqlfuProjectConfig,
  input: {
    sql: string;
  },
): Promise<SqlAnalysisResponse> {
  if (!input.sql.trim()) {
    return {};
  }

  try {
    const analysis = await analyzeAdHocSqlForConfig(config, input.sql);
    return {
      paramsSchema: analysis.paramsSchema,
      diagnostics: [],
    };
  } catch (error) {
    return {
      diagnostics: [toSqlEditorDiagnostic(input.sql, error)],
    };
  }
}

async function getSchemaCheckResponse(config: SqlfuProjectConfig): Promise<SchemaCheckResponse> {
  const mismatches = await getCheckMismatches(toSqlfuRouterContext(config));
  return {
    cards: buildSchemaCheckCards(mismatches),
  };
}

async function runSchemaCommand(
  config: SqlfuProjectConfig,
  input: {
    command: string;
  },
) {
  if (!input.command.trim()) {
    throw new Error('Command is required');
  }

  await runSqlfuCommand(toSqlfuRouterContext(config), input.command);
  return {
    ok: true,
  } as const;
}

async function saveDefinitionsSql(
  config: SqlfuProjectConfig,
  input: {
    sql: string;
  },
) {
  if (!input.sql.trim()) {
    throw new Error('Desired Schema is required');
  }

  await writeDefinitionsSql(toSqlfuRouterContext(config), input.sql);
  return {
    ok: true,
  } as const;
}

async function getSchemaAuthoritiesResponse(config: SqlfuProjectConfig): Promise<SchemaAuthoritiesResponse> {
  const authorities = await getSchemaAuthorities(toSqlfuRouterContext(config));
  return {
    desiredSchemaSql: authorities.desiredSchemaSql,
    migrations: authorities.migrations.map((migration) => ({
      ...parseMigrationId(migration.id),
      id: migration.id,
      fileName: migration.fileName,
      content: migration.content,
      applied: migration.applied,
      appliedAt: migration.appliedAt,
      integrity: migration.integrity,
    })),
    migrationHistory: authorities.migrationHistory.map((migration) => ({
      ...parseMigrationId(migration.id),
      id: migration.id,
      fileName: migration.fileName,
      content: migration.content,
      applied: migration.applied,
      appliedAt: migration.appliedAt,
      integrity: migration.integrity,
    })),
    liveSchemaSql: authorities.liveSchemaSql,
  };
}

async function getMigrationResultantSchemaResponse(
  config: SqlfuProjectConfig,
  input: {
    source: 'migrations' | 'history';
    id: string;
  },
): Promise<MigrationResultantSchemaResponse> {
  if (!input.id.trim()) {
    throw new Error('Migration id is required');
  }

  return {
    sql: await getMigrationResultantSchema(toSqlfuRouterContext(config), input),
  };
}

function toSqlfuRouterContext(config: SqlfuProjectConfig): SqlfuRouterContext {
  return {config};
}

function buildSchemaCheckCards(
  mismatches: readonly {
    readonly name: string;
    readonly lines: readonly string[];
  }[],
): readonly SchemaCheckCard[] {
  const mismatchByTitle = new Map<string, {
    readonly summary: string;
    readonly recommendation?: string;
    readonly commands: readonly string[];
  }>();

  for (const mismatch of mismatches) {
    const [title, summary, ...rest] = mismatch.lines;
    const recommendation = rest.find((line) => line.startsWith('Recommendation:'));
    mismatchByTitle.set(title ?? '', {
      summary: summary ?? '',
      recommendation,
      commands: extractCommands(rest),
    });
  }

  return [
    toSchemaCheckCard(
      'repoDrift',
      'Repo Drift',
      '✅ No Repo Drift',
      'Desired Schema matches Migrations.',
      mismatchByTitle.get('Repo Drift'),
    ),
    toSchemaCheckCard(
      'pendingMigrations',
      'Pending Migrations',
      '✅ No Pending Migrations',
      'Migration History matches Migrations.',
      mismatchByTitle.get('Pending Migrations'),
    ),
    toSchemaCheckCard(
      'historyDrift',
      'History Drift',
      '✅ No History Drift',
      'Applied migrations still match the repo versions.',
      mismatchByTitle.get('History Drift'),
    ),
    toSchemaCheckCard(
      'schemaDrift',
      'Schema Drift',
      '✅ No Schema Drift',
      'Live Schema matches Migration History.',
      mismatchByTitle.get('Schema Drift'),
    ),
    toSchemaCheckCard(
      'syncDrift',
      'Sync Drift',
      '✅ No Sync Drift',
      'Desired Schema matches Live Schema.',
      mismatchByTitle.get('Sync Drift'),
    ),
  ];
}

function toSchemaCheckCard(
  key: SchemaCheckCard['key'],
  title: string,
  okTitle: string,
  explainer: string,
  mismatch: {
    readonly summary: string;
    readonly recommendation?: string;
    readonly commands: readonly string[];
  } | undefined,
): SchemaCheckCard {
  return {
    key,
    title,
    okTitle,
    explainer,
    ok: !mismatch,
    summary: mismatch?.summary ?? '',
    recommendation: mismatch?.recommendation,
    commands: mismatch?.commands ?? [],
  };
}

function extractCommands(lines: readonly string[]) {
  return [...new Set(lines.flatMap((line) => [...line.matchAll(/`(sqlfu [^`]+)`/g)].map((match) => match[1]!)))]
    .filter((command) => !/[<>]/.test(command));
}

function parseMigrationId(id: string) {
  const separatorIndex = id.indexOf('_');
  if (separatorIndex === -1) {
    return {
      timestamp: undefined,
      name: id,
    };
  }

  return {
    timestamp: id.slice(0, separatorIndex),
    name: id.slice(separatorIndex + 1),
  };
}

function toSqlEditorDiagnostic(sql: string, error: unknown): SqlEditorDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const explicitLocation = locateExplicitPosition(sql, message);
  if (explicitLocation) {
    return {
      ...explicitLocation,
      message,
    };
  }

  const nearToken = message.match(/near ['"`]([^'"`]+)['"`]/i)?.[1]
    ?? message.match(/no such (?:table|column):\s*([A-Za-z0-9_."]+)/i)?.[1]
    ?? message.match(/Must select the join column:\s*([A-Za-z0-9_."]+)/i)?.[1];
  const tokenLocation = nearToken ? locateToken(sql, nearToken) : null;
  if (tokenLocation) {
    return {
      ...tokenLocation,
      message,
    };
  }

  return {
    ...fallbackDiagnosticRange(sql),
    message,
  };
}

function locateExplicitPosition(sql: string, message: string) {
  const lineColumnMatch = message.match(/line\s+(\d+)\D+column\s+(\d+)/i);
  if (!lineColumnMatch) {
    return null;
  }

  const lineNumber = Number(lineColumnMatch[1]);
  const columnNumber = Number(lineColumnMatch[2]);
  if (!Number.isFinite(lineNumber) || !Number.isFinite(columnNumber) || lineNumber < 1 || columnNumber < 1) {
    return null;
  }

  const lines = sql.split('\n');
  const targetLine = lines[lineNumber - 1];
  if (targetLine == null) {
    return null;
  }

  const from = lines
    .slice(0, lineNumber - 1)
    .reduce((total, line) => total + line.length + 1, 0) + (columnNumber - 1);

  return {
    from,
    to: Math.min(sql.length, from + Math.max(1, targetLine.trim().length ? 1 : targetLine.length || 1)),
  };
}

function locateToken(sql: string, rawToken: string) {
  const token = rawToken.replace(/^["'`]+|["'`]+$/g, '');
  if (!token) {
    return null;
  }

  for (const candidate of [token, token.split('.').at(-1) ?? '']) {
    if (!candidate) {
      continue;
    }
    const index = sql.toLowerCase().indexOf(candidate.toLowerCase());
    if (index !== -1) {
      return {
        from: index,
        to: index + candidate.length,
      };
    }
  }

  return null;
}

function fallbackDiagnosticRange(sql: string) {
  const firstNonWhitespace = sql.search(/\S/);
  const from = firstNonWhitespace === -1 ? 0 : firstNonWhitespace;
  return {
    from,
    to: Math.max(from + 1, sql.length),
  };
}

async function executeCatalogQuery(
  config: SqlfuProjectConfig,
  queryId: string,
  input: {
    data?: Record<string, unknown>;
    params?: Record<string, unknown>;
  },
) {
  const catalog = await loadCatalog(config);
  const query = catalog.queries.find((entry) => entry.id === queryId);
  if (!query || query.kind !== 'query') {
    throw new Error(`Unknown query: ${queryId}`);
  }

  const args = query.args.flatMap((arg) => {
    const source = arg.scope === 'data' ? input.data : input.params;
    return encodeArgument(arg, source?.[arg.name]);
  }) as readonly QueryArg[];

  const database = new Database(config.db);
  const client = createBunClient(database);

  try {
    if (query.resultMode === 'metadata') {
      return {
        mode: 'metadata',
        metadata: client.run({sql: query.sql, args}),
      } as const;
    }

    return {
      mode: 'rows',
      rows: client.all({sql: query.sql, args}).map(materializeRow),
    } as const;
  } finally {
    database.close();
  }
}

async function renameQueryFile(
  config: SqlfuProjectConfig,
  queryId: string,
  input: {
    name: string;
  },
): Promise<QueryFileMutationResponse> {
  const query = await loadWritableQuery(config, queryId);
  const nextId = slugifyQueryName(input.name);
  if (!nextId) {
    throw new Error('Query name is required');
  }

  const nextRelativePath = `sql/${nextId}.sql`;
  const nextPath = path.join(config.projectRoot, nextRelativePath);
  await fs.rename(path.join(config.projectRoot, query.sqlFile), nextPath);
  await generateCatalogForProject(config.projectRoot);
  return {
    id: nextId,
    sqlFile: nextRelativePath,
  };
}

async function updateQueryFile(
  config: SqlfuProjectConfig,
  queryId: string,
  input: {
    sql: string;
  },
): Promise<QueryFileMutationResponse> {
  const query = await loadWritableQuery(config, queryId);
  const sql = input.sql.trim();
  if (!sql) {
    throw new Error('SQL is required');
  }

  await fs.writeFile(path.join(config.projectRoot, query.sqlFile), `${sql}\n`);
  await generateCatalogForProject(config.projectRoot);
  return {
    id: query.id,
    sqlFile: query.sqlFile,
  };
}

async function deleteQueryFile(
  config: SqlfuProjectConfig,
  queryId: string,
): Promise<QueryFileMutationResponse> {
  const query = await loadWritableQuery(config, queryId);
  await fs.rm(path.join(config.projectRoot, query.sqlFile), {force: true});
  await generateCatalogForProject(config.projectRoot);
  return {
    id: query.id,
    sqlFile: query.sqlFile,
  };
}

async function loadWritableQuery(config: SqlfuProjectConfig, queryId: string) {
  const catalog = await loadCatalog(config);
  const query = catalog.queries.find((entry) => entry.id === queryId);
  if (!query) {
    throw new Error(`Unknown query: ${queryId}`);
  }
  return query;
}

function encodeArgument(
  arg: Extract<QueryCatalogEntry, {kind: 'query'}>['args'][number],
  value: unknown,
): readonly QueryArg[] {
  if (arg.isArray) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((item) => encodeScalar(arg.driverEncoding, item));
  }

  return [encodeScalar(arg.driverEncoding, value)];
}

function encodeScalar(
  encoding: Extract<QueryCatalogEntry, {kind: 'query'}>['args'][number]['driverEncoding'],
  value: unknown,
): QueryArg {
  if (value == null) {
    return null;
  }
  if (encoding === 'boolean-number') {
    return Number(Boolean(value));
  }
  if (encoding === 'date') {
    return typeof value === 'string' ? value.split('T')[0] : String(value);
  }
  if (encoding === 'datetime') {
    if (typeof value !== 'string') {
      return String(value);
    }
    return value.replace('T', ' ').replace(/\.\d+Z?$/, '');
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean' || value instanceof Uint8Array) {
    return value;
  }
  return JSON.stringify(value);
}

async function getSchemaResponse(dbPath: string): Promise<StudioSchemaResponse> {
  const database = new Database(dbPath);
  const client = createBunClient(database);

  try {
    const rows = client.all<{name: string; type: string; sql: string | null}>({
      sql: `
        select name, type, sql
        from sqlite_schema
        where type in ('table', 'view')
          and name not like 'sqlite_%'
        order by type, name
      `,
      args: [],
    });

    const relations: StudioRelation[] = rows.map((row) => ({
      name: row.name,
      kind: row.type === 'view' ? 'view' : 'table',
      columns: getRelationColumns(client, row.name),
      rowCount: row.type === 'table' ? getRelationCount(client, row.name) : undefined,
      sql: row.sql ?? undefined,
    }));

    return {
      projectName: path.basename(process.cwd()),
      projectRoot: process.cwd(),
      relations,
    };
  } finally {
    database.close();
  }
}

function getRelationColumns(client: ReturnType<typeof createBunClient>, relationName: string): readonly StudioColumn[] {
  return client
    .all<Record<string, unknown>>({
      sql: `PRAGMA table_xinfo("${escapeIdentifier(relationName)}")`,
      args: [],
    })
    .filter((row) => Number(row.hidden ?? 0) === 0)
    .map((row) => ({
      name: String(row.name),
      type: typeof row.type === 'string' ? row.type : '',
      notNull: Number(row.notnull ?? 0) === 1,
      primaryKey: Number(row.pk ?? 0) >= 1,
    }));
}

function getRelationCount(client: ReturnType<typeof createBunClient>, relationName: string) {
  const rows = client.all<{count: number}>({
    sql: `select count(*) as count from "${escapeIdentifier(relationName)}"`,
    args: [],
  });
  return rows[0]?.count ?? 0;
}

async function getTableRows(dbPath: string, relationName: string, page: number): Promise<TableRowsResponse> {
  const safePage = Math.max(0, page);
  const pageSize = 25;
  const database = new Database(dbPath);
  const client = createBunClient(database);

  try {
    const relation = getRelationInfo(client, relationName);
    const relationColumns = getRelationColumns(client, relationName);
    const columns = relationColumns.map((column) => column.name);
    const primaryKeyColumns = relationColumns.filter((column) => column.primaryKey).map((column) => column.name);
    const includeRowid = relation.type === 'table' && primaryKeyColumns.length === 0;
    const rows = client.all<Record<string, unknown>>({
      sql: `select ${includeRowid ? 'rowid as "__sqlfu_rowid__", ' : ''}* from "${escapeIdentifier(relationName)}" limit ? offset ?`,
      args: [pageSize, safePage * pageSize],
    });
    const materializedRows = rows.map(materializeRow);

    return {
      relation: relationName,
      page: safePage,
      pageSize,
      editable: relation.type === 'table',
      rowKeys: materializedRows.map((row) => buildTableRowKey(row, primaryKeyColumns)),
      columns,
      rows: materializedRows.map(stripInternalRowValues),
    };
  } finally {
    database.close();
  }
}

async function saveTableRows(
  dbPath: string,
  relationName: string,
  input: {
    page: number;
    originalRows: unknown[];
    rows: unknown[];
    rowKeys: TableRowKey[];
  },
): Promise<TableRowsResponse> {
  const database = new Database(dbPath);
  const client = createBunClient(database);

  try {
    const relation = getRelationInfo(client, relationName);
    if (relation.type !== 'table') {
      throw new Error(`Relation "${relationName}" is not editable`);
    }

    if (input.originalRows.length !== input.rows.length || input.rows.length !== input.rowKeys.length) {
      throw new Error('Edited rows payload is malformed');
    }

    const changedRows = input.rows.flatMap((row, index) => {
      const nextRow = asRecord(row);
      const originalRow = asRecord(input.originalRows[index]);
      if (!nextRow || !originalRow) {
        return [];
      }
      const normalizedNextRow = normalizeEditedRow(nextRow, originalRow);

      const changedColumns = Object.keys(normalizedNextRow).filter((column) => !isSameValue(normalizedNextRow[column], originalRow[column]));
      if (changedColumns.length === 0) {
        return [];
      }

      return [{
        rowKey: input.rowKeys[index]!,
        originalRow,
        nextRow: normalizedNextRow,
        changedColumns,
      }];
    });

    for (const row of changedRows) {
      const sql = row.rowKey.kind === 'new'
        ? buildInsertRowStatement(relationName, row.nextRow, row.changedColumns)
        : buildUpdateRowStatement(relationName, row.rowKey, row.originalRow, row.nextRow, row.changedColumns);
      try {
        database.run(sql.sql, sql.args as any);
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nSQL: ${sql.sql}\nArgs: ${JSON.stringify(sql.args)}`);
      }
    }

    return await getTableRows(dbPath, relationName, input.page);
  } finally {
    database.close();
  }
}

async function executeSql(
  dbPath: string,
  input: {
    sql: string;
    params: unknown;
  },
) {
  const trimmedSql = input.sql.trim();
  if (!trimmedSql) {
    throw new Error('SQL is required');
  }

  const statements = splitSqlStatements(trimmedSql);
  const params = normalizeSqlRunnerParams(input.params);
  const database = new Database(dbPath);

  try {
    if (statements.length === 1) {
      try {
        const rows = database.query<Record<string, unknown>, any>(statements[0]!).all(params as never);
        return {
          sql: trimmedSql,
          mode: 'rows',
          rows: rows.map(materializeRow),
        } as const;
      } catch {}
    }

    return {
      sql: trimmedSql,
      mode: 'metadata',
      metadata: runSqlStatement(database, trimmedSql, params),
    } as const;
  } finally {
    database.close();
  }
}

async function saveSqlQuery(
  config: SqlfuProjectConfig,
  input: {
    sql: string;
    name: string;
  },
): Promise<SaveSqlResponse> {
  const sql = input.sql.trim();
  if (!sql) {
    throw new Error('SQL is required');
  }

  const baseName = slugifyQueryName(input.name);
  if (!baseName) {
    throw new Error('Query name is required');
  }

  const relativePath = `sql/${baseName}.sql`;
  const targetPath = path.join(config.projectRoot, relativePath);
  await fs.mkdir(path.dirname(targetPath), {recursive: true});
  await fs.writeFile(targetPath, `${sql}\n`);
  await generateCatalogForProject(config.projectRoot);
  return {savedPath: relativePath};
}

function slugifyQueryName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeSqlRunnerParams(value: unknown): Record<string, unknown> | readonly unknown[] | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'object') {
    return expandNamedParameters(value as Record<string, unknown>);
  }
  throw new Error('SQL runner params must be an object or array');
}

function expandNamedParameters(input: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = value;
    if (!/^[\:\@\$\?]/.test(key)) {
      output[`:${key}`] = value;
      output[`@${key}`] = value;
      output[`$${key}`] = value;
    }
  }
  return output;
}

function runSqlStatement(
  database: Database,
  sql: string,
  params: Record<string, unknown> | readonly unknown[] | undefined,
) {
  const result = database.run(sql, params as never);
  return {
    rowsAffected: result.changes,
    lastInsertRowid: result.lastInsertRowid,
  };
}

function materializeRow(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (typeof value === 'bigint') {
        return [key, Number(value)];
      }
      if (value instanceof ArrayBuffer) {
        return [key, `[ArrayBuffer ${value.byteLength}]`];
      }
      if (value instanceof Uint8Array) {
        return [key, `[Uint8Array ${value.byteLength}]`];
      }
      return [key, value];
    }),
  );
}

function escapeIdentifier(value: string) {
  return value.replaceAll('"', '""');
}

function getRelationInfo(client: ReturnType<typeof createBunClient>, relationName: string) {
  const row = client.all<{name: string; type: 'table' | 'view'; sql: string | null}>({
    sql: `select name, type, sql from sqlite_schema where name = ?`,
    args: [relationName],
  })[0];
  if (!row || (row.type !== 'table' && row.type !== 'view')) {
    throw new Error(`Unknown relation "${relationName}"`);
  }
  return row;
}

function buildTableRowKey(row: Record<string, unknown>, primaryKeyColumns: readonly string[]): TableRowKey {
  if (primaryKeyColumns.length > 0) {
    return {
      kind: 'primaryKey',
      values: Object.fromEntries(primaryKeyColumns.map((column) => [column, row[column]])),
    };
  }

  const rowid = row.__sqlfu_rowid__;
  if (typeof rowid !== 'number') {
    throw new Error('Editable table row is missing rowid');
  }

  return {
    kind: 'rowid',
    value: rowid,
  };
}

function stripInternalRowValues(row: Record<string, unknown>) {
  const nextRow = {...row};
  delete nextRow.__sqlfu_rowid__;
  return nextRow;
}

function buildRowWhereClause(rowKey: TableRowKey, originalRow: Record<string, unknown>) {
  if (rowKey.kind === 'new') {
    throw new Error('New rows do not have a where clause');
  }
  if (rowKey.kind === 'rowid') {
    return {
      sql: 'rowid = ?',
      args: [rowKey.value],
    };
  }

  const entries = Object.entries(rowKey.values);
  return {
    sql: entries.map(([column, value]) => (value == null ? `"${escapeIdentifier(column)}" is null` : `"${escapeIdentifier(column)}" = ?`)).join(' and '),
    args: entries.flatMap(([, value]) => (value == null ? [] : [normalizeDbValue(value)])),
  };
}

function buildInsertRowStatement(
  relationName: string,
  nextRow: Record<string, unknown>,
  changedColumns: readonly string[],
) {
  const columns = changedColumns.map((column) => `"${escapeIdentifier(column)}"`).join(', ');
  const placeholders = changedColumns.map(() => '?').join(', ');
  return {
    sql: `insert into "${escapeIdentifier(relationName)}" (${columns}) values (${placeholders})`,
    args: changedColumns.map((column) => normalizeDbValue(nextRow[column])),
  };
}

function buildUpdateRowStatement(
  relationName: string,
  rowKey: TableRowKey,
  originalRow: Record<string, unknown>,
  nextRow: Record<string, unknown>,
  changedColumns: readonly string[],
) {
  const setSql = changedColumns.map((column) => `"${escapeIdentifier(column)}" = ?`).join(', ');
  const setArgs = changedColumns.map((column) => normalizeDbValue(nextRow[column]));
  const whereClause = buildRowWhereClause(rowKey, originalRow);
  return {
    sql: `update "${escapeIdentifier(relationName)}" set ${setSql} where ${whereClause.sql}`,
    args: [...setArgs, ...whereClause.args],
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isSameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeDbValue(value: unknown) {
  if (typeof value === 'boolean') {
    return Number(value);
  }
  return value;
}

function normalizeEditedRow(nextRow: Record<string, unknown>, originalRow: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(nextRow).map(([column, value]) => [column, coerceEditedValue(value, originalRow[column])]),
  );
}

function coerceEditedValue(value: unknown, originalValue: unknown) {
  if (typeof originalValue === 'number' && typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }

  return value;
}

function json(value: unknown) {
  return new Response(JSON.stringify(value, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function html(value: string) {
  return new Response(value, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
    },
  });
}

function css(value: string) {
  return new Response(value, {
    headers: {
      'content-type': 'text/css; charset=utf-8',
    },
  });
}

function javascript(value: string) {
  return new Response(value, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
    },
  });
}

function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return new Response(message, {
    status: 400,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
  });
}

function renderIndexHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>sqlfu/ui</title>
    <link rel="stylesheet" href="/assets/app.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/app.js"></script>
  </body>
</html>`;
}

function readOption(name: string) {
  const index = Bun.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return Bun.argv[index + 1];
}

export async function generateCatalogForProject(projectRoot: string) {
  await runCommand(['tsx', generateCatalogScriptPath], projectRoot);
}

async function runCommand(command: readonly string[], cwd: string) {
  const process = Bun.spawn([...command], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      [
        `Command failed: ${command.join(' ')}`,
        stdout.trim(),
        stderr.trim(),
      ].filter(Boolean).join('\n'),
    );
  }
}
