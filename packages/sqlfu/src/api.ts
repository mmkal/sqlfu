import type {Client, SqlfuMigrationPrefix, SqlfuProjectConfig} from './types.js';
import type {SqlfuHost} from './host.js';
import {basename, joinPath} from './paths.js';
import {createDefaultInitPreview} from './init-preview.js';
import {migrationNickname} from './naming.js';
import {extractSchema} from './sqlite-text.js';
import {
  applyMigrations,
  baselineMigrationHistory,
  migrationName,
  readMigrationHistory,
  replaceMigrationHistory,
  type Migration,
} from './migrations/index.js';
import {diffSchemaSql} from './schemadiff/index.js';
import {inspectSqliteSchemaSql, schemasEqual} from './schemadiff/sqlite/index.js';

const schemaDriftExcludedTables = (['sqlfu_migrations'] as const).slice();

export async function getCheckMismatches(context: SqlfuContext): Promise<CheckMismatch[]> {
  const analysis = await analyzeDatabase(context);
  return analysis.mismatches;
}

export async function getCheckAnalysis(context: SqlfuContext): Promise<CheckAnalysis> {
  return analyzeDatabase(context);
}

export async function writeDefinitionsSql(context: SqlfuContext, sql: string): Promise<void> {
  await context.host.fs.writeFile(context.config.definitions, `${sql.trimEnd()}\n`);
}

