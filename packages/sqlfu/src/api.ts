import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

import {os} from '@orpc/server';
import {z} from 'zod';

import type {Client, SqlfuProjectConfig} from './core/types.js';
import {createBunClient, createNodeSqliteClient, migrationNickname} from './client.js';
import {extractSchema} from './core/sqlite.js';
import {
  applyMigrations,
  baselineMigrationHistory,
  migrationName,
  readMigrationHistory,
  replaceMigrationHistory,
  type Migration,
} from './migrations/index.js';
import {diffSchemaSql} from './schemadiff/index.js';
import {inspectSqliteSchemaSql, schemasEqual} from './schemadiff/sqlite-native.js';
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
        `This command fails if semantic changes are required. You can run 'sqlfu draft' to create a migration file with the necessary changes.`,
    })
    .handler(async ({context}) => {
      await syncSql(context);
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
        allowDestructive: true,
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

  pending: base
    .meta({
      description: `List migrations that exist but have not been applied to the configured database.`,
    })
    .handler(async ({context}) => {
      const migrations = await createRuntime(context).readMigrations();
      await using database = await openMainDevDatabase(context.config.db);
      const applied = await readMigrationHistory(database.client);
      const appliedNames = new Set(applied.map((migration) => migration.name));
      return migrations
        .map((migration) => migrationName(migration))
        .filter((name) => !appliedNames.has(name));
    }),

  applied: base
    .meta({
      description: `List migrations recorded in the configured database history.`,
    })
    .handler(async ({context}) => {
      await using database = await openMainDevDatabase(context.config.db);
      const applied = await readMigrationHistory(database.client);
      return applied.map((migration) => migration.name);
    }),

  find: base
    .meta({
      description: `Find migrations by substring and show whether each one is applied.`,
    })
    .input(z.object({
      text: z.string().min(1),
    }))
    .handler(async ({context, input}) => {
      const migrations = await createRuntime(context).readMigrations();
      await using database = await openMainDevDatabase(context.config.db);
      const applied = await readMigrationHistory(database.client);
      const appliedNames = new Set(applied.map((migration) => migration.name));
      return migrations
        .map((migration) => migrationName(migration))
        .filter((name) => name.includes(input.text))
        .map((name) => ({
          name,
          applied: appliedNames.has(name),
        }));
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
        target: z.string().min(1).meta({positional: true}),
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
        allowDestructive: true,
      });
      await database.client.transaction(async (tx) => {
        if (diffLines.length > 0) {
          await tx.raw(diffLines.join('\n'));
        }
        await replaceMigrationHistory(tx, targetMigrations);
      });
    }),

  check: {
    all: base
      .meta({
        default: true,
        description: `Run all checks and recommend the next action.`,
      })
      .handler(async ({context}) => {
        const result = await analyzeDatabase(createRuntime(context));
        if (result.mismatches.length > 0) {
          throw new Error(result.mismatches.map((mismatch) => mismatch.lines.join('\n')).join('\n\n'));
        }
      }),
    migrationsMatchDefinitions: base.handler(async ({context}) => {
      const runtime = createRuntime(context);
      const [definitionsSchema, migrationsSchema] = await Promise.all([
        materializeDefinitionsSchema(runtime.config, await runtime.readDefinitionsSql()),
        materializeMigrationsSchema(runtime.config, await runtime.readMigrations()),
      ]);
      if ((await compareSchemas(runtime.config, definitionsSchema, migrationsSchema)).isDifferent) {
        throw new Error('replayed migrations do not match definitions.sql');
      }
    }),
  },
};

export async function getCheckMismatches(context: SqlfuRouterContext): Promise<readonly CheckMismatch[]> {
  const result = await analyzeDatabase(createRuntime(context));
  return result.mismatches;
}

export async function writeDefinitionsSql(context: SqlfuRouterContext, sql: string): Promise<void> {
  await fs.writeFile(context.config.definitionsPath, `${sql.trimEnd()}\n`);
}

