import fs from 'node:fs/promises';
import path from 'node:path';
import {Database} from 'bun:sqlite';
import {os} from '@orpc/server';
import {RPCHandler} from '@orpc/server/fetch';
import {z} from 'zod';

import type {QueryCatalog, QueryCatalogEntry, QueryArg, SqlfuProjectConfig} from 'sqlfu/experimental';
import {analyzeAdHocSqlForConfig, createBunClient, getCheckMismatches, getMigrationResultantSchema, getSchemaAuthorities, loadProjectConfig, runSqlfuCommand, splitSqlStatements, writeDefinitionsSql} from 'sqlfu/experimental';
import type {QueryExecutionResponse, SchemaCheckCard, SqlAnalysisResponse, SqlEditorDiagnostic, StudioColumn, TableRowKey, TableRowsResponse} from './shared.js';

const clientEntryPath = path.join(import.meta.dir, 'client.tsx');
const stylesPath = path.join(import.meta.dir, 'styles.css');
const generateCatalogScriptPath = path.join(import.meta.dir, 'generate-catalog.ts');

type UiRouterContext = {
  config: SqlfuProjectConfig;
};

const uiBase = os.$context<UiRouterContext>();
const rowRecordSchema = z.record(z.string(), z.unknown());
const tableRowKeySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('primaryKey'),
    values: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal('new'),
    value: z.string(),
  }),
  z.object({
    kind: z.literal('rowid'),
    value: z.number(),
  }),
]) satisfies z.ZodType<TableRowKey>;

