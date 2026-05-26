import {ORPCError, os} from '@orpc/server';
import {z} from 'zod';

import packageJson from '../../package.json' with {type: 'json'};
import {
  getCheckAnalysis,
  getMigrationResultantSchema,
  getSchemaAuthorities,
  runSqlfuCommand,
  writeDefinitionsSql,
  type CheckAnalysis,
  type SqlfuCommandConfirmParams,
} from '../api/internal.js';
import {type Dialect, sqliteDialect} from '../dialect.js';
import {SqlfuError, type SqlfuErrorKind} from '../errors.js';
import {sqlReturnsRows} from '../sqlite-text.js';
import type {
  AdHocSqlParams,
  AdHocSqlResult,
  DisposableClient,
  HostCatalog,
  HostFs,
  SqlfuHost,
  SqlfuUiHost,
} from '../host.js';
import type {Client, PreparedStatementParams, QueryArg, SqlfuProjectConfig} from '../types.js';
import {basename, joinPath} from '../paths.js';
import type {QueryCatalogEntry} from '../typegen/query-catalog.js';
import {sha256} from '../vendor/sha256.js';
import type {
  QueryExecutionResponse,
  SchemaCheckCard,
  SchemaCheckRecommendation,
  SqlEditorDiagnostic,
  StudioColumn,
  StudioForeignKey,
  StudioReverseForeignKey,
  TableRowKey,
  TableRowsResponse,
} from './shared.js';

export type ResolvedUiProject =
  | {
      initialized: true;
      projectRoot: string;
      config: SqlfuProjectConfig;
    }
  | {
      initialized: false;
      projectRoot: string;
      configPath: string;
    };

export type SqlfuUiProjectConfig = Partial<Omit<SqlfuProjectConfig, 'generate'>> & {
  generate?: Partial<SqlfuProjectConfig['generate']>;
};

export type SqlfuUiProject =
  | {
      initialized: true;
      projectRoot: string;
      config?: SqlfuUiProjectConfig;
    }
  | {
      initialized: false;
      projectRoot: string;
      configPath?: string;
    };

export type UiRouterContext = {
  project: SqlfuUiProject;
  host: SqlfuUiHost;
};

type ResolvedSqlfuUiHost = Omit<SqlfuHost, 'openDb' | 'openScratchDb' | 'execAdHocSql'> & {
  openDb(config: SqlfuProjectConfig): Promise<DisposableClient>;
  openScratchDb(slug: string): Promise<DisposableClient>;
  execAdHocSql(client: Client, sql: string, params: AdHocSqlParams): Promise<AdHocSqlResult>;
};

const uiBase = os.$context<UiRouterContext>().use(async ({next, context}) => {
  try {
    return await next({
      context: {
        ...context,
        project: applyUiProjectDefaults(context.project),
        host: applyUiHostDefaults(context.host),
      },
    });
  } catch (error) {
    throw toOrpcError(error);
  }
});
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

type SqlRunnerParams = PreparedStatementParams | undefined;

function applyUiProjectDefaults(project: SqlfuUiProject): ResolvedUiProject {
  if (!project.initialized) {
    return {
      initialized: false,
      projectRoot: project.projectRoot,
      configPath: project.configPath || joinPath(project.projectRoot, 'sqlfu.config.ts'),
    };
  }

  const config = project.config || {};
  const projectRoot = config.projectRoot || project.projectRoot;
  const generate = config.generate || {};
  return {
    initialized: true,
    projectRoot,
    config: {
      projectRoot,
      db: config.db,
      definitions: config.definitions || joinPath(projectRoot, 'definitions.sql'),
      migrations: config.migrations,
      queries: config.queries || joinPath(projectRoot, 'sql'),
      generate: {
        validator: generate.validator || null,
        prettyErrors: generate.prettyErrors !== false,
        sync: generate.sync === true,
        experimentalJsonTypes: generate.experimentalJsonTypes === true,
        casing: generate.casing || 'camel',
        runtime: generate.runtime || 'sqlfu',
        importExtension: generate.importExtension || '.js',
        authority: generate.authority || 'live_schema',
      },
      dialect: config.dialect || sqliteDialect(),
    },
  };
}

