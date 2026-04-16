import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {ORPCError, os} from '@orpc/server';
import {RPCHandler} from '@orpc/server/fetch';
import type {ViteDevServer} from 'vite';
import {z} from 'zod';
import {resolveProjectConfig} from '../core/config.js';

import {
  analyzeAdHocSqlForConfig,
  generateQueryTypesForConfig,
} from '../typegen/index.js';
import type {QueryCatalog, QueryCatalogEntry} from '../typegen/query-catalog.js';
import type {CheckAnalysis} from '../api.js';
import {
  getCheckAnalysis,
  getMigrationResultantSchema,
  getSchemaAuthorities,
  runSqlfuCommand,
  writeDefinitionsSql,
} from '../api.js';
import {createNodeSqliteClient} from '../client.js';
import {splitSqlStatements} from '../core/sqlite.js';
import type {QueryArg, SqlfuProjectConfig} from '../core/types.js';
import type {QueryExecutionResponse, SchemaCheckCard, SchemaCheckRecommendation, SqlAnalysisResponse, SqlEditorDiagnostic, StudioColumn, TableRowKey, TableRowsResponse} from './shared.js';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(sourceDir, '..', '..');

type UiRouterContext = {
  config: SqlfuProjectConfig;
};

type ProjectResolver = (request: {
  readonly host: string;
  readonly projectHeader?: string;
}) => Promise<SqlfuProjectConfig>;

type UiAssetOptions = {
  root: string;
  distDir?: string;
  indexHtmlPath?: string;
};

