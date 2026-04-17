import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

import {os} from '@orpc/server';
import {z} from 'zod';

import type {Client, SqlfuProjectConfig} from './core/types.js';
import {createDefaultInitPreview, initializeProject} from './core/config.js';
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
import {inspectSqliteSchemaSql, schemasEqual} from './schemadiff/sqlite/index.js';
import {generateQueryTypes} from './typegen/index.js';
import {startSqlfuServer} from './ui/server.js';
import {stopProcessesListeningOnPort} from './core/port-process.js';

const base = os.$context<SqlfuCommandRouterContext>();
const schemaDriftExcludedTables = ['sqlfu_migrations'] as const;

export const router = {
  serve: base
    .meta({
      default: true,
      description: `Start the local sqlfu backend server used by local.sqlfu.dev.`,
    })
    .input(z.object({
      port: z.number().int().positive(),
    }).partial().optional())
    .handler(async ({context, input}) => {
      await startSqlfuServer({
        port: input?.port,
        projectRoot: context.projectRoot,
      });

      console.log('sqlfu ready at https://local.sqlfu.dev');

      await new Promise(() => {});
    }),

  init: base
    .meta({
      description: `Initialize a new sqlfu project in the current directory.`,
    })
    .handler(async ({context}) => {
      const preview = createDefaultInitPreview(context.projectRoot);
      const configContents = await context.confirm({
        title: 'Create sqlfu.config.ts?',
        body: preview.configContents,
        bodyType: 'typescript',
        editable: true,
      });

      if (!configContents?.trim()) {
        return 'Initialization cancelled.';
      }

      await initializeProject({
        projectRoot: context.projectRoot,
        configContents,
      });

      return `Initialized sqlfu project in ${context.projectRoot}.`;
    }),

  kill: base
    .meta({
      description: `Stop the process listening on the local sqlfu backend port.`,
    })
    .input(z.object({
      port: z.number().int().positive(),
    }).partial().optional())
    .handler(async ({input}) => {
      const port = input?.port || 56081;
      const stopped = await stopProcessesListeningOnPort(port);

      if (stopped.length === 0) {
        return `No process listening on port ${port}.`;
      }

      return `Stopped process on port ${port}: ${stopped.map((process) => process.command ? `${process.command} (${process.pid})` : String(process.pid)).join(', ')}`;
    }),

  generate: base
    .meta({
      description: `Generate TypeScript functions for all queries in the sql/ directory.`,
    })
    .handler(async () => {
      await generateQueryTypes();
      return 'Generated schema-derived database and TypeSQL outputs.';
    }),

  config: base.handler(async ({context}) => {
    return requireContextConfig(context).config;
  }),

  sync: base
    .meta({
      description: `Update the current database to match definitions.sql. Note: this should only be used for local development. For production databases, use 'sqlfu migrate' instead. ` +
        `This command fails if semantic changes are required. You can run 'sqlfu draft' to create a migration file with the necessary changes.`,
    })
    .handler(async ({context}) => {
      await applySyncSql(requireContextConfig(context), context.confirm);
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
      await applyDraftSql(requireContextConfig(context), input, context.confirm);
    }),

  migrate: base
    .meta({
      description: `Apply pending migrations to the configured database.`,
    })
    .handler(async ({context}) => {
      await applyMigrateSql(requireContextConfig(context), context.confirm);
    }),

  pending: base
    .meta({
      description: `List migrations that exist but have not been applied to the configured database.`,
    })
    .handler(async ({context}) => {
      const initializedContext = requireContextConfig(context);
      const migrations = await createRuntime(initializedContext).readMigrations();
      await using database = await openMainDevDatabase(initializedContext.config.db);
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
      await using database = await openMainDevDatabase(requireContextConfig(context).config.db);
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
      const initializedContext = requireContextConfig(context);
      const migrations = await createRuntime(initializedContext).readMigrations();
      await using database = await openMainDevDatabase(initializedContext.config.db);
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
      await applyBaselineSql(requireContextConfig(context), input, context.confirm);
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
      await applyGotoSql(requireContextConfig(context), input, context.confirm);
    }),

  check: {
    all: base
      .meta({
        description: `Run all checks and recommend the next action.`,
      })
      .handler(async ({context}) => {
        const analysis = await analyzeDatabase(createRuntime(requireContextConfig(context)));
        if (analysis.mismatches.length > 0) {
          throw new Error(formatCheckFailure(analysis));
        }
      }),
    migrationsMatchDefinitions: base.handler(async ({context}) => {
      const runtime = createRuntime(requireContextConfig(context));
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

export async function getCheckMismatches(context: SqlfuContext): Promise<readonly CheckMismatch[]> {
  const analysis = await analyzeDatabase(createRuntime(context));
  return analysis.mismatches;
}

export async function getCheckAnalysis(context: SqlfuContext): Promise<CheckAnalysis> {
  return analyzeDatabase(createRuntime(context));
}

export async function writeDefinitionsSql(context: SqlfuContext, sql: string): Promise<void> {
  await fs.writeFile(context.config.definitions, `${sql.trimEnd()}\n`);
}

export async function getSchemaAuthorities(context: SqlfuContext) {
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
  context: SqlfuContext,
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

export type SqlfuCommandConfirmParams = {
  readonly title: string;
  readonly body: string;
  readonly bodyType?: 'markdown' | 'sql' | 'typescript';
  readonly editable?: boolean;
};

export type SqlfuCommandConfirm = (
  params: SqlfuCommandConfirmParams,
) => Promise<string | null>;

export async function runSqlfuCommand(
  context: SqlfuCommandContext,
  command: string,
  confirm: SqlfuCommandConfirm,
): Promise<void> {
  const normalized = command.trim();

  if (normalized === 'sqlfu init') {
    const preview = createDefaultInitPreview(context.projectRoot);
    const configContents = await confirm({
      title: 'Create sqlfu.config.ts?',
      body: preview.configContents,
      bodyType: 'typescript',
      editable: true,
    });
    if (!configContents?.trim()) {
      return;
    }
    await initializeProject({
      projectRoot: context.projectRoot,
      configContents,
    });
    return;
  }

  const initializedContext = requireContextConfig(context);

  if (normalized === 'sqlfu draft') {
    await applyDraftSql(initializedContext, {}, confirm);
    return;
  }

  if (normalized === 'sqlfu sync') {
    await applySyncSql(initializedContext, confirm);
    return;
  }

  if (normalized === 'sqlfu migrate') {
    await applyMigrateSql(initializedContext, confirm);
    return;
  }

  if (normalized.startsWith('sqlfu baseline ')) {
    await applyBaselineSql(initializedContext, {
      target: normalized.replace(/^sqlfu baseline /u, '').trim(),
    }, confirm);
    return;
  }

  if (normalized.startsWith('sqlfu goto ')) {
    await applyGotoSql(initializedContext, {
      target: normalized.replace(/^sqlfu goto /u, '').trim(),
    }, confirm);
    return;
  }

  if (normalized === 'sqlfu check') {
    const analysis = await analyzeDatabase(createRuntime(initializedContext));
    if (analysis.mismatches.length > 0) {
      throw new Error(formatCheckFailure(analysis));
    }
    return;
  }

  throw new Error(`Unsupported sqlfu command: ${command}`);
}

function createRuntime(context: SqlfuContext) {
  return {
    config: context.config,
    now: () => context.now?.() ?? new Date(),
    readDefinitionsSql: () => readDefinitionsSql(context.config.definitions),
    async readMigrations() {
      try {
        const fileNames = (await fs.readdir(context.config.migrations))
          .filter((fileName) => fileName.endsWith('.sql'))
          .sort();

        const migrations = [];
        for (const fileName of fileNames) {
          const filePath = path.join(context.config.migrations, fileName);
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

async function applyDraftSql(
  context: SqlfuContext,
  input: {name?: string} | undefined,
  confirm: SqlfuCommandConfirm,
) {
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

  const body = await confirm({
    title: 'Create migration file?',
    body: diffLines.join('\n').trim(),
    bodyType: 'sql',
    editable: true,
  });
  if (!body?.trim()) {
    return;
  }
  const fileName = `${getMigrationPrefix(runtime.now())}_${slugify(input?.name ?? migrationNickname(body))}.sql`;
  await fs.mkdir(context.config.migrations, {recursive: true});
  await fs.writeFile(path.join(context.config.migrations, fileName), `${body.trim()}\n`);
}

async function applySyncSql(
  context: SqlfuContext,
  confirm: SqlfuCommandConfirm,
) {
  const definitionsSql = await readDefinitionsSql(context.config.definitions);
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

    const confirmedSql = await confirm({
      title: 'Apply sync SQL?',
      body: diffLines.join('\n').trim(),
      bodyType: 'sql',
      editable: true,
    });
    if (!confirmedSql?.trim()) {
      return;
    }

    await database.client.transaction(async (tx) => {
      await tx.raw(confirmedSql.trim());
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

async function applyMigrateSql(
  context: SqlfuContext,
  confirm: SqlfuCommandConfirm,
) {
  const runtime = createRuntime(context);
  const migrations = await runtime.readMigrations();

  // preflight: the database must be healthy enough to apply migrations from a trusted prefix.
  // we check this once before doing anything, even when there are zero pending migrations.
  const preflight = await analyzeMigrateHealth(runtime);
  if (preflight.blockers.length > 0) {
    throw new Error(formatMigratePreflightFailure(preflight));
  }

  await using database = await openMainDevDatabase(context.config.db);
  const applied = await readMigrationHistory(database.client);
  const appliedNames = new Set(applied.map((migration) => migration.name));
  const pendingMigrations = migrations.filter((migration) => !appliedNames.has(migrationName(migration)));
  if (pendingMigrations.length === 0) {
    return;
  }

  const ok = await confirm({
    title: 'Apply pending migrations?',
    body: pendingMigrations.map((migration) => [
      `-- ${migrationName(migration)}`,
      migration.content.trim(),
    ].join('\n')).join('\n\n'),
    bodyType: 'sql',
  });
  if (!ok) {
    return;
  }

  try {
    await applyMigrations(database.client, {migrations});
  } catch (error) {
    // figure out which migration was the first one to not make it into history
    const appliedAfter = await readMigrationHistory(database.client);
    const appliedAfterNames = new Set(appliedAfter.map((migration) => migration.name));
    const failed = pendingMigrations.find((migration) => !appliedAfterNames.has(migrationName(migration)));
    const failedName = failed ? migrationName(failed) : 'migration';

    // rerun the migrate-health check against whatever state the database is in now.
    // if nothing drifted, retrying is honest. if something did drift, reconciliation is required.
    // reuse the already-open client so we do not race a second connection against a database
    // that is still recovering from the failed migration.
    const postFailure = await analyzeMigrateHealth(runtime, database.client);
    throw new Error(formatMigrateFailure({
      failedName,
      cause: summarizeSqlite3defError(error),
      postFailure,
    }));
  }
}

async function analyzeMigrateHealth(
  runtime: ReturnType<typeof createRuntime>,
  existingClient?: Client,
): Promise<MigrateHealthAnalysis> {
  // this is narrower than analyzeDatabase on purpose. it only checks the things that would make
  // it unsafe to apply more migrations:
  //   - history drift: the database claims migrations that no longer match the repo
  //   - schema drift: the live schema no longer matches the schema the applied history implies
  // pending migrations are the whole point of migrate, so they are never blockers. sync drift
  // is about desired vs live, which is downstream of applying migrations.
  // unlike analyzeDatabase, this deliberately does not replay pending migrations, so broken
  // pending migrations still reach the real apply path where their errors can be reported.
  const migrations = await runtime.readMigrations();
  if (existingClient) {
    return analyzeMigrateHealthWithClient(runtime, migrations, existingClient);
  }
  await using database = await openMainDevDatabase(runtime.config.db);
  return await analyzeMigrateHealthWithClient(runtime, migrations, database.client);
}

async function analyzeMigrateHealthWithClient(
  runtime: ReturnType<typeof createRuntime>,
  migrations: readonly Migration[],
  client: Client,
): Promise<MigrateHealthAnalysis> {
  const applied = await readMigrationHistory(client);
  const liveSchema = await extractSchema(client, 'main', {
    excludedTables: schemaDriftExcludedTables,
  });
  const migrationByName = new Map(migrations.map((migration) => [migrationName(migration), migration]));
  const historyMismatch = findHistoryMismatch(applied, migrations, migrationByName);

  const blockers: CheckMismatch[] = [];
  const recommendations: CheckRecommendation[] = [];

  if (historyMismatch) {
    const problemLine = historyMismatch.kind === 'deleted'
      ? `Deleted applied migration: ${historyMismatch.name}`
      : historyMismatch.kind === 'checksumMismatch'
      ? `Applied migration checksum mismatch: ${historyMismatch.name}`
      : `New migration sorts before applied migration: ${historyMismatch.name}`;
    blockers.push({
      kind: 'historyDrift',
      title: 'History Drift',
      summary: 'Migration History does not match Migrations.',
      details: [problemLine],
    });
    if (historyMismatch.kind === 'deleted') {
      addRecommendation(recommendations, {
        kind: 'restoreMissingMigration',
        label: 'Restore the missing migration from version control.',
      });
    } else if (historyMismatch.kind === 'outOfOrder') {
      const latestApplied = applied.at(-1)?.name;
      if (latestApplied) {
        addRecommendation(recommendations, {
          kind: 'goto',
          command: ['goto', latestApplied],
          label: 'Move the database to the selected migration target.',
        });
      }
    } else {
      addRecommendation(recommendations, {
        kind: 'restoreOriginalMigration',
        label: 'Restore the original migration from version control.',
      });
    }
    return {blockers, recommendations};
  }

  // safe to replay the applied prefix now that we know the applied migrations line up with the
  // repo. only replay migrations that we are claiming have already been applied - do not replay
  // pending ones, because those might be broken (and that's migrate's job to surface).
  const historicalMigrations = applied
    .map((historical) => migrationByName.get(historical.name))
    .filter((migration): migration is Migration => Boolean(migration));
  const historicalSchema = await materializeMigrationsSchema(runtime.config, historicalMigrations);
  const schemaDrift = await compareSchemas(runtime.config, historicalSchema, liveSchema);

  if (schemaDrift.isDifferent) {
    const recommendedBaselineTarget = await findRecommendedTarget(runtime.config, migrations, liveSchema);
    // prefer the latest applied migration as the goto target. its replay is known to work, and
    // it resets the database to a trusted recorded state. falling back to the latest migration
    // in the repo could recommend a broken pending migration.
    const recommendedGotoTarget = applied.at(-1)?.name
      || (migrations.length > 0 ? migrationName(migrations.at(-1)!) : null);
    blockers.push({
      kind: 'schemaDrift',
      title: 'Schema Drift',
      summary: applied.length === 0
        ? 'Live Schema exists, but Migration History is empty.'
        : 'Live Schema does not match Migration History.',
      details: [],
    });
    if (recommendedBaselineTarget) {
      addRecommendation(recommendations, {
        kind: 'baseline',
        command: ['baseline', recommendedBaselineTarget],
        label: 'Record the current schema as already applied.',
      });
    } else if (recommendedGotoTarget) {
      addRecommendation(recommendations, {
        kind: 'goto',
        command: ['goto', recommendedGotoTarget],
        label: 'Move the database to the selected migration target.',
      });
    }
  }

  return {blockers, recommendations};
}

function formatMigratePreflightFailure(analysis: MigrateHealthAnalysis) {
  const sections: string[] = ['Cannot migrate from current database state.'];
  for (const blocker of analysis.blockers) {
    sections.push([blocker.title, blocker.summary, ...blocker.details].join('\n'));
  }
  if (analysis.recommendations.length > 0) {
    sections.push([
      'Recommended next actions',
      ...analysis.recommendations.map((recommendation) => `- ${formatRecommendationText(recommendation)}`),
    ].join('\n'));
  }
  return sections.join('\n\n');
}

function formatMigrateFailure(params: {
  failedName: string;
  cause: string;
  postFailure: MigrateHealthAnalysis;
}) {
  const header = `Migration ${params.failedName} failed: ${params.cause}`;

  if (params.postFailure.blockers.length === 0) {
    return [
      header,
      'The database is still healthy for migrate. Fix the migration and retry.',
    ].join('\n\n');
  }

  const sections: string[] = [
    header,
    'The database is no longer healthy for migrate. Reconcile before retrying.',
  ];
  for (const blocker of params.postFailure.blockers) {
    sections.push([blocker.title, blocker.summary, ...blocker.details].join('\n'));
  }
  if (params.postFailure.recommendations.length > 0) {
    sections.push([
      'Recommended next actions',
      ...params.postFailure.recommendations.map((recommendation) => `- ${formatRecommendationText(recommendation)}`),
    ].join('\n'));
  }
  return sections.join('\n\n');
}

type MigrateHealthAnalysis = {
  readonly blockers: readonly CheckMismatch[];
  readonly recommendations: readonly CheckRecommendation[];
};

async function applyBaselineSql(
  context: SqlfuContext,
  input: {target: string},
  confirm: SqlfuCommandConfirm,
) {
  const migrations = await createRuntime(context).readMigrations();
  const targetMigrations = getMigrationsThroughTarget(migrations, input.target);
  const ok = await confirm({
    title: 'Record migration history?',
    body: [
      `Target: ${input.target}`,
      '',
      'These migrations will be recorded as applied:',
      ...targetMigrations.map((migration) => `- ${migrationName(migration)}`),
    ].join('\n'),
  });
  if (!ok) {
    return;
  }
  await using database = await openMainDevDatabase(context.config.db);
  await baselineMigrationHistory(database.client, {migrations, target: input.target});
}

async function applyGotoSql(
  context: SqlfuContext,
  input: {target: string},
  confirm: SqlfuCommandConfirm,
) {
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
  const confirmedSql = await confirm({
    title: `Move database to ${input.target}?`,
    body: diffLines.join('\n').trim(),
    bodyType: 'sql',
    editable: true,
  });
  if (confirmedSql == null) {
    return;
  }

  await database.client.transaction(async (tx) => {
    if (confirmedSql?.trim()) {
      await tx.raw(confirmedSql.trim());
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
  const hasAppliedHistory = applied.length > 0;
  const appliedNames = new Set(applied.map((migration) => migration.name));
  const migrationByName = new Map(migrations.map((migration) => [migrationName(migration), migration]));

  const repoDrift = await compareSchemas(runtime.config, desiredSchema, migrationsSchema);
  const historyMismatch = findHistoryMismatch(applied, migrations, migrationByName);
  const hasPendingMigrations = !historyMismatch && migrations.some((migration) => !appliedNames.has(migrationName(migration)));

  const historicalMigrations = applied
    .map((historical) => migrationByName.get(historical.name))
    .filter((migration): migration is Migration => Boolean(migration));
  const historicalSchema = await materializeMigrationsSchema(runtime.config, historicalMigrations);
  const schemaDrift = await compareSchemas(runtime.config, historicalSchema, liveSchema);
  const syncDrift = await compareSchemas(runtime.config, desiredSchema, liveSchema);
  const recommendedBaselineTarget = await findRecommendedTarget(runtime.config, migrations, liveSchema);
  const recommendedGotoTarget = !repoDrift.isDifferent && !historyMismatch && migrations.length > 0
    ? migrationName(migrations.at(-1)!)
    : null;
  const mismatches: CheckMismatch[] = [];
  const recommendations: CheckRecommendation[] = [];

  if (historyMismatch) {
    const problemLine = historyMismatch.kind === 'deleted'
      ? `Deleted applied migration: ${historyMismatch.name}`
      : historyMismatch.kind === 'checksumMismatch'
      ? `Applied migration checksum mismatch: ${historyMismatch.name}`
      : `New migration sorts before applied migration: ${historyMismatch.name}`;
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
        label: 'Restore the missing migration from version control.',
      });
    } else if (historyMismatch.kind === 'outOfOrder') {
      const latestApplied = applied.at(-1)?.name;
      if (latestApplied) {
        addRecommendation(recommendations, {
          kind: 'goto',
          command: ['goto', latestApplied],
          label: 'Move the database to the selected migration target.',
        });
      }
    } else if (recommendedBaselineTarget) {
      addRecommendation(recommendations, {
        kind: 'restoreOriginalMigration',
        label: 'Restore the original migration from version control.',
      });
      addRecommendation(recommendations, {
        kind: 'baseline',
        command: ['baseline', recommendedBaselineTarget],
        label: 'Keep the current live schema.',
      });
    } else if (syncDrift.isDifferent) {
      addRecommendation(recommendations, {
        kind: 'restoreOriginalMigration',
        label: 'Restore the original migration from version control.',
      });
      addRecommendation(recommendations, {
        kind: 'goto',
        command: ['goto', historyMismatch.name],
        label: 'Reconcile the database to the current repo state.',
      });
    } else {
      addRecommendation(recommendations, {
        kind: 'restoreOriginalMigration',
        label: 'Restore the original migration from version control.',
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
      command: ['draft'],
      label: 'Create a reviewable migration.',
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
        command: ['migrate'],
        label: 'Apply pending migrations to the database.',
      });
    }
  }

  if (!historyMismatch && schemaDrift.isDifferent) {
    const repoDriftWithLiveAlreadySynced = repoDrift.isDifferent && !syncDrift.isDifferent;
    mismatches.push({
      kind: 'schemaDrift',
      title: 'Schema Drift',
      summary: !hasAppliedHistory
        ? 'Live Schema exists, but Migration History is empty.'
        : repoDriftWithLiveAlreadySynced
        ? 'Live Schema matches Desired Schema, but not Migration History.'
        : 'Live Schema does not match Migration History.',
      details: [],
    });

    if (!repoDriftWithLiveAlreadySynced && recommendedBaselineTarget) {
      addRecommendation(recommendations, {
        kind: 'baseline',
        command: ['baseline', recommendedBaselineTarget],
        label: `Record the current schema as already applied.`,
      });
    } else if (!repoDriftWithLiveAlreadySynced && recommendedGotoTarget) {
      addRecommendation(recommendations, {
        kind: 'goto',
        command: ['goto', recommendedGotoTarget],
        label: 'Move the database to the selected migration target.',
      });
    } else if (!repoDriftWithLiveAlreadySynced && !repoDrift.isDifferent) {
      addRecommendation(recommendations, {
        kind: 'goto',
        label: 'Move the database to the selected migration target.',
      });
    }
  }

  if (syncDrift.isDifferent && syncDrift.isSyncable) {
    const pendingMigrationsWouldResolveSyncDrift = mismatches.length === 1
      && mismatches[0]?.kind === 'pendingMigrations';
    mismatches.push({
      kind: 'syncDrift',
      title: 'Sync Drift',
      summary: pendingMigrationsWouldResolveSyncDrift
        ? 'Live Schema is behind Desired Schema. Applying pending migrations would resolve this.'
        : 'Desired Schema does not match Live Schema.',
      details: [],
    });

    if (!historyMismatch && repoDrift.isDifferent) {
      addRecommendation(recommendations, {
        kind: 'sync',
        command: ['sync'],
        label: 'Update the database from Desired Schema, useful while iterating locally.',
      });
    } else if (!historyMismatch && !repoDrift.isDifferent && !hasPendingMigrations && !schemaDrift.isDifferent) {
      addRecommendation(recommendations, {
        kind: 'sync',
        command: ['sync'],
        label: 'Update the database from Desired Schema.',
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
  migrations: readonly Migration[],
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
  // applied migrations must also match the leading prefix of migrations by sort order.
  // if a new migration file sorts before an already-applied one, the repository no longer
  // describes a history that the database could honestly claim to have applied.
  for (let index = 0; index < applied.length; index += 1) {
    const historical = applied[index]!;
    const expected = migrations[index];
    if (!expected || migrationName(expected) !== historical.name) {
      return {kind: 'outOfOrder' as const, name: historical.name};
    }
  }
  return null;
}

async function findRecommendedTarget(config: SqlfuProjectConfig, migrations: readonly Migration[], liveSchema: string) {
  for (let index = 0; index < migrations.length; index += 1) {
    const candidate = migrations.slice(0, index + 1);
    let candidateSchema: string;
    try {
      candidateSchema = await materializeMigrationsSchema(config, candidate);
    } catch {
      // a migration in this prefix is broken. it cannot be a trusted target, and any later
      // prefix containing the same migration is also untrustworthy. stop searching.
      return null;
    }
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

export interface SqlfuContext {
  readonly config: SqlfuProjectConfig;
  readonly now?: () => Date;
}

export interface SqlfuCommandContext {
  readonly projectRoot: string;
  readonly config?: SqlfuProjectConfig;
  readonly now?: () => Date;
}

export interface SqlfuRouterContext extends SqlfuContext {}

export interface SqlfuCommandRouterContext extends SqlfuCommandContext {
  readonly confirm: SqlfuCommandConfirm;
}

function requireContextConfig(context: SqlfuCommandContext): SqlfuContext {
  if (!context.config) {
    throw new Error(`No sqlfu config found in ${context.projectRoot}. Run 'sqlfu init' first.`);
  }

  return {
    config: context.config,
    now: context.now,
  };
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
  readonly command?: readonly [string, ...string[]];
  readonly label: string;
  readonly rationale?: string;
};

export type CheckAnalysis = {
  readonly mismatches: readonly CheckMismatch[];
  readonly recommendations: readonly CheckRecommendation[];
};

function addRecommendation(target: CheckRecommendation[], recommendation: CheckRecommendation) {
  const commandKey = recommendation.command?.join('\0') ?? '';
  const key = `${recommendation.kind}|${commandKey}|${recommendation.label}|${recommendation.rationale ?? ''}`;
  if (target.some((existing) => `${existing.kind}|${existing.command?.join('\0') ?? ''}|${existing.label}|${existing.rationale ?? ''}` === key)) {
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
    rationale: getRecommendationExplainer(recommendation),
  }));
}

function getRecommendationExplainer(recommendation: CheckRecommendation) {
  switch (recommendation.kind) {
    case 'draft':
      return 'Addresses Repo Drift';
    case 'migrate':
      return 'Addresses Pending Migrations';
    case 'baseline':
      return 'Addresses Schema Drift';
    case 'goto':
      return 'Addresses Schema Drift';
    case 'sync':
      return 'Addresses Sync Drift';
    case 'restoreMissingMigration':
      return 'Addresses History Drift';
    case 'restoreOriginalMigration':
      return 'Addresses History Drift';
  }
}

function formatCheckFailure(analysis: CheckAnalysis) {
  const sections = analysis.mismatches.map((mismatch) =>
    [mismatch.title, mismatch.summary, ...mismatch.details].join('\n'),
  );

  if (analysis.recommendations.length > 0) {
    sections.push([
      'Recommended next actions',
      ...analysis.recommendations.map((recommendation) => `- ${formatRecommendationText(recommendation)}`),
    ].join('\n'));
  }

  return sections.join('\n\n');
}

function formatRecommendationText(recommendation: CheckRecommendation) {
  const parts = [
    recommendation.command ? `\`${formatRecommendationCommand(recommendation.command)}\`` : null,
    recommendation.label.replace(/\.$/u, ''),
  ].filter(Boolean);
  const sentence = parts.join(' ');
  return recommendation.rationale ? `${sentence}. (${recommendation.rationale})` : `${sentence}.`;
}

function formatRecommendationCommand(command: readonly [string, ...string[]]) {
  return ['sqlfu', ...command].join(' ');
}
