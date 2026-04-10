import fs from 'node:fs/promises';
import path from 'node:path';

import {createClient} from '@libsql/client';
import {createRouterClient, os} from '@orpc/server';
import {z} from 'zod';

import {createDefaultSqlite3defConfig, diffSnapshotSqlToDesiredSql, runSqlite3def} from './core/sqlite3def.js';
import type {SqlfuProjectConfig} from './core/types.js';
import {generateQueryTypes} from './typegen/index.js';

const base = os.$context<SqlfuRouterContext>();
const sqlite3defConfig = createDefaultSqlite3defConfig('orpc');
const draftInputSchema = z
  .object({
    name: z.string().min(1).optional(),
    bumpTimestamp: z.boolean().optional(),
  })
  .optional();
const migrateInputSchema = z.object({
  includeDraft: z.boolean(),
});

export const router = {
  generate: base.handler(async () => {
    await generateQueryTypes();
    return 'Generated schema-derived database and TypeSQL outputs.';
  }),

  config: base.handler(async ({context}) => {
    return context.projectConfig;
  }),

  sync: base.handler(async ({context}) => {
    const definitionsSql = await fs.readFile(context.projectConfig.definitionsPath, 'utf8');
    const stagedSqlPath = path.join(context.projectConfig.projectRoot, '.sqlfu', 'sync.sql');

    await fs.mkdir(path.dirname(stagedSqlPath), {recursive: true});
    await fs.writeFile(stagedSqlPath, definitionsSql);
    await runSqlite3def(
      {
        ...sqlite3defConfig,
        projectRoot: context.projectConfig.projectRoot,
      },
      ['--apply', '--file', stagedSqlPath, context.projectConfig.dbPath],
    );
  }),

  draft: base.input(draftInputSchema).handler(async ({context, input}) => {
    const runtime = createRuntime(context);
    let migrations = await runtime.readMigrations();
    const definitionsSql = await runtime.readDefinitionsSql();
    const draftMigrations = migrations.filter((migration) => migration.status === 'draft');

    if (draftMigrations.length > 1) {
      throw new Error('multiple draft migrations exist');
    }

    let draft = draftMigrations[0];
    if (draft && migrations.at(-1)?.fileName !== draft.fileName) {
      if (input?.bumpTimestamp !== true) {
        throw new Error('draft migration must be lexically last; rerun with bumpTimestamp: true');
      }

      const bumpedFileName = `${nextMigrationId(migrations, runtime.now())}_${draft.fileName.replace(/^\d{14}_/u, '')}`;
      await fs.rename(draft.path, path.join(context.projectConfig.migrationsDir, bumpedFileName));
      migrations = await runtime.readMigrations();
      const bumpedDraft = migrations.find((migration) => migration.status === 'draft');
      if (!bumpedDraft) {
        throw new Error('draft migration disappeared after bumpTimestamp');
      }
      draft = bumpedDraft;
    }

    const baselineSql = draft ? await materializeMigrationsSchema(runtime.projectRoot, migrations) : '';
    const diffLines = await diffSnapshotSqlToDesiredSql(sqlite3defConfig, {
      snapshotSql: baselineSql,
      desiredSql: definitionsSql,
    });

    if (draft) {
      if (diffLines.length === 0) {
        return;
      }

      await fs.writeFile(draft.path, `${draft.contents.trimEnd()}\n\n${diffLines.join('\n')}\n`);
      return;
    }

    const fileName = `${nextMigrationId(migrations, runtime.now())}_${slugify(input?.name ?? 'draft')}.sql`;
    const body = diffLines.length === 0 ? definitionsSql.trim() : diffLines.join('\n');

    await fs.mkdir(context.projectConfig.migrationsDir, {recursive: true});
    await fs.writeFile(path.join(context.projectConfig.migrationsDir, fileName), `-- status: draft\n${body}\n`);
  }),

  migrate: base.input(migrateInputSchema).handler(async ({context, input}) => {
    const runtime = createRuntime(context);
    const migrations = await runtime.readMigrations();
    const draftMigrations = migrations.filter((migration) => migration.status === 'draft');

    if (draftMigrations.length > 1) {
      throw new Error('multiple draft migrations exist');
    }

    if (draftMigrations.length === 1 && !input.includeDraft) {
      throw new Error('draft migration exists; pass includeDraft: true to apply it');
    }

    await applyMigrationsToDatabase(
      context.projectConfig.dbPath,
      input.includeDraft ? migrations : migrations.filter((migration) => migration.status === 'final'),
    );
  }),

  finalize: base.handler(async ({context}) => {
    const runtime = createRuntime(context);
    const migrations = await runtime.readMigrations();
    const draftMigrations = migrations.filter((migration) => migration.status === 'draft');

    if (draftMigrations.length === 0) {
      throw new Error('no draft migration exists to finalize');
    }

    if (draftMigrations.length > 1) {
      throw new Error('multiple draft migrations exist');
    }

    const draft = draftMigrations[0]!;
    const definitionsSql = await runtime.readDefinitionsSql();
    const [definitionsSchema, migrationsSchema] = await Promise.all([
      materializeDefinitionsSchema(runtime.projectRoot, definitionsSql),
      materializeMigrationsSchema(runtime.projectRoot, migrations),
    ]);

    if (definitionsSchema !== migrationsSchema) {
      throw new Error('draft migration does not match definitions.sql');
    }

    await fs.writeFile(draft.path, draft.contents.replace(/^--\s*status:\s*draft\b/iu, '-- status: final'));
  }),

  check: {
    all: base.meta({default: true}).handler(async ({context}) => {
      const checks = await runChecks(createRuntime(context));
      return {
        ok: Object.values(checks).every((check) => check.ok),
        checks,
      };
    }),
    draftCount: base.handler(async ({context}) => (await runChecks(createRuntime(context))).draftCount),
    migrationMetadata: base.handler(async ({context}) => (await runChecks(createRuntime(context))).migrationMetadata),
    draftIsLast: base.handler(async ({context}) => (await runChecks(createRuntime(context))).draftIsLast),
    migrationsMatchDefinitions: base.handler(
      async ({context}) => (await runChecks(createRuntime(context))).migrationsMatchDefinitions,
    ),
    noDraft: base.handler(async ({context}) => (await runChecks(createRuntime(context))).noDraft),
  },
};

