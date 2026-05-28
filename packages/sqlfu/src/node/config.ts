import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import type {SqlfuConfig, SqlfuProjectConfig} from '../types.js';
import {
  assertConfigShape,
  createDefaultInitPreview,
  resolveProjectConfig,
  type LoadedSqlfuProject,
  type TsconfigPreferences,
} from '../config.js';
import {resolveCliConfigPath} from './cli-config.js';
import {readInlineConfigSources} from './inline-source.js';

const defaultConfigFileNames = ['sqlfu.config.ts', 'sqlfu.config.mjs', 'sqlfu.config.js', 'sqlfu.config.cjs'] as const;
const defaultSqlfuConfigFileName = 'sqlfu.config.ts';
const defaultLocalArtifactsGitignoreEntry = '.sqlfu/';

export async function loadProjectConfig(input: {configPath?: string} = {}): Promise<SqlfuProjectConfig> {
  const cwd = path.resolve(process.cwd());
  const project = await loadProjectState({configPath: input.configPath});
  if (!project.initialized) {
    if (input.configPath) {
      throw new Error(`No sqlfu config found at ${project.configPath}.`);
    }
    throw new Error(`No sqlfu config found in ${cwd}. Create sqlfu.config.ts.`);
  }
  if ('inline' in project) {
    throw new Error(
      `No file-backed sqlfu config found at ${project.configPath}; inline defineConfig modules support generate and draft only.`,
    );
  }
  return project.config;
}

export async function loadProjectState(input: {configPath?: string} = {}) {
  if (input.configPath) {
    return loadProjectStateFromConfigPath(input.configPath, path.resolve(process.cwd()));
  }
  return loadProjectStateFrom(path.resolve(process.cwd()));
}

export async function loadProjectStateFrom(projectRoot: string): Promise<LoadedSqlfuProject> {
  const configPath = await resolveConfigPath(projectRoot);
  if (!configPath) {
    return {
      initialized: false,
      projectRoot,
      configPath: path.join(projectRoot, defaultSqlfuConfigFileName),
    };
  }

  const inlines = await readInlineConfigSources(configPath);
  if (inlines.length > 0) {
    return {
      initialized: true,
      projectRoot,
      configPath,
      inline: {
        modulePath: configPath,
      },
    };
  }

  const fileConfig = await loadConfigFile(configPath);
  const tsconfigPreferences = await loadTsconfigPreferences(path.dirname(configPath));
  return {
    initialized: true,
    projectRoot,
    configPath,
    config: resolveProjectConfig(fileConfig, configPath, tsconfigPreferences),
  };
}

export async function loadProjectStateFromConfigPath(configPath: string, cwd: string): Promise<LoadedSqlfuProject> {
  const resolvedConfigPath = resolveCliConfigPath(configPath, cwd);
  const projectRoot = path.dirname(resolvedConfigPath);
  try {
    await fs.access(resolvedConfigPath);
  } catch {
    return {
      initialized: false,
      projectRoot,
      configPath: resolvedConfigPath,
    };
  }

  const inlines = await readInlineConfigSources(resolvedConfigPath);
  if (inlines.length > 0) {
    return {
      initialized: true,
      projectRoot,
      configPath: resolvedConfigPath,
      inline: {
        modulePath: resolvedConfigPath,
      },
    };
  }

  const fileConfig = await loadConfigFile(resolvedConfigPath);
  const tsconfigPreferences = await loadTsconfigPreferences(projectRoot);
  return {
    initialized: true,
    projectRoot,
    configPath: resolvedConfigPath,
    config: resolveProjectConfig(fileConfig, resolvedConfigPath, tsconfigPreferences),
  };
}

