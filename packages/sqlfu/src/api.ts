import fs from 'node:fs/promises';
import path from 'node:path';

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
    rewrite: z.boolean().optional(),
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
    try {
      await runSqlite3def(
        {
          ...sqlite3defConfig,
          projectRoot: context.projectConfig.projectRoot,
        },
        ['--apply', '--file', stagedSqlPath, context.projectConfig.dbPath],
      );
    } catch (error) {
      throw new Error(
        [
          'sync could not apply definitions.sql safely to the current database.',
          'Create or update a draft migration and test it with `sqlfu migrate --include-draft`.',
          '',
          `Cause: ${summarizeSqlite3defError(error)}`,
        ].join('\n'),
      );
    }
  }),

  draft: base.input(draftInputSchema).handler(async ({context, input}) => {
    const runtime = createRuntime(context);
    let migrations = await runtime.readMigrations();
    const definitionsSql = await runtime.readDefinitionsSql();
    const draftMigrations = migrations.filter((migration) => migration.status === 'draft');

    if (draftMigrations.length > 1) {
      throw new Error('multiple draft migrations exist');
    }

    let currentDraft = draftMigrations[0];
    if (currentDraft && migrations.at(-1)?.fileName !== currentDraft.fileName) {
      if (!input?.bumpTimestamp) {
        throw new Error('draft migration must be lexically last; rerun with bumpTimestamp: true');
      }

      const bumpedFileName = `${nextMigrationId(migrations, runtime.now())}_${currentDraft.fileName.replace(/^[^_]+_/u, '')}`;
      await fs.rename(currentDraft.path, path.join(context.projectConfig.migrationsDir, bumpedFileName));
      migrations = await runtime.readMigrations();
      const bumpedDraft = migrations.find((migration) => migration.status === 'draft');
      if (!bumpedDraft) {
        throw new Error('draft migration disappeared after bumpTimestamp');
      }
      currentDraft = bumpedDraft;
    }

    if (currentDraft && input?.rewrite) {
      await fs.writeFile(currentDraft.path, '-- status: draft\n');
      migrations = await runtime.readMigrations();
      const rewrittenDraft = migrations.find((migration) => migration.status === 'draft');
      if (!rewrittenDraft) {
        throw new Error('draft migration disappeared after rewrite');
      }
      currentDraft = rewrittenDraft;
    }

    const baselineSql = currentDraft
      ? await materializeMigrationsSchema(runtime.createSqliteFileDatabase, runtime.projectRoot, migrations)
      : '';
    const diffLines = await diffSnapshotSqlToDesiredSql(sqlite3defConfig, {
      snapshotSql: baselineSql,
      desiredSql: definitionsSql,
    });

    if (currentDraft) {
      if (diffLines.length) {
        await fs.writeFile(currentDraft.path, appendMigrationContents(currentDraft.contents, diffLines));
      }

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
      runtime.createSqliteFileDatabase,
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
      materializeDefinitionsSchema(runtime.createSqliteFileDatabase, runtime.projectRoot, definitionsSql),
      materializeMigrationsSchema(runtime.createSqliteFileDatabase, runtime.projectRoot, migrations),
    ]);

    if (definitionsSchema !== migrationsSchema) {
      throw new Error('draft migration does not match definitions.sql');
    }

    await fs.writeFile(draft.path, draft.contents.replace(/^--\s*status:\s*draft\b/iu, '-- status: final'));
  }),

  check: {
    all: base.meta({default: true}).handler(async ({context}) => {
      await runChecks(
        createRuntime(context),
        checkDraftCount,
        checkMigrationMetadata,
        checkDraftIsLast,
        checkMigrationsMatchDefinitions,
        checkNoDraft,
      );
    }),
    draftCount: base.handler(async ({context}) => {
      await runChecks(createRuntime(context), checkDraftCount);
    }),
    migrationMetadata: base.handler(async ({context}) => {
      await runChecks(createRuntime(context), checkMigrationMetadata);
    }),
    draftIsLast: base.handler(async ({context}) => {
      await runChecks(createRuntime(context), checkDraftIsLast);
    }),
    migrationsMatchDefinitions: base.handler(async ({context}) => {
      await runChecks(createRuntime(context), checkMigrationsMatchDefinitions);
    }),
    noDraft: base.handler(async ({context}) => {
      await runChecks(createRuntime(context), checkNoDraft);
    }),
  },
};

