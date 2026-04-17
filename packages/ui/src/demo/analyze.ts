import {extractSchema} from 'sqlfu/browser';
import type {AsyncClient} from 'sqlfu/browser';

import {createScratchDb} from './scratch-db.js';
import {inspectSchemaFromSql, schemasCompareSyncable} from './schema-diff.js';
import {
  applyMigrations,
  migrationChecksum,
  migrationName,
  readMigrationHistory,
  type Migration,
} from './migrations.js';

const schemaDriftExcludedTables = ['sqlfu_migrations'] as const;

async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.error(`[analyze] step "${name}" failed:`, error);
    throw error;
  }
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
    | 'restoreOriginalMigration';
  readonly command?: readonly [string, ...string[]];
  readonly label: string;
  readonly rationale?: string;
};

export type CheckAnalysis = {
  readonly mismatches: readonly CheckMismatch[];
  readonly recommendations: readonly CheckRecommendation[];
};

export async function analyzeDatabase(input: {
  liveClient: AsyncClient;
  definitionsSql: string;
  migrations: readonly Migration[];
}): Promise<CheckAnalysis> {
  const {liveClient, definitionsSql, migrations} = input;

  const desiredSchema = await step('desired', () => materializeSchemaFromDefinitions(definitionsSql));
  const migrationsSchema = await step('migrationsSchema', () => materializeMigrationsSchemaLocal(migrations));

  const liveSchema = await step('liveSchema', () => extractSchema(liveClient, 'main', {excludedTables: schemaDriftExcludedTables}));
  const applied = await step('applied', () => readMigrationHistory(liveClient));
  const hasAppliedHistory = applied.length > 0;
  const appliedNames = new Set(applied.map((migration) => migration.name));
  const migrationByName = new Map(migrations.map((migration) => [migrationName(migration), migration]));

  const repoDrift = await step('repoDrift', () => compareSchemas(desiredSchema, migrationsSchema));
  const historyMismatch = await step('historyMismatch', () => findHistoryMismatch(applied, migrationByName));
  const hasPendingMigrations = !historyMismatch && migrations.some((migration) => !appliedNames.has(migrationName(migration)));

  const historicalMigrations = applied
    .map((historical) => migrationByName.get(historical.name))
    .filter((migration): migration is Migration => Boolean(migration));
  const historicalSchema = await step('historicalSchema', () => materializeMigrationsSchemaLocal(historicalMigrations));
  const schemaDrift = await step('schemaDrift', () => compareSchemas(historicalSchema, liveSchema));
  const syncDrift = await step('syncDrift', () => compareSchemas(desiredSchema, liveSchema));
  const recommendedBaselineTarget = await step('recommendedBaselineTarget', () => findRecommendedTarget(migrations, liveSchema));
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
        label: 'Record the current schema as already applied.',
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
    const pendingMigrationsWouldResolveSyncDrift = mismatches.length === 1 && mismatches[0]?.kind === 'pendingMigrations';
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

export async function findRecommendedTarget(migrations: readonly Migration[], liveSchema: string): Promise<string | null> {
  for (let index = 0; index < migrations.length; index += 1) {
    const candidate = migrations.slice(0, index + 1);
    const candidateSchema = await materializeMigrationsSchemaLocal(candidate);
    if (!(await compareSchemas(candidateSchema, liveSchema)).isDifferent) {
      return migrationName(candidate.at(-1)!);
    }
  }
  return null;
}

async function findHistoryMismatch(
  applied: readonly {name: string; checksum: string}[],
  migrationByName: ReadonlyMap<string, Migration>,
) {
  for (const historical of applied) {
    const current = migrationByName.get(historical.name);
    if (!current) {
      return {kind: 'deleted' as const, name: historical.name};
    }
    if ((await migrationChecksum(current.content)) !== historical.checksum) {
      return {kind: 'checksumMismatch' as const, name: historical.name};
    }
  }
  return null;
}

async function materializeSchemaFromDefinitions(definitionsSql: string): Promise<string> {
  await using scratch = await createScratchDb();
  if (definitionsSql.trim()) {
    await scratch.client.raw(definitionsSql);
  }
  return await extractSchema(scratch.client, 'main', {excludedTables: schemaDriftExcludedTables});
}

async function materializeMigrationsSchemaLocal(migrations: readonly Migration[]): Promise<string> {
  await using scratch = await createScratchDb();
  await applyMigrations(scratch.client, {migrations});
  return await extractSchema(scratch.client, 'main', {excludedTables: schemaDriftExcludedTables});
}

async function compareSchemas(left: string, right: string) {
  const [leftInspected, rightInspected] = await Promise.all([
    inspectSchemaFromSql(left),
    inspectSchemaFromSql(right),
  ]);
  return schemasCompareSyncable({left: leftInspected, right: rightInspected, allowDestructive: true});
}

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
    case 'goto':
      return 'Addresses Schema Drift';
    case 'sync':
      return 'Addresses Sync Drift';
    case 'restoreMissingMigration':
    case 'restoreOriginalMigration':
      return 'Addresses History Drift';
  }
}