export async function initializeProject(input: {projectRoot: string; configContents: string; configPath?: string}) {
  const preview = createDefaultInitPreview(input.projectRoot, {configPath: input.configPath});
  const state = input.configPath
    ? await loadProjectStateFromConfigPath(input.configPath, input.projectRoot)
    : await loadProjectStateFrom(input.projectRoot);
  if (state.initialized) {
    throw new Error(`sqlfu is already initialized in ${input.projectRoot}`);
  }

  await fs.mkdir(path.join(input.projectRoot, 'migrations'), {recursive: true});
  await fs.mkdir(path.join(input.projectRoot, 'sql'), {recursive: true});
  await fs.mkdir(path.dirname(preview.configPath), {recursive: true});
  await fs.writeFile(preview.configPath, withTrailingNewline(input.configContents));
  await fs.writeFile(
    path.join(input.projectRoot, 'definitions.sql'),
    '-- create table yourtable(id int, body text);\n',
  );
  await ensureGitignoreEntry(path.join(input.projectRoot, '.gitignore'), defaultLocalArtifactsGitignoreEntry);
  await fs.writeFile(path.join(input.projectRoot, 'migrations', '.gitkeep'), '');
  await fs.writeFile(path.join(input.projectRoot, 'sql', '.gitkeep'), '');
}

async function ensureGitignoreEntry(gitignorePath: string, entry: string) {
  let contents: string;
  try {
    contents = await fs.readFile(gitignorePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    await fs.writeFile(gitignorePath, `${entry}\n`);
    return;
  }

  const existingEntries = contents.split(/\r?\n/g).map((line) => line.trim());
  if (existingEntries.includes(entry)) {
    return;
  }

  const newline = contents.includes('\r\n') ? '\r\n' : '\n';
  const prefix = contents.trim() ? (contents.endsWith('\n') ? contents : `${contents}${newline}`) : '';
  await fs.writeFile(gitignorePath, `${prefix}${entry}${newline}`);
}

async function resolveConfigPath(cwd: string): Promise<string | undefined> {
  for (const candidate of defaultConfigFileNames) {
    const resolved = path.resolve(cwd, candidate);
    try {
      await fs.access(resolved);
      return resolved;
    } catch {
      continue;
    }
  }

  return undefined;
}

async function loadConfigFile(configPath: string): Promise<SqlfuConfig> {
  const moduleUrl = new URL(pathToFileURL(configPath).href);
  moduleUrl.searchParams.set('t', String(Date.now()));

  const loaded = await import(moduleUrl.href);
  const config = loaded.default ?? loaded.config ?? loaded;

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`Invalid sqlfu config at ${configPath}: expected a default-exported object.`);
  }

  assertConfigShape(configPath, config);
  return config as SqlfuConfig;
}

async function loadTsconfigPreferences(cwd: string): Promise<TsconfigPreferences> {
  const tsconfigPath = await findTsconfigPath(cwd);
  if (!tsconfigPath) {
    return {};
  }

  let contents: string;
  try {
    contents = await fs.readFile(tsconfigPath, 'utf8');
  } catch {
    return {};
  }

  const compilerOptions = parseTsconfigCompilerOptions(contents);
  if (!compilerOptions || typeof compilerOptions !== 'object') {
    return {};
  }

  return {
    prefersTsImportExtensions:
      hasTrueFlag(compilerOptions, 'allowImportingTsExtensions') ||
      hasTrueFlag(compilerOptions, 'rewriteRelativeImportExtensions'),
  };
}

async function findTsconfigPath(startDir: string): Promise<string | undefined> {
  let currentDir = path.resolve(startDir);

  while (true) {
    const candidate = path.join(currentDir, 'tsconfig.json');
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }

    currentDir = parentDir;
  }
}

function parseTsconfigCompilerOptions(contents: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(stripJsonComments(stripTrailingCommas(contents))) as {
      compilerOptions?: Record<string, unknown>;
    };
    return parsed.compilerOptions;
  } catch {
    return undefined;
  }
}

function hasTrueFlag(value: Record<string, unknown>, key: string): boolean {
  return value[key] === true;
}

function stripJsonComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function stripTrailingCommas(value: string): string {
  return value.replace(/,\s*([}\]])/g, '$1');
}

function withTrailingNewline(value: string) {
  return value.endsWith('\n') ? value : `${value}\n`;
}
