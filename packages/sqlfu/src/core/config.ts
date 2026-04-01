import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import type {ProjectConfigOverrides, SqlfuConfig, SqlfuProjectConfig} from './types.js';

export const defaultSqlite3defVersion = 'v3.10.1';
const defaultConfigFileNames = ['sqlfu.config.ts', 'sqlfu.config.mjs', 'sqlfu.config.js', 'sqlfu.config.cjs'] as const;

export function defineConfig(config: SqlfuConfig): SqlfuConfig {
  return config;
}

export async function loadProjectConfig(overrides: ProjectConfigOverrides = {}): Promise<SqlfuProjectConfig> {
  const cwd = path.resolve(overrides.cwd ?? process.cwd());
  const configPath = await resolveConfigPath(cwd, overrides.configPath);
  const fileConfig = await loadConfigFile(configPath);
  const tsconfigPreferences = await loadTsconfigPreferences(path.dirname(configPath));
  return resolveProjectConfig(overrides, fileConfig, configPath, tsconfigPreferences);
}

export function resolveProjectConfig(
  overrides: ProjectConfigOverrides = {},
  fileConfig: SqlfuConfig,
  configPath: string,
  tsconfigPreferences: TsconfigPreferences = {},
): SqlfuProjectConfig {
  const cwd = path.resolve(overrides.cwd ?? process.cwd());
  const configDir = path.dirname(configPath);
  const tempDir = resolveConfigPathValue(cwd, configDir, fileConfig.tempDir ?? '.sqlfu');

  return {
    cwd,
    configPath,
    dbPath: resolveConfigPathValue(cwd, configDir, fileConfig.dbPath),
    migrationsDir: resolveConfigPathValue(cwd, configDir, fileConfig.migrationsDir),
    snapshotFile: resolveConfigPathValue(cwd, configDir, fileConfig.snapshotFile),
    definitionsPath: resolveConfigPathValue(cwd, configDir, fileConfig.definitionsPath),
    sqlDir: resolveConfigPathValue(cwd, configDir, fileConfig.sqlDir),
    generatedImportExtension: fileConfig.generatedImportExtension ?? inferGeneratedImportExtension(tsconfigPreferences),
    tempDir,
    tempDbPath: resolveConfigPathValue(cwd, configDir, fileConfig.tempDbPath ?? path.join('.sqlfu', 'typegen.db')),
    typesqlConfigPath: resolveConfigPathValue(cwd, configDir, fileConfig.typesqlConfigPath ?? path.join('.sqlfu', 'typesql.json')),
    sqlite3defVersion: fileConfig.sqlite3defVersion ?? defaultSqlite3defVersion,
    sqlite3defBinaryPath: resolveConfigPathValue(cwd, configDir, fileConfig.sqlite3defBinaryPath ?? path.join(tempDir, 'bin', 'sqlite3def')),
  };
}

type TsconfigPreferences = {
  readonly prefersTsImportExtensions?: boolean;
};

async function resolveConfigPath(cwd: string, configPath?: string): Promise<string> {
  if (configPath) {
    const resolved = path.resolve(cwd, configPath);
    try {
      await fs.access(resolved);
      return resolved;
    } catch {
      throw new Error(`No sqlfu config found at ${resolved}`);
    }
  }

  for (const candidate of defaultConfigFileNames) {
    const resolved = path.resolve(cwd, candidate);
    try {
      await fs.access(resolved);
      return resolved;
    } catch {
      continue;
    }
  }

  throw new Error(`No sqlfu config found in ${cwd}. Create sqlfu.config.ts.`);
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
    prefersTsImportExtensions: hasTrueFlag(compilerOptions, 'allowImportingTsExtensions') || hasTrueFlag(compilerOptions, 'rewriteRelativeImportExtensions'),
  };
}

function inferGeneratedImportExtension(tsconfigPreferences: TsconfigPreferences): '.js' | '.ts' {
  return tsconfigPreferences.prefersTsImportExtensions ? '.ts' : '.js';
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
    const parsed = JSON.parse(stripJsonComments(stripTrailingCommas(contents))) as {compilerOptions?: Record<string, unknown>};
    return parsed.compilerOptions;
  } catch {
    return undefined;
  }
}

function hasTrueFlag(value: Record<string, unknown>, key: string): boolean {
  return value[key] === true;
}

function stripJsonComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function stripTrailingCommas(value: string): string {
  return value.replace(/,\s*([}\]])/g, '$1');
}

function assertConfigShape(configPath: string, config: object): asserts config is SqlfuConfig {
  for (const field of ['dbPath', 'migrationsDir', 'snapshotFile', 'definitionsPath', 'sqlDir'] as const) {
    if (!(field in config) || typeof (config as Record<string, unknown>)[field] !== 'string') {
      throw new Error(`Invalid sqlfu config at ${configPath}: missing required string field "${field}".`);
    }
  }
}

function resolveConfigPathValue(cwd: string, configDir: string, configValue: string): string {
  return path.resolve(path.isAbsolute(configValue) ? cwd : configDir, configValue);
}
