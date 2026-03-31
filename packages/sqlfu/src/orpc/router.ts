import fs from 'node:fs/promises';
import path from 'node:path';

import {createRouterClient, os} from '@orpc/server';
import {z} from 'zod';

import {loadProjectConfig} from '../core/config.js';
import {migrationNickname} from '../core/naming.js';
import {createDefaultSqlite3defConfig, diffSnapshotSqlToDesiredSql, runSqlite3def} from '../core/sqlite3def.js';

export interface SqlfuFsLike {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, contents: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string): Promise<void>;
}

export interface SqlfuDatabaseLike {
  execute(sql: string): Promise<void>;
  exportSchema(): Promise<string>;
}

export type SqlfuCheckResult = 'ok' | `failure: ${string}`;

export interface SqlfuCheckReport {
  readonly ok: SqlfuCheckResult;
  readonly desiredVsHistory: SqlfuCheckResult;
  readonly finalizedVsSnapshot: SqlfuCheckResult;
  readonly databaseVsDesired: SqlfuCheckResult;
  readonly databaseVsFinalized: SqlfuCheckResult;
}

export interface SqlfuRouterConfig {
  readonly definitionsPath: string;
  readonly migrationsDir: string;
  readonly snapshotPath: string;
  readonly dbPath: string;
}

export interface SqlfuRouterContext {
  readonly config?: SqlfuRouterConfig;
  readonly fs?: SqlfuFsLike;
  readonly db?: SqlfuDatabaseLike;
}

type MigrationStatus = 'draft' | 'final';

type MigrationFile = {
  readonly fileName: string;
  readonly contents: string;
  readonly body: string;
  status(): MigrationStatus;
};

const sqlite3defConfig = createDefaultSqlite3defConfig('orpc');
const configShape = {
  cwd: z.string().optional(),
  configPath: z.string().optional(),
  dbPath: z.string().optional(),
  migrationsDir: z.string().optional(),
  snapshotFile: z.string().optional(),
  definitionsPath: z.string().optional(),
  sqlDir: z.string().optional(),
  tempDir: z.string().optional(),
  tempDbPath: z.string().optional(),
  typesqlConfigPath: z.string().optional(),
  sqlite3defVersion: z.string().optional(),
  sqlite3defBinaryPath: z.string().optional(),
};
export const sqlfuConfigInput = z.object(configShape).default({});
const draftInputSchema = z
  .object({
    ...configShape,
    name: z.string().min(1).optional(),
    finalize: z.boolean().optional(),
    content: z.string().optional(),
  })
  .optional();
const base = os.$context<SqlfuRouterContext>();

export const sqlfuRouter = {
  sync: base.input(sqlfuConfigInput).handler(async ({context, input}) => {
    await using runtime = await resolveRuntime(context, input);
    const desiredSql = await runtime.fs.readFile(runtime.config.definitionsPath);
    await runtime.db.execute(desiredSql);
  }),

  migrate: base.input(sqlfuConfigInput).handler(async ({context, input}) => {
    await using runtime = await resolveRuntime(context, input);
    const migrations = await loadMigrations(runtime);
    const draftMigration = migrations.find((migration) => migration.status() === 'draft');
    if (draftMigration) {
      throw new Error(`draft migration must be finalized before migrate: ${draftMigration.fileName}`);
    }

    const snapshotSql = await runtime.fs.readFile(runtime.config.snapshotPath);
    await runtime.db.execute(snapshotSql);
  }),

  draft: base.input(draftInputSchema).handler(async ({context, input}) => {
    await using runtime = await resolveRuntime(context, input);
    const desiredSql = await runtime.fs.readFile(runtime.config.definitionsPath);
    const snapshotSql = await runtime.fs.readFile(runtime.config.snapshotPath);
    const migrations = await loadMigrations(runtime);
    const existingDraft = migrations.find((migration) => migration.status() === 'draft');
    const wantsFinalize = input?.finalize === true;
    const wantsContent = typeof input?.content === 'string';
    const wantsName = typeof input?.name === 'string' && input.name.trim().length > 0;

    if (wantsFinalize && wantsContent) {
      throw new Error('draft finalize cannot be combined with content');
    }

    if (wantsFinalize && wantsName) {
      throw new Error('draft finalize cannot be combined with name');
    }

    if (wantsFinalize) {
      if (!existingDraft) {
        throw new Error('no draft migration exists to finalize');
      }

        await runtime.fs.writeFile(
          joinPath(runtime.config.migrationsDir, existingDraft.fileName),
          serializeMigration('final', existingDraft.body),
        );
        await runtime.fs.writeFile(runtime.config.snapshotPath, withTrailingNewline(desiredSql));
        return;
      }

    if (existingDraft && wantsName) {
      throw new Error(`draft migration already exists: ${existingDraft.fileName}`);
    }

    const draftBody = wantsContent
      ? input!.content!.trim()
      : (await diffSnapshotSqlToDesiredSql(sqlite3defConfig, {snapshotSql, desiredSql})).join('\n');
    const targetFileName =
      existingDraft?.fileName ??
      `${nextMigrationId(migrations)}_${slugify(input?.name ?? migrationNickname(draftBody))}.sql`;

    await runtime.fs.mkdir(runtime.config.migrationsDir);
    await runtime.fs.writeFile(
      joinPath(runtime.config.migrationsDir, targetFileName),
      serializeMigration('draft', draftBody),
    );
  }),

  check: base.input(sqlfuConfigInput).handler(async ({context, input}): Promise<SqlfuCheckReport> => {
    await using runtime = await resolveRuntime(context, input);
    const definitionsSql = await runtime.fs.readFile(runtime.config.definitionsPath);
    const snapshotSql = await runtime.fs.readFile(runtime.config.snapshotPath);
    const migrations = await loadMigrations(runtime);
    const databaseSql = await runtime.db.exportSchema();

    const finalSql = migrations
      .filter((migration) => migration.status() === 'final')
      .map((migration) => migration.body)
      .join('\n');
    const draftSql = migrations.find((migration) => migration.status() === 'draft')?.body ?? '';
    const desiredVsHistory = compareSchemas(
      'desired schema does not match finalized history plus draft',
      definitionsSql,
      [snapshotSql, draftSql].filter(Boolean).join('\n'),
    );
    const finalizedVsSnapshot = compareSchemas(
      'finalized history does not match snapshot.sql',
      snapshotSql,
      finalSql,
    );
    const databaseVsDesired = compareSchemas(
      'database does not match desired schema',
      definitionsSql,
      databaseSql,
    );
    const databaseVsFinalized = compareSchemas(
      'database does not match finalized history',
      snapshotSql,
      databaseSql,
    );

    const failures = [desiredVsHistory, finalizedVsSnapshot, databaseVsDesired, databaseVsFinalized].filter(
      (result) => result !== 'ok',
    );

    return {
      ok: failures.length === 0 ? 'ok' : (`failure: ${failures.map((failure) => failure.slice('failure: '.length)).join('; ')}` as const),
      desiredVsHistory,
      finalizedVsSnapshot,
      databaseVsDesired,
      databaseVsFinalized,
    };
  }),
};

