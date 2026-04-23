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
} from '../api.js';
import {SqlfuError, type SqlfuErrorKind} from '../core/errors.js';
import {splitSqlStatements} from '../core/sqlite.js';
import type {SqlfuHost} from '../core/host.js';
import type {AsyncClient, QueryArg, SqlfuProjectConfig} from '../core/types.js';
import {basename, joinPath} from '../core/paths.js';
import type {QueryCatalogEntry} from '../typegen/query-catalog.js';
import type {
  QueryExecutionResponse,
  SchemaCheckCard,
  SchemaCheckRecommendation,
  SqlEditorDiagnostic,
  StudioColumn,
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

export type UiRouterContext = {
  project: ResolvedUiProject;
  host: SqlfuHost;
};

const uiBase = os.$context<UiRouterContext>().use(async ({next}) => {
  try {
    return await next();
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
      const relations = await client.all<{name: string; type: string; sql: string | null}>({
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
        projectName: basename(config.projectRoot),
        projectRoot: config.projectRoot,
        relations: await Promise.all(
          relations.map(async (relation) => ({
            name: String(relation.name),
            kind: (relation.type === 'view' ? 'view' : 'table') as 'table' | 'view',
            rowCount: relation.type === 'table' ? await getRelationCount(client, String(relation.name)) : undefined,
            columns: await getRelationColumns(client, String(relation.name)),
            sql: typeof relation.sql === 'string' ? relation.sql : undefined,
          })),
        ),
      };
    }),
    check: uiBase.handler(async ({context}) => {
      const config = requireProjectConfig(context.project);
      try {
        const analysis = await getCheckAnalysis({config, host: context.host});
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
        const authorities = await getSchemaAuthorities({
          config: requireProjectConfig(context.project),
          host: context.host,
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
              {config: requireProjectConfig(context.project), host: context.host},
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
            config: context.project.initialized ? context.project.config : undefined,
            host: context.host,
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

        await writeDefinitionsSql({config: requireProjectConfig(context.project), host: context.host}, input.sql);
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
        }),
      )
      .handler(async ({context, input}) => {
        const config = requireProjectConfig(context.project);
        await using database = await context.host.openDb(config);
        return await getTableRows(database.client, input.relationName, input.page);
      }),
    save: uiBase
      .input(
        z.object({
          relationName: z.string(),
          page: z.number().int(),
          originalRows: z.array(rowRecordSchema),
          rows: z.array(rowRecordSchema),
          rowKeys: z.array(tableRowKeySchema),
        }),
      )
      .handler(async ({context, input}) => {
        const config = requireProjectConfig(context.project);
        await using database = await context.host.openDb(config);
        return await saveTableRows(database.client, input.relationName, input);
      }),
    delete: uiBase
      .input(
        z.object({
          relationName: z.string(),
          page: z.number().int(),
          originalRow: rowRecordSchema,
          rowKey: tableRowKeySchema,
        }),
      )
      .handler(async ({context, input}) => {
        const config = requireProjectConfig(context.project);
        await using database = await context.host.openDb(config);
        return await deleteTableRow(database.client, input.relationName, input);
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
          const result = await context.host.execAdHocSql(database.client, trimmedSql, params);
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

type QueueItem =
  | {kind: 'event'; event: CommandEvent}
  | {kind: 'error'; error: unknown};

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

function encodeArgument(
  arg: Extract<QueryCatalogEntry, {kind: 'query'}>['args'][number],
  value: unknown,
): QueryArg[] {
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

async function getRelationColumns(client: AsyncClient, relationName: string): Promise<StudioColumn[]> {
  const rows = await client.all<Record<string, unknown>>({
    sql: `PRAGMA table_xinfo("${escapeIdentifier(relationName)}")`,
    args: [],
  });
  return rows
    .filter((row) => Number(row.hidden ?? 0) === 0)
    .map((row) => ({
      name: String(row.name),
      type: typeof row.type === 'string' ? row.type : '',
      notNull: Number(row.notnull ?? 0) === 1,
      primaryKey: Number(row.pk ?? 0) >= 1,
    }));
}

async function getRelationCount(client: AsyncClient, relationName: string) {
  const rows = await client.all<{count: number}>({
    sql: `select count(*) as count from "${escapeIdentifier(relationName)}"`,
    args: [],
  });
  return Number(rows[0]?.count ?? 0);
}

async function getTableRows(client: AsyncClient, relationName: string, page: number): Promise<TableRowsResponse> {
  const safePage = Math.max(0, page);
  const pageSize = 25;
  const relation = await getRelationInfo(client, relationName);
  const relationColumns = await getRelationColumns(client, relationName);
  const columns = relationColumns.map((column) => column.name);
  const primaryKeyColumns = relationColumns.filter((column) => column.primaryKey).map((column) => column.name);
  const includeRowid = relation.type === 'table' && primaryKeyColumns.length === 0;
  const rows = await client.all<Record<string, unknown>>({
    sql: `select ${includeRowid ? 'rowid as "__sqlfu_rowid__", ' : ''}* from "${escapeIdentifier(relationName)}" limit ? offset ?`,
    args: [pageSize, safePage * pageSize],
  });
  const materializedRows = rows.map(materializeRow);

  return {
    relation: relationName,
    page: safePage,
    pageSize,
    editable: relation.type === 'table',
    rowKeys: relation.type === 'table' ? materializedRows.map((row) => buildTableRowKey(row, primaryKeyColumns)) : [],
    columns,
    rows: materializedRows.map(stripInternalRowValues),
  };
}

async function saveTableRows(
  client: AsyncClient,
  relationName: string,
  input: {
    page: number;
    originalRows: unknown[];
    rows: unknown[];
    rowKeys: TableRowKey[];
  },
): Promise<TableRowsResponse> {
  const relation = await getRelationInfo(client, relationName);
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
        ? buildInsertRowStatement(relationName, row.nextRow, row.changedColumns)
        : buildUpdateRowStatement(relationName, row.rowKey, row.originalRow, row.nextRow, row.changedColumns);
    await client.run({sql: statement.sql, args: statement.args as QueryArg[]});
  }

  return await getTableRows(client, relationName, input.page);
}

async function deleteTableRow(
  client: AsyncClient,
  relationName: string,
  input: {
    page: number;
    originalRow: unknown;
    rowKey: TableRowKey | undefined;
  },
): Promise<TableRowsResponse> {
  const relation = await getRelationInfo(client, relationName);
  if (relation.type !== 'table') {
    throw new Error(`Relation "${relationName}" is not editable`);
  }

  const originalRow = asRecord(input.originalRow);
  if (!originalRow || !input.rowKey || input.rowKey.kind === 'new') {
    throw new Error('Delete row payload is malformed');
  }

  const statement = buildDeleteRowStatement(relationName, input.rowKey, originalRow);
  const result = await client.run({sql: statement.sql, args: statement.args as QueryArg[]});
  if (result.rowsAffected !== 1) {
    throw new Error(`Delete affected ${result.rowsAffected ?? 0} rows`);
  }

  return await getTableRows(client, relationName, input.page);
}

function slugifyQueryName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeSqlRunnerParams(value: unknown): Record<string, unknown> | unknown[] | undefined {
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

async function getRelationInfo(client: AsyncClient, relationName: string) {
  const row = (
    await client.all<{name: string; type: 'table' | 'view'; sql: string | null}>({
      sql: `select name, type, sql from sqlite_schema where name = ?`,
      args: [relationName],
    })
  )[0];
  if (!row || (row.type !== 'table' && row.type !== 'view')) {
    throw new Error(`Unknown relation "${relationName}"`);
  }
  return row;
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

function buildRowWhereClause(rowKey: TableRowKey, _originalRow: Record<string, unknown>) {
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
        value == null ? `"${escapeIdentifier(column)}" is null` : `"${escapeIdentifier(column)}" = ?`,
      )
      .join(' and '),
    args: entries.flatMap(([, value]) => (value == null ? [] : [normalizeDbValue(value)])),
  };
}

function buildExactRowMatchClause(row: Record<string, unknown>) {
  const entries = Object.entries(row);
  return {
    sql: entries
      .map(([column, value]) =>
        value == null ? `"${escapeIdentifier(column)}" is null` : `"${escapeIdentifier(column)}" = ?`,
      )
      .join(' and '),
    args: entries.flatMap(([, value]) => (value == null ? [] : [normalizeDbValue(value)])),
  };
}

function buildInsertRowStatement(
  relationName: string,
  nextRow: Record<string, unknown>,
  changedColumns: string[],
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
  changedColumns: string[],
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
