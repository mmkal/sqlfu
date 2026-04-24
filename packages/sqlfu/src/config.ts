import type {
  SqlfuAuthority,
  SqlfuConfig,
  SqlfuMigrationPrefix,
  SqlfuMigrationPreset,
  SqlfuProjectConfig,
  SqlfuValidator,
} from './types.js';
import {createDefaultInitPreview} from './init-preview.js';
import {dirname, resolvePath} from './paths.js';

export {createDefaultInitPreview};

export function defineConfig(config: SqlfuConfig): SqlfuConfig {
  return config;
}

export type TsconfigPreferences = {
  prefersTsImportExtensions?: boolean;
};

export function resolveProjectConfig(
  fileConfig: SqlfuConfig,
  configPath: string,
  tsconfigPreferences: TsconfigPreferences = {},
): SqlfuProjectConfig {
  const configDir = dirname(configPath);

  return {
    projectRoot: configDir,
    db: typeof fileConfig.db === 'string' ? resolveConfigPathValue(configDir, fileConfig.db) : fileConfig.db,
    migrations: resolveMigrationsConfig(configDir, fileConfig.migrations),
    definitions: resolveConfigPathValue(configDir, fileConfig.definitions),
    queries: resolveConfigPathValue(configDir, fileConfig.queries),
    generate: {
      validator: fileConfig.generate?.validator ?? null,
      prettyErrors: fileConfig.generate?.prettyErrors !== false,
      sync: fileConfig.generate?.sync === true,
      importExtension: fileConfig.generate?.importExtension ?? inferImportExtension(tsconfigPreferences),
      authority: fileConfig.generate?.authority ?? 'desired_schema',
    },
  };
}

export function inferImportExtension(tsconfigPreferences: TsconfigPreferences): '.js' | '.ts' {
  return tsconfigPreferences.prefersTsImportExtensions ? '.ts' : '.js';
}

const validValidators: SqlfuValidator[] = ['arktype', 'valibot', 'zod', 'zod-mini'];
const validAuthorities: SqlfuAuthority[] = ['desired_schema', 'migrations', 'migration_history', 'live_schema'];
const validPrefixes: SqlfuMigrationPrefix[] = ['iso', 'four-digit'];
const validPresets: SqlfuMigrationPreset[] = ['sqlfu', 'd1'];
const presetDefaultPrefix: Record<SqlfuMigrationPreset, SqlfuMigrationPrefix> = {
  sqlfu: 'iso',
  d1: 'four-digit',
};

