import {inlineSqlfu as runtimeInlineSqlfu} from './inline.js';
import {sql as runtimeSql} from '../sql.js';
import type {LoadedSqlfuProject} from '../config.js';
import type {SqlfuHost} from '../host.js';
import packageJson from '../../package.json' with {type: 'json'};

export type Confirm = (params: {
  title: string;
  body: string;
  bodyType?: 'markdown' | 'sql' | 'typescript';
  editable?: boolean;
}) => string | null | Promise<string | null>;

type ApiQueryArg = null | string | number | bigint | Uint8Array | boolean;
type ApiResultRow = object;
type ApiSqlFragment = {
  sql: string;
  args: ApiQueryArg[];
};
type ApiSqlQuery = ApiSqlFragment & {
  name?: string;
  __sqlfuType?: unknown;
};
type ApiSqlValue = ApiQueryArg | ApiSqlFragment;
type ApiPreparedStatementParams = Record<string, unknown> | ApiQueryArg[];
type ApiRunResult = {
  rowsAffected?: number;
  lastInsertRowid?: string | number | bigint | null;
};
type ApiSyncPreparedStatement<TRow extends ApiResultRow = ApiResultRow> = {
  all(params?: ApiPreparedStatementParams): TRow[];
  run(params?: ApiPreparedStatementParams): ApiRunResult;
  iterate(params?: ApiPreparedStatementParams): Iterable<TRow>;
  [Symbol.dispose](): void;
};
type ApiPreparedStatement<TRow extends ApiResultRow = ApiResultRow> = {
  all(params?: ApiPreparedStatementParams): Promise<TRow[]>;
  run(params?: ApiPreparedStatementParams): Promise<ApiRunResult>;
  iterate(params?: ApiPreparedStatementParams): AsyncIterable<TRow>;
  [Symbol.asyncDispose](): Promise<void>;
};
type ApiSyncClient = {
  sync: true;
  all<TRow extends ApiResultRow = ApiResultRow>(query: ApiSqlQuery): TRow[];
  run(query: ApiSqlQuery): ApiRunResult;
  raw(sql: string): ApiRunResult;
  prepare<TRow extends ApiResultRow = ApiResultRow>(sql: string): ApiSyncPreparedStatement<TRow>;
};
type ApiAsyncClient = {
  sync: false;
  all<TRow extends ApiResultRow = ApiResultRow>(query: ApiSqlQuery): Promise<TRow[]>;
  run(query: ApiSqlQuery): Promise<ApiRunResult>;
  raw(sql: string): Promise<ApiRunResult>;
  prepare<TRow extends ApiResultRow = ApiResultRow>(sql: string): ApiPreparedStatement<TRow>;
};
type ApiClient = ApiSyncClient | ApiAsyncClient;

export type InlineSqlfuQueryType = {
  parameters?: ApiPreparedStatementParams;
  result?: ApiResultRow;
};

export type InlineSqlfuMigration = {
  name: string;
  content: ApiSqlQuery;
};

export type InlineSqlfuDefinition<TQueries extends Record<string, ApiSqlQuery>> = {
  definitions: ApiSqlQuery;
  migrations: InlineSqlfuMigration[];
  queries: TQueries;
};

type InlineQueryParameters<TQuery> = TQuery extends {__sqlfuType?: {parameters: infer TParameters}}
  ? TParameters
  : undefined;
type InlineQueryResult<TQuery> = TQuery extends {__sqlfuType?: {result: infer TResult}} ? TResult : ApiRunResult;
type InlineQueryReturnsRows<TQuery> = TQuery extends {__sqlfuType?: {result: ApiResultRow}} ? true : false;
type InlineQueryFunction<TClient extends ApiClient, TQuery> = undefined extends InlineQueryParameters<TQuery>
  ? () => InlineQueryReturn<TClient, TQuery>
  : (params: InlineQueryParameters<TQuery>) => InlineQueryReturn<TClient, TQuery>;