function applyUiHostDefaults(host: SqlfuUiHost): ResolvedSqlfuUiHost {
  const fs = host.fs || unsupportedFs;
  return {
    fs,
    openDb: host.openDb,
    openScratchDb: host.openScratchDb || unsupportedOpenScratchDb,
    execAdHocSql: host.execAdHocSql || execAdHocSql,
    initializeProject: host.initializeProject || unsupportedInitializeProject,
    digest: host.digest || ((content) => Promise.resolve(sha256Hex(content))),
    now: host.now || (() => new Date()),
    uuid: host.uuid || (() => globalThis.crypto.randomUUID()),
    logger: host.logger || console,
    catalog: host.catalog || emptyCatalog,
  };
}

const unsupportedFs: HostFs = {
  readFile: unsupportedFileSystemOperation,
  writeFile: unsupportedFileSystemOperation,
  readdir: unsupportedFileSystemOperation,
  mkdir: unsupportedFileSystemOperation,
  rm: unsupportedFileSystemOperation,
  rename: unsupportedFileSystemOperation,
  exists: unsupportedFileSystemOperation,
};

async function unsupportedFileSystemOperation(): Promise<never> {
  throw new UnsupportedUiHostFeatureError('File system operations are not supported by this sqlfu UI host');
}

async function unsupportedOpenScratchDb(): Promise<never> {
  throw new UnsupportedUiHostFeatureError('Scratch databases are not supported by this sqlfu UI host');
}

async function unsupportedInitializeProject(): Promise<never> {
  throw new UnsupportedUiHostFeatureError('Project initialization is not supported by this sqlfu UI host');
}

const emptyCatalog: HostCatalog = {
  async load() {
    return {
      generatedAt: new Date(0).toISOString(),
      queries: [],
    };
  },
  async refresh() {},
  async analyzeSql() {
    return {};
  },
};

