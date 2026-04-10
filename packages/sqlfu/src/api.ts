import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

import {os} from '@orpc/server';
import {z} from 'zod';

import type {Client, SqlfuProjectConfig} from './core/types.js';
import {createNodeSqliteClient} from './client.js';
import {applyMigrations} from './migrations/index.js';
import {diffSchemaSql} from './schemadiff/index.js';
import {generateQueryTypes} from './typegen/index.js';

const base = os.$context<SqlfuRouterContext>();

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
    await using database = await openMainDevDatabase(context.projectConfig.db);
    const baselineSql = await exportSchema(database.client);
    try {
      const diffLines = await diffSchemaSql({
        projectRoot: context.projectConfig.projectRoot,
        baselineSql,
        desiredSql: definitionsSql,
      });
      await applySqlScript(database.client, diffLines.join('\n'));
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

  draft: base
    .input(
      z.object({
        name: z.string().min(1),
        bumpTimestamp: z.boolean(),
        rewrite: z.boolean(),
      }).partial().optional()
    )
    .handler(async ({context, input}) => {
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

      const baselineSql = currentDraft ? await materializeMigrationsSchema(runtime.projectRoot, migrations) : '';
      const diffLines = await diffSchemaSql({
        projectRoot: runtime.projectRoot,
        baselineSql,
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

  migrate: base
    .input(
      z.object({
        includeDraft: z.boolean(),
      }).partial().optional()
    )
    .handler(async ({context, input}) => {
      const runtime = createRuntime(context);
      const migrations = await runtime.readMigrations();

      await runChecks(runtime, checkDraftCount, checkDraftIsLast, input?.includeDraft ? () => [] : checkNoDraft);

      await applyMigrationsToDatabase(
        runtime.projectConfig.db,
        input?.includeDraft ? migrations : migrations.filter((migration) => migration.status === 'final'),
      );
    }),

  finalize: base.handler(async ({context}) => {
    const runtime = createRuntime(context);
    const migrations = await runtime.readMigrations();
    const draftMigrations = migrations.filter((migration) => migration.status === 'draft');

    await runChecks(runtime, checkDraftCount);
    if (draftMigrations.length === 0) throw new Error('no draft migration exists to finalize');

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
    projectConfig: context.projectConfig,
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
  projectRoot: string,
  definitionsSql: string,
) {
  await using database = await createScratchDatabase(projectRoot, 'materialize-definitions');
  await applySqlScript(database.client, definitionsSql);
  return exportSchema(database.client);
}

async function materializeMigrationsSchema(
  projectRoot: string,
  migrations: readonly {path: string}[],
) {
  await using database = await createScratchDatabase(projectRoot, 'materialize-migrations');
  await applyMigrations(database.client, {migrations: await readMigrationInputs(migrations)});
  return exportSchema(database.client);
}

async function applyMigrationsToDatabase(
  dbPath: string,
  migrations: readonly {path: string}[],
) {
  await using database = await openMainDevDatabase(dbPath);
  await applyMigrations(database.client, {migrations: await readMigrationInputs(migrations)});
}

type DisposableClient = {
  readonly client: Client;
  [Symbol.asyncDispose](): Promise<void>;
};

async function createScratchDatabase(projectRoot: string, slug: string): Promise<DisposableClient> {
  const dbPath = path.join(projectRoot, '.sqlfu', `${slug}.db`);
  await fs.mkdir(path.dirname(dbPath), {recursive: true});
  const database = new DatabaseSync(dbPath);
  return {
    client: createNodeSqliteClient(database),
    async [Symbol.asyncDispose]() {
      database.close();
      await Promise.allSettled([
        fs.rm(dbPath, {force: true}),
        fs.rm(`${dbPath}-shm`, {force: true}),
        fs.rm(`${dbPath}-wal`, {force: true}),
      ]);
    },
  };
}

async function openMainDevDatabase(dbPath: string): Promise<DisposableClient> {
  await fs.mkdir(path.dirname(dbPath), {recursive: true});
  const database = new DatabaseSync(dbPath);
  return {
    client: createNodeSqliteClient(database),
    async [Symbol.asyncDispose]() {
      database.close();
    },
  };
}

async function exportSchema(client: Client, schemaName = 'main') {
  const rows = await client.all<{sql: string | null}>({
    sql: `
      select sql
      from ${schemaName}.sqlite_schema
      where sql is not null
        and name not like 'sqlite_%'
      order by type, name
    `,
    args: [],
  });
  return rows.map((row) => `${String(row.sql).toLowerCase()};`).join('\n');
}

async function applySqlScript(client: Client, sql: string) {
  await applyMigrations(client, {migrations: [{path: '<inline>', content: sql}]});
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

/** checks you don't have more than one draft */
function checkDraftCount(state: CheckState): string[] {
  return state.draftMigrations.length <= 1 ? [] : ['multiple draft migrations exist'];
}

function checkMigrationMetadata(state: CheckState): string[] {
  for (const migration of state.migrations) {
      try {
        parseMigrationStatus(migration.contents);
      } catch (error) {
        return [String(error)];
      }
    }
  return [];
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
      materializeDefinitionsSchema(state.runtime.projectRoot, await state.runtime.readDefinitionsSql()),
      materializeMigrationsSchema(state.runtime.projectRoot, state.migrations),
    ]);

    return definitionsSchema === migrationsSchema ? [] : ['replayed migrations do not match definitions.sql'];
  } catch (error) {
    return [`migration replay failed: ${error instanceof Error ? error.message : String(error)}`];
  }
}

function appendMigrationContents(contents: string, lines: readonly string[]) {
  const trimmed = contents.trimEnd();
  return `${trimmed}${trimmed === '-- status: draft' ? '\n' : '\n\n'}${lines.join('\n')}\n`;
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

async function readMigrationInputs(migrations: readonly {path: string}[]) {
  return Promise.all(
    migrations.map(async (migration) => ({
      path: migration.path,
      content: await fs.readFile(migration.path, 'utf8'),
    })),
  );
}

export interface SqlfuRouterContext {
  readonly projectConfig: SqlfuProjectConfig;
  readonly now?: () => Date;
}

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