export const sqlfuRouter = router;

export function createCaller(context: SqlfuRouterContext) {
  return createRouterClient(router, {context});
}

export const createSqlfuCaller = createCaller;

function createRuntime(context: SqlfuRouterContext) {
  return {
    projectRoot: context.projectConfig.projectRoot,
    now: () => context.now?.() ?? new Date(),
    readDefinitionsSql: () => fs.readFile(context.projectConfig.definitionsPath, 'utf8'),
    async readMigrations() {
      try {
        const fileNames = (await fs.readdir(context.projectConfig.migrationsDir))
          .filter((fileName) => fileName.endsWith('.sql'))
          .sort();

        const migrations = [];
        for (const fileName of fileNames) {
          const filePath = path.join(context.projectConfig.migrationsDir, fileName);
          const contents = await fs.readFile(filePath, 'utf8');
          migrations.push({
            fileName,
            path: filePath,
            contents,
            status: parseMigrationStatus(contents),
          });
        }
        return migrations;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return [];
        }
        throw error;
      }
    },
  };
}

function parseMigrationStatus(contents: string): 'draft' | 'final' {
  const metadata = parseMigrationMetadata(contents);
  if (metadata.status === 'draft' || metadata.status === 'final') {
    return metadata.status;
  }
  throw new Error('migration metadata must include status: draft|final on the first line');
}

function parseMigrationMetadata(contents: string) {
  const firstLine = contents.split('\n', 1)[0];
  const match = firstLine.match(/^--\s*(.*)$/u);
  if (!match) {
    throw new Error('migration metadata must be on the first line');
  }

  return Object.fromEntries(
    match[1]
      .split(/,\s*/u)
      .filter(Boolean)
      .map((segment) => {
        const [key, value] = segment.split(/:\s*/u, 2);
        return [key, value];
      }),
  );
}

function nextMigrationId(existingMigrations: readonly {fileName: string}[], now: Date) {
  const nowId = formatMigrationTimestamp(now);
  const lastExistingId = existingMigrations.at(-1)?.fileName.match(/^(\d{14})_/u)?.[1];
  if (!lastExistingId || lastExistingId < nowId) {
    return nowId;
  }
  return String(Number(lastExistingId) + 1).padStart(14, '0');
}