export async function getSchemaAuthorities(context: SqlfuRouterContext) {
  const runtime = createRuntime(context);
  const definitionsSql = await runtime.readDefinitionsSql();
  const migrations = await runtime.readMigrations();

  await using database = await openMainDevDatabase(context.config.db);
  const applied = await readMigrationHistory(database.client);
  const liveSchema = await extractSchema(database.client);
  const appliedByName = new Map(applied.map((migration) => [migration.name, migration]));
  const migrationByName = new Map(migrations.map((migration) => [migrationName(migration), migration]));

  return {
    desiredSchemaSql: definitionsSql,
    migrations: migrations.map((migration) => ({
      id: migrationName(migration),
      fileName: path.basename(migration.path),
      content: migration.content,
      applied: appliedByName.has(migrationName(migration)),
      appliedAt: appliedByName.get(migrationName(migration))?.appliedAt ?? null,
    })),
    migrationHistory: applied.map((migration) => ({
      id: migration.name,
      fileName: migrationByName.get(migration.name) ? path.basename(migrationByName.get(migration.name)!.path) : null,
      content: migration.content,
      applied: true,
      appliedAt: migration.appliedAt,
    })),
    liveSchemaSql: liveSchema,
  };
}

export async function getMigrationResultantSchema(
  context: SqlfuRouterContext,
  input: {
    source: 'migrations' | 'history';
    id: string;
  },
) {
  const runtime = createRuntime(context);
  if (input.source === 'migrations') {
    const migrations = await runtime.readMigrations();
    const targetIndex = migrations.findIndex((migration) => migrationName(migration) === input.id);
    if (targetIndex === -1) {
      throw new Error(`migration ${input.id} not found`);
    }
    return materializeMigrationsSchema(runtime.config, migrations.slice(0, targetIndex + 1));
  }

  await using database = await openMainDevDatabase(context.config.db);
  const applied = await readMigrationHistory(database.client);
  const targetIndex = applied.findIndex((migration) => migration.name === input.id);
  if (targetIndex === -1) {
    throw new Error(`migration history entry ${input.id} not found`);
  }
  return materializeMigrationsSchema(
    runtime.config,
    applied.slice(0, targetIndex + 1).map((migration) => ({
      path: `${migration.name}.sql`,
      content: migration.content,
    })),
  );
}

export async function runSqlfuCommand(context: SqlfuRouterContext, command: string): Promise<void> {
  const normalized = command.trim();

  if (normalized === 'sqlfu draft') {
    await draftSql(context, {});
    return;
  }

  if (normalized === 'sqlfu sync') {
    await syncSql(context);
    return;
  }

  if (normalized === 'sqlfu migrate') {
    await migrateSql(context);
    return;
  }

  if (normalized.startsWith('sqlfu baseline ')) {
    await baselineSql(context, {
      target: normalized.replace(/^sqlfu baseline /u, '').trim(),
    });
    return;
  }

  if (normalized.startsWith('sqlfu goto ')) {
    await gotoSql(context, {
      target: normalized.replace(/^sqlfu goto /u, '').trim(),
    });
    return;
  }

  if (normalized === 'sqlfu check') {
    const result = await analyzeDatabase(createRuntime(context));
    if (result.mismatches.length > 0) {
      throw new Error(result.mismatches.map((mismatch) => mismatch.lines.join('\n')).join('\n\n'));
    }
    return;
  }

  throw new Error(`Unsupported sqlfu command: ${command}`);
}

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

async function draftSql(context: SqlfuRouterContext, input?: {name?: string}) {
  const runtime = createRuntime(context);
  const migrations = await runtime.readMigrations();
  const definitionsSql = await runtime.readDefinitionsSql();
  const baselineSql = migrations.length === 0 ? '' : await materializeMigrationsSchema(runtime.config, migrations);
  const diffLines = await diffSchemaSql({
    projectRoot: runtime.config.projectRoot,
    baselineSql,
    desiredSql: definitionsSql,
    allowDestructive: true,
  });

  if (diffLines.length === 0) {
    return;
  }

  const body = diffLines.join('\n').trim();
  const fileName = `${getMigrationPrefix(runtime.now())}_${slugify(input?.name ?? migrationNickname(body))}.sql`;
  await fs.mkdir(context.config.migrationsDir, {recursive: true});
  await fs.writeFile(path.join(context.config.migrationsDir, fileName), `${body}\n`);
}