const uiRouter = {
  schema: {
    get: uiBase.handler(async ({context}) => {
      const projectRoot = path.dirname(context.config.db);
      const database = new Database(context.config.db);
      const client = createBunClient(database);

      try {
        const relations = client.all<{name: string; type: 'table' | 'view'; sql: string | null}>({
          sql: `
            select name, type, sql
            from sqlite_master
            where type in ('table', 'view')
              and name not like 'sqlite_%'
            order by type, name
          `,
          args: [],
        });

        return {
          projectName: path.basename(projectRoot),
          projectRoot,
          relations: relations.map((relation) => ({
            name: relation.name,
            kind: relation.type,
            rowCount: relation.type === 'table' ? getRelationCount(client, relation.name) : undefined,
            columns: getRelationColumns(client, relation.name),
            sql: relation.sql ?? undefined,
          })),
        };
      } finally {
        database.close();
      }
    }),
    check: uiBase.handler(async ({context}) => {
      const mismatches = await getCheckMismatches({config: context.config});
      return {
        cards: buildSchemaCheckCards(mismatches),
      };
    }),
    authorities: {
      get: uiBase.handler(async ({context}) => {
        const authorities = await getSchemaAuthorities({config: context.config});
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
      }),
      resultantSchema: uiBase
        .input(z.object({
          source: z.enum(['migrations', 'history']),
          id: z.string(),
        }))
        .handler(async ({context, input}) => {
          if (!input.id.trim()) {
            throw new Error('Migration id is required');
          }

          return {
            sql: await getMigrationResultantSchema({config: context.config}, input),
          };
        }),
    },
    command: uiBase
      .input(z.object({
        command: z.string(),
      }))
      .handler(async ({context, input}) => {
        if (!input.command.trim()) {
          throw new Error('Command is required');
        }

        await runSqlfuCommand({config: context.config}, input.command);
        return {ok: true} as const;
      }),
    definitions: uiBase
      .input(z.object({
        sql: z.string(),
      }))
      .handler(async ({context, input}) => {
        if (!input.sql.trim()) {
          throw new Error('Desired Schema is required');
        }

        await writeDefinitionsSql({config: context.config}, input.sql);
        return {ok: true} as const;
      }),
  },
  catalog: uiBase.handler(({context}) => loadCatalog(context.config)),
  table: {
    list: uiBase
      .input(z.object({
        relationName: z.string(),
        page: z.number().int(),
      }))
      .handler(({context, input}) => getTableRows(context.config.db, input.relationName, input.page)),
    save: uiBase
      .input(z.object({
        relationName: z.string(),
        page: z.number().int(),
        originalRows: z.array(rowRecordSchema),
        rows: z.array(rowRecordSchema),
        rowKeys: z.array(tableRowKeySchema),
      }))
      .handler(({context, input}) => saveTableRows(context.config.db, input.relationName, input)),
    delete: uiBase
      .input(z.object({
        relationName: z.string(),
        page: z.number().int(),
        originalRow: rowRecordSchema,
        rowKey: tableRowKeySchema,
      }))
      .handler(({context, input}) => deleteTableRow(context.config.db, input.relationName, input)),
  },
  sql: {
    run: uiBase
      .input(z.object({
        sql: z.string(),
        params: z.unknown().optional(),
      }))
      .handler(({context, input}) => {
        const trimmedSql = input.sql.trim();
        if (!trimmedSql) {
          throw new Error('SQL is required');
        }

        const statements = splitSqlStatements(trimmedSql);
        const params = normalizeSqlRunnerParams(input.params);
        const database = new Database(context.config.db);

        try {
          if (statements.length === 1) {
            try {
              const rows = database.query<Record<string, unknown>, any>(statements[0]!).all(params as never);
              return {
                sql: trimmedSql,
                mode: 'rows' as const,
                rows: rows.map(materializeRow),
              };
            } catch {}
          }

          return {
            sql: trimmedSql,
            mode: 'metadata' as const,
            metadata: runSqlStatement(database, trimmedSql, params),
          };
        } finally {
          database.close();
        }
      }),
    analyze: uiBase
      .input(z.object({
        sql: z.string(),
      }))
      .handler(({context, input}) => analyzeSql(context.config, input)),
    save: uiBase
      .input(z.object({
        sql: z.string(),
        name: z.string(),
      }))
      .handler(async ({context, input}) => {
        const sql = input.sql.trim();
        if (!sql) {
          throw new Error('SQL is required');
        }

        const baseName = slugifyQueryName(input.name);
        if (!baseName) {
          throw new Error('Query name is required');
        }

        const relativePath = `sql/${baseName}.sql`;
        const targetPath = path.join(context.config.projectRoot, relativePath);
        await fs.mkdir(path.dirname(targetPath), {recursive: true});
        await fs.writeFile(targetPath, `${sql}\n`);
        await generateCatalogForProject(context.config.projectRoot);
        return {savedPath: relativePath};
      }),
  },
  query: {
    execute: uiBase
      .input(z.object({
        queryId: z.string(),
        data: z.record(z.string(), z.unknown()).optional(),
        params: z.record(z.string(), z.unknown()).optional(),
      }))
      .handler(async ({context, input}): Promise<QueryExecutionResponse> => {
        const catalog = await loadCatalog(context.config);
        const query = catalog.queries.find((entry) => entry.id === input.queryId);
        if (!query || query.kind !== 'query') {
          throw new Error(`Unknown query: ${input.queryId}`);
        }

        const args = query.args.flatMap((arg) => {
          const source = arg.scope === 'data' ? input.data : input.params;
          return encodeArgument(arg, source?.[arg.name]);
        }) as readonly QueryArg[];

        const database = new Database(context.config.db);
        const client = createBunClient(database);

        try {
          if (query.resultMode === 'metadata') {
            return {
              mode: 'metadata',
              metadata: client.run({sql: query.sql, args}),
            };
          }

          return {
            mode: 'rows',
            rows: client.all({sql: query.sql, args}).map(materializeRow),
          };
        } finally {
          database.close();
        }
      }),
    update: uiBase
      .input(z.object({
        queryId: z.string(),
        sql: z.string(),
      }))
      .handler(async ({context, input}) => {
        const catalog = await loadCatalog(context.config);
        const query = catalog.queries.find((entry) => entry.id === input.queryId);
        if (!query) {
          throw new Error(`Unknown query: ${input.queryId}`);
        }
        const sql = input.sql.trim();
        if (!sql) {
          throw new Error('SQL is required');
        }

        await fs.writeFile(path.join(context.config.projectRoot, query.sqlFile), `${sql}\n`);
        await generateCatalogForProject(context.config.projectRoot);
        return {
          id: query.id,
          sqlFile: query.sqlFile,
        };
      }),
    rename: uiBase
      .input(z.object({
        queryId: z.string(),
        name: z.string(),
      }))
      .handler(async ({context, input}) => {
        const catalog = await loadCatalog(context.config);
        const query = catalog.queries.find((entry) => entry.id === input.queryId);
        if (!query) {
          throw new Error(`Unknown query: ${input.queryId}`);
        }
        const nextId = slugifyQueryName(input.name);
        if (!nextId) {
          throw new Error('Query name is required');
        }

        const nextRelativePath = `sql/${nextId}.sql`;
        const nextPath = path.join(context.config.projectRoot, nextRelativePath);
        await fs.rename(path.join(context.config.projectRoot, query.sqlFile), nextPath);
        await generateCatalogForProject(context.config.projectRoot);
        return {
          id: nextId,
          sqlFile: nextRelativePath,
        };
      }),
    delete: uiBase
      .input(z.object({
        queryId: z.string(),
      }))
      .handler(async ({context, input}) => {
        const catalog = await loadCatalog(context.config);
        const query = catalog.queries.find((entry) => entry.id === input.queryId);
        if (!query) {
          throw new Error(`Unknown query: ${input.queryId}`);
        }
        await fs.rm(path.join(context.config.projectRoot, query.sqlFile), {force: true});
        await generateCatalogForProject(context.config.projectRoot);
        return {
          id: query.id,
          sqlFile: query.sqlFile,
        };
      }),
  },
};