type InlineQueryReturn<TClient extends ApiClient, TQuery> = TClient extends ApiSyncClient
  ? InlineQueryReturnsRows<TQuery> extends true
    ? InlineQueryResult<TQuery>[]
    : ApiRunResult
  : InlineQueryReturnsRows<TQuery> extends true
    ? Promise<InlineQueryResult<TQuery>[]>
    : Promise<ApiRunResult>;
type InlineSqlfuBound<TQueries extends Record<string, ApiSqlQuery>, TClient extends ApiClient> = {
  [TName in keyof TQueries]: InlineQueryFunction<TClient, TQueries[TName]>;
} & {
  migrate(): TClient extends ApiSyncClient ? void : Promise<void>;
};

export type InlineSqlfuFactory<TQueries extends Record<string, ApiSqlQuery>> = {
  <TClient extends ApiClient>(client: TClient): InlineSqlfuBound<TQueries, TClient>;
  $type: InlineSqlfuBound<TQueries, ApiClient>;
};

export const inlineSqlfu = runtimeInlineSqlfu as unknown as <TQueries extends Record<string, ApiSqlQuery>>(
  definition: InlineSqlfuDefinition<TQueries>,
) => InlineSqlfuFactory<TQueries>;

export const sql = runtimeSql as unknown as <TType = unknown>(
  strings: TemplateStringsArray,
  ...values: ApiSqlValue[]
) => ApiSqlQuery & {__sqlfuType?: TType};

async function load<TModule>(specifier: string): Promise<TModule> {
  return import(specifier) as Promise<TModule>;
}

type NodeApiOptions = {
  configPath?: string;
  projectRoot?: string;
};

type ServeOptions = NodeApiOptions & {
  port?: number;
  ui?: boolean;
};

type KillOptions = {
  port?: number;
};

type GenerateOptions = NodeApiOptions;

type InitOptions = NodeApiOptions & {confirm: Confirm};
type ConfigOptions = NodeApiOptions;
type SyncOptions = NodeApiOptions & {confirm: Confirm};
type DraftOptions = NodeApiOptions & {name?: string; confirm: Confirm};
type MigrateOptions = NodeApiOptions & {confirm: Confirm};
type PendingOptions = NodeApiOptions;
type AppliedOptions = NodeApiOptions;
type FindOptions = NodeApiOptions & {text: string};
type BaselineOptions = NodeApiOptions & {target: string; confirm: Confirm};
type GotoOptions = NodeApiOptions & {target: string; confirm: Confirm};
type CheckOptions = NodeApiOptions;

type GenerateQueryTypesResult = {
  writtenFiles: string[];
};

export async function init(input: InitOptions): Promise<string> {
  return (await createNodeSqlfuApi(input)).init(input);
}

export async function config(input: ConfigOptions = {}): Promise<unknown> {
  return (await createNodeSqlfuApi(input)).config();
}

export async function sync(input: SyncOptions): Promise<void> {
  await (await createNodeSqlfuApi(input)).sync(input);
}

export async function draft(input: DraftOptions): Promise<{path: string} | null> {
  const {project, host} = await loadInitializedNodeProject(input);
  if ('inline' in project) {
    const {draftInlineSqlfuMigration} =
      await load<typeof import('../node/inline-commands.js')>('../node/inline-commands.js');
    return draftInlineSqlfuMigration({
      modulePath: project.inline.modulePath,
      projectRoot: project.projectRoot,
      host,
      name: input.name,
      confirm: input.confirm,
    });
  }
  const {createSqlfuApi} = await load<typeof import('./core.js')>('./core.js');
  return createSqlfuApi({
    projectRoot: project.projectRoot,
    configPath: project.configPath,
    config: project.config,
    host,
  }).draft(input);
}

export async function migrate(input: MigrateOptions): Promise<void> {
  await (await createNodeSqlfuApi(input)).migrate(input);
}

export async function pending(input: PendingOptions = {}): Promise<string[]> {
  return (await createNodeSqlfuApi(input)).pending();
}

export async function applied(input: AppliedOptions = {}): Promise<string[]> {
  return (await createNodeSqlfuApi(input)).applied();
}

