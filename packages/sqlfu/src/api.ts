import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

import {os} from '@orpc/server';
import {z} from 'zod';

import type {Client, SqlfuProjectConfig} from './core/types.js';
import {createNodeSqliteClient, migrationNickname} from './client.js';
import {extractSchema, runSqlStatements} from './core/sqlite.js';
import {
  applyMigrations,
  baselineMigrationHistory,
  migrationName,
  readMigrationHistory,
  type Migration,
} from './migrations/index.js';
import {diffSchemaSql} from './schemadiff/index.js';
import {generateQueryTypes} from './typegen/index.js';

const base = os.$context<SqlfuRouterContext>();

export const router = {
  generate: base
    .meta({
      description: `Generate TypeScript functions for all queries in the sql/ directory.`,
    })
    .handler(async () => {
      await generateQueryTypes();
      return 'Generated schema-derived database and TypeSQL outputs.';
    }),

  config: base.handler(async ({context}) => {
    return context.config;
  }),

  sync: base
    .meta({
      description: `Update the current database to match definitions.sql. Note: this should only be used for local development. For production databases, use 'sqlfu migrate' instead. ` +
        `This command fails if semantic or destructive changes are required. You can run 'sqlfu draft' to create a migration file with the necessary changes.`,
    })
    .handler(async ({context}) => {
      const definitionsSql = await readDefinitionsSql(context.config.definitionsPath);
      await using database = await openMainDevDatabase(context.config.db);
      const baselineSql = await extractSchema(database.client);
      try {
        const diffLines = await diffSchemaSql({
          projectRoot: context.config.projectRoot,
          baselineSql,
          desiredSql: definitionsSql,
          enableDrop: false,
        });
        await runSqlStatements(database.client, diffLines.join('\n'));
      } catch (error) {
        throw new Error(
          [
            'sync could not apply definitions.sql safely to the current database.',
            'Create a migration with `sqlfu draft`, edit it if needed, then run `sqlfu migrate`.',
            '',
            `Cause: ${summarizeSqlite3defError(error)}`,
          ].join('\n'),
        );
      }
    }),

  draft: base
    .meta({
      description: `Create a migration file from the diff between replayed migrations and definitions.sql.`,
    })
    .input(
      z.object({
        name: z.string().min(1).describe('The name of the migration to create. If omitted one is derived from the drafted SQL.'),
      }).partial().optional(),
    )
    .handler(async ({context, input}) => {
      const runtime = createRuntime(context);
      const migrations = await runtime.readMigrations();
      const definitionsSql = await runtime.readDefinitionsSql();
      const baselineSql = migrations.length === 0 ? '' : await materializeMigrationsSchema(runtime.config, migrations);
      const diffLines = await diffSchemaSql({
        projectRoot: runtime.config.projectRoot,
        baselineSql,
        desiredSql: definitionsSql,
        enableDrop: false,
      });

      if (diffLines.length === 0) {
        return;
      }

      const body = diffLines.join('\n').trim();
      const fileName = `${getMigrationPrefix(runtime.now())}_${slugify(input?.name ?? migrationNickname(body))}.sql`;
      await fs.mkdir(context.config.migrationsDir, {recursive: true});
      await fs.writeFile(path.join(context.config.migrationsDir, fileName), `${body}\n`);
    }),

  migrate: base
    .meta({
      description: `Apply pending migrations to the configured database.`,
    })
    .handler(async ({context}) => {
      const migrations = await createRuntime(context).readMigrations();
      await applyMigrationsToDatabase(context.config.db, migrations);
    }),

  baseline: base
    .meta({
      description: `Set migration history to an exact target without changing the live schema.`,
    })
    .input(
      z.object({
        target: z.string().min(1),
      }),
    )
    .handler(async ({context, input}) => {
      const migrations = await createRuntime(context).readMigrations();
      await using database = await openMainDevDatabase(context.config.db);
      await baselineMigrationHistory(database.client, {migrations, target: input.target});
    }),

  goto: base
    .meta({
      description: `Change the database schema and migration history to match an exact migration target.`,
    })
    .input(
      z.object({
        target: z.string().min(1),
      }),
    )
    .handler(async ({context, input}) => {
      const runtime = createRuntime(context);
      const migrations = await runtime.readMigrations();
      const targetMigrations = getMigrationsThroughTarget(migrations, input.target);
      const targetSchema = await materializeMigrationsSchema(runtime.config, targetMigrations);

      await using database = await openMainDevDatabase(context.config.db);
      const liveSchema = await extractSchema(database.client);
      const diffLines = await diffSchemaSql({
        projectRoot: runtime.config.projectRoot,
        baselineSql: liveSchema,
        desiredSql: targetSchema,
        enableDrop: true,
      });
      if (diffLines.length > 0) {
        await runSqlStatements(database.client, diffLines.join('\n'));
      }
      await baselineMigrationHistory(database.client, {migrations, target: input.target});
    }),

  check: {
    all: base
      .meta({
        default: true,
        description: `Run all checks and recommend the next action.`,
      })
      .handler(async ({context}) => {
        const result = await analyzeDatabase(createRuntime(context));
        if (result.problems.length > 0) {
          throw new Error(result.problems.join('\n'));
        }
      }),
    migrationsMatchDefinitions: base.handler(async ({context}) => {
      const runtime = createRuntime(context);
      const [definitionsSchema, migrationsSchema] = await Promise.all([
        materializeDefinitionsSchema(runtime.config, await runtime.readDefinitionsSql()),
        materializeMigrationsSchema(runtime.config, await runtime.readMigrations()),
      ]);
      if (definitionsSchema !== migrationsSchema) {
        throw new Error('replayed migrations do not match definitions.sql');
      }
    }),
  },
};

