import type {SqlfuProjectConfig} from './core/types.js';
import type {SqlfuHost} from './core/host.js';
import {basename, joinPath} from './core/paths.js';
import {createDefaultInitPreview} from './core/init-preview.js';
import {migrationNickname} from './core/naming.js';
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
import {inspectSqliteSchemaSql, schemasEqual} from './schemadiff/sqlite/index.js';

const schemaDriftExcludedTables = ['sqlfu_migrations'] as const;

export async function getCheckMismatches(context: SqlfuContext): Promise<readonly CheckMismatch[]> {
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

  const migrationEntries = await Promise.all(migrations.map(async (migration) => {
    const name = migrationName(migration);
    const appliedEntry = appliedByName.get(name);
    return {
      id: name,
      fileName: basename(migration.path),
      content: migration.content,
      applied: appliedByName.has(name),
      appliedAt: appliedEntry?.appliedAt ?? null,
      integrity: appliedEntry
        ? await getMigrationIntegrity(context.host, migration.content, appliedEntry.checksum)
        : null,
    };
  }));

  const historyEntries = await Promise.all(applied.map(async (migration) => {
    const current = migrationByName.get(migration.name);
    return {
      id: migration.name,
      fileName: current ? basename(current.path) : null,
      content: current?.content ?? '-- migration file missing from repo',
      applied: true,
      appliedAt: migration.appliedAt,
      integrity: await getMigrationIntegrity(context.host, current?.content, migration.checksum),
    };
  }));

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
    const analysis = await analyzeDatabase(initializedContext);
    if (analysis.mismatches.length > 0) {
      throw new Error(formatCheckFailure(analysis));
    }
    return;
  }

  throw new Error(`Unsupported sqlfu command: ${command}`);
}

export async function readMigrationsFromContext(context: SqlfuContext): Promise<Migration[]> {
  let fileNames: string[];
  try {
    fileNames = (await context.host.fs.readdir(context.config.migrations))
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
    const filePath = joinPath(context.config.migrations, fileName);
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
  const baselineSql = migrations.length === 0 ? '' : await materializeMigrationsSchemaForContext(context.host, migrations);
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
  const fileName = `${getMigrationPrefix(context.host.now())}_${slugify(input?.name ?? migrationNickname(body))}.sql`;
  await context.host.fs.mkdir(context.config.migrations);
  await context.host.fs.writeFile(joinPath(context.config.migrations, fileName), `${body.trim()}\n`);
}

export async function applySyncSql(
  context: SqlfuContext,
  confirm: SqlfuCommandConfirm,
) {
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

export async function applyMigrateSql(
  context: SqlfuContext,
  confirm: SqlfuCommandConfirm,
) {
  const migrations = await readMigrationsFromContext(context);
  await using database = await context.host.openDb(context.config);
  const applied = await readMigrationHistory(database.client);
  const appliedNames = new Set(applied.map((migration) => migration.name));
  const pendingMigrations = migrations.filter((migration) => !appliedNames.has(migrationName(migration)));
  if (pendingMigrations.length > 0) {
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
  }
  // apply migrations even if there are zero pending, because this will validate migration history
  await applyMigrations(context.host, database.client, {migrations});
}

export async function applyBaselineSql(
  context: SqlfuContext,
  input: {target: string},
  confirm: SqlfuCommandConfirm,
) {
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
  await baselineMigrationHistory(context.host, database.client, {migrations, target: input.target});
}

export async function applyGotoSql(
  context: SqlfuContext,
  input: {target: string},
  confirm: SqlfuCommandConfirm,
) {
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
    await replaceMigrationHistory(context.host, tx, targetMigrations);
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

export async function materializeDefinitionsSchemaForContext(host: SqlfuHost, definitionsSql: string) {
  await using database = await host.openScratchDb('materialize-definitions');
  await database.client.raw(definitionsSql);
  return await extractSchema(database.client, 'main', {
    excludedTables: schemaDriftExcludedTables,
  });
}

export async function materializeMigrationsSchemaForContext(host: SqlfuHost, migrations: readonly Migration[]) {
  await using database = await host.openScratchDb('materialize-migrations');
  await applyMigrations(host, database.client, {migrations});
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
  const historyMismatch = await findHistoryMismatch(host, applied, migrationByName);
  const hasPendingMigrations = !historyMismatch && migrations.some((migration) => !appliedNames.has(migrationName(migration)));

  const historicalMigrations = applied
    .map((historical) => migrationByName.get(historical.name))
    .filter((migration): migration is Migration => Boolean(migration));
  const historicalSchema = await materializeMigrationsSchemaForContext(host, historicalMigrations);
  const schemaDrift = await compareSchemasForContext(host, historicalSchema, liveSchema);
  const syncDrift = await compareSchemasForContext(host, desiredSchema, liveSchema);
  const recommendedBaselineTarget = await findRecommendedTarget(host, migrations, liveSchema);
  const recommendedGotoTarget = !repoDrift.isDifferent && !historyMismatch && migrations.length > 0
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
      details: [problemLine],
    });

    if (historyMismatch.kind === 'deleted') {
      addRecommendation(recommendations, {
        kind: 'restoreMissingMigration',
        label: 'Restore the missing migration from version control.',
      });
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

async function findHistoryMismatch(
  host: SqlfuHost,
  applied: readonly {name: string; checksum: string}[],
  migrationByName: ReadonlyMap<string, Migration>,
) {
  for (const historical of applied) {
    const current = migrationByName.get(historical.name);
    if (!current) {
      return {kind: 'deleted' as const, name: historical.name};
    }
    if (await host.digest(current.content) !== historical.checksum) {
      return {kind: 'checksumMismatch' as const, name: historical.name};
    }
  }
  return null;
}

async function findRecommendedTarget(host: SqlfuHost, migrations: readonly Migration[], liveSchema: string) {
  for (let index = 0; index < migrations.length; index += 1) {
    const candidate = migrations.slice(0, index + 1);
    const candidateSchema = await materializeMigrationsSchemaForContext(host, candidate);
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

async function getMigrationIntegrity(host: SqlfuHost, currentContent: string | undefined, appliedChecksum: string | undefined) {
  if (!currentContent || !appliedChecksum) {
    return 'checksum mismatch' as const;
  }

  return await host.digest(currentContent) === appliedChecksum ? 'ok' as const : 'checksum mismatch' as const;
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
  readonly host: SqlfuHost;
}

export interface SqlfuCommandContext {
  readonly projectRoot: string;
  readonly config?: SqlfuProjectConfig;
  readonly host: SqlfuHost;
}

export interface SqlfuRouterContext extends SqlfuContext {}

export interface SqlfuCommandRouterContext extends SqlfuCommandContext {
  readonly confirm: SqlfuCommandConfirm;
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