function formatMigrationTimestamp(value: Date) {
  const year = String(value.getUTCFullYear());
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');
  const seconds = String(value.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .replace(/_+/gu, '_');
}

async function materializeDefinitionsSchema(projectRoot: string, definitionsSql: string) {
  await fs.mkdir(sqlite3defConfig.tempDir, {recursive: true});
  const workDir = await fs.mkdtemp(path.join(sqlite3defConfig.tempDir, 'definitions-'));
  const definitionsPath = path.join(workDir, 'definitions.sql');
  const dbPath = path.join(workDir, 'schema.db');

  try {
    await fs.writeFile(definitionsPath, definitionsSql);
    if (definitionsSql.trim()) {
      await runSqlite3def({...sqlite3defConfig, projectRoot}, ['--apply', '--file', definitionsPath, dbPath]);
    }
    return exportSchema(dbPath);
  } finally {
    await fs.rm(workDir, {recursive: true, force: true});
  }
}

async function materializeMigrationsSchema(projectRoot: string, migrations: readonly {path: string}[]) {
  await fs.mkdir(sqlite3defConfig.tempDir, {recursive: true});
  const workDir = await fs.mkdtemp(path.join(sqlite3defConfig.tempDir, 'migrations-'));
  const dbPath = path.join(workDir, 'schema.db');

  try {
    await ensureDatabaseExists(dbPath);
    for (const migration of migrations) {
      await executeSqlScript(dbPath, await fs.readFile(migration.path, 'utf8'));
    }
    return exportSchema(dbPath);
  } finally {
    await fs.rm(workDir, {recursive: true, force: true});
  }
}

async function applyMigrationsToDatabase(dbPath: string, migrations: readonly {path: string}[]) {
  await ensureDatabaseExists(dbPath);
  for (const migration of migrations) {
    await executeSqlScript(dbPath, await fs.readFile(migration.path, 'utf8'));
  }
}

async function exportSchema(dbPath: string) {
  const client = createClient({url: `file:${dbPath}`});
  try {
    const result = await client.execute(`
      select sql
      from sqlite_schema
      where sql is not null
        and name not like 'sqlite_%'
      order by type, name
    `);
    return result.rows.map((row) => `${String(row.sql).toLowerCase()};`).join('\n');
  } finally {
    client.close();
  }
}

async function ensureDatabaseExists(dbPath: string) {
  const client = createClient({url: `file:${dbPath}`});
  client.close();
}

async function executeSqlScript(dbPath: string, sql: string) {
  const client = createClient({url: `file:${dbPath}`});
  try {
    for (const statement of splitSqlStatements(sql)) {
      await client.execute(statement);
    }
  } finally {
    client.close();
  }
}

async function runChecks(runtime: ReturnType<typeof createRuntime>) {
  const migrations = await runtime.readMigrations();
  const draftMigrations = migrations.filter((migration) => migration.status === 'draft');

  const draftCount = draftMigrations.length <= 1 ? okCheck() : failedCheck('multiple draft migrations exist');
  const migrationMetadata = checkMigrationMetadata(migrations);
  const draftIsLast =
    draftMigrations.length === 0 || migrations.at(-1)?.fileName === draftMigrations[0]?.fileName
      ? okCheck()
      : failedCheck('draft migration must be lexically last');
  const noDraft = draftMigrations.length === 0 ? okCheck() : failedCheck('draft migration exists');

  let migrationsMatchDefinitions: CheckResult;
  try {
    const [definitionsSchema, migrationsSchema] = await Promise.all([
      materializeDefinitionsSchema(runtime.projectRoot, await runtime.readDefinitionsSql()),
      materializeMigrationsSchema(runtime.projectRoot, migrations),
    ]);
    migrationsMatchDefinitions =
      definitionsSchema === migrationsSchema ? okCheck() : failedCheck('replayed migrations do not match definitions.sql');
  } catch (error) {
    migrationsMatchDefinitions = failedCheck(
      `migration replay failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    draftCount,
    migrationMetadata,
    draftIsLast,
    migrationsMatchDefinitions,
    noDraft,
  };
}

function checkMigrationMetadata(migrations: readonly {contents: string}[]): CheckResult {
  try {
    for (const migration of migrations) {
      parseMigrationStatus(migration.contents);
    }
    return okCheck();
  } catch (error) {
    return failedCheck(error instanceof Error ? error.message : String(error));
  }
}

function okCheck(): CheckResult {
  return {ok: true};
}

function failedCheck(message: string): CheckResult {
  return {ok: false, message};
}

function splitSqlStatements(sql: string) {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
}

export interface SqlfuRouterContext {
  readonly projectConfig: SqlfuProjectConfig;
  readonly now?: () => Date;
}

interface CheckResult {
  readonly ok: boolean;
  readonly message?: string;
}
