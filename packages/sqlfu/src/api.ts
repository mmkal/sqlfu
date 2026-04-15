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
  migrationChecksum,
  migrationName,
  readMigrationHistory,
  replaceMigrationHistory,
  type Migration,
} from './migrations/index.js';
import {diffSchemaSql} from './schemadiff/index.js';
import {inspectSqliteSchemaSql, schemasEqual} from './schemadiff/sqlite-native.js';
import {generateQueryTypes} from './typegen/index.js';

const base = os.$context<SqlfuRouterContext>();
const schemaDriftExcludedTables = ['sqlfu_migrations'] as const;

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
      const liveSchema = await extractSchema(database.client, 'main', {
        excludedTables: schemaDriftExcludedTables,
      });
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
        const analysis = await analyzeDatabase(createRuntime(context));
        if (analysis.mismatches.length > 0) {
          throw new Error(formatCheckFailure(analysis));
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
  const analysis = await analyzeDatabase(createRuntime(context));
  return analysis.mismatches;
}

export async function getCheckAnalysis(context: SqlfuRouterContext): Promise<CheckAnalysis> {
  return analyzeDatabase(createRuntime(context));
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
  const liveSchema = await extractSchema(database.client, 'main', {
    excludedTables: schemaDriftExcludedTables,
  });
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
      integrity: appliedByName.has(migrationName(migration))
        ? getMigrationIntegrity(migration.content, appliedByName.get(migrationName(migration))?.checksum)
        : null,
    })),
    migrationHistory: applied.map((migration) => ({
      id: migration.name,
      fileName: migrationByName.get(migration.name) ? path.basename(migrationByName.get(migration.name)!.path) : null,
      content: migrationByName.get(migration.name)?.content ?? '-- migration file missing from repo',
      applied: true,
      appliedAt: migration.appliedAt,
      integrity: getMigrationIntegrity(migrationByName.get(migration.name)?.content, migration.checksum),
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
    const schemaSql = await materializeMigrationsSchema(runtime.config, migrations.slice(0, targetIndex + 1));
    return `-- schema that would be produced by \`sqlfu goto ${input.id}\`\n${schemaSql}`;
  }

  await using database = await openMainDevDatabase(context.config.db);
  const applied = await readMigrationHistory(database.client);
  const targetIndex = applied.findIndex((migration) => migration.name === input.id);
  if (targetIndex === -1) {
    throw new Error(`migration history entry ${input.id} not found`);
  }
  const migrations = await runtime.readMigrations();
  const targetMigrationIndex = migrations.findIndex((migration) => migrationName(migration) === input.id);
  if (targetMigrationIndex === -1) {
    throw new Error(`migration ${input.id} not found in repo`);
  }
  const schemaSql = await materializeMigrationsSchema(
    runtime.config,
    migrations.slice(0, targetMigrationIndex + 1),
  );
  return `-- schema produced by sqlfu goto ${input.id}\n${schemaSql}`;
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
    const analysis = await analyzeDatabase(createRuntime(context));
    if (analysis.mismatches.length > 0) {
      throw new Error(formatCheckFailure(analysis));
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
  const baselineSql = await extractSchema(database.client, 'main', {
    excludedTables: schemaDriftExcludedTables,
  });
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
  const liveSchema = await extractSchema(database.client, 'main', {
    excludedTables: schemaDriftExcludedTables,
  });
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
  return await extractSchema(database.client, 'main', {
    excludedTables: schemaDriftExcludedTables,
  });
}

async function materializeMigrationsSchema(config: SqlfuProjectConfig, migrations: readonly Migration[]) {
  await using database = await createScratchDatabase(config, 'materialize-migrations');
  await applyMigrations(database.client, {migrations});
  return await extractSchema(database.client, 'main', {
    excludedTables: schemaDriftExcludedTables,
  });
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
  let applied: readonly {name: string; checksum: string}[];
  await using database = await openMainDevDatabase(runtime.config.db);
  liveSchema = await extractSchema(database.client, 'main', {
    excludedTables: schemaDriftExcludedTables,
  });
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
  const recommendations: CheckRecommendation[] = [];

  if (historyMismatch) {
    const problemLine = historyMismatch.kind === 'deleted'
      ? `Deleted applied migration: ${historyMismatch.name}`
      : `Applied migration checksum mismatch: ${historyMismatch.name}`;
    mismatches.push({
      kind: 'historyDrift',
      title: 'History Drift',
      summary: 'Migration History does not match Migrations.',
      details: [
        problemLine,
      ],
    });

    if (historyMismatch.kind === 'deleted') {
      addRecommendation(recommendations, {
        kind: 'restoreMissingMigration',
        summary: 'restore the missing migration from version control.',
      });
    } else if (recommendedBaselineTarget) {
      addRecommendation(recommendations, {
        kind: 'restoreOriginalMigration',
        summary: 'restore the original migration from version control.',
      });
      addRecommendation(recommendations, {
        kind: 'baseline',
        command: `sqlfu baseline ${recommendedBaselineTarget}`,
        summary: `run \`sqlfu baseline ${recommendedBaselineTarget}\` to keep the current live schema.`,
      });
    } else if (syncDrift.isDifferent) {
      addRecommendation(recommendations, {
        kind: 'restoreOriginalMigration',
        summary: 'restore the original migration from version control.',
      });
      addRecommendation(recommendations, {
        kind: 'goto',
        command: `sqlfu goto ${historyMismatch.name}`,
        summary: `run \`sqlfu goto ${historyMismatch.name}\` to reconcile this database to the current repo state.`,
      });
    } else {
      addRecommendation(recommendations, {
        kind: 'restoreOriginalMigration',
        summary: 'restore the original migration from version control.',
      });
    }
  }

  if (repoDrift.isDifferent) {
    mismatches.push({
      kind: 'repoDrift',
      title: 'Repo Drift',
      summary: 'Desired Schema does not match Migrations.',
      details: [],
    });
    addRecommendation(recommendations, {
      kind: 'draft',
      command: 'sqlfu draft',
      summary: 'run `sqlfu draft` to create a reviewable migration.',
    });
  }

  if (!historyMismatch && hasPendingMigrations) {
    mismatches.push({
      kind: 'pendingMigrations',
      title: 'Pending Migrations',
      summary: 'Migration History is behind Migrations.',
      details: [],
    });
    if (!schemaDrift.isDifferent) {
      addRecommendation(recommendations, {
        kind: 'migrate',
        command: 'sqlfu migrate',
        summary: 'run `sqlfu migrate`.',
      });
    }
  }

  if (!historyMismatch && schemaDrift.isDifferent) {
    const repoDriftWithLiveAlreadySynced = repoDrift.isDifferent && !syncDrift.isDifferent;
    mismatches.push({
      kind: 'schemaDrift',
      title: 'Schema Drift',
      summary: repoDriftWithLiveAlreadySynced
        ? 'Live Schema matches Desired Schema, but not Migration History.'
        : 'Live Schema does not match Migration History.',
      details: [],
    });

    if (!repoDriftWithLiveAlreadySynced && recommendedBaselineTarget) {
      addRecommendation(recommendations, {
        kind: 'baseline',
        command: `sqlfu baseline ${recommendedBaselineTarget}`,
        summary: `run \`sqlfu baseline ${recommendedBaselineTarget}\`.`,
      });
    } else if (!repoDriftWithLiveAlreadySynced && recommendedGotoTarget) {
      addRecommendation(recommendations, {
        kind: 'goto',
        command: `sqlfu goto ${recommendedGotoTarget}`,
        summary: `run \`sqlfu goto ${recommendedGotoTarget}\`.`,
      });
    } else if (!repoDriftWithLiveAlreadySynced && !repoDrift.isDifferent) {
      addRecommendation(recommendations, {
        kind: 'goto',
        summary: 'run `sqlfu goto <target>`.',
      });
    }
  }

  if (syncDrift.isDifferent && syncDrift.isSyncable) {
    mismatches.push({
      kind: 'syncDrift',
      title: 'Sync Drift',
      summary: 'Desired Schema does not match Live Schema.',
      details: [],
    });

    if (!historyMismatch && !repoDrift.isDifferent && !hasPendingMigrations && !schemaDrift.isDifferent) {
      addRecommendation(recommendations, {
        kind: 'sync',
        command: 'sqlfu sync',
        summary: 'run `sqlfu sync`.',
      });
    }
  }

  return {
    mismatches,
    recommendations: withRecommendationExplainers(recommendations),
  };
}

function findHistoryMismatch(
  applied: readonly {name: string; checksum: string}[],
  migrationByName: ReadonlyMap<string, Migration>,
) {
  for (const historical of applied) {
    const current = migrationByName.get(historical.name);
    if (!current) {
      return {kind: 'deleted' as const, name: historical.name};
    }
    if (migrationChecksum(current.content) !== historical.checksum) {
      return {kind: 'checksumMismatch' as const, name: historical.name};
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

function getMigrationIntegrity(currentContent: string | undefined, appliedChecksum: string | undefined) {
  if (!currentContent || !appliedChecksum) {
    return 'checksum mismatch' as const;
  }

  return migrationChecksum(currentContent) === appliedChecksum ? 'ok' as const : 'checksum mismatch' as const;
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
  readonly kind: 'repoDrift' | 'pendingMigrations' | 'historyDrift' | 'schemaDrift' | 'syncDrift';
  readonly title: 'Repo Drift' | 'Pending Migrations' | 'History Drift' | 'Schema Drift' | 'Sync Drift';
  readonly summary: string;
  readonly details: readonly string[];
};

export type CheckRecommendation = {
  readonly kind:
    | 'draft'
    | 'migrate'
    | 'baseline'
    | 'goto'
    | 'sync'
    | 'restoreMissingMigration'
    | 'restoreOriginalMigration'
    ;
  readonly summary: string;
  readonly command?: string;
};

export type CheckAnalysis = {
  readonly mismatches: readonly CheckMismatch[];
  readonly recommendations: readonly CheckRecommendation[];
};

function addRecommendation(target: CheckRecommendation[], recommendation: CheckRecommendation) {
  const key = `${recommendation.kind}|${recommendation.command ?? ''}|${recommendation.summary}`;
  if (target.some((existing) => `${existing.kind}|${existing.command ?? ''}|${existing.summary}` === key)) {
    return;
  }
  target.push(recommendation);
}

function withRecommendationExplainers(recommendations: readonly CheckRecommendation[]): readonly CheckRecommendation[] {
  if (recommendations.length < 2) {
    return recommendations;
  }

  // Rule: if multiple next actions survive analysis, each one must explain in
  // parentheses what it fixes so users can choose between repo-level and
  // database-level actions without guessing.
  return recommendations.map((recommendation) => ({
    ...recommendation,
    summary: `${recommendation.summary.replace(/\.$/u, '')} (${getRecommendationExplainer(recommendation)}).`,
  }));
}

function getRecommendationExplainer(recommendation: CheckRecommendation) {
  switch (recommendation.kind) {
    case 'draft':
      return 'fixes the repo by recording the desired schema change as a migration';
    case 'migrate':
      return 'fixes this database by applying the pending migrations';
    case 'baseline':
      return 'fixes this database by recording that it already matches that migration prefix';
    case 'goto':
      return 'fixes this database by moving it to that migration target';
    case 'sync':
      return 'fixes this database directly from desired schema for local dev';
    case 'restoreMissingMigration':
      return 'fixes the repo by restoring the migration chain that migration history already points at';
    case 'restoreOriginalMigration':
      return 'fixes the repo by restoring the migration file that migration history already points at';
  }
}

function formatCheckFailure(analysis: CheckAnalysis) {
  const sections = analysis.mismatches.map((mismatch) =>
    [mismatch.title, mismatch.summary, ...mismatch.details].join('\n'),
  );

  if (analysis.recommendations.length > 0) {
    sections.push([
      'Recommended next actions',
      ...analysis.recommendations.map((recommendation) => `- ${recommendation.summary}`),
    ].join('\n'));
  }

  return sections.join('\n\n');
}
