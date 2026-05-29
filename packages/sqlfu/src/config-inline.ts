import {applyMigrations, type Migration} from './migrations/index.js';
import type {
  AsyncClient,
  Client,
  PreparedStatementParams,
  QueryMetadata,
  QueryResultMode,
  ResultRow,
  RunResult,
  SqlQueryNoArgs,
  SqlTypedQueryNoArgs,
  SyncClient,
} from './types.js';

export type InlineConfigQueryType = {
  parameters?: PreparedStatementParams;
  result?: ResultRow;
};

export type InlineConfigMigration = {
  name: string;
  content: SqlQueryNoArgs;
};

export type InlineConfigQueryObject<TType extends InlineConfigQueryType = InlineConfigQueryType> = {
  query: SqlQueryNoArgs;
  $type?: TType;
  mode?: QueryResultMode;
};

export type InlineConfigQuery<TType extends InlineConfigQueryType = InlineConfigQueryType> =
  | InlineConfigQueryObject<TType>
  | SqlTypedQueryNoArgs<TType>
  | SqlQueryNoArgs;

export type InlineConfigDefinition<TQueries extends Record<string, InlineConfigQuery>> = {
  definitions: SqlQueryNoArgs;
  migrations?: InlineConfigMigration[];
  queries: TQueries;
};

type InlineQueryTypePayload<TQuery> = TQuery extends {$type: infer TType}
  ? TType
  : TQuery extends {$type?: infer TType}
    ? TType
    : TQuery extends {__sqlfuType?: infer TType}
      ? TType
      : {};

type InlineQueryParameters<TQuery> =
  InlineQueryTypePayload<TQuery> extends {parameters: infer TParameters}
    ? [parameters: TParameters]
    : unknown extends InlineQueryTypePayload<TQuery>
      ? [parameters?: Record<string, unknown>]
      : [];

type InlineQueryResult<TQuery> =
  InlineQueryTypePayload<TQuery> extends {result: infer TResult} ? TResult : QueryMetadata;

type InlineQueryMode<TQuery> = TQuery extends {mode: infer TMode} ? TMode : 'metadata';

type InlineQueryReturn<TClient extends Client, TQuery> = TClient extends SyncClient
  ? InlineSyncQueryReturn<TQuery>
  : Promise<InlineSyncQueryReturn<TQuery>>;

type InlineSyncQueryReturn<TQuery> =
  InlineQueryMode<TQuery> extends 'many'
    ? InlineQueryResult<TQuery>[]
    : InlineQueryMode<TQuery> extends 'nullableOne'
      ? InlineQueryResult<TQuery> | null
      : InlineQueryMode<TQuery> extends 'one'
        ? InlineQueryResult<TQuery>
        : RunResult;

type InlineConfigBound<TQueries extends Record<string, InlineConfigQuery>, TClient extends Client> = {
  [TName in keyof TQueries]: (
    ...args: InlineQueryParameters<TQueries[TName]>
  ) => InlineQueryReturn<TClient, TQueries[TName]>;
} & {
  migrate(): TClient extends SyncClient ? void : Promise<void>;
};

type InlineRuntimeQueryResult = RunResult | ResultRow | ResultRow[] | null;

export type InlineConfigFactory<TQueries extends Record<string, InlineConfigQuery>> = {
  <TClient extends Client>(client: TClient): InlineConfigBound<TQueries, TClient>;
  $type: InlineConfigBound<TQueries, Client>;
  config: InlineConfigDefinition<TQueries>;
};

export function defineInlineConfig<const TQueries extends Record<string, InlineConfigQuery>>(
  definition: InlineConfigDefinition<TQueries>,
): InlineConfigFactory<TQueries> {
  const factory = (<TClient extends Client>(client: TClient) => {
    const bound: Record<string, unknown> = {
      migrate() {
        return applyMigrations(client, {
          migrations: inlineMigrations(definition.migrations || []),
          preset: 'sqlfu',
        }) as TClient extends SyncClient ? void : Promise<void>;
      },
    };

    for (const [name, query] of Object.entries(definition.queries)) {
      bound[name] = (params?: PreparedStatementParams) => runInlineQuery(client, query, params);
    }

    return bound as InlineConfigBound<TQueries, TClient>;
  }) as InlineConfigFactory<TQueries>;

  factory.$type = {} as InlineConfigBound<TQueries, Client>;
  factory.config = definition;
  return factory;
}