function createRuntime(context: SqlfuRouterContext) {
  return {
    projectRoot: context.projectConfig.projectRoot,
    now: () => context.now?.() ?? new Date(),
    createSqliteFileDatabase: context.createSqliteFileDatabase,
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
    throw new Error('migration metadata (looking like "-- status: final") must be on the first line');
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
  const lastExistingId = existingMigrations.at(-1)?.fileName.match(/^([^_]+)_/u)?.[1];
  if (!lastExistingId || lastExistingId < nowId) {
    return nowId;
  }

  let next = new Date(parseMigrationTimestamp(lastExistingId).getTime() + 1);
  while (formatMigrationTimestamp(next) <= lastExistingId) {
    next = new Date(next.getTime() + 1);
  }
  return formatMigrationTimestamp(next);
}

function formatMigrationTimestamp(value: Date) {
  return value.toISOString().replaceAll(':', '.');
}

function parseMigrationTimestamp(value: string) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2})\.(\d{2})\.(\d{2})\.(\d{3}Z)$/u);
  if (!match) {
    throw new Error(`invalid migration timestamp: ${value}`);
  }

  return new Date(`${match[1]}:${match[2]}:${match[3]}.${match[4]}`);
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .replace(/_+/gu, '_');
}

async function materializeDefinitionsSchema(
  createSqliteFileDatabase: SqliteFileDatabaseFactory,
  projectRoot: string,
  definitionsSql: string,
) {
  await fs.mkdir(sqlite3defConfig.tempDir, {recursive: true});
  const workDir = await fs.mkdtemp(path.join(sqlite3defConfig.tempDir, 'definitions-'));
  const definitionsPath = path.join(workDir, 'definitions.sql');
  const dbPath = path.join(workDir, 'schema.db');

  try {
    await fs.writeFile(definitionsPath, definitionsSql);
    if (definitionsSql.trim()) {
      await runSqlite3def({...sqlite3defConfig, projectRoot}, ['--apply', '--file', definitionsPath, dbPath]);
    }
    return exportSchema(createSqliteFileDatabase, dbPath);
  } finally {
    await fs.rm(workDir, {recursive: true, force: true});
  }
}

async function materializeMigrationsSchema(
  createSqliteFileDatabase: SqliteFileDatabaseFactory,
  projectRoot: string,
  migrations: readonly {path: string}[],
) {
  await fs.mkdir(sqlite3defConfig.tempDir, {recursive: true});
  const workDir = await fs.mkdtemp(path.join(sqlite3defConfig.tempDir, 'migrations-'));
  const dbPath = path.join(workDir, 'schema.db');
  try {
    await ensureDatabaseExists(createSqliteFileDatabase, dbPath);
    for (const migration of migrations) {
      await executeSqlScript(createSqliteFileDatabase, dbPath, await fs.readFile(migration.path, 'utf8'));
    }
    return exportSchema(createSqliteFileDatabase, dbPath);
  } finally {
    await fs.rm(workDir, {recursive: true, force: true});
  }
}

async function applyMigrationsToDatabase(
  createSqliteFileDatabase: SqliteFileDatabaseFactory,
  dbPath: string,
  migrations: readonly {path: string}[],
) {
  await ensureDatabaseExists(createSqliteFileDatabase, dbPath);
  for (const migration of migrations) {
    await executeSqlScript(createSqliteFileDatabase, dbPath, await fs.readFile(migration.path, 'utf8'));
  }
}

async function exportSchema(createSqliteFileDatabase: SqliteFileDatabaseFactory, dbPath: string) {
  const database = createSqliteFileDatabase(dbPath);
  try {
    const rows = await database.query(`
      select sql
      from sqlite_schema
      where sql is not null
        and name not like 'sqlite_%'
      order by type, name
    `);
    return rows.map((row) => `${String(row.sql).toLowerCase()};`).join('\n');
  } finally {
    database.close();
  }
}

async function ensureDatabaseExists(createSqliteFileDatabase: SqliteFileDatabaseFactory, dbPath: string) {
  const database = createSqliteFileDatabase(dbPath);
  await database.close();
}