export type UiRouter = typeof uiRouter;

export async function startSqlfuUiServer(input: {
  port?: number;
  projectRoot?: string;
}) {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  process.chdir(projectRoot);
  const config = await loadProjectConfig();
  const rpcHandler = new RPCHandler(uiRouter);

  const server = Bun.serve({
    port: input.port ?? 3017,
    async fetch(request: Request) {
      try {
        const url = new URL(request.url);

        if (url.pathname.startsWith('/api/rpc')) {
          const {matched, response} = await rpcHandler.handle(request, {
            prefix: '/api/rpc',
            context: {config},
          });
          return matched ? response : new Response('Not found', {status: 404});
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

async function deleteTableRow(
  dbPath: string,
  relationName: string,
  input: {
    page: number;
    originalRow: unknown;
    rowKey: TableRowKey | undefined;
  },
): Promise<TableRowsResponse> {
  const database = new Database(dbPath);
  const client = createBunClient(database);

  try {
    const relation = getRelationInfo(client, relationName);
    if (relation.type !== 'table') {
      throw new Error(`Relation "${relationName}" is not editable`);
    }

    const originalRow = asRecord(input.originalRow);
    if (!originalRow || !input.rowKey || input.rowKey.kind === 'new') {
      throw new Error('Delete row payload is malformed');
    }

    const sql = buildDeleteRowStatement(relationName, input.rowKey, originalRow);
    const result = database.run(sql.sql, sql.args as any) as {changes?: number};
    if (result.changes !== 1) {
      throw new Error(`Delete affected ${result.changes ?? 0} rows`);
    }

    return await getTableRows(dbPath, relationName, input.page);
  } catch (error) {
    if (error instanceof Error && error.message.includes('\nSQL: ')) {
      throw error;
    }
    throw new Error(`${error instanceof Error ? error.message : String(error)}`);
  } finally {
    database.close();
  }
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

function buildExactRowMatchClause(row: Record<string, unknown>) {
  const entries = Object.entries(row);
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

function buildDeleteRowStatement(
  relationName: string,
  rowKey: Exclude<TableRowKey, {kind: 'new'}>,
  originalRow: Record<string, unknown>,
) {
  const rowKeyWhereClause = buildRowWhereClause(rowKey, originalRow);
  const originalRowWhereClause = buildExactRowMatchClause(originalRow);
  return {
    sql: `delete from "${escapeIdentifier(relationName)}" where (${rowKeyWhereClause.sql}) and (${originalRowWhereClause.sql})`,
    args: [...rowKeyWhereClause.args, ...originalRowWhereClause.args],
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isTableRowKey(value: unknown): value is TableRowKey {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const rowKey = value as Record<string, unknown>;
  if (rowKey.kind === 'new') {
    return typeof rowKey.value === 'string';
  }
  if (rowKey.kind === 'rowid') {
    return typeof rowKey.value === 'number';
  }
  if (rowKey.kind === 'primaryKey') {
    return !!rowKey.values && typeof rowKey.values === 'object' && !Array.isArray(rowKey.values);
  }
  return false;
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