export function createSqlfuCaller(context: SqlfuRouterContext) {
  return createRouterClient(sqlfuRouter, {context});
}

async function loadMigrations(context: {config: SqlfuRouterConfig; fs: SqlfuFsLike}): Promise<MigrationFile[]> {
  const exists = await context.fs.exists(context.config.migrationsDir);
  if (!exists) {
    return [];
  }

  const fileNames = (await context.fs.readdir(context.config.migrationsDir))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();

  return Promise.all(
    fileNames.map(async (fileName) => {
      const contents = await context.fs.readFile(joinPath(context.config.migrationsDir, fileName));
      return parseMigrationFile(fileName, contents);
    }),
  );
}

async function resolveRuntime(
  context: SqlfuRouterContext,
  overrides?: z.input<typeof sqlfuConfigInput>,
): Promise<{
  config: SqlfuRouterConfig;
  fs: SqlfuFsLike;
  db: SqlfuDatabaseLike;
  [Symbol.asyncDispose](): Promise<void>;
}> {
  if (context.config && context.fs && context.db) {
    return {
      config: context.config,
      fs: context.fs,
      db: context.db,
      async [Symbol.asyncDispose]() {},
    };
  }

  const projectConfig = await loadProjectConfig(overrides ?? {});
  const stagedSqlPath = path.join(projectConfig.tempDir, 'cli-applied.sql');

  return {
    config: {
      definitionsPath: projectConfig.definitionsPath,
      migrationsDir: projectConfig.migrationsDir,
      snapshotPath: projectConfig.snapshotFile,
      dbPath: projectConfig.dbPath,
    },
    fs: {
      async exists(filePath: string) {
        try {
          await fs.access(filePath);
          return true;
        } catch {
          return false;
        }
      },
      async readFile(filePath: string) {
        return fs.readFile(filePath, 'utf8');
      },
      async writeFile(filePath: string, contents: string) {
        await fs.mkdir(path.dirname(filePath), {recursive: true});
        await fs.writeFile(filePath, contents);
      },
      async readdir(dirPath: string) {
        return (await fs.readdir(dirPath)).sort();
      },
      async mkdir(dirPath: string) {
        await fs.mkdir(dirPath, {recursive: true});
      },
    },
    db: {
      async execute(sql: string) {
        await fs.mkdir(path.dirname(stagedSqlPath), {recursive: true});
        await fs.writeFile(stagedSqlPath, sql);
        await runSqlite3def(projectConfig, ['--apply', '--file', stagedSqlPath, projectConfig.dbPath]);
      },
      async exportSchema() {
        return runSqlite3def(projectConfig, ['--export', projectConfig.dbPath]);
      },
    },
    async [Symbol.asyncDispose]() {},
  };
}

function parseMigrationFile(fileName: string, contents: string): MigrationFile {
  const lines = contents.split('\n');
  const statusLine = lines.find((line) => line.trim().startsWith('-- status:'));
  const statusValue = statusLine?.split(':')[1]?.trim();
  const body = lines
    .filter((line) => !line.trim().startsWith('-- status:'))
    .join('\n')
    .trim();

  return {
    fileName,
    contents,
    body,
    status() {
      return statusValue === 'draft' ? 'draft' : 'final';
    },
  };
}

function serializeMigration(status: MigrationStatus, body: string): string {
  return `-- status: ${status}\n${body.trim()}\n`;
}

function compareSchemas(message: string, leftSql: string, rightSql: string): SqlfuCheckResult {
  return normalizeSql(leftSql) === normalizeSql(rightSql) ? 'ok' : `failure: ${message}`;
}

function normalizeSql(sql: string): string {
  return splitStatements(sql).join('\n');
}

function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'migration';
}

function joinPath(left: string, right: string): string {
  return `${left.replace(/\/+$/u, '')}/${right.replace(/^\/+/u, '')}`;
}

function withTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function nextMigrationId(migrations: readonly MigrationFile[]): string {
  const numericIds = migrations
    .map((migration) => migration.fileName.match(/^(\d+)_/u)?.[1])
    .filter((value): value is string => Boolean(value));

  if (numericIds.length === 0) {
    return '00000000000001';
  }

  const widest = Math.max(...numericIds.map((id) => id.length));
  const next = (BigInt(numericIds.sort().at(-1)!) + 1n).toString();
  return next.padStart(widest, '0');
}