async function syncSql(context: SqlfuRouterContext) {
  const definitionsSql = await readDefinitionsSql(context.config.definitionsPath);
  await using database = await openMainDevDatabase(context.config.db);
  const baselineSql = await extractSchema(database.client);
  try {
    const diffLines = await diffSchemaSql({
      projectRoot: context.config.projectRoot,
      baselineSql,
      desiredSql: definitionsSql,
      allowDestructive: true,
    });

    if (diffLines.length === 0) {
      return;
    }

    await database.client.transaction(async (tx) => {
      await tx.raw(diffLines.join('\n'));
    });
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
}

async function migrateSql(context: SqlfuRouterContext) {
  const migrations = await createRuntime(context).readMigrations();
  await applyMigrationsToDatabase(context.config.db, migrations);
}

async function baselineSql(context: SqlfuRouterContext, input: {target: string}) {
  const migrations = await createRuntime(context).readMigrations();
  await using database = await openMainDevDatabase(context.config.db);
  await baselineMigrationHistory(database.client, {migrations, target: input.target});
}

async function gotoSql(context: SqlfuRouterContext, input: {target: string}) {
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
    allowDestructive: true,
  });
  await database.client.transaction(async (tx) => {
    if (diffLines.length > 0) {
      await tx.raw(diffLines.join('\n'));
    }
    await replaceMigrationHistory(tx, targetMigrations);
  });
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
  await database.client.raw(definitionsSql);
  return await extractSchema(database.client);
}