function inlineMigrations(migrations: InlineConfigMigration[]): Migration[] {
  return migrations.map((migration) => {
    if (migration.content.args.length > 0) {
      throw new Error(`Inline migration ${JSON.stringify(migration.name)} cannot use template interpolations.`);
    }
    return {
      path: `${migration.name}.sql`,
      content: migration.content.sql,
    };
  });
}

function runInlineQuery(
  client: Client,
  query: InlineConfigQuery,
  params: PreparedStatementParams | undefined,
): InlineRuntimeQueryResult | Promise<InlineRuntimeQueryResult> {
  const mode = readInlineQueryMode(query);
  const sqlQuery = inlineQuerySql(query);
  if (sqlQuery.args.length > 0) {
    throw new Error('Inline queries cannot use template interpolations.');
  }
  if (isInlineSyncClient(client)) {
    return runInlineSyncQuery(client, sqlQuery.sql, mode, params);
  }
  if (isInlineAsyncClient(client)) {
    return runInlineAsyncQuery(client, sqlQuery.sql, mode, params);
  }
  throw new Error('Inline defineConfig() received an unsupported client.');
}

function isInlineSyncClient(client: Client): client is SyncClient {
  return client.sync;
}

function isInlineAsyncClient(client: Client): client is AsyncClient {
  return !client.sync;
}

function runInlineSyncQuery(
  client: SyncClient,
  sql: string,
  mode: QueryResultMode,
  params: PreparedStatementParams | undefined,
): InlineRuntimeQueryResult {
  using stmt = client.prepare(sql);
  if (mode === 'metadata') return stmt.run(params);
  return inlineRowsResult(stmt.all(params), mode);
}

async function runInlineAsyncQuery(
  client: AsyncClient,
  sql: string,
  mode: QueryResultMode,
  params: PreparedStatementParams | undefined,
): Promise<InlineRuntimeQueryResult> {
  const stmt = client.prepare(sql);
  try {
    if (mode === 'metadata') return await stmt.run(params);
    return inlineRowsResult(await stmt.all(params), mode);
  } finally {
    await stmt[Symbol.asyncDispose]();
  }
}

function readInlineQueryMode(query: InlineConfigQuery): QueryResultMode {
  const mode = inlineQueryMode(query);
  if (isQueryResultMode(mode)) {
    return mode;
  }
  if (!mode) {
    throw new Error('Inline query is missing generated mode. Run sqlfu generate before binding inline defineConfig().');
  }
  throw new Error(`Inline query has unsupported generated mode ${JSON.stringify(mode)}.`);
}

function inlineQueryMode(query: InlineConfigQuery): unknown {
  return 'mode' in query ? query.mode : undefined;
}

function inlineQuerySql(query: InlineConfigQuery): SqlQueryNoArgs {
  return isInlineConfigQueryObject(query) ? query.query : query;
}

function isInlineConfigQueryObject(query: InlineConfigQuery): query is InlineConfigQueryObject {
  return 'query' in query;
}

function isQueryResultMode(value: unknown): value is QueryResultMode {
  return value === 'many' || value === 'nullableOne' || value === 'one' || value === 'metadata';
}

function inlineRowsResult(rows: ResultRow[], mode: QueryResultMode): ResultRow | ResultRow[] | null {
  if (mode === 'many') return rows;
  if (mode === 'nullableOne') return rows[0] || null;
  if (mode === 'one') return rows[0]!;
  throw new Error(`Inline query mode ${JSON.stringify(mode)} cannot return rows.`);
}