export async function getSchemaAuthorities(context: SqlfuContext) {
  const definitionsSql = await readDefinitionsSql(context.host, context.config.definitions);
  const migrations = await readMigrationsFromContext(context);

  await using database = await context.host.openDb(context.config);
  const applied = await readMigrationHistory(database.client);
  const liveSchema = await extractSchema(database.client, 'main', {
    excludedTables: schemaDriftExcludedTables,
  });
  const appliedByName = new Map(applied.map((migration) => [migration.name, migration]));
  const migrationByName = new Map(migrations.map((migration) => [migrationName(migration), migration]));

  const migrationEntries = await Promise.all(
    migrations.map(async (migration) => {
      const name = migrationName(migration);
      const appliedEntry = appliedByName.get(name);
      return {
        id: name,
        fileName: basename(migration.path),
        content: migration.content,
        applied: appliedByName.has(name),
        applied_at: appliedEntry?.applied_at ?? null,
        integrity: appliedEntry
          ? await getMigrationIntegrity(context.host, migration.content, appliedEntry.checksum)
          : null,
      };
    }),
  );

  const historyEntries = await Promise.all(
    applied.map(async (migration) => {
      const current = migrationByName.get(migration.name);
      return {
        id: migration.name,
        fileName: current ? basename(current.path) : null,
        content: current?.content ?? '-- migration file missing from repo',
        applied: true,
        applied_at: migration.applied_at,
        integrity: await getMigrationIntegrity(context.host, current?.content, migration.checksum),
      };
    }),
  );

  return {
    desiredSchemaSql: definitionsSql,
    migrations: migrationEntries,
    migrationHistory: historyEntries,
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
  if (input.source === 'migrations') {
    const migrations = await readMigrationsFromContext(context);
    const targetIndex = migrations.findIndex((migration) => migrationName(migration) === input.id);
    if (targetIndex === -1) {
      throw new Error(`migration ${input.id} not found`);
    }
    const schemaSql = await materializeMigrationsSchemaForContext(context.host, migrations.slice(0, targetIndex + 1));
    return `-- schema that would be produced by \`sqlfu goto ${input.id}\`\n${schemaSql}`;
  }

  await using database = await context.host.openDb(context.config);
  const applied = await readMigrationHistory(database.client);
  const targetIndex = applied.findIndex((migration) => migration.name === input.id);
  if (targetIndex === -1) {
    throw new Error(`migration history entry ${input.id} not found`);
  }
  const migrations = await readMigrationsFromContext(context);
  const targetMigrationIndex = migrations.findIndex((migration) => migrationName(migration) === input.id);
  if (targetMigrationIndex === -1) {
    throw new Error(`migration ${input.id} not found in repo`);
  }
  const schemaSql = await materializeMigrationsSchemaForContext(
    context.host,
    migrations.slice(0, targetMigrationIndex + 1),
  );
  return `-- schema produced by sqlfu goto ${input.id}\n${schemaSql}`;
}

export type SqlfuCommandConfirmParams = {
  title: string;
  body: string;
  bodyType?: 'markdown' | 'sql' | 'typescript';
  editable?: boolean;
};

export type SqlfuCommandConfirm = (params: SqlfuCommandConfirmParams) => Promise<string | null>;

/**
 * A `SqlfuCommandConfirm` that accepts the proposed body without prompting.
 * Used by the CLI when `--yes` is passed or when stdin is non-TTY, and by
 * programmatic callers that want to skip interactive confirmation.
 */
export const autoAcceptConfirm: SqlfuCommandConfirm = async (params) => params.body.trim() || null;

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
    await context.host.initializeProject({
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
    await applyBaselineSql(
      initializedContext,
      {
        target: normalized.replace(/^sqlfu baseline /u, '').trim(),
      },
      confirm,
    );
    return;
  }

  if (normalized.startsWith('sqlfu goto ')) {
    await applyGotoSql(
      initializedContext,
      {
        target: normalized.replace(/^sqlfu goto /u, '').trim(),
      },
      confirm,
    );
    return;
  }

  if (normalized === 'sqlfu check') {
    const analysis = await analyzeDatabase(initializedContext);
    if (analysis.mismatches.length > 0) {
      throw new Error(formatCheckFailure(analysis));
    }
    return;
  }

  throw new Error(`Unsupported sqlfu command: ${command}`);
}

export async function readMigrationsFromContext(context: SqlfuContext): Promise<Migration[]> {
  if (!context.config.migrations) return [];
  const migrationsDir = context.config.migrations.path;

  let fileNames: string[];
  try {
    fileNames = (await context.host.fs.readdir(migrationsDir))
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const migrations: Migration[] = [];
  for (const fileName of fileNames) {
    const filePath = joinPath(migrationsDir, fileName);
    const content = await context.host.fs.readFile(filePath);
    migrations.push({path: filePath, content});
  }
  return migrations;
}

async function readDefinitionsSql(host: SqlfuHost, definitionsPath: string) {
  try {
    return await host.fs.readFile(definitionsPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('definitions.sql not found');
    }
    throw error;
  }
}

export async function applyDraftSql(
  context: SqlfuContext,
  input: {name?: string} | undefined,
  confirm: SqlfuCommandConfirm,
) {
  const migrations = await readMigrationsFromContext(context);
  const definitionsSql = await readDefinitionsSql(context.host, context.config.definitions);
  const baselineSql =
    migrations.length === 0 ? '' : await materializeMigrationsSchemaForContext(context.host, migrations);
  const diffLines = await diffSchemaSql(context.host, {
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
  if (!context.config.migrations) {
    throw new Error('sqlfu draft requires a `migrations` directory in sqlfu.config.ts');
  }
  const migrationsDir = context.config.migrations.path;
  const prefix = getMigrationPrefix({
    kind: context.config.migrations.prefix,
    now: context.host.now(),
    existing: migrations.map((migration) => basename(migration.path)),
  });
  const fileName = `${prefix}_${slugify(input?.name ?? migrationNickname(body))}.sql`;
  await context.host.fs.mkdir(migrationsDir);
  await context.host.fs.writeFile(joinPath(migrationsDir, fileName), `${body.trim()}\n`);
}

export async function applySyncSql(context: SqlfuContext, confirm: SqlfuCommandConfirm) {
  const definitionsSql = await readDefinitionsSql(context.host, context.config.definitions);
  await using database = await context.host.openDb(context.config);
  const baselineSql = await extractSchema(database.client, 'main', {
    excludedTables: schemaDriftExcludedTables,
  });
  try {
    const diffLines = await diffSchemaSql(context.host, {
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

export async function applyMigrateSql(context: SqlfuContext, confirm: SqlfuCommandConfirm) {
  const migrations = await readMigrationsFromContext(context);

  // preflight: the database must be healthy enough to apply migrations from a trusted prefix.
  // we check this once before doing anything, even when there are zero pending migrations.
  const preflight = await analyzeMigrateHealth(context);
  if (preflight.blockers.length > 0) {
    throw new Error(formatMigratePreflightFailure(preflight));
  }

  await using database = await context.host.openDb(context.config);
  const applied = await readMigrationHistory(database.client);
  const appliedNames = new Set(applied.map((migration) => migration.name));
  const pendingMigrations = migrations.filter((migration) => !appliedNames.has(migrationName(migration)));
  if (pendingMigrations.length > 0) {
    const ok = await confirm({
      title: 'Apply pending migrations?',
      body: pendingMigrations
        .map((migration) => [`-- ${migrationName(migration)}`, migration.content.trim()].join('\n'))
        .join('\n\n'),
      bodyType: 'sql',
    });
    if (!ok) {
      return;
    }
  }

  try {
    // apply migrations even if there are zero pending, because this will validate migration history
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
    const postFailure = await analyzeMigrateHealth(context, database.client);
    throw new Error(
      formatMigrateFailure({
        failedName,
        cause: summarizeSqlite3defError(error),
        postFailure,
      }),
    );
  }
}

async function analyzeMigrateHealth(context: SqlfuContext, existingClient?: Client): Promise<MigrateHealthAnalysis> {
  // this is narrower than analyzeDatabase on purpose. it only checks the things that would make
  // it unsafe to apply more migrations:
  //   - history drift: the database claims migrations that no longer match the repo
  //   - schema drift: the live schema no longer matches the schema the applied history implies
  // pending migrations are the whole point of migrate, so they are never blockers. sync drift
  // is about desired vs live, which is downstream of applying migrations.
  // unlike analyzeDatabase, this deliberately does not replay pending migrations, so broken
  // pending migrations still reach the real apply path where their errors can be reported.
  const migrations = await readMigrationsFromContext(context);
  if (existingClient) {
    return analyzeMigrateHealthWithClient(context, migrations, existingClient);
  }
  await using database = await context.host.openDb(context.config);
  return await analyzeMigrateHealthWithClient(context, migrations, database.client);
}

async function analyzeMigrateHealthWithClient(
  context: SqlfuContext,
  migrations: Migration[],
  client: Client,
): Promise<MigrateHealthAnalysis> {
  const applied = await readMigrationHistory(client);
  const liveSchema = await extractSchema(client, 'main', {
    excludedTables: schemaDriftExcludedTables,
  });
  const migrationByName = new Map(migrations.map((migration) => [migrationName(migration), migration]));
  const historyMismatch = await findHistoryMismatch(context.host, applied, migrations, migrationByName);

  const blockers: CheckMismatch[] = [];
  const recommendations: CheckRecommendation[] = [];

  if (historyMismatch) {
    const problemLine =
      historyMismatch.kind === 'deleted'
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
  const historicalSchema = await materializeMigrationsSchemaForContext(context.host, historicalMigrations);
  const schemaDrift = await compareSchemasForContext(context.host, historicalSchema, liveSchema);

  if (schemaDrift.isDifferent) {
    const recommendedBaselineTarget = await findRecommendedTarget(context.host, migrations, liveSchema);
    // prefer the latest applied migration as the goto target. its replay is known to work, and
    // it resets the database to a trusted recorded state. falling back to the latest migration
    // in the repo could recommend a broken pending migration.
    const recommendedGotoTarget =
      applied.at(-1)?.name || (migrations.length > 0 ? migrationName(migrations.at(-1)!) : null);
    blockers.push({
      kind: 'schemaDrift',
      title: 'Schema Drift',
      summary:
        applied.length === 0
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
    sections.push(
      [
        'Recommended next actions',
        ...analysis.recommendations.map((recommendation) => `- ${formatRecommendationText(recommendation)}`),
      ].join('\n'),
    );
  }
  return sections.join('\n\n');
}

function formatMigrateFailure(params: {failedName: string; cause: string; postFailure: MigrateHealthAnalysis}) {
  const header = `Migration ${params.failedName} failed: ${params.cause}`;

  if (params.postFailure.blockers.length === 0) {
    return [header, 'The database is still healthy for migrate. Fix the migration and retry.'].join('\n\n');
  }

  const sections: string[] = [header, 'The database is no longer healthy for migrate. Reconcile before retrying.'];
  for (const blocker of params.postFailure.blockers) {
    sections.push([blocker.title, blocker.summary, ...blocker.details].join('\n'));
  }
  if (params.postFailure.recommendations.length > 0) {
    sections.push(
      [
        'Recommended next actions',
        ...params.postFailure.recommendations.map((recommendation) => `- ${formatRecommendationText(recommendation)}`),
      ].join('\n'),
    );
  }
  return sections.join('\n\n');
}

type MigrateHealthAnalysis = {
  blockers: CheckMismatch[];
  recommendations: CheckRecommendation[];
};

export async function applyBaselineSql(context: SqlfuContext, input: {target: string}, confirm: SqlfuCommandConfirm) {
  const migrations = await readMigrationsFromContext(context);
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
  await using database = await context.host.openDb(context.config);
  await baselineMigrationHistory(database.client, {migrations, target: input.target});
}

export async function applyGotoSql(context: SqlfuContext, input: {target: string}, confirm: SqlfuCommandConfirm) {
  const migrations = await readMigrationsFromContext(context);
  const targetMigrations = getMigrationsThroughTarget(migrations, input.target);
  const targetSchema = await materializeMigrationsSchemaForContext(context.host, targetMigrations);

  await using database = await context.host.openDb(context.config);
  const liveSchema = await extractSchema(database.client, 'main', {
    excludedTables: schemaDriftExcludedTables,
  });
  const diffLines = await diffSchemaSql(context.host, {
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

export function getMigrationPrefix(input: {kind: SqlfuMigrationPrefix; now: Date; existing: string[]}) {
  if (input.kind === 'four-digit') {
    return nextFourDigitPrefix(input.existing);
  }
  return input.now.toISOString().replaceAll(':', '.');
}

function nextFourDigitPrefix(existingFileNames: string[]) {
  let max = -1;
  for (const fileName of existingFileNames) {
    const match = /^(\d{4})_/.exec(fileName);
    if (!match) continue;
    const n = Number.parseInt(match[1], 10);
    if (n > max) max = n;
  }
  return String(max + 1).padStart(4, '0');
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .replace(/_+/gu, '_');
}

export async function materializeDefinitionsSchemaForContext(host: SqlfuHost, definitionsSql: string) {
  await using database = await host.openScratchDb('materialize-definitions');
  await database.client.raw(definitionsSql);
  return await extractSchema(database.client, 'main', {
    excludedTables: schemaDriftExcludedTables,
  });
}

export async function materializeMigrationsSchemaForContext(host: SqlfuHost, migrations: Migration[]) {
  await using database = await host.openScratchDb('materialize-migrations');
  await applyMigrations(database.client, {migrations});
  return await extractSchema(database.client, 'main', {
    excludedTables: schemaDriftExcludedTables,
  });
}

function getMigrationsThroughTarget(migrations: Migration[], target: string) {
  const targetIndex = migrations.findIndex((migration) => migrationName(migration) === target);
  if (targetIndex === -1) {
    throw new Error(`migration ${target} not found`);
  }
  return migrations.slice(0, targetIndex + 1);
}

export async function analyzeDatabase(context: SqlfuContext) {
  const host = context.host;
  const migrations = await readMigrationsFromContext(context);
  const definitionsSql = await readDefinitionsSql(host, context.config.definitions);
  const [desiredSchema, migrationsSchema] = await Promise.all([
    materializeDefinitionsSchemaForContext(host, definitionsSql),
    materializeMigrationsSchemaForContext(host, migrations),
  ]);

  await using database = await host.openDb(context.config);
  const liveSchema = await extractSchema(database.client, 'main', {
    excludedTables: schemaDriftExcludedTables,
  });
  const applied = await readMigrationHistory(database.client);
  const hasAppliedHistory = applied.length > 0;
  const appliedNames = new Set(applied.map((migration) => migration.name));
  const migrationByName = new Map(migrations.map((migration) => [migrationName(migration), migration]));

  const repoDrift = await compareSchemasForContext(host, desiredSchema, migrationsSchema);
  const historyMismatch = await findHistoryMismatch(host, applied, migrations, migrationByName);
  const hasPendingMigrations =
    !historyMismatch && migrations.some((migration) => !appliedNames.has(migrationName(migration)));

  const historicalMigrations = applied
    .map((historical) => migrationByName.get(historical.name))
    .filter((migration): migration is Migration => Boolean(migration));
  const historicalSchema = await materializeMigrationsSchemaForContext(host, historicalMigrations);
  const schemaDrift = await compareSchemasForContext(host, historicalSchema, liveSchema);
  const syncDrift = await compareSchemasForContext(host, desiredSchema, liveSchema);
  const recommendedBaselineTarget = await findRecommendedTarget(host, migrations, liveSchema);
  const recommendedGotoTarget =
    !repoDrift.isDifferent && !historyMismatch && migrations.length > 0 ? migrationName(migrations.at(-1)!) : null;
  const mismatches: CheckMismatch[] = [];
  const recommendations: CheckRecommendation[] = [];

  if (historyMismatch) {
    const problemLine =
      historyMismatch.kind === 'deleted'
        ? `Deleted applied migration: ${historyMismatch.name}`
        : historyMismatch.kind === 'checksumMismatch'
          ? `Applied migration checksum mismatch: ${historyMismatch.name}`
          : `New migration sorts before applied migration: ${historyMismatch.name}`;
    mismatches.push({
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
    const pendingMigrationsWouldResolveSyncDrift =
      mismatches.length === 1 && mismatches[0]?.kind === 'pendingMigrations';
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

async function findHistoryMismatch(
  host: SqlfuHost,
  applied: {name: string; checksum: string}[],
  migrations: Migration[],
  migrationByName: ReadonlyMap<string, Migration>,
) {
  for (const historical of applied) {
    const current = migrationByName.get(historical.name);
    if (!current) {
      return {kind: 'deleted' as const, name: historical.name};
    }
    if ((await host.digest(current.content)) !== historical.checksum) {
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

async function findRecommendedTarget(host: SqlfuHost, migrations: Migration[], liveSchema: string) {
  for (let index = 0; index < migrations.length; index += 1) {
    const candidate = migrations.slice(0, index + 1);
    let candidateSchema: string;
    try {
      candidateSchema = await materializeMigrationsSchemaForContext(host, candidate);
    } catch {
      // a migration in this prefix is broken. it cannot be a trusted target, and any later
      // prefix containing the same migration is also untrustworthy. stop searching.
      return null;
    }
    if (!(await compareSchemasForContext(host, candidateSchema, liveSchema)).isDifferent) {
      return migrationName(candidate.at(-1)!);
    }
  }
  return null;
}

export async function compareSchemasForContext(host: SqlfuHost, left: string, right: string) {
  const [leftInspected, rightInspected] = await Promise.all([
    inspectSqliteSchemaSql(host, left),
    inspectSqliteSchemaSql(host, right),
  ]);

  const isDifferent = !schemasEqual(leftInspected, rightInspected);
  let isSyncable = false;
  if (isDifferent) {
    try {
      const syncPlan = await diffSchemaSql(host, {
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

async function getMigrationIntegrity(
  host: SqlfuHost,
  currentContent: string | undefined,
  appliedChecksum: string | undefined,
) {
  if (!currentContent || !appliedChecksum) {
    return 'checksum mismatch' as const;
  }

  return (await host.digest(currentContent)) === appliedChecksum ? ('ok' as const) : ('checksum mismatch' as const);
}

function summarizeSqlite3defError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const line =
    message
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean)
      .at(-1) ?? message.trim();
  return line.replace(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} /u, '');
}

export interface SqlfuContext {
  config: SqlfuProjectConfig;
  host: SqlfuHost;
}

export interface SqlfuCommandContext {
  projectRoot: string;
  config?: SqlfuProjectConfig;
  host: SqlfuHost;
}

export interface SqlfuRouterContext extends SqlfuContext {}

export interface SqlfuCommandRouterContext extends SqlfuCommandContext {
  confirm: SqlfuCommandConfirm;
}

export function requireContextConfig(context: SqlfuCommandContext): SqlfuContext {
  if (!context.config) {
    throw new Error(`No sqlfu config found in ${context.projectRoot}. Run 'sqlfu init' first.`);
  }

  return {
    config: context.config,
    host: context.host,
  };
}

export type CheckMismatch = {
  kind: 'repoDrift' | 'pendingMigrations' | 'historyDrift' | 'schemaDrift' | 'syncDrift';
  title: 'Repo Drift' | 'Pending Migrations' | 'History Drift' | 'Schema Drift' | 'Sync Drift';
  summary: string;
  details: string[];
};

export type CheckRecommendation = {
  kind:
    | 'draft'
    | 'migrate'
    | 'baseline'
    | 'goto'
    | 'sync'
    | 'restoreMissingMigration'
    | 'restoreOriginalMigration';
  command?: [string, ...string[]];
  label: string;
  rationale?: string;
};

export type CheckAnalysis = {
  mismatches: CheckMismatch[];
  recommendations: CheckRecommendation[];
};

function addRecommendation(target: CheckRecommendation[], recommendation: CheckRecommendation) {
  const commandKey = recommendation.command?.join('\0') ?? '';
  const key = `${recommendation.kind}|${commandKey}|${recommendation.label}|${recommendation.rationale ?? ''}`;
  if (
    target.some(
      (existing) =>
        `${existing.kind}|${existing.command?.join('\0') ?? ''}|${existing.label}|${existing.rationale ?? ''}` === key,
    )
  ) {
    return;
  }
  target.push(recommendation);
}

function withRecommendationExplainers(recommendations: CheckRecommendation[]): CheckRecommendation[] {
  if (recommendations.length < 2) {
    return recommendations;
  }

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

export function formatCheckFailure(analysis: CheckAnalysis) {
  const sections = analysis.mismatches.map((mismatch) =>
    [mismatch.title, mismatch.summary, ...mismatch.details].join('\n'),
  );

  if (analysis.recommendations.length > 0) {
    sections.push(
      [
        'Recommended next actions',
        ...analysis.recommendations.map((recommendation) => `- ${formatRecommendationText(recommendation)}`),
      ].join('\n'),
    );
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

function formatRecommendationCommand(command: [string, ...string[]]) {
  return ['sqlfu', ...command].join(' ');
}

// sqlfu/api is the heavy tier: "all the smart stuff" per the design
// grill. Re-export the public surfaces of schemadiff and the SQL
// formatter so consumers writing CI scripts / editor integrations /
// custom tooling can reach them without deep-importing.
//
// Typegen is NOT re-exported here. typegen/index.ts has `node:*`
// imports, and api.ts is transitively imported by ui/router.ts (via
// uiRouter's handlers), which is in turn imported by ui/browser.ts for
// demo mode. Re-exporting typegen poisons the browser bundle: the
// rollup pass for @sqlfu/ui fails on `pathToFileURL` from node:url
// before tree-shaking can remove the unused re-export. Until the
// follow-up router/handler split lands (see
// scripts/check-strict-imports.ts TODO), consumers who need typegen at
// runtime deep-import `sqlfu/dist/typegen/index.js` — off-piste but
// functional.

export {diffSchemaSql} from './schemadiff/index.js';
export {inspectSqliteSchemaSql, schemasEqual} from './schemadiff/sqlite/index.js';
export type {SqliteInspectedDatabase} from './schemadiff/sqlite/types.js';

export {formatSql} from './formatter.js';
export type {FormatSqlOptions, SqlFormatStyle} from './formatter.js';
