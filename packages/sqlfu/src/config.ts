import type {SqlfuConfig, SqlfuProjectConfig, SqlfuValidator} from './types.js';
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
    db: resolveConfigPathValue(configDir, fileConfig.db),
    migrations: fileConfig.migrations && resolveConfigPathValue(configDir, fileConfig.migrations),
    definitions: resolveConfigPathValue(configDir, fileConfig.definitions),
    queries: resolveConfigPathValue(configDir, fileConfig.queries),
    generate: {
      validator: fileConfig.generate?.validator ?? null,
      prettyErrors: fileConfig.generate?.prettyErrors !== false,
      sync: fileConfig.generate?.sync === true,
      importExtension: fileConfig.generate?.importExtension ?? inferImportExtension(tsconfigPreferences),
    },
  };
}

export function inferImportExtension(tsconfigPreferences: TsconfigPreferences): '.js' | '.ts' {
  return tsconfigPreferences.prefersTsImportExtensions ? '.ts' : '.js';
}

const validValidators: SqlfuValidator[] = ['arktype', 'valibot', 'zod', 'zod-mini'];

export function assertConfigShape(configPath: string, config: object): asserts config is SqlfuConfig {
  for (const field of ['db', 'definitions', 'queries'] as const) {
    if (!(field in config) || typeof (config as Record<string, unknown>)[field] !== 'string') {
      throw new Error(`Invalid sqlfu config at ${configPath}: missing required string field "${field}".`);
    }
  }
  const migrations = (config as Record<string, unknown>).migrations;
  if (migrations !== undefined && typeof migrations !== 'string') {
    throw new Error(`Invalid sqlfu config at ${configPath}: "migrations" must be a string if provided.`);
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