async function materializeMigrationsSchema(config: SqlfuProjectConfig, migrations: readonly Migration[]) {
  await using database = await createScratchDatabase(config, 'materialize-migrations');
  await applyMigrations(database.client, {migrations});
  return await extractSchema(database.client);
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
  const dbPath = path.join(config.projectRoot, '.sqlfu', `${slug}-${randomUUID()}.db`);
  await fs.mkdir(path.dirname(dbPath), {recursive: true});
  const database = await openSqliteDatabase(dbPath);
  return {
    client: database.client,
    async [Symbol.asyncDispose]() {
      await database[Symbol.asyncDispose]();
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
  return openSqliteDatabase(dbPath);
}

async function openSqliteDatabase(dbPath: string): Promise<DisposableClient> {
  if ('Bun' in globalThis) {
    const {Database} = await import('bun:sqlite' as any);
    const database = new Database(dbPath);
    return {
      client: createBunClient(database as Parameters<typeof createBunClient>[0]),
      async [Symbol.asyncDispose]() {
        database.close();
      },
    };
  }

  const {DatabaseSync} = await import('node:sqlite');
  const database = new DatabaseSync(dbPath);
  return {
    client: createNodeSqliteClient(database as Parameters<typeof createNodeSqliteClient>[0]),
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

  let liveSchema: string;
  let applied: readonly {name: string; content: string}[];
  await using database = await openMainDevDatabase(runtime.config.db);
  liveSchema = await extractSchema(database.client);
  applied = await readMigrationHistory(database.client);
  const appliedNames = new Set(applied.map((migration) => migration.name));
  const migrationByName = new Map(migrations.map((migration) => [migrationName(migration), migration]));

  const repoDrift = await compareSchemas(runtime.config, desiredSchema, migrationsSchema);
  const historyMismatch = findHistoryMismatch(applied, migrationByName);
  const hasPendingMigrations = !historyMismatch && migrations.some((migration) => !appliedNames.has(migrationName(migration)));

  const historicalMigrations = applied
    .map((historical) => migrationByName.get(historical.name))
    .filter((migration): migration is Migration => Boolean(migration));
  const historicalSchema = await materializeMigrationsSchema(runtime.config, historicalMigrations);
  const schemaDrift = await compareSchemas(runtime.config, historicalSchema, liveSchema);
  const syncDrift = await compareSchemas(runtime.config, desiredSchema, liveSchema);
  const recommendedBaselineTarget = await findRecommendedTarget(runtime.config, migrations, liveSchema);
  const recommendedGotoTarget = !repoDrift.isDifferent && !historyMismatch && !hasPendingMigrations && migrations.length > 0
    ? migrationName(migrations.at(-1)!)
    : null;
  const mismatches: CheckMismatch[] = [];

  if (historyMismatch) {
    const problemLine = historyMismatch.kind === 'deleted'
      ? `Deleted applied migration: ${historyMismatch.name}`
      : `Edited applied migration: ${historyMismatch.name}`;
    const recommendation = historyMismatch.kind === 'deleted'
      ? ['Recommendation: restore the missing migration from git.']
      : recommendedBaselineTarget
        ? [
          `Recommended Baseline Target: ${recommendedBaselineTarget}`,
          `Recommendation: restore the original migration from git, or run \`sqlfu baseline ${recommendedBaselineTarget}\` if you want to keep the current live schema.`,
        ]
        : syncDrift.isDifferent
          ? [
            `Recommended Goto Target: ${historyMismatch.name}`,
            `Recommendation: restore the original migration from git, or run \`sqlfu goto ${historyMismatch.name}\` if you want to reconcile this database to the current repo state.`,
          ]
          : [
            'Recommendation: restore the original migration from git.',
          ];
    mismatches.push({
      name: 'History Drift',
      lines: [
        'History Drift',
        'Migration History does not match Migrations.',
        problemLine,
        ...recommendation,
      ],
    });
  }

  if (repoDrift.isDifferent) {
    mismatches.push({
      name: 'Repo Drift',
      lines: [
        'Repo Drift',
        'Desired Schema does not match Migrations.',
        syncDrift.isDifferent
          ? 'Recommendation: run `sqlfu draft` (reviewable migration).'
          : 'Recommendation: run `sqlfu draft` (reviewable migration). Then maybe `sqlfu baseline <new-migration>` for a synced dev db.',
      ],
    });
  }

  if (!historyMismatch && hasPendingMigrations) {
    mismatches.push({
      name: 'Pending Migrations',
      lines: [
        'Pending Migrations',
        'Migration History is behind Migrations.',
        ...(schemaDrift.isDifferent ? [
          'Recommendation: Address Schema Drift.',
        ] : ['Recommendation: run `sqlfu migrate`.']),
      ],
    });
  }

  if (!historyMismatch && schemaDrift.isDifferent) {
    const repoDriftWithLiveAlreadySynced = repoDrift.isDifferent && !syncDrift.isDifferent;
    mismatches.push({
      name: 'Schema Drift',
      lines: [
        'Schema Drift',
        repoDriftWithLiveAlreadySynced
          ? 'Live Schema matches Desired Schema, but not Migration History.'
          : 'Live Schema does not match Migration History.',
        ...(repoDriftWithLiveAlreadySynced
          ? [
            'Recommendation: resolve Repo Drift first. Then run `sqlfu baseline <new-migration>` for this database.',
          ]
          : recommendedBaselineTarget ? [
            `Recommended Baseline Target: ${recommendedBaselineTarget}`,
            `Recommendation: run \`sqlfu baseline ${recommendedBaselineTarget}\`.`,
          ] : recommendedGotoTarget ? [
            `Recommendation: run \`sqlfu goto ${recommendedGotoTarget}\`.`,
          ] : ['Recommendation: run `sqlfu goto <target>`.']),
      ],
    });
  }

  if (syncDrift.isDifferent && syncDrift.isSyncable) {
    mismatches.push({
      name: 'Sync Drift',
      lines: [
        'Sync Drift',
        'Desired Schema does not match Live Schema.',
        buildSyncDriftRecommendation({
          repoDrift: repoDrift.isDifferent,
          historyDrift: Boolean(historyMismatch),
          pendingMigrations: hasPendingMigrations,
          schemaDrift: schemaDrift.isDifferent,
        }),
      ],
    });
  }

  return {mismatches};
}

function buildSyncDriftRecommendation(input: {
  repoDrift: boolean;
  historyDrift: boolean;
  pendingMigrations: boolean;
  schemaDrift: boolean;
}) {
  if (input.repoDrift) {
    return 'Recommendation: resolve Repo Drift first.';
  }
  if (input.historyDrift) {
    return 'Recommendation: resolve History Drift first.';
  }
  if (input.schemaDrift) {
    return 'Recommendation: Address Schema Drift.';
  }
  if (input.pendingMigrations) {
    return 'Recommendation: run `sqlfu migrate`.';
  }
  return 'Recommendation: run `sqlfu sync`.';
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
    if (!(await compareSchemas(config, candidateSchema, liveSchema)).isDifferent) {
      return migrationName(candidate.at(-1)!);
    }
  }
  return null;
}

async function compareSchemas(config: SqlfuProjectConfig, left: string, right: string) {
  const [leftInspected, rightInspected] = await Promise.all([
    inspectSqliteSchemaSql(config, left),
    inspectSqliteSchemaSql(config, right),
  ]);

  const isDifferent = !schemasEqual(leftInspected, rightInspected);
  let isSyncable = false;
  if (isDifferent) {
    try {
      const syncPlan = await diffSchemaSql({
        projectRoot: config.projectRoot,
        baselineSql: right,
        desiredSql: left,
        allowDestructive: true,
      });
      isSyncable = syncPlan.length > 0;
    } catch {
      isSyncable = false;
    }
  }

  return {
    isDifferent,
    isSyncable,
  };
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

export type CheckMismatch = {
  readonly name: 'Repo Drift' | 'Pending Migrations' | 'History Drift' | 'Schema Drift' | 'Sync Drift';
  readonly lines: readonly string[];
};