function sha256Hex(content: string) {
  const bytes = sha256(new TextEncoder().encode(content));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

class UnsupportedUiHostFeatureError extends Error {}

export const uiRouter = {
  project: {
    status: uiBase.handler(({context}) => ({
      initialized: context.project.initialized,
      projectRoot: context.project.projectRoot,
      serverVersion: packageJson.version,
    })),
  },
  schema: {
    get: uiBase.handler(async ({context}) => {
      const config = requireProjectConfig(context.project);
      await using database = await context.host.openDb(config);
      const client = database.client;
      const relations = await config.dialect.listLiveRelations(client);
      const foreignKeysByRelation = new Map<string, StudioForeignKey[]>();
      for (const relation of relations) {
        foreignKeysByRelation.set(relation.name, await config.dialect.getRelationForeignKeys(client, relation.name));
      }

      return {
        projectName: basename(config.projectRoot),
        projectRoot: config.projectRoot,
        relations: await Promise.all(
          relations.map(async (relation) => ({
            name: relation.name,
            kind: relation.kind,
            rowCount: await getRelationCount(client, config.dialect, relation.name),
            columns: await config.dialect.getRelationColumns(client, relation.name),
            foreignKeys: foreignKeysByRelation.get(relation.name) || [],
            referencedBy: buildReverseForeignKeys(relation.name, foreignKeysByRelation),
            sql: relation.sql,
          })),
        ),
      };
    }),
    check: uiBase.handler(async ({context}) => {
      const config = requireProjectConfig(context.project);
      try {
        const analysis = await getCheckAnalysis({config, host: context.host as SqlfuHost});
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
        const authorities =
          context.host.fs === unsupportedFs
            ? {
                desiredSchemaSql: '',
                migrations: [],
                migrationHistory: [],
                liveSchemaSql: '',
              }
            : await getSchemaAuthorities({
                config: requireProjectConfig(context.project),
                host: context.host as SqlfuHost,
              });
        return {
          desiredSchemaSql: authorities.desiredSchemaSql,
          migrations: authorities.migrations.map((migration) => ({
            ...parseMigrationId(migration.id),
            id: migration.id,
            fileName: migration.fileName,
            content: migration.content,
            applied: migration.applied,
            applied_at: migration.applied_at,
            integrity: migration.integrity,
          })),
          migrationHistory: authorities.migrationHistory.map((migration) => ({
            ...parseMigrationId(migration.id),
            id: migration.id,
            fileName: migration.fileName,
            content: migration.content,
            applied: migration.applied,
            applied_at: migration.applied_at,
            integrity: migration.integrity,
          })),
          liveSchemaSql: authorities.liveSchemaSql,
        };
      }),
      resultantSchema: uiBase
        .input(
          z.object({
            source: z.enum(['migrations', 'history']),
            id: z.string(),
          }),
        )
        .handler(async ({context, input}) => {
          if (!input.id.trim()) {
            throw new Error('Migration id is required');
          }

          return {
            sql: await getMigrationResultantSchema(
              {config: requireProjectConfig(context.project), host: context.host as SqlfuHost},
              input,
            ),
          };
        }),
    },
    command: uiBase
      .input(
        z.object({
          command: z.string(),
        }),
      )
      .handler(async function* ({context, input}): AsyncGenerator<CommandEvent> {
        if (!input.command.trim()) {
          throw new Error('Command is required');
        }

        const queue = createCommandEventQueue();
        runSqlfuCommand(
          {
            projectRoot: context.project.projectRoot,
            configPath: context.project.initialized ? undefined : context.project.configPath,
            config: context.project.initialized ? context.project.config : undefined,
            host: context.host as SqlfuHost,
          },
          input.command,
          async (params) => {
            const body = params.body.trim();
            if (!body) {
              return null;
            }
            return await queue.request(params);
          },
        ).then(
          () => queue.finish(),
          (error) => queue.fail(toOrpcError(error)),
        );

        try {
          yield* queue.drain();
        } finally {
          queue.dispose();
        }
      }),
    submitConfirmation: uiBase
      .input(
        z.object({
          id: z.string(),
          body: z.string().nullable(),
        }),
      )
      .handler(({input}) => {
        resolvePendingConfirmation(input.id, input.body);
        return {ok: true as const};
      }),
    definitions: uiBase
      .input(
        z.object({
          sql: z.string(),
        }),
      )
      .handler(async ({context, input}) => {
        if (!input.sql.trim()) {
          throw new Error('Desired Schema is required');
        }

        await writeDefinitionsSql(
          {config: requireProjectConfig(context.project), host: context.host as SqlfuHost},
          input.sql,
        );
        return {ok: true} as const;
      }),
  },
  catalog: uiBase.handler(({context}) => context.host.catalog.load(requireProjectConfig(context.project))),
  table: {
    list: uiBase
      .input(
        z.object({
          relationName: z.string(),
          page: z.number().int(),
          pageSize: z.number().int().min(1).max(1000),
        }),
      )
      .handler(async ({context, input}) => {
        const config = requireProjectConfig(context.project);
        await using database = await context.host.openDb(config);
        return await getTableRows(database.client, config.dialect, input.relationName, input.page, input.pageSize);
      }),
    save: uiBase
      .input(
        z.object({
          relationName: z.string(),
          page: z.number().int(),
          pageSize: z.number().int().min(1).max(1000),
          originalRows: z.array(rowRecordSchema),
          rows: z.array(rowRecordSchema),
          rowKeys: z.array(tableRowKeySchema),
        }),
      )
      .handler(async ({context, input}) => {
        const config = requireProjectConfig(context.project);
        await using database = await context.host.openDb(config);
        return await saveTableRows(database.client, config.dialect, input.relationName, input);
      }),
    delete: uiBase
      .input(
        z.object({
          relationName: z.string(),
          page: z.number().int(),
          pageSize: z.number().int().min(1).max(1000),
          originalRow: rowRecordSchema,
          rowKey: tableRowKeySchema,
        }),
      )
      .handler(async ({context, input}) => {
        const config = requireProjectConfig(context.project);
        await using database = await context.host.openDb(config);
        return await deleteTableRow(database.client, config.dialect, input.relationName, input);
      }),
  },
  sql: {
    run: uiBase
      .input(
        z.object({
          sql: z.string(),
          params: z.unknown().optional(),
        }),
      )
      .handler(async ({context, input}) => {
        const config = requireProjectConfig(context.project);
        const trimmedSql = input.sql.trim();
        if (!trimmedSql) {
          throw new Error('SQL is required');
        }

        const params = normalizeSqlRunnerParams(input.params);
        await using database = await context.host.openDb(config);
        try {
          const result = await execAdHocSql(database.client, trimmedSql, params);
          if (result.mode === 'rows') {
            return {
              sql: trimmedSql,
              mode: 'rows' as const,
              rows: result.rows.map(materializeRow),
            };
          }
          return {
            sql: trimmedSql,
            mode: 'metadata' as const,
            metadata: result.metadata,
          };
        } catch (error) {
          throw toOrpcError(error);
        }
      }),
    analyze: uiBase
      .input(
        z.object({
          sql: z.string(),
        }),
      )
      .handler(({context, input}) => context.host.catalog.analyzeSql(requireProjectConfig(context.project), input.sql)),
    save: uiBase
      .input(
        z.object({
          sql: z.string(),
          name: z.string(),
        }),
      )
      .handler(async ({context, input}) => {
        const config = requireProjectConfig(context.project);
        const sql = input.sql.trim();
        if (!sql) {
          throw new Error('SQL is required');
        }

        const baseName = slugifyQueryName(input.name);
        if (!baseName) {
          throw new Error('Query name is required');
        }

        const relativePath = `sql/${baseName}.sql`;
        const targetPath = joinPath(config.projectRoot, relativePath);
        await context.host.fs.writeFile(targetPath, `${sql}\n`);
        await context.host.catalog.refresh(config);
        return {savedPath: relativePath};
      }),
  },
  query: {
    execute: uiBase
      .input(
        z.object({
          queryId: z.string(),
          data: z.record(z.string(), z.unknown()).optional(),
          params: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .handler(async ({context, input}): Promise<QueryExecutionResponse> => {
        const config = requireProjectConfig(context.project);
        const catalog = await context.host.catalog.load(config);
        const query = catalog.queries.find((entry) => entry.id === input.queryId);
        if (!query || query.kind !== 'query') {
          throw new Error(`Unknown query: ${input.queryId}`);
        }

        const args = query.args.flatMap((arg) => {
          const source = arg.scope === 'data' ? input.data : input.params;
          return encodeArgument(arg, source?.[arg.name]);
        }) as QueryArg[];

        await using database = await context.host.openDb(config);
        if (query.resultMode === 'metadata') {
          return {
            mode: 'metadata',
            metadata: await database.client.run({sql: query.sql, args}),
          };
        }
        return {
          mode: 'rows',
          rows: (await database.client.all({sql: query.sql, args})).map(materializeRow),
        };
      }),
    update: uiBase
      .input(
        z.object({
          queryId: z.string(),
          sql: z.string(),
        }),
      )
      .handler(async ({context, input}) => {
        const config = requireProjectConfig(context.project);
        const catalog = await context.host.catalog.load(config);
        const query = catalog.queries.find((entry) => entry.id === input.queryId);
        if (!query) {
          throw new Error(`Unknown query: ${input.queryId}`);
        }
        const sql = input.sql.trim();
        if (!sql) {
          throw new Error('SQL is required');
        }

        await context.host.fs.writeFile(joinPath(config.projectRoot, query.sqlFile), `${sql}\n`);
        await context.host.catalog.refresh(config);
        return {
          id: query.id,
          sqlFile: query.sqlFile,
        };
      }),
    rename: uiBase
      .input(
        z.object({
          queryId: z.string(),
          name: z.string(),
        }),
      )
      .handler(async ({context, input}) => {
        const config = requireProjectConfig(context.project);
        const catalog = await context.host.catalog.load(config);
        const query = catalog.queries.find((entry) => entry.id === input.queryId);
        if (!query) {
          throw new Error(`Unknown query: ${input.queryId}`);
        }
        const nextId = slugifyQueryName(input.name);
        if (!nextId) {
          throw new Error('Query name is required');
        }

        const nextRelativePath = `sql/${nextId}.sql`;
        const nextPath = joinPath(config.projectRoot, nextRelativePath);
        await context.host.fs.rename(joinPath(config.projectRoot, query.sqlFile), nextPath);
        await context.host.catalog.refresh(config);
        return {
          id: nextId,
          sqlFile: nextRelativePath,
        };
      }),
    delete: uiBase
      .input(
        z.object({
          queryId: z.string(),
        }),
      )
      .handler(async ({context, input}) => {
        const config = requireProjectConfig(context.project);
        const catalog = await context.host.catalog.load(config);
        const query = catalog.queries.find((entry) => entry.id === input.queryId);
        if (!query) {
          throw new Error(`Unknown query: ${input.queryId}`);
        }
        await context.host.fs.rm(joinPath(config.projectRoot, query.sqlFile), {force: true});
        await context.host.catalog.refresh(config);
        return {
          id: query.id,
          sqlFile: query.sqlFile,
        };
      }),
  },
};

export type UiRouter = typeof uiRouter;

export type CommandEvent =
  | {
      kind: 'needsConfirmation';
      id: string;
      params: SqlfuCommandConfirmParams;
    }
  | {
      kind: 'done';
    };

type PendingConfirmation = {
  resolve: (body: string | null) => void;
  reject: (error: unknown) => void;
};

const pendingConfirmations = new Map<string, PendingConfirmation>();

function resolvePendingConfirmation(id: string, body: string | null) {
  const pending = pendingConfirmations.get(id);
  if (!pending) {
    throw new ORPCError('NOT_FOUND', {message: `Unknown confirmation id: ${id}`});
  }
  pendingConfirmations.delete(id);
  pending.resolve(body);
}

type QueueItem = {kind: 'event'; event: CommandEvent} | {kind: 'error'; error: unknown};

function createCommandEventQueue() {
  const pendingIds = new Set<string>();
  const buffer: QueueItem[] = [];
  let notify: (() => void) | null = null;
  let finished = false;

  const poke = () => {
    const listener = notify;
    notify = null;
    listener?.();
  };

  return {
    async request(params: SqlfuCommandConfirmParams): Promise<string | null> {
      const id = crypto.randomUUID();
      pendingIds.add(id);
      try {
        return await new Promise<string | null>((resolve, reject) => {
          pendingConfirmations.set(id, {resolve, reject});
          buffer.push({kind: 'event', event: {kind: 'needsConfirmation', id, params}});
          poke();
        });
      } finally {
        pendingIds.delete(id);
      }
    },
    finish() {
      buffer.push({kind: 'event', event: {kind: 'done'}});
      finished = true;
      poke();
    },
    fail(error: unknown) {
      buffer.push({kind: 'error', error});
      finished = true;
      poke();
    },
    async *drain(): AsyncGenerator<CommandEvent> {
      while (true) {
        while (buffer.length > 0) {
          const item = buffer.shift()!;
          if (item.kind === 'error') {
            throw item.error;
          }
          yield item.event;
          if (item.event.kind === 'done') {
            return;
          }
        }
        if (finished) {
          return;
        }
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
    },
    dispose() {
      for (const id of pendingIds) {
        const pending = pendingConfirmations.get(id);
        pendingConfirmations.delete(id);
        pending?.reject(new Error('Confirmation request cancelled'));
      }
      pendingIds.clear();
      buffer.length = 0;
      finished = true;
      poke();
    },
  };
}

function requireProjectConfig(project: ResolvedUiProject) {
  if (!project.initialized) {
    throw new ORPCError('BAD_REQUEST', {
      message: `No sqlfu config found in ${project.projectRoot}. Run 'sqlfu init' first.`,
    });
  }

  return project.config;
}

function kindToOrpcCode(kind: SqlfuErrorKind): string {
  switch (kind) {
    case 'unique_violation':
      return 'CONFLICT';
    case 'transient':
      return 'SERVICE_UNAVAILABLE';
    case 'unknown':
      return 'INTERNAL_SERVER_ERROR';
    case 'syntax':
    case 'missing_table':
    case 'missing_column':
    case 'not_null_violation':
    case 'foreign_key_violation':
    case 'check_violation':
      return 'BAD_REQUEST';
  }
}

// A `SqlfuError` carries a classified `kind` — the oRPC middleware maps it to
// the appropriate HTTP code and surfaces `kind` on `data` so the React side can
// branch on specific outcomes (`unique_violation` → "email taken" toast, etc.)
// instead of string-matching the message.
function toOrpcError(error: unknown): ORPCError<string, unknown> {
  if (error instanceof ORPCError) return error;
  if (error instanceof SqlfuError) {
    return new ORPCError(kindToOrpcCode(error.kind), {
      message: error.message,
      data: {kind: error.kind},
    });
  }
  return new ORPCError('INTERNAL_SERVER_ERROR', {message: String(error)});
}

function buildSchemaCheckCards(analysis: CheckAnalysis): SchemaCheckCard[] {
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

function buildSchemaCheckRecommendations(analysis: CheckAnalysis): SchemaCheckRecommendation[] {
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
  mismatch:
    | {
        kind: SchemaCheckCard['key'];
        summary: string;
        details: string[];
      }
    | undefined,
  recommendationKinds?: ReadonlySet<string>,
  mismatchByKind?: ReadonlyMap<
    string,
    {
      kind: SchemaCheckCard['key'];
      summary: string;
      details: string[];
    }
  >,
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
  mismatch:
    | {
        kind: SchemaCheckCard['key'];
        summary: string;
        details: string[];
      }
    | undefined,
  recommendationKinds: ReadonlySet<string> = new Set(),
  mismatchByKind: ReadonlyMap<
    string,
    {
      kind: SchemaCheckCard['key'];
      summary: string;
      details: string[];
    }
  > = new Map(),
): SchemaCheckCard['variant'] {
  if (!mismatch) {
    return 'ok';
  }

  if (key === 'syncDrift' && mismatchByKind.has('pendingMigrations') && !recommendationKinds.has('sync')) {
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

function encodeArgument(arg: Extract<QueryCatalogEntry, {kind: 'query'}>['args'][number], value: unknown): QueryArg[] {
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
    return typeof value === 'string' ? value.split('T')[0]! : String(value);
  }
  if (encoding === 'datetime') {
    if (typeof value !== 'string') {
      return String(value);
    }
    return value.replace('T', ' ').replace(/\.\d+Z?$/, '');
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean' ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  return JSON.stringify(value);
}

async function getRelationCount(client: Client, dialect: Dialect, relationName: string) {
  const rows = await client.all<{count: number | string}>({
    sql: `select count(*) as count from ${dialect.quoteIdentifier(relationName)}`,
    args: [],
  });
  return Number(rows[0]?.count ?? 0);
}

function buildReverseForeignKeys(
  relationName: string,
  foreignKeysByRelation: Map<string, StudioForeignKey[]>,
): StudioReverseForeignKey[] {
  const reverse: StudioReverseForeignKey[] = [];
  for (const [sourceRelation, foreignKeys] of foreignKeysByRelation) {
    for (const foreignKey of foreignKeys) {
      if (foreignKey.referencedRelation !== relationName) {
        continue;
      }
      reverse.push({
        relation: sourceRelation,
        columns: foreignKey.columns,
        referencedColumns: foreignKey.referencedColumns,
      });
    }
  }
  return reverse;
}

async function getTableRows(
  client: Client,
  dialect: Dialect,
  relationName: string,
  page: number,
  pageSize: number,
): Promise<TableRowsResponse> {
  const safePage = Math.max(0, page);
  const relation = await dialect.getRelationInfo(client, relationName);
  const relationColumns = await dialect.getRelationColumns(client, relationName);
  const columns = relationColumns.map((column) => column.name);
  const primaryKeyColumns = relationColumns.filter((column) => column.primaryKey).map((column) => column.name);
  // sqlite-only: when a table lacks an explicit primary key, fall back
  // to the `rowid` pseudo-column so we can still build stable row keys.
  // Pg has no equivalent (`ctid` shifts on VACUUM, `oid` is deprecated),
  // so for pg we just degrade to a non-editable view of the rows. A
  // user who wants to edit a pg table without a PK has to add one.
  const includeRowid =
    dialect.name === 'sqlite' && relation.kind === 'table' && primaryKeyColumns.length === 0;
  const editable = relation.kind === 'table' && (primaryKeyColumns.length > 0 || includeRowid);
  const quoted = dialect.quoteIdentifier(relationName);
  const rows = await client.all<Record<string, unknown>>({
    sql: `select ${includeRowid ? 'rowid as "__sqlfu_rowid__", ' : ''}* from ${quoted} limit ? offset ?`,
    args: [pageSize, safePage * pageSize],
  });
  const materializedRows = rows.map(materializeRow);

  return {
    relation: relationName,
    page: safePage,
    pageSize,
    editable,
    rowKeys: editable ? materializedRows.map((row) => buildTableRowKey(row, primaryKeyColumns)) : [],
    columns,
    rows: materializedRows.map(stripInternalRowValues),
  };
}

async function saveTableRows(
  client: Client,
  dialect: Dialect,
  relationName: string,
  input: {
    page: number;
    pageSize: number;
    originalRows: unknown[];
    rows: unknown[];
    rowKeys: TableRowKey[];
  },
): Promise<TableRowsResponse> {
  const relation = await dialect.getRelationInfo(client, relationName);
  if (relation.kind !== 'table') {
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

    const changedColumns = Object.keys(normalizedNextRow).filter(
      (column) => !isSameValue(normalizedNextRow[column], originalRow[column]),
    );
    if (changedColumns.length === 0) {
      return [];
    }

    return [
      {
        rowKey: input.rowKeys[index]!,
        originalRow,
        nextRow: normalizedNextRow,
        changedColumns,
      },
    ];
  });

  for (const row of changedRows) {
    const statement =
      row.rowKey.kind === 'new'
        ? buildInsertRowStatement(dialect, relationName, row.nextRow, row.changedColumns)
        : buildUpdateRowStatement(dialect, relationName, row.rowKey, row.originalRow, row.nextRow, row.changedColumns);
    await client.run({sql: statement.sql, args: statement.args as QueryArg[]});
  }

  return await getTableRows(client, dialect, relationName, input.page, input.pageSize);
}

async function deleteTableRow(
  client: Client,
  dialect: Dialect,
  relationName: string,
  input: {
    page: number;
    pageSize: number;
    originalRow: unknown;
    rowKey: TableRowKey | undefined;
  },
): Promise<TableRowsResponse> {
  const relation = await dialect.getRelationInfo(client, relationName);
  if (relation.kind !== 'table') {
    throw new Error(`Relation "${relationName}" is not editable`);
  }

  const originalRow = asRecord(input.originalRow);
  if (!originalRow || !input.rowKey || input.rowKey.kind === 'new') {
    throw new Error('Delete row payload is malformed');
  }

  const statement = buildDeleteRowStatement(dialect, relationName, input.rowKey, originalRow);
  const result = await client.run({sql: statement.sql, args: statement.args as QueryArg[]});
  if (result.rowsAffected !== 1) {
    throw new Error(`Delete affected ${result.rowsAffected ?? 0} rows`);
  }

  return await getTableRows(client, dialect, relationName, input.page, input.pageSize);
}

function slugifyQueryName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function execAdHocSql(client: Client, sql: string, params: SqlRunnerParams) {
  const stmt = client.prepare(sql);
  try {
    if (sqlReturnsRows(sql)) {
      return {
        mode: 'rows' as const,
        rows: await stmt.all(params),
      };
    }
    return {
      mode: 'metadata' as const,
      metadata: await stmt.run(params),
    };
  } finally {
    await disposePreparedStatement(stmt);
  }
}

async function disposePreparedStatement(stmt: ReturnType<Client['prepare']>) {
  if (Symbol.asyncDispose in stmt) {
    await stmt[Symbol.asyncDispose]();
    return;
  }
  (stmt as unknown as {[Symbol.dispose]?: () => void})[Symbol.dispose]?.();
}

function normalizeSqlRunnerParams(value: unknown): SqlRunnerParams {
  if (value == null || value === '') {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value as QueryArg[];
  }
  if (typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  throw new Error('SQL runner params must be an object or array');
}

function materializeRow(row: object) {
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

function buildTableRowKey(row: Record<string, unknown>, primaryKeyColumns: string[]): TableRowKey {
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

function buildRowWhereClause(dialect: Dialect, rowKey: TableRowKey, _originalRow: Record<string, unknown>) {
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
    sql: entries
      .map(([column, value]) =>
        value == null ? `${dialect.quoteIdentifier(column)} is null` : `${dialect.quoteIdentifier(column)} = ?`,
      )
      .join(' and '),
    args: entries.flatMap(([, value]) => (value == null ? [] : [normalizeDbValue(value)])),
  };
}

function buildExactRowMatchClause(dialect: Dialect, row: Record<string, unknown>) {
  const entries = Object.entries(row);
  return {
    sql: entries
      .map(([column, value]) =>
        value == null ? `${dialect.quoteIdentifier(column)} is null` : `${dialect.quoteIdentifier(column)} = ?`,
      )
      .join(' and '),
    args: entries.flatMap(([, value]) => (value == null ? [] : [normalizeDbValue(value)])),
  };
}

function buildInsertRowStatement(
  dialect: Dialect,
  relationName: string,
  nextRow: Record<string, unknown>,
  changedColumns: string[],
) {
  const columns = changedColumns.map((column) => dialect.quoteIdentifier(column)).join(', ');
  const placeholders = changedColumns.map(() => '?').join(', ');
  return {
    sql: `insert into ${dialect.quoteIdentifier(relationName)} (${columns}) values (${placeholders})`,
    args: changedColumns.map((column) => normalizeDbValue(nextRow[column])),
  };
}

function buildUpdateRowStatement(
  dialect: Dialect,
  relationName: string,
  rowKey: TableRowKey,
  originalRow: Record<string, unknown>,
  nextRow: Record<string, unknown>,
  changedColumns: string[],
) {
  const setSql = changedColumns.map((column) => `${dialect.quoteIdentifier(column)} = ?`).join(', ');
  const setArgs = changedColumns.map((column) => normalizeDbValue(nextRow[column]));
  const whereClause = buildRowWhereClause(dialect, rowKey, originalRow);
  return {
    sql: `update ${dialect.quoteIdentifier(relationName)} set ${setSql} where ${whereClause.sql}`,
    args: [...setArgs, ...whereClause.args],
  };
}

function buildDeleteRowStatement(
  dialect: Dialect,
  relationName: string,
  rowKey: Exclude<TableRowKey, {kind: 'new'}>,
  originalRow: Record<string, unknown>,
) {
  const rowKeyWhereClause = buildRowWhereClause(dialect, rowKey, originalRow);
  const originalRowWhereClause = buildExactRowMatchClause(dialect, originalRow);
  return {
    sql: `delete from ${dialect.quoteIdentifier(relationName)} where (${rowKeyWhereClause.sql}) and (${originalRowWhereClause.sql})`,
    args: [...rowKeyWhereClause.args, ...originalRowWhereClause.args],
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
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