export function assertConfigShape(configPath: string, config: object): asserts config is SqlfuConfig {
  for (const field of ['definitions', 'queries'] as const) {
    if (!(field in config) || typeof (config as Record<string, unknown>)[field] !== 'string') {
      throw new Error(`Invalid sqlfu config at ${configPath}: missing required string field "${field}".`);
    }
  }
  const dbField = (config as Record<string, unknown>).db;
  if (dbField !== undefined && typeof dbField !== 'string' && typeof dbField !== 'function') {
    throw new Error(
      `Invalid sqlfu config at ${configPath}: "db" must be a filesystem path, a factory function returning a DisposableAsyncClient, or omitted.`,
    );
  }
  const migrations = (config as Record<string, unknown>).migrations;
  if (migrations !== undefined && typeof migrations !== 'string') {
    if (typeof migrations !== 'object' || migrations === null || Array.isArray(migrations)) {
      throw new Error(
        `Invalid sqlfu config at ${configPath}: "migrations" must be a string or ` +
          `{ path: string; prefix?: 'iso' | 'four-digit'; preset?: 'sqlfu' | 'd1' } if provided.`,
      );
    }
    const migrationsRecord = migrations as Record<string, unknown>;
    if (typeof migrationsRecord.path !== 'string') {
      throw new Error(`Invalid sqlfu config at ${configPath}: "migrations.path" must be a string.`);
    }
    if (migrationsRecord.prefix !== undefined && !validPrefixes.includes(migrationsRecord.prefix as SqlfuMigrationPrefix)) {
      throw new Error(
        `Invalid sqlfu config at ${configPath}: "migrations.prefix" must be 'iso' or 'four-digit'. ` +
          `Got ${JSON.stringify(migrationsRecord.prefix)}.`,
      );
    }
    if (migrationsRecord.preset !== undefined && !validPresets.includes(migrationsRecord.preset as SqlfuMigrationPreset)) {
      throw new Error(
        `Invalid sqlfu config at ${configPath}: "migrations.preset" must be 'sqlfu' or 'd1'. ` +
          `Got ${JSON.stringify(migrationsRecord.preset)}.`,
      );
    }
  }
  const generate = (config as Record<string, unknown>).generate;
  if (generate !== undefined) {
    if (typeof generate !== 'object' || generate === null || Array.isArray(generate)) {
      throw new Error(`Invalid sqlfu config at ${configPath}: "generate" must be an object.`);
    }
    const generateRecord = generate as Record<string, unknown>;

    if ('zod' in generateRecord) {
      throw new Error(
        `Invalid sqlfu config at ${configPath}: "generate.zod" is no longer supported. ` +
          `Use "generate.validator: 'zod' | 'valibot' | 'zod-mini' | null" instead.`,
      );
    }

    const validator = generateRecord.validator;
    if (validator !== undefined && validator !== null && !validValidators.includes(validator as SqlfuValidator)) {
      throw new Error(
        `Invalid sqlfu config at ${configPath}: "generate.validator" must be one of ` +
          `${validValidators.map((v) => `'${v}'`).join(', ')}, null, or undefined. Got ${JSON.stringify(validator)}.`,
      );
    }

    const prettyErrors = generateRecord.prettyErrors;
    if (prettyErrors !== undefined && typeof prettyErrors !== 'boolean') {
      throw new Error(`Invalid sqlfu config at ${configPath}: "generate.prettyErrors" must be a boolean.`);
    }

    const sync = generateRecord.sync;
    if (sync !== undefined && typeof sync !== 'boolean') {
      throw new Error(`Invalid sqlfu config at ${configPath}: "generate.sync" must be a boolean.`);
    }

    const importExtension = generateRecord.importExtension;
    if (importExtension !== undefined && importExtension !== '.js' && importExtension !== '.ts') {
      throw new Error(`Invalid sqlfu config at ${configPath}: "generate.importExtension" must be '.js' or '.ts'.`);
    }

    const authority = generateRecord.authority;
    if (authority !== undefined && !validAuthorities.includes(authority as SqlfuAuthority)) {
      throw new Error(
        `Invalid sqlfu config at ${configPath}: "generate.authority" must be one of ` +
          `${validAuthorities.map((value) => `'${value}'`).join(', ')}, or undefined. Got ${JSON.stringify(authority)}.`,
      );
    }
  }

  if ('generatedImportExtension' in config) {
    throw new Error(
      `Invalid sqlfu config at ${configPath}: "generatedImportExtension" at the top level is no longer supported. ` +
        `Use "generate.importExtension: '.js' | '.ts'" instead.`,
    );
  }
}

function resolveConfigPathValue(configDir: string, configValue: string): string {
  return resolvePath(configDir, configValue);
}

function resolveMigrationsConfig(
  configDir: string,
  value: SqlfuConfig['migrations'],
): SqlfuProjectConfig['migrations'] {
  if (!value) return undefined;
  if (typeof value === 'string') {
    return {path: resolveConfigPathValue(configDir, value), prefix: 'iso', preset: 'sqlfu'};
  }
  const preset: SqlfuMigrationPreset = value.preset ?? 'sqlfu';
  const prefix: SqlfuMigrationPrefix = value.prefix ?? presetDefaultPrefix[preset];
  return {path: resolveConfigPathValue(configDir, value.path), prefix, preset};
}

export type LoadedSqlfuProject =
  | {
      initialized: true;
      projectRoot: string;
      configPath: string;
      config: SqlfuProjectConfig;
    }
  | {
      initialized: false;
      projectRoot: string;
      configPath: string;
    };