export type StartSqlfuServerOptions = {
  port?: number;
  projectRoot?: string;
  defaultProjectName?: string;
  projectsRoot?: string;
  templateRoot?: string;
  dev?: boolean;
  ui?: UiAssetOptions;
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
      const database = new DatabaseSync(context.config.db);
      const client = createNodeSqliteClient(database);

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
      try {
        const analysis = await getCheckAnalysis({config: context.config});
        return {
          cards: buildSchemaCheckCards(analysis),
          recommendations: buildSchemaCheckRecommendations(analysis),
        };
      } catch (error) {
        return {
          cards: [],
          recommendations: [],
          error: String(error),
        };
      }
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
        confirmation: z.string().optional(),
      }))
      .handler(async ({context, input}) => {
        if (!input.command.trim()) {
          throw new Error('Command is required');
        }

        try {
          await runSqlfuCommand(
            {config: context.config},
            input.command,
            async (params) => {
              const body = params.body.trim();
              if (!body) {
                return null;
              }

              const confirmation = input.confirmation?.trim();
              if (!confirmation) {
                throw toClientError(new Error(`confirmation_missing:${JSON.stringify({...params, body})}`));
              }

              return confirmation;
            },
          );
        } catch (error) {
          if (error instanceof ORPCError) {
            throw error;
          }
          throw toClientError(error);
        }
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
        const database = new DatabaseSync(context.config.db);

        try {
          try {
            if (statements.length === 1) {
              try {
                const rows = executePreparedAll<Record<string, unknown>>(database.prepare(statements[0]!), params);
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
          } catch (error) {
            throw toClientError(error);
          }
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

        const database = new DatabaseSync(context.config.db);
        const client = createNodeSqliteClient(database);

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

export async function startSqlfuServer(input: StartSqlfuServerOptions = {}) {
  const resolveProject = input.projectRoot
    ? createFixedProjectResolver(path.resolve(input.projectRoot))
    : createSubdomainProjectResolver({
        projectsRoot: path.resolve(input.projectsRoot ?? path.join(packageRoot, 'test', 'projects')),
        templateRoot: path.resolve(input.templateRoot ?? path.join(packageRoot, 'test', 'template-project')),
        defaultProjectName: input.defaultProjectName ?? 'dev-project',
      });
  const rpcHandler = new RPCHandler(uiRouter);
  const httpServer = http.createServer();
  const uiAssets = input.ui ? resolveUiAssets(input.ui) : undefined;
  const vite = input.dev && uiAssets
    ? await createUiDevServer(uiAssets.root, httpServer)
    : undefined;

  httpServer.on('request', async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      const config = await resolveProject({
        host: req.headers.host ?? url.host,
        projectHeader: headerValue(req.headers['x-sqlfu-project']),
      });

      if (url.pathname.startsWith('/api/rpc')) {
        const request = await toWebRequest(req, url);
        const {matched, response} = await rpcHandler.handle(request, {
          prefix: '/api/rpc',
          context: {config},
        });
        await sendWebResponse(res, matched ? response : new Response('Not found', {status: 404}));
        return;
      }

      if (vite && uiAssets) {
        await serveViteRequest(vite, req, res, url, uiAssets.indexHtmlPath);
        return;
      }

      if (uiAssets?.distDir) {
        await serveBuiltUi(res, url, uiAssets.distDir);
        return;
      }

      await sendWebResponse(res, htmlResponse(renderServerHomePage(config), 200));
    } catch (error) {
      await sendWebResponse(res, requestErrorResponse(error, req.url ?? '/'));
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(input.port ?? 3217, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  if (vite) {
    httpServer.on('close', () => {
      void vite.close();
    });
  }

  return {
    port: getServerPort(httpServer),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    server: httpServer,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const projectRoot = readOption('--project-root');
  const port = readOption('--port');
  const dev = process.argv.includes('--dev');
  const server = await startSqlfuServer({
    projectRoot,
    defaultProjectName: readOption('--default-project') ?? undefined,
    projectsRoot: readOption('--projects-root') ?? undefined,
    templateRoot: readOption('--template-root') ?? undefined,
    port: port ? Number(port) : undefined,
    dev,
  });
  console.log(`sqlfu local server listening on http://localhost:${server.port}`);
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
    if (isInternalUnsupportedSqlAnalysisError(error)) {
      return {};
    }

    return {
      diagnostics: [toSqlEditorDiagnostic(input.sql, error)],
    };
  }
}

function isInternalUnsupportedSqlAnalysisError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    'traverse_Sql_stmtContext',
    'Not supported!',
  ].includes(message);
}

function buildSchemaCheckCards(
  analysis: CheckAnalysis,
): readonly SchemaCheckCard[] {
  const mismatchByKind = new Map(analysis.mismatches.map((mismatch) => [mismatch.kind, mismatch]));
  const recommendationKinds = new Set(analysis.recommendations.map((recommendation) => recommendation.kind));

  return [
    toSchemaCheckCard(
      'repoDrift',
      'Repo Drift',
      '✅ No Repo Drift',
      'Desired Schema matches Migrations.',
      mismatchByKind.get('repoDrift'),
    ),
    toSchemaCheckCard(
      'pendingMigrations',
      'Pending Migrations',
      '✅ No Pending Migrations',
      'Migration History matches Migrations.',
      mismatchByKind.get('pendingMigrations'),
    ),
    toSchemaCheckCard(
      'historyDrift',
      'History Drift',
      '✅ No History Drift',
      'Applied migrations still match the repo versions.',
      mismatchByKind.get('historyDrift'),
    ),
    toSchemaCheckCard(
      'schemaDrift',
      'Schema Drift',
      '✅ No Schema Drift',
      'Live Schema matches Migration History.',
      mismatchByKind.get('schemaDrift'),
    ),
    toSchemaCheckCard(
      'syncDrift',
      'Sync Drift',
      '✅ No Sync Drift',
      'Desired Schema matches Live Schema.',
      mismatchByKind.get('syncDrift'),
      recommendationKinds,
      mismatchByKind,
    ),
  ];
}

function buildSchemaCheckRecommendations(analysis: CheckAnalysis): readonly SchemaCheckRecommendation[] {
  return analysis.recommendations.map((recommendation) => ({
    kind: recommendation.kind,
    command: recommendation.command,
    label: recommendation.label,
    rationale: recommendation.rationale,
  }));
}

function toSchemaCheckCard(
  key: SchemaCheckCard['key'],
  title: string,
  okTitle: string,
  explainer: string,
  mismatch: {
    readonly kind: SchemaCheckCard['key'];
    readonly summary: string;
    readonly details: readonly string[];
  } | undefined,
  recommendationKinds?: ReadonlySet<string>,
  mismatchByKind?: ReadonlyMap<string, {
    readonly kind: SchemaCheckCard['key'];
    readonly summary: string;
    readonly details: readonly string[];
  }>,
): SchemaCheckCard {
  const variant = getSchemaCheckCardVariant(key, mismatch, recommendationKinds, mismatchByKind);
  return {
    key,
    variant,
    title,
    okTitle,
    explainer,
    ok: !mismatch,
    summary: mismatch?.summary ?? '',
    details: mismatch?.details ?? [],
  };
}

function getSchemaCheckCardVariant(
  key: SchemaCheckCard['key'],
  mismatch: {
    readonly kind: SchemaCheckCard['key'];
    readonly summary: string;
    readonly details: readonly string[];
  } | undefined,
  recommendationKinds: ReadonlySet<string> = new Set(),
  mismatchByKind: ReadonlyMap<string, {
    readonly kind: SchemaCheckCard['key'];
    readonly summary: string;
    readonly details: readonly string[];
  }> = new Map(),
): SchemaCheckCard['variant'] {
  if (!mismatch) {
    return 'ok';
  }

  if (
    key === 'syncDrift'
    && mismatchByKind.has('pendingMigrations')
    && !recommendationKinds.has('sync')
  ) {
    return 'info';
  }

  return 'warn';
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

function getRelationColumns(client: ReturnType<typeof createNodeSqliteClient>, relationName: string): readonly StudioColumn[] {
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

function getRelationCount(client: ReturnType<typeof createNodeSqliteClient>, relationName: string) {
  const rows = client.all<{count: number}>({
    sql: `select count(*) as count from "${escapeIdentifier(relationName)}"`,
    args: [],
  });
  return rows[0]?.count ?? 0;
}

async function getTableRows(dbPath: string, relationName: string, page: number): Promise<TableRowsResponse> {
  const safePage = Math.max(0, page);
  const pageSize = 25;
  const database = new DatabaseSync(dbPath);
  const client = createNodeSqliteClient(database);

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
      rowKeys: relation.type === 'table'
        ? materializedRows.map((row) => buildTableRowKey(row, primaryKeyColumns))
        : [],
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
  const database = new DatabaseSync(dbPath);
  const client = createNodeSqliteClient(database);

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
        executePreparedRun(database.prepare(sql.sql), sql.args);
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
  const database = new DatabaseSync(dbPath);
  const client = createNodeSqliteClient(database);

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
    const result = executePreparedRun(database.prepare(sql.sql), sql.args) as {changes?: number};
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
    return value as Record<string, unknown>;
  }
  throw new Error('SQL runner params must be an object or array');
}

function runSqlStatement(
  database: DatabaseSync,
  sql: string,
  params: Record<string, unknown> | readonly unknown[] | undefined,
) {
  const result = executePreparedRun(database.prepare(sql), params);
  return {
    rowsAffected: result.changes == null ? undefined : Number(result.changes),
    lastInsertRowid: result.lastInsertRowid,
  };
}

function executePreparedAll<TRow extends Record<string, unknown>>(
  statement: ReturnType<DatabaseSync['prepare']>,
  params: Record<string, unknown> | readonly unknown[] | undefined,
) {
  if (params == null) {
    return statement.all() as TRow[];
  }
  return Array.isArray(params)
    ? statement.all(...params) as TRow[]
    : statement.all(params as never) as TRow[];
}

function executePreparedRun(
  statement: ReturnType<DatabaseSync['prepare']>,
  params: Record<string, unknown> | readonly unknown[] | undefined,
) {
  if (params == null) {
    return statement.run();
  }
  return Array.isArray(params)
    ? statement.run(...params)
    : statement.run(params as never);
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

function getRelationInfo(client: ReturnType<typeof createNodeSqliteClient>, relationName: string) {
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

function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return new Response(message, {
    status: 400,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
  });
}

function toClientError(error: unknown) {
  return new ORPCError('BAD_REQUEST', {
    message: error instanceof Error ? error.message : String(error),
  });
}

function readOption(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

export async function generateCatalogForProject(projectRoot: string) {
  const config = await loadProjectConfigFrom(projectRoot);
  await generateQueryTypesForConfig(config);
}

function createFixedProjectResolver(projectRoot: string): ProjectResolver {
  let configPromise: Promise<SqlfuProjectConfig> | undefined;
  return async () => {
    configPromise ??= loadProjectConfigFrom(projectRoot);
    return await configPromise;
  };
}

function createSubdomainProjectResolver(input: {
  projectsRoot: string;
  templateRoot: string;
  defaultProjectName: string;
}): ProjectResolver {
  const initPromises = new Map<string, Promise<SqlfuProjectConfig>>();

  return async ({host, projectHeader}) => {
    const projectName = projectNameFromRequest({
      host,
      projectHeader,
      defaultProjectName: input.defaultProjectName,
    });
    const existing = initPromises.get(projectName);
    if (existing) {
      return await existing;
    }

    const next = ensureProjectConfig({
      projectName,
      projectsRoot: input.projectsRoot,
      templateRoot: input.templateRoot,
    }).finally(() => {
      initPromises.delete(projectName);
    });
    initPromises.set(projectName, next);
    return await next;
  };
}

async function ensureProjectConfig(input: {
  projectName: string;
  projectsRoot: string;
  templateRoot: string;
}) {
  const projectRoot = path.join(input.projectsRoot, input.projectName);
  await ensureProjectFiles({
    projectRoot,
    projectsRoot: input.projectsRoot,
    templateRoot: input.templateRoot,
  });
  await ensureDatabase(projectRoot);
  return await loadProjectConfigFrom(projectRoot);
}

async function ensureProjectFiles(input: {
  projectRoot: string;
  projectsRoot: string;
  templateRoot: string;
}) {
  await fs.mkdir(input.projectsRoot, {recursive: true});
  try {
    await fs.access(input.projectRoot);
    return;
  } catch {}
  await fs.cp(input.templateRoot, input.projectRoot, {recursive: true});
}

async function ensureDatabase(projectRoot: string) {
  const dbPath = path.join(projectRoot, 'app.db');
  try {
    await fs.access(dbPath);
    return;
  } catch {}

  const database = new DatabaseSync(dbPath);
  try {
    const definitionsSql = await fs.readFile(path.join(projectRoot, 'definitions.sql'), 'utf8');
    try {
      database.exec(definitionsSql);
      database.exec(`
        insert into posts (slug, title, body, published) values
          ('hello-world', 'Hello World', 'First post body', 1),
          ('draft-notes', 'Draft Notes', 'Unpublished notes', 0);
      `);
    } catch (error) {
      console.warn(
        `sqlfu/ui could not initialize ${path.basename(projectRoot)} from definitions.sql: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } finally {
    database.close();
  }
}

async function loadProjectConfigFrom(projectRoot: string) {
  const configPath = path.join(projectRoot, 'sqlfu.config.ts');
  const configModule = await importConfigFile(configPath);
  return resolveProjectConfig(configModule, configPath);
}

async function importConfigFile(configPath: string) {
  const moduleUrl = new URL(pathToFileURL(configPath).href);
  moduleUrl.searchParams.set('t', String(Date.now()));
  const loaded = await import(moduleUrl.href);
  const config = loaded.default ?? loaded.config ?? loaded;

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`Invalid sqlfu config at ${configPath}: expected a default-exported object.`);
  }

  return config as {
    readonly db: string;
    readonly migrationsDir: string;
    readonly definitionsPath: string;
    readonly sqlDir: string;
    readonly generatedImportExtension?: '.js' | '.ts';
  };
}

function projectNameFromRequest(input: {
  host: string;
  projectHeader?: string;
  defaultProjectName: string;
}) {
  const projectName = input.projectHeader?.trim();
  if (projectName) {
    if (!/^[a-z0-9-]+$/.test(projectName)) {
      throw new Error(`Invalid project name in x-sqlfu-project header: ${projectName}`);
    }
    return projectName;
  }

  return projectNameFromHost(input.host, input.defaultProjectName);
}

function projectNameFromHost(host: string, defaultProjectName: string) {
  const hostname = host.split(':')[0] ?? host;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return defaultProjectName;
  }
  if (!hostname.endsWith('.localhost')) {
    throw new Error(`Unsupported host: ${host}`);
  }

  const projectName = hostname.slice(0, -'.localhost'.length);
  if (!/^[a-z0-9-]+$/.test(projectName)) {
    throw new Error(`Invalid project name in host: ${host}`);
  }
  return projectName;
}

async function toWebRequest(req: http.IncomingMessage, url: URL) {
  const method = req.method ?? 'GET';
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
      continue;
    }
    if (value != null) {
      headers.set(name, value);
    }
  }

  const body = method === 'GET' || method === 'HEAD'
    ? undefined
    : await readIncomingMessage(req);

  return new Request(url, {
    method,
    headers,
    body,
  } satisfies RequestInit);
}

async function sendWebResponse(res: http.ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
  const body = response.body ? Buffer.from(await response.arrayBuffer()) : undefined;
  res.end(body);
}

async function serveViteRequest(
  vite: ViteDevServer,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  indexHtmlPath: string,
) {
  await new Promise<void>((resolve, reject) => {
    vite.middlewares(req, res, (error: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  if (res.writableEnded) {
    return;
  }

  const template = await fs.readFile(indexHtmlPath, 'utf8');
  const html = await vite.transformIndexHtml(url.pathname, template);
  await sendWebResponse(res, htmlResponse(html, 200));
}

async function serveBuiltUi(res: http.ServerResponse, url: URL, distDir: string) {
  const relativePath = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const candidatePath = path.join(distDir, relativePath);

  if (isInsideDist(candidatePath, distDir)) {
    try {
      const file = await fs.readFile(candidatePath);
      await sendWebResponse(res, new Response(file, {
        headers: {
          'content-type': contentTypeForPath(candidatePath),
        },
      }));
      return;
    } catch {}
  }

  const indexHtml = await fs.readFile(path.join(distDir, 'index.html'), 'utf8');
  await sendWebResponse(res, htmlResponse(indexHtml, 200));
}

function isInsideDist(candidatePath: string, distDir: string) {
  const relative = path.relative(distDir, candidatePath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function contentTypeForPath(filePath: string) {
  if (filePath.endsWith('.js')) {
    return 'text/javascript; charset=utf-8';
  }
  if (filePath.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  if (filePath.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }
  if (filePath.endsWith('.json')) {
    return 'application/json; charset=utf-8';
  }
  if (filePath.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  return 'application/octet-stream';
}

function resolveUiAssets(input: UiAssetOptions) {
  const root = path.resolve(input.root);
  return {
    root,
    distDir: input.distDir ? path.resolve(input.distDir) : path.join(root, 'dist'),
    indexHtmlPath: path.resolve(input.indexHtmlPath ?? path.join(root, 'index.html')),
  };
}

async function createUiDevServer(root: string, httpServer: http.Server) {
  const {createServer} = await import('vite');
  return createServer({
    root,
    appType: 'custom',
    server: {
      middlewareMode: true,
      hmr: {
        server: httpServer,
      },
    },
  });
}

function requestErrorResponse(error: unknown, requestPath: string) {
  if (requestPath.startsWith('/api/rpc')) {
    return apiError(error);
  }
  return htmlResponse(renderErrorPage(error), 400);
}

function htmlResponse(html: string, status: number) {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
    },
  });
}

function renderServerHomePage(config: SqlfuProjectConfig) {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '  <title>sqlfu local server</title>',
    '  <style>',
    '    :root { color-scheme: light; font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif; }',
    '    body { margin: 0; background: linear-gradient(180deg, #f8f0df 0%, #fffdf8 100%); color: #1f1a14; }',
    '    main { max-width: 48rem; margin: 0 auto; padding: 4rem 1.5rem 5rem; }',
    '    .eyebrow { letter-spacing: 0.12em; text-transform: uppercase; font: 600 0.72rem/1.4 ui-monospace, SFMono-Regular, monospace; color: #8a5a22; }',
    '    h1 { font-size: clamp(2.6rem, 8vw, 4.8rem); line-height: 0.95; margin: 0.5rem 0 1rem; }',
    '    p { font-size: 1.08rem; line-height: 1.7; margin: 0.75rem 0; }',
    '    code { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.95em; }',
    '    .card { margin-top: 2rem; padding: 1.1rem 1.2rem; border: 1px solid #d9c7aa; border-radius: 1rem; background: rgba(255,255,255,0.72); }',
    '    a { color: #7a3e00; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <main>',
    '    <div class="eyebrow">sqlfu local backend</div>',
    '    <h1>Local project server is running.</h1>',
    `    <p>This backend is serving the sqlfu project at <code>${escapeHtml(config.projectRoot)}</code>.</p>`,
    '    <p>Use the UI against this origin via <code>local.sqlfu.dev</code>, or point a client at <code>/api/rpc</code>.</p>',
    '    <div class="card">',
    '      <p><strong>API base:</strong> <code>/api/rpc</code></p>',
    '      <p><strong>Configured database:</strong> <code>' + escapeHtml(config.db) + '</code></p>',
    '      <p><a href="https://www.sqlfu.dev">Open docs on www.sqlfu.dev</a></p>',
    '    </div>',
    '  </main>',
    '</body>',
    '</html>',
  ].join('\n');
}

function renderErrorPage(error: unknown) {
  const message = escapeHtml(error instanceof Error ? error.message : String(error));
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '  <title>sqlfu local server error</title>',
    '  <style>',
    '    body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #fcf7f1; color: #23170f; }',
    '    main { max-width: 42rem; margin: 0 auto; padding: 3rem 1.5rem 4rem; }',
    '    h1 { font-size: 2rem; margin-bottom: 0.75rem; }',
    '    pre { white-space: pre-wrap; padding: 1rem; border-radius: 0.75rem; background: #fff; border: 1px solid #e2d6c9; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <main>',
    '    <h1>sqlfu could not serve this request.</h1>',
    '    <p>The local backend is running, but this request could not be handled.</p>',
    `    <pre>${message}</pre>`,
    '  </main>',
    '</body>',
    '</html>',
  ].join('\n');
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function getServerPort(server: http.Server) {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server to listen on a TCP port');
  }
  return address.port;
}

async function readIncomingMessage(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function headerValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
