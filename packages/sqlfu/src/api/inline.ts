import {applyMigrations, type Migration} from '../migrations/index.js';
import {sqlReturnsRows} from '../sqlite-text.js';
import type {
  Client,
  PreparedStatementParams,
  QueryMetadata,
  ResultRow,
  RunResult,
  SqlQuery,
  SyncClient,
} from '../types.js';

export type InlineSqlfuQueryType = {
  parameters?: PreparedStatementParams;
  result?: ResultRow;
};

export type InlineSqlfuMigration = {
  name: string;
  content: SqlQuery;
};

export type InlineSqlfuDefinition<TQueries extends Record<string, SqlQuery>> = {
  definitions: SqlQuery;
  migrations: InlineSqlfuMigration[];
  queries: TQueries;
};

type InlineQueryParameters<TQuery> = TQuery extends {__sqlfuType?: {parameters: infer TParameters}}
  ? TParameters
  : undefined;

type InlineQueryResult<TQuery> = TQuery extends {__sqlfuType?: {result: infer TResult}} ? TResult : QueryMetadata;

type InlineQueryReturnsRows<TQuery> = TQuery extends {__sqlfuType?: {result: ResultRow}} ? true : false;

type InlineQueryFunction<TClient extends Client, TQuery> = undefined extends InlineQueryParameters<TQuery>
  ? () => InlineQueryReturn<TClient, TQuery>
  : (params: InlineQueryParameters<TQuery>) => InlineQueryReturn<TClient, TQuery>;

type InlineQueryReturn<TClient extends Client, TQuery> = TClient extends SyncClient
  ? InlineQueryReturnsRows<TQuery> extends true
    ? InlineQueryResult<TQuery>[]
    : RunResult
  : InlineQueryReturnsRows<TQuery> extends true
    ? Promise<InlineQueryResult<TQuery>[]>
    : Promise<RunResult>;

type InlineSqlfuBound<TQueries extends Record<string, SqlQuery>, TClient extends Client> = {
  [TName in keyof TQueries]: InlineQueryFunction<TClient, TQueries[TName]>;
} & {
  migrate(): TClient extends SyncClient ? void : Promise<void>;
};

export type InlineSqlfuFactory<TQueries extends Record<string, SqlQuery>> = {
  <TClient extends Client>(client: TClient): InlineSqlfuBound<TQueries, TClient>;
  $type: InlineSqlfuBound<TQueries, Client>;
};

export function inlineSqlfu<TQueries extends Record<string, SqlQuery>>(
  definition: InlineSqlfuDefinition<TQueries>,
): InlineSqlfuFactory<TQueries> {
  const factory = (<TClient extends Client>(client: TClient) => {
    const bound: Record<string, unknown> = {
      migrate() {
        return applyMigrations(client, {
          migrations: inlineMigrations(definition.migrations),
          preset: 'sqlfu',
        }) as TClient extends SyncClient ? void : Promise<void>;
      },
    };

    for (const [name, query] of Object.entries(definition.queries)) {
      bound[name] = (params?: PreparedStatementParams) => runInlineQuery(client, query, params);
    }

    return bound as InlineSqlfuBound<TQueries, TClient>;
  }) as InlineSqlfuFactory<TQueries>;

  factory.$type = undefined as unknown as InlineSqlfuBound<TQueries, Client>;
  return factory;
}

function inlineMigrations(migrations: InlineSqlfuMigration[]): Migration[] {
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

function runInlineQuery<TClient extends Client>(
  client: TClient,
  query: SqlQuery,
  params: PreparedStatementParams | undefined,
): RunResult | Promise<RunResult> | ResultRow[] | Promise<ResultRow[]> {
  if (client.sync) {
    using stmt = client.prepare(query.sql);
    if (sqlReturnsRows(query.sql)) {
      return stmt.all(params);
    }
    return stmt.run(params);
  }

  const stmt = client.prepare(query.sql);
  if (sqlReturnsRows(query.sql)) {
    return stmt.all(params).finally(() => stmt[Symbol.asyncDispose]());
  }
  return stmt.run(params).finally(() => stmt[Symbol.asyncDispose]());
}
