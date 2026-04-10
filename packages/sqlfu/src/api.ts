import fs from 'node:fs/promises';
import path from 'node:path';

import {os} from '@orpc/server';
import {z} from 'zod';

import type {Database, SqlfuProjectConfig} from './core/types.js';
import {diffSchemaSql} from './schemadiff/index.js';
import {generateQueryTypes} from './typegen/index.js';

const base = os.$context<SqlfuRouterContext>();
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
    await using database = await context.projectConfig.getMainDatabase();
    const baselineSql = await exportSchema(database);
    try {
      const diffLines = await diffSchemaSql({
        projectRoot: context.projectConfig.projectRoot,
        baselineSql,
        desiredSql: definitionsSql,
      });
      await applySqlScript(database, diffLines.join('\n'));
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
      ? await materializeMigrationsSchema(runtime.createDatabase, migrations)
      : '';
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

    await applyMigrationsToDatabase(runtime.getMainDatabase, input.includeDraft ? migrations : migrations.filter((migration) => migration.status === 'final'));
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
      materializeDefinitionsSchema(runtime.createDatabase, definitionsSql),
      materializeMigrationsSchema(runtime.createDatabase, migrations),
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
    createDatabase: context.projectConfig.createDatabase,
    getMainDatabase: context.projectConfig.getMainDatabase,
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
  createDatabase: SqlfuProjectConfig['createDatabase'],
  definitionsSql: string,
) {
  await using database = await createDatabase('materialize-definitions');
  await applySqlScript(database, definitionsSql);
  return exportSchema(database);
}

async function materializeMigrationsSchema(
  createDatabase: SqlfuProjectConfig['createDatabase'],
  migrations: readonly {path: string}[],
) {
  await using database = await createDatabase('materialize-migrations');
  for (const migration of migrations) {
    await applySqlScript(database, await fs.readFile(migration.path, 'utf8'));
  }
  return exportSchema(database);
}

async function applyMigrationsToDatabase(
  getMainDatabase: SqlfuProjectConfig['getMainDatabase'],
  migrations: readonly {path: string}[],
) {
  await using database = await getMainDatabase();
  for (const migration of migrations) {
    await applySqlScript(database, await fs.readFile(migration.path, 'utf8'));
  }
}

async function exportSchema(database: Database, schemaName = 'main') {
  const rows = await database.client.all<{sql: string | null}>({
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

async function applySqlScript(database: Database, sql: string) {
  for (const statement of splitSqlStatements(sql)) {
    if (stripSqlComments(statement).trim() === '') {
      continue;
    }
    try {
      await database.client.run({sql: statement, args: []});
    } catch (error) {
      throw new Error(summarizeDatabaseError(error));
    }
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
      materializeDefinitionsSchema(state.runtime.createDatabase, await state.runtime.readDefinitionsSql()),
      materializeMigrationsSchema(state.runtime.createDatabase, state.migrations),
    ]);

    return definitionsSchema === migrationsSchema ? [] : ['replayed migrations do not match definitions.sql'];
  } catch (error) {
    return [`migration replay failed: ${error instanceof Error ? error.message : String(error)}`];
  }
}

function splitSqlStatements(sql: string) {
  // Pain point: sqlfu still has to decide how to split multi-statement SQL scripts instead of delegating that to a lower-level primitive.
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
