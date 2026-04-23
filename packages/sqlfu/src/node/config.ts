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

const defaultConfigFileNames = ['sqlfu.config.ts', 'sqlfu.config.mjs', 'sqlfu.config.js', 'sqlfu.config.cjs'] as const;
const defaultSqlfuConfigFileName = 'sqlfu.config.ts';

export async function loadProjectConfig(): Promise<SqlfuProjectConfig> {
  const cwd = path.resolve(process.cwd());
  const project = await loadProjectStateFrom(cwd);
  if (!project.initialized) {
    throw new Error(`No sqlfu config found in ${cwd}. Create sqlfu.config.ts.`);
  }
  return project.config;
}

export async function loadProjectState() {
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

  const fileConfig = await loadConfigFile(configPath);
  const tsconfigPreferences = await loadTsconfigPreferences(path.dirname(configPath));
  return {
    initialized: true,
    projectRoot,
    configPath,
    config: resolveProjectConfig(fileConfig, configPath, tsconfigPreferences),
  };
}

export async function initializeProject(input: {projectRoot: string; configContents: string}) {
  const preview = createDefaultInitPreview(input.projectRoot);
  const state = await loadProjectStateFrom(input.projectRoot);
  if (state.initialized) {
    throw new Error(`sqlfu is already initialized in ${input.projectRoot}`);
  }

  await fs.mkdir(path.join(input.projectRoot, 'db'), {recursive: true});
  await fs.mkdir(path.join(input.projectRoot, 'migrations'), {recursive: true});
  await fs.mkdir(path.join(input.projectRoot, 'sql'), {recursive: true});
  await fs.writeFile(preview.configPath, withTrailingNewline(input.configContents));
  await fs.writeFile(
    path.join(input.projectRoot, 'definitions.sql'),
    '-- create table yourtable(id int, body text);\n',
  );
  await fs.writeFile(path.join(input.projectRoot, 'migrations', '.gitkeep'), '');
  await fs.writeFile(path.join(input.projectRoot, 'sql', '.gitkeep'), '');
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
