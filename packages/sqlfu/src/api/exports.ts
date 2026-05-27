import type {
  AppliedOptions,
  BaselineOptions,
  CheckOptions,
  ConfigOptions,
  DraftOptions,
  FindOptions,
  GotoOptions,
  InitOptions,
  MigrateOptions,
  PendingOptions,
  SyncOptions,
} from './core.js';
import {formatSql} from '../formatter.js';
import type {LoadedSqlfuProject} from '../config.js';
import type {SqlfuHost} from '../host.js';
import packageJson from '../../package.json' with {type: 'json'};

export type {Confirm, SqlfuApi} from './core.js';
export {inlineSqlfu} from './inline.js';
export {sql} from '../sql.js';

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

export async function init(input: InitOptions & NodeApiOptions): Promise<string> {
  return (await createNodeSqlfuApi(input)).init(input);
}

export async function config(input: ConfigOptions & NodeApiOptions = {}) {
  return (await createNodeSqlfuApi(input)).config();
}

export async function sync(input: SyncOptions & NodeApiOptions): Promise<void> {
  await (await createNodeSqlfuApi(input)).sync(input);
}

export async function draft(input: DraftOptions & NodeApiOptions) {
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

export async function migrate(input: MigrateOptions & NodeApiOptions): Promise<void> {
  await (await createNodeSqlfuApi(input)).migrate(input);
}

export async function pending(input: PendingOptions & NodeApiOptions = {}) {
  return (await createNodeSqlfuApi(input)).pending();
}

export async function applied(input: AppliedOptions & NodeApiOptions = {}) {
  return (await createNodeSqlfuApi(input)).applied();
}

export async function find(input: FindOptions & NodeApiOptions) {
  return (await createNodeSqlfuApi(input)).find(input);
}

export async function baseline(input: BaselineOptions & NodeApiOptions): Promise<void> {
  await (await createNodeSqlfuApi(input)).baseline(input);
}

export async function goto(input: GotoOptions & NodeApiOptions): Promise<void> {
  await (await createNodeSqlfuApi(input)).goto(input);
}

export async function check(input: CheckOptions & NodeApiOptions = {}) {
  return (await createNodeSqlfuApi(input)).check();
}

export async function generate(input: GenerateOptions = {}) {
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

export function format(sql: string, options: {language?: 'sqlite' | 'postgresql'} = {}) {
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

export async function kill(input: KillOptions = {}) {
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