async function executeSqlScript(
  createSqliteFileDatabase: SqliteFileDatabaseFactory,
  dbPath: string,
  sql: string,
) {
  const database = createSqliteFileDatabase(dbPath);
  try {
    for (const statement of splitSqlStatements(sql)) {
      if (stripSqlComments(statement).trim() === '') {
        continue;
      }
      try {
        await database.execute(statement);
      } catch (error) {
        throw new Error(summarizeDatabaseError(error));
      }
    }
  } finally {
    await database.close();
  }
}

async function createCheckState(runtime: ReturnType<typeof createRuntime>): Promise<CheckState> {
  const migrations = await runtime.readMigrations();
  return {
    runtime,
    migrations,
    draftMigrations: migrations.filter((migration) => migration.status === 'draft'),
  };
}

function combineChecks(...checks: readonly CheckFunction[]): CheckFunction {
  return async (state) => {
    const problemGroups = await Promise.all(checks.map((check) => check(state)));
    return problemGroups.flat();
  };
}

async function runChecks(runtime: ReturnType<typeof createRuntime>, ...checks: readonly CheckFunction[]) {
  const state = await createCheckState(runtime);
  const check = combineChecks(...checks);
  const problems = await check(state);
  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }
}

function checkDraftCount(state: CheckState): string[] {
  return state.draftMigrations.length <= 1 ? [] : ['multiple draft migrations exist'];
}

function checkMigrationMetadata(state: CheckState): string[] {
  try {
    for (const migration of state.migrations) {
      parseMigrationStatus(migration.contents);
    }
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

function checkDraftIsLast(state: CheckState): string[] {
  return state.draftMigrations.length === 0 || state.migrations.at(-1)?.fileName === state.draftMigrations[0]?.fileName
    ? []
    : ['draft migration must be lexically last'];
}

function checkNoDraft(state: CheckState): string[] {
  return state.draftMigrations.length === 0 ? [] : ['draft migration exists'];
}

async function checkMigrationsMatchDefinitions(state: CheckState): Promise<string[]> {
  try {
    const [definitionsSchema, migrationsSchema] = await Promise.all([
      materializeDefinitionsSchema(
        state.runtime.createSqliteFileDatabase,
        state.runtime.projectRoot,
        await state.runtime.readDefinitionsSql(),
      ),
      materializeMigrationsSchema(
        state.runtime.createSqliteFileDatabase,
        state.runtime.projectRoot,
        state.migrations,
      ),
    ]);

    return definitionsSchema === migrationsSchema ? [] : ['replayed migrations do not match definitions.sql'];
  } catch (error) {
    return [`migration replay failed: ${error instanceof Error ? error.message : String(error)}`];
  }
}

function splitSqlStatements(sql: string) {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
}

function appendMigrationContents(contents: string, lines: readonly string[]) {
  const trimmed = contents.trimEnd();
  return `${trimmed}${trimmed === '-- status: draft' ? '\n' : '\n\n'}${lines.join('\n')}\n`;
}

function stripSqlComments(sql: string) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

function summarizeSqlite3defError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const line = message
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
    .at(-1) ?? message.trim();
  return line.replace(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} /u, '');
}

function summarizeDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^SQLITE_ERROR:\s*/u, '').trim();
}

export interface SqlfuRouterContext {
  readonly projectConfig: SqlfuProjectConfig;
  readonly now?: () => Date;
  readonly createSqliteFileDatabase: SqliteFileDatabaseFactory;
}

export interface SqliteFileDatabase {
  query(sql: string): Promise<ReadonlyArray<Record<string, unknown>>>;
  execute(sql: string): Promise<void>;
  close(): Promise<void>;
}

export type SqliteFileDatabaseFactory = (dbPath: string) => SqliteFileDatabase;

interface CheckState {
  readonly runtime: ReturnType<typeof createRuntime>;
  readonly migrations: readonly {
    fileName: string;
    path: string;
    contents: string;
    status: 'draft' | 'final';
  }[];
  readonly draftMigrations: readonly {
    fileName: string;
    path: string;
    contents: string;
    status: 'draft' | 'final';
  }[];
}

type CheckFunction = (state: CheckState) => string[] | Promise<string[]>;