function createRuntime(context: SqlfuRouterContext) {
  return {
    config: context.config,
    now: () => context.now?.() ?? new Date(),
    readDefinitionsSql: () => readDefinitionsSql(context.config.definitionsPath),
    async readMigrations() {
      try {
        const fileNames = (await fs.readdir(context.config.migrationsDir))
          .filter((fileName) => fileName.endsWith('.sql'))
          .sort();

        const migrations = [];
        for (const fileName of fileNames) {
          const filePath = path.join(context.config.migrationsDir, fileName);
          const content = await fs.readFile(filePath, 'utf8');
          migrations.push({path: filePath, content});
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

async function readDefinitionsSql(definitionsPath: string) {
  try {
    return await fs.readFile(definitionsPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('definitions.sql not found');
    }
    throw error;
  }
}

export function getMigrationPrefix(now: Date) {
  return now.toISOString().replaceAll(':', '.');
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .replace(/_+/gu, '_');
}

async function materializeDefinitionsSchema(config: SqlfuProjectConfig, definitionsSql: string) {
  await using database = await createScratchDatabase(config, 'materialize-definitions');
  await runSqlStatements(database.client, definitionsSql);
  return extractSchema(database.client);
}

async function materializeMigrationsSchema(config: SqlfuProjectConfig, migrations: readonly Migration[]) {
  await using database = await createScratchDatabase(config, 'materialize-migrations');
  await applyMigrations(database.client, {migrations});
  return extractSchema(database.client);
}

async function applyMigrationsToDatabase(dbPath: string, migrations: readonly Migration[]) {
  await using database = await openMainDevDatabase(dbPath);
  await applyMigrations(database.client, {migrations});
}

function getMigrationsThroughTarget(migrations: readonly Migration[], target: string) {
  const targetIndex = migrations.findIndex((migration) => migrationName(migration) === target);
  if (targetIndex === -1) {
    throw new Error(`migration ${target} not found`);
  }
  return migrations.slice(0, targetIndex + 1);
}

type DisposableClient = {
  readonly client: Client;
  [Symbol.asyncDispose](): Promise<void>;
};

async function createScratchDatabase(config: SqlfuProjectConfig, slug: string): Promise<DisposableClient> {
  const dbPath = path.join(config.projectRoot, '.sqlfu', `${slug}.db`);
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

async function analyzeDatabase(runtime: ReturnType<typeof createRuntime>) {
  const migrations = await runtime.readMigrations();
  const definitionsSql = await runtime.readDefinitionsSql();
  const [desiredSchema, migrationsSchema] = await Promise.all([
    materializeDefinitionsSchema(runtime.config, definitionsSql),
    materializeMigrationsSchema(runtime.config, migrations),
  ]);

  await using database = await openMainDevDatabase(runtime.config.db);
  const liveSchema = await extractSchema(database.client);
  const applied = await readMigrationHistory(database.client);
  const appliedNames = new Set(applied.map((migration) => migration.name));
  const migrationByName = new Map(migrations.map((migration) => [migrationName(migration), migration]));

  const hasRepoDrift = desiredSchema !== migrationsSchema;
  const historyMismatch = findHistoryMismatch(applied, migrationByName);
  const hasPendingMigrations = !historyMismatch && migrations.some((migration) => !appliedNames.has(migrationName(migration)));

  const historicalMigrations = applied
    .map((historical) => migrationByName.get(historical.name))
    .filter((migration): migration is Migration => Boolean(migration));
  const historicalSchema = await materializeMigrationsSchema(runtime.config, historicalMigrations);
  const hasSchemaDrift = historicalSchema !== liveSchema;
  const hasSchemaNotCurrent = desiredSchema !== liveSchema;
  const recommendedTarget = await findRecommendedTarget(runtime.config, migrations, liveSchema);

  if (historyMismatch) {
    const problemLine = historyMismatch.kind === 'deleted'
      ? `Deleted applied migration: ${historyMismatch.name}`
      : `Edited applied migration: ${historyMismatch.name}`;
    const recommendation = historyMismatch.kind === 'deleted'
      ? ['Recommendation: restore the missing migration from git.']
      : recommendedTarget
        ? [
          `Recommended Baseline Target: ${recommendedTarget}`,
          `Recommendation: restore the original migration from git, or run \`sqlfu baseline ${recommendedTarget}\` if you want to keep the current live schema.`,
        ]
        : hasSchemaNotCurrent
          ? [
            `Recommended Goto Target: ${historyMismatch.name}`,
            `Recommendation: restore the original migration from git, or run \`sqlfu goto ${historyMismatch.name}\` if you want to reconcile this database to the current repo state.`,
          ]
          : [
            'Recommendation: restore the original migration from git.',
          ];
    return {
      problems: [
        'History Drift',
        'Migration History does not match Migrations.',
        problemLine,
        ...recommendation,
      ],
    };
  }

  if (hasRepoDrift && !hasPendingMigrations && !hasSchemaDrift && !hasSchemaNotCurrent) {
    return {
      problems: [
        'Repo Drift',
        'Desired Schema does not match Migrations.',
        'Recommendation: run `sqlfu draft`.',
      ],
    };
  }

  if (!hasRepoDrift && hasPendingMigrations && !hasSchemaDrift) {
    return {
      problems: [
        'Pending Migrations',
        'Migration History is behind Migrations.',
        'Recommendation: run `sqlfu migrate`.',
      ],
    };
  }

  if (!hasRepoDrift && hasSchemaDrift) {
    return {
      problems: [
        'Schema Drift',
        'Live Schema does not match Migration History.',
        ...(recommendedTarget ? [
          `Recommended Baseline Target: ${recommendedTarget}`,
          `Recommendation: run \`sqlfu baseline ${recommendedTarget}\`.`,
        ] : ['Recommendation: run `sqlfu goto <target>`.']),
      ],
    };
  }

  if (hasRepoDrift) {
    return {
      problems: [
        'Repo Drift',
        'Desired Schema does not match Migrations.',
        'Recommendation: run `sqlfu draft`.',
      ],
    };
  }

  if (hasPendingMigrations) {
    return {
      problems: [
        'Pending Migrations',
        'Migration History is behind Migrations.',
        'Recommendation: run `sqlfu migrate`.',
      ],
    };
  }

  if (hasSchemaDrift) {
    return {
      problems: [
        'Schema Drift',
        'Live Schema does not match Migration History.',
        'Recommendation: run `sqlfu baseline <target>` or `sqlfu goto <target>`.',
      ],
    };
  }

  return {problems: []};
}

function findHistoryMismatch(
  applied: readonly {name: string; content: string}[],
  migrationByName: ReadonlyMap<string, Migration>,
) {
  for (const historical of applied) {
    const current = migrationByName.get(historical.name);
    if (!current) {
      return {kind: 'deleted' as const, name: historical.name};
    }
    if (current.content !== historical.content) {
      return {kind: 'edited' as const, name: historical.name};
    }
  }
  return null;
}

async function findRecommendedTarget(config: SqlfuProjectConfig, migrations: readonly Migration[], liveSchema: string) {
  for (let index = 0; index < migrations.length; index += 1) {
    const candidate = migrations.slice(0, index + 1);
    const candidateSchema = await materializeMigrationsSchema(config, candidate);
    if (candidateSchema === liveSchema) {
      return migrationName(candidate.at(-1)!);
    }
  }
  return null;
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

export interface SqlfuRouterContext {
  readonly config: SqlfuProjectConfig;
  readonly now?: () => Date;
}