export async function find(input: FindOptions): Promise<{name: string; applied: boolean}[]> {
  return (await createNodeSqlfuApi(input)).find(input);
}

export async function baseline(input: BaselineOptions): Promise<void> {
  await (await createNodeSqlfuApi(input)).baseline(input);
}

export async function goto(input: GotoOptions): Promise<void> {
  await (await createNodeSqlfuApi(input)).goto(input);
}

export async function check(input: CheckOptions = {}): Promise<void> {
  return (await createNodeSqlfuApi(input)).check();
}

export async function generate(input: GenerateOptions = {}): Promise<GenerateQueryTypesResult> {
  const {project, host} = await loadInitializedNodeProject(input);
  if ('inline' in project) {
    const {generateInlineSqlfuModule} =
      await load<typeof import('../node/inline-commands.js')>('../node/inline-commands.js');
    return generateInlineSqlfuModule({
      modulePath: project.inline.modulePath,
      projectRoot: project.projectRoot,
      host,
    });
  }
  const {generateQueryTypesForConfig} = await load<typeof import('../typegen/index.js')>('../typegen/index.js');
  return generateQueryTypesForConfig(project.config, host);
}

export async function format(sql: string, options: {language?: 'sqlite' | 'postgresql'} = {}): Promise<string> {
  const {formatSql} = await load<typeof import('../formatter.js')>('../formatter.js');
  return formatSql(sql, {language: options.language});
}

export async function serve(input: ServeOptions = {}): Promise<unknown> {
  const project = await loadNodeProjectState(input);
  const params = {port: input.port, configPath: project.configPath};
  if (input.ui) {
    const {resolveSqlfuUi} = await load<typeof import('../ui/resolve-sqlfu-ui.js')>(
      '../ui/resolve-sqlfu-ui.js',
    );
    const {startSqlfuServer} = await load<typeof import('../ui/server.js')>('../ui/server.js');
    const ui = await resolveSqlfuUi({sqlfuVersion: packageJson.version});
    return startSqlfuServer({...params, ui});
  }
  const {startSqlfuServer} = await load<typeof import('../ui/server.js')>('../ui/server.js');
  return startSqlfuServer(params);
}

export async function kill(input: KillOptions = {}): Promise<unknown[]> {
  const {stopProcessesListeningOnPort} =
    await load<typeof import('../node/port-process.js')>('../node/port-process.js');
  return stopProcessesListeningOnPort(input.port || 56081);
}

async function createNodeSqlfuApi(input: NodeApiOptions) {
  const {createSqlfuApi} = await load<typeof import('./core.js')>('./core.js');
  const host = await createNodeHost();
  const projectRoot = input.projectRoot || (await load<typeof import('node:process')>('node:process')).cwd();
  return createSqlfuApi({
    projectRoot,
    configPath: input.configPath,
    loadProjectState: () => loadNodeProjectState({projectRoot, configPath: input.configPath}),
    host,
  });
}

async function loadNodeProjectState(input: NodeApiOptions) {
  const projectRoot = input.projectRoot || (await load<typeof import('node:process')>('node:process')).cwd();
  const {loadProjectStateFrom, loadProjectStateFromConfigPath} =
    await load<typeof import('../node/config.js')>('../node/config.js');
  if (input.configPath) {
    return loadProjectStateFromConfigPath(input.configPath, projectRoot);
  }
  return loadProjectStateFrom(projectRoot);
}

async function loadInitializedNodeProject(
  input: NodeApiOptions,
): Promise<{project: Extract<LoadedSqlfuProject, {initialized: true}>; host: SqlfuHost}> {
  const host = await createNodeHost();
  const project = await loadNodeProjectState(input);
  if (!project.initialized) {
    if (project.configPath) {
      throw new Error(`No sqlfu config found at ${project.configPath}. Run 'sqlfu init' first.`);
    }
    throw new Error(`No sqlfu config found in ${project.projectRoot}. Run 'sqlfu init' first.`);
  }
  return {project, host};
}

async function createNodeHost() {
  const {createNodeHost} = await load<typeof import('../node/host.js')>('../node/host.js');
  return createNodeHost();
}
