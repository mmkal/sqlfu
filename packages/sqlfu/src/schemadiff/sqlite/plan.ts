/*
 * SQLite-specific schemadiff planning and statement rendering.
 * This file owns deciding what operations are needed for SQLite schema changes and ordering them deterministically.
 *
 * Inspired by @pgkit/migra (https://github.com/mmkal/pgkit/tree/main/packages/migra), a TypeScript port of djrobstep's
 * Python `migra` (https://github.com/djrobstep/migra). The table-rebuild strategy and the "drop and recreate dependents
 * even when their text did not change" ordering are specific to SQLite and do not come from upstream. What is borrowed is
 * the general approach of producing an ordered plan from compared inspected models rather than from raw SQL diffs.
 */
import {graphSequencer} from '../graph-sequencer.js';
import {
  analyzeColumnDropDependencies,
  analyzeTriggerDependencies,
  analyzeViewDependencies,
  directViewDependencies,
  tableHasCheckConstraintReferencingColumns,
  triggerSelectableNames,
} from './analysis.js';
import {maybeQuoteIdentifier, renderTableName} from './identifiers.js';
import {normalizeComparableSql, sqlMentionsIdentifier} from './sqltext.js';
import type {
  SqliteDependencyFact,
  SchemadiffOperation,
  SchemadiffReason,
  SqliteInspectedColumn,
  SqliteInspectedDatabase,
  SqliteInspectedIndex,
  SqliteInspectedTable,
  SqliteInspectedTrigger,
  SqliteInspectedView,
} from './types.js';

const formatReason = (reason: SchemadiffReason): string =>
  `${reason.verb} ${reason.resourceType} "${reason.resourceName}": ${reason.explanation}`;

export function planSchemaDiff(input: {
  baseline: SqliteInspectedDatabase;
  desired: SqliteInspectedDatabase;
  allowDestructive: boolean;
}): string[] {
  const baselineViewDependencyFacts = analyzeViewDependencies(input.baseline);
  const desiredViewDependencyFacts = analyzeViewDependencies(input.desired);
  const baselineTriggerDependencyFacts = analyzeTriggerDependencies(input.baseline, baselineViewDependencyFacts);
  const desiredTriggerDependencyFacts = analyzeTriggerDependencies(input.desired, desiredViewDependencyFacts);
  const statements: string[] = [];
  const removedViewNames = sortedRemovedKeys(input.baseline.views, input.desired.views);
  const addedViewNames = sortedAddedKeys(input.baseline.views, input.desired.views);
  const modifiedViewNames = sortedModifiedKeys(input.baseline.views, input.desired.views, viewEquals);
  const removedTriggerNames = sortedRemovedKeys(input.baseline.triggers, input.desired.triggers);
  const addedTriggerNames = sortedAddedKeys(input.baseline.triggers, input.desired.triggers);
  const modifiedTriggerNames = sortedModifiedKeys(input.baseline.triggers, input.desired.triggers, triggerEquals);

  const removedTableNames = Object.keys(input.baseline.tables)
    .filter((name) => !(name in input.desired.tables))
    .sort((left, right) => left.localeCompare(right));
  const addedTableNames = topologicallySortTables(input.desired.tables).filter(
    (name) => !(name in input.baseline.tables),
  );
  const commonTableNames = Object.keys(input.desired.tables)
    .filter((name) => name in input.baseline.tables)
    .sort((left, right) => left.localeCompare(right));

  const changedTables = new Set<string>();
  const rebuiltTables = new Set<string>();
  const explicitIndexDrops: string[] = [];
  const explicitIndexCreates: string[] = [];
  const handledRemovedViewNames = new Set<string>();
  const handledRemovedTriggerNames = new Set<string>();
  const handledCreatedViewNames = new Set<string>();
  const handledCreatedTriggerNames = new Set<string>();

  for (const tableName of commonTableNames) {
    const baselineTable = input.baseline.tables[tableName]!;
    const desiredTable = input.desired.tables[tableName]!;
    const classification = classifyTableChange({
      tableName,
      baseline: input.baseline,
      desired: input.desired,
      baselineTable,
      desiredTable,
      baselineViewDependencyFacts,
      desiredViewDependencyFacts,
      baselineTriggerDependencyFacts,
      desiredTriggerDependencyFacts,
    });

    if (classification.kind !== 'none') {
      changedTables.add(tableName);
    }

    if (classification.kind === 'add-columns') {
      for (const column of classification.columns) {
        statements.push(`alter table ${maybeQuoteIdentifier(tableName)} add column ${columnDefinition(column)};`);
      }
      collectExplicitIndexChanges(baselineTable, desiredTable, explicitIndexDrops, explicitIndexCreates);
      continue;
    }

    if (classification.kind === 'drop-columns') {
      if (!input.allowDestructive) {
        throw new Error(`destructive schema change required for table ${tableName}`);
      }
      classification.handledRemovedViewNames.forEach((name) => handledRemovedViewNames.add(name));
      classification.handledRemovedTriggerNames.forEach((name) => handledRemovedTriggerNames.add(name));
      classification.handledCreatedViewNames.forEach((name) => handledCreatedViewNames.add(name));
      classification.handledCreatedTriggerNames.forEach((name) => handledCreatedTriggerNames.add(name));
      pushStatements(statements, orderOperations(classification.operations));
      continue;
    }

    if (classification.kind === 'rebuild') {
      if (!input.allowDestructive) {
        throw new Error(`destructive schema change required for table ${tableName}`);
      }
      rebuiltTables.add(tableName);
      pushStatements(statements, planTableRebuild(baselineTable, desiredTable, classification.reason));
    }
  }

  // Views whose baseline SQL directly references a rebuilt table are rewritten by SQLite during
  // `alter table ... rename to ...` to point at the temporary name, so we must drop and recreate
  // them around the rebuild. Transitive dependents must also be dropped (and recreated) because
  // SQLite's rename does a validation pass that re-parses every dependent view.
  const recreatedViewNames = transitiveViewDependents(
    [...rebuiltTables],
    baselineViewDependencyFacts,
    input.baseline.views,
  )
    .filter((viewName) => viewName in input.desired.views)
    .filter((viewName) => !modifiedViewNames.includes(viewName))
    .sort((left, right) => left.localeCompare(right));

  const recreatedTriggerNames = Object.entries(input.desired.triggers)
    .filter(
      ([, trigger]) =>
        rebuiltTables.has(trigger.onName) ||
        modifiedViewNames.includes(trigger.onName) ||
        recreatedViewNames.includes(trigger.onName),
    )
    .map(([triggerName]) => triggerName)
    .sort((left, right) => left.localeCompare(right));

  const viewCascadeExplanations = new Map<string, string>();
  for (const tableName of [...rebuiltTables].sort((left, right) => left.localeCompare(right))) {
    const dependents = transitiveViewDependents([tableName], baselineViewDependencyFacts, input.baseline.views);
    for (const viewName of dependents) {
      if (recreatedViewNames.includes(viewName) && !viewCascadeExplanations.has(viewName)) {
        viewCascadeExplanations.set(viewName, `table "${tableName}" needs rebuild`);
      }
    }
  }

  const triggerCascadeExplanations = new Map<string, string>();
  for (const triggerName of recreatedTriggerNames) {
    if (modifiedTriggerNames.includes(triggerName)) {
      continue;
    }
    const trigger = input.desired.triggers[triggerName]!;
    if (rebuiltTables.has(trigger.onName)) {
      triggerCascadeExplanations.set(triggerName, `table "${trigger.onName}" needs rebuild`);
    } else if (modifiedViewNames.includes(trigger.onName)) {
      triggerCascadeExplanations.set(triggerName, `view "${trigger.onName}" changing`);
    } else if (recreatedViewNames.includes(trigger.onName)) {
      triggerCascadeExplanations.set(triggerName, `view "${trigger.onName}" recreating`);
    }
  }

  for (const tableName of commonTableNames) {
    if (changedTables.has(tableName)) {
      continue;
    }
    const baselineTable = input.baseline.tables[tableName]!;
    const desiredTable = input.desired.tables[tableName]!;
    collectExplicitIndexChanges(baselineTable, desiredTable, explicitIndexDrops, explicitIndexCreates);
  }

  const needsDestructive =
    removedTriggerNames.length > 0 ||
    removedViewNames.length > 0 ||
    removedTableNames.length > 0 ||
    modifiedViewNames.length > 0 ||
    modifiedTriggerNames.length > 0 ||
    explicitIndexDrops.length > 0;

  if (needsDestructive && !input.allowDestructive) {
    throw new Error('destructive schema changes are not allowed');
  }

  const prefixes: string[] = [];

  for (const triggerName of new Set(
    [...removedTriggerNames, ...modifiedTriggerNames, ...recreatedTriggerNames].sort((left, right) =>
      left.localeCompare(right),
    ),
  )) {
    if (handledRemovedTriggerNames.has(triggerName)) {
      continue;
    }
    const explanation = triggerCascadeExplanations.get(triggerName);
    if (explanation) {
      prefixes.push(
        `-- ${formatReason({verb: 'dropping', resourceType: 'trigger', resourceName: triggerName, explanation})}`,
      );
    }
    prefixes.push(`drop trigger ${maybeQuoteIdentifier(triggerName)};`);
  }

  for (const viewName of [...new Set([...removedViewNames, ...modifiedViewNames, ...recreatedViewNames])].sort(
    (left, right) => left.localeCompare(right),
  )) {
    if (handledRemovedViewNames.has(viewName)) {
      continue;
    }
    const explanation = viewCascadeExplanations.get(viewName);
    if (explanation) {
      prefixes.push(
        `-- ${formatReason({verb: 'dropping', resourceType: 'view', resourceName: viewName, explanation})}`,
      );
    }
    prefixes.push(`drop view ${maybeQuoteIdentifier(viewName)};`);
  }

  for (const indexStatement of explicitIndexDrops.sort((left, right) => left.localeCompare(right))) {
    prefixes.push(indexStatement);
  }

  for (const tableName of addedTableNames) {
    statements.push(withSemicolon(input.desired.tables[tableName]!.createSql));
    for (const index of Object.values(input.desired.tables[tableName]!.indexes).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      explicitIndexCreates.push(withSemicolon(index.createSql));
    }
  }

  for (const tableName of removedTableNames) {
    statements.push(`drop table ${maybeQuoteIdentifier(tableName)};`);
  }

  for (const createIndex of explicitIndexCreates) {
    statements.push(createIndex);
  }

  for (const viewName of [...new Set([...addedViewNames, ...modifiedViewNames, ...recreatedViewNames])].sort(
    (left, right) => left.localeCompare(right),
  )) {
    if (handledCreatedViewNames.has(viewName)) {
      continue;
    }
    const explanation = viewCascadeExplanations.get(viewName);
    if (explanation) {
      statements.push(
        `-- ${formatReason({verb: 'recreating', resourceType: 'view', resourceName: viewName, explanation})}`,
      );
    }
    statements.push(withSemicolon(input.desired.views[viewName]!.createSql));
  }

  for (const triggerName of new Set(
    [...addedTriggerNames, ...modifiedTriggerNames, ...recreatedTriggerNames].sort((left, right) =>
      left.localeCompare(right),
    ),
  )) {
    if (handledCreatedTriggerNames.has(triggerName)) {
      continue;
    }
    const explanation = triggerCascadeExplanations.get(triggerName);
    if (explanation) {
      statements.push(
        `-- ${formatReason({verb: 'recreating', resourceType: 'trigger', resourceName: triggerName, explanation})}`,
      );
    }
    statements.push(withSemicolon(input.desired.triggers[triggerName]!.createSql));
  }

  return [...prefixes, ...statements].flatMap(splitStatementForOutput).filter(Boolean);
}

function collectExplicitIndexChanges(
  baselineTable: SqliteInspectedTable,
  desiredTable: SqliteInspectedTable,
  explicitIndexDrops: string[],
  explicitIndexCreates: string[],
): void {
  const baselineIndexes = baselineTable.indexes;
  const desiredIndexes = desiredTable.indexes;

  for (const indexName of sortedRemovedKeys(baselineIndexes, desiredIndexes)) {
    explicitIndexDrops.push(`drop index ${maybeQuoteIdentifier(indexName)};`);
  }

  for (const indexName of sortedModifiedKeys(baselineIndexes, desiredIndexes, indexEquals)) {
    explicitIndexDrops.push(`drop index ${maybeQuoteIdentifier(indexName)};`);
    explicitIndexCreates.push(withSemicolon(desiredIndexes[indexName]!.createSql));
  }

  for (const indexName of sortedAddedKeys(baselineIndexes, desiredIndexes)) {
    explicitIndexCreates.push(withSemicolon(desiredIndexes[indexName]!.createSql));
  }
}

function classifyTableChange(input: {
  tableName: string;
  baseline: SqliteInspectedDatabase;
  desired: SqliteInspectedDatabase;
  baselineTable: SqliteInspectedTable;
  desiredTable: SqliteInspectedTable;
  baselineViewDependencyFacts: SqliteDependencyFact[];
  desiredViewDependencyFacts: SqliteDependencyFact[];
  baselineTriggerDependencyFacts: SqliteDependencyFact[];
  desiredTriggerDependencyFacts: SqliteDependencyFact[];
}):
  | {kind: 'none'}
  | {kind: 'add-columns'; columns: SqliteInspectedColumn[]}
  | {
      kind: 'drop-columns';
      operations: SchemadiffOperation[];
      handledRemovedViewNames: string[];
      handledRemovedTriggerNames: string[];
      handledCreatedViewNames: string[];
      handledCreatedTriggerNames: string[];
    }
  | {kind: 'rebuild'; reason: SchemadiffReason} {
  const {
    tableName,
    baseline,
    desired,
    baselineTable,
    desiredTable,
    baselineViewDependencyFacts,
    desiredViewDependencyFacts,
    baselineTriggerDependencyFacts,
    desiredTriggerDependencyFacts,
  } = input;

  if (tableCoreEquals(baselineTable, desiredTable)) {
    return {kind: 'none'};
  }

  if (
    arraysEqual(baselineTable.primaryKey, desiredTable.primaryKey) &&
    stableStringify(baselineTable.uniqueConstraints) === stableStringify(desiredTable.uniqueConstraints) &&
    stableStringify(baselineTable.foreignKeys) === stableStringify(desiredTable.foreignKeys) &&
    baselineTable.columns.length <= desiredTable.columns.length &&
    baselineTable.columns.every((column, index) => columnEquals(column, desiredTable.columns[index]!))
  ) {
    const addedColumns = desiredTable.columns.slice(baselineTable.columns.length);
    const canAddColumns = addedColumns.every((column) => !column.generated && column.hidden === 0);
    if (canAddColumns) {
      return {kind: 'add-columns', columns: addedColumns};
    }
  }

  const desiredColumnNames = new Set(desiredTable.columns.map((column) => column.name));
  const removedColumns = baselineTable.columns.filter((column) => !desiredColumnNames.has(column.name));
  const keptBaselineColumns = baselineTable.columns.filter((column) => desiredColumnNames.has(column.name));
  const pureColumnRemoval =
    removedColumns.length > 0 &&
    keptBaselineColumns.length === desiredTable.columns.length &&
    keptBaselineColumns.every((column, index) => columnEquals(column, desiredTable.columns[index]!)) &&
    arraysEqual(baselineTable.primaryKey, desiredTable.primaryKey) &&
    stableStringify(baselineTable.uniqueConstraints) === stableStringify(desiredTable.uniqueConstraints) &&
    stableStringify(baselineTable.foreignKeys) === stableStringify(desiredTable.foreignKeys);

  if (
    pureColumnRemoval &&
    canUseDirectDropColumn({
      baseline,
      desired,
      baselineTable,
      desiredTable,
      removedColumns,
    })
  ) {
    return {
      kind: 'drop-columns',
      ...planDirectDropColumnOperations({
        tableName,
        baseline,
        desired,
        baselineTable,
        desiredTable,
        removedColumns,
        baselineViewDependencyFacts,
        desiredViewDependencyFacts,
        baselineTriggerDependencyFacts,
        desiredTriggerDependencyFacts,
      }),
    };
  }

  return {
    kind: 'rebuild',
    reason: {
      verb: 'rebuilding',
      resourceType: 'table',
      resourceName: desiredTable.name,
      explanation: diagnoseRebuildExplanation(baselineTable, desiredTable),
    },
  };
}

function diagnoseRebuildExplanation(baseline: SqliteInspectedTable, desired: SqliteInspectedTable): string {
  if (!arraysEqual(baseline.primaryKey, desired.primaryKey)) {
    return 'primary key changed';
  }
  if (stableStringify(baseline.uniqueConstraints) !== stableStringify(desired.uniqueConstraints)) {
    return 'unique constraints changed';
  }
  if (stableStringify(baseline.foreignKeys) !== stableStringify(desired.foreignKeys)) {
    return 'foreign keys changed';
  }

  const baselineByName = new Map(baseline.columns.map((column) => [column.name, column]));
  const desiredByName = new Map(desired.columns.map((column) => [column.name, column]));
  const droppedNames = baseline.columns
    .filter((column) => !desiredByName.has(column.name))
    .map((column) => column.name);
  const addedColumns = desired.columns.filter((column) => !baselineByName.has(column.name));

  for (const desiredColumn of desired.columns) {
    const baselineColumn = baselineByName.get(desiredColumn.name);
    if (!baselineColumn || columnEquals(baselineColumn, desiredColumn)) {
      continue;
    }
    return describeColumnChange(baselineColumn, desiredColumn);
  }

  if (droppedNames.length > 0) {
    const quoted = droppedNames.map((name) => `"${name}"`).join(', ');
    const noun = droppedNames.length === 1 ? 'column' : 'columns';
    return `${noun} ${quoted} dropped (cannot drop in place)`;
  }

  for (const addedColumn of addedColumns) {
    if (addedColumn.generated) {
      return `new column "${addedColumn.name}" is generated`;
    }
    if (addedColumn.hidden !== 0) {
      return `new column "${addedColumn.name}" is hidden`;
    }
  }

  return 'columns reordered';
}

function columnRemovalExplanation(tableName: string, removedColumnNames: Set<string>): string {
  const sorted = [...removedColumnNames].sort((left, right) => left.localeCompare(right));
  const list = sorted.map((name) => `"${name}"`).join(', ');
  const noun = sorted.length === 1 ? 'column' : 'columns';
  return `table "${tableName}" removing ${noun} ${list}`;
}

function describeColumnChange(baseline: SqliteInspectedColumn, desired: SqliteInspectedColumn): string {
  const name = desired.name;
  if (baseline.declaredType !== desired.declaredType) {
    const from = baseline.declaredType || '<none>';
    const to = desired.declaredType || '<none>';
    return `column "${name}" type changed from ${from} to ${to}`;
  }
  if ((baseline.collation || '') !== (desired.collation || '')) {
    const from = baseline.collation || 'default';
    const to = desired.collation || 'default';
    return `column "${name}" collation changed from ${from} to ${to}`;
  }
  if (baseline.notNull !== desired.notNull) {
    return `column "${name}" not-null ${desired.notNull ? 'added' : 'removed'}`;
  }
  if (baseline.defaultSql !== desired.defaultSql) {
    return `column "${name}" default changed`;
  }
  if (Boolean(baseline.generated) !== Boolean(desired.generated)) {
    return `column "${name}" generated expression ${desired.generated ? 'added' : 'removed'}`;
  }
  if (baseline.hidden !== desired.hidden) {
    return `column "${name}" hidden status changed`;
  }
  return `column "${name}" definition changed`;
}

function canUseDirectDropColumn(input: {
  baseline: SqliteInspectedDatabase;
  desired: SqliteInspectedDatabase;
  baselineTable: SqliteInspectedTable;
  desiredTable: SqliteInspectedTable;
  removedColumns: SqliteInspectedColumn[];
}): boolean {
  const {baselineTable, desiredTable, removedColumns} = input;

  if (removedColumns.length === 0) {
    return false;
  }

  const removedColumnNames = new Set(removedColumns.map((column) => column.name));

  if (
    tableHasCheckConstraintReferencingColumns(baselineTable.createSql, removedColumnNames) ||
    tableHasCheckConstraintReferencingColumns(desiredTable.createSql, removedColumnNames)
  ) {
    return false;
  }

  if (
    baselineTable.columns.some((column) => column.generated || column.hidden !== 0) ||
    desiredTable.columns.some((column) => column.generated || column.hidden !== 0)
  ) {
    return false;
  }

  if (baselineTable.primaryKey.some((columnName) => removedColumnNames.has(columnName))) {
    return false;
  }

  if (
    baselineTable.uniqueConstraints.some((constraint) =>
      constraint.columns.some((columnName) => removedColumnNames.has(columnName)),
    )
  ) {
    return false;
  }

  if (
    baselineTable.foreignKeys.some((foreignKey) =>
      foreignKey.columns.some((columnName) => removedColumnNames.has(columnName)),
    )
  ) {
    return false;
  }

  if (
    Object.values(baselineTable.indexes).some((index) =>
      removedColumns.some((column) => index.where != null && sqlMentionsIdentifier(index.where, column.name)),
    )
  ) {
    return false;
  }

  return true;
}

function planDirectDropColumnOperations(input: {
  tableName: string;
  baseline: SqliteInspectedDatabase;
  desired: SqliteInspectedDatabase;
  baselineTable: SqliteInspectedTable;
  desiredTable: SqliteInspectedTable;
  removedColumns: SqliteInspectedColumn[];
  baselineViewDependencyFacts: SqliteDependencyFact[];
  desiredViewDependencyFacts: SqliteDependencyFact[];
  baselineTriggerDependencyFacts: SqliteDependencyFact[];
  desiredTriggerDependencyFacts: SqliteDependencyFact[];
}): {
  operations: SchemadiffOperation[];
  handledRemovedViewNames: string[];
  handledRemovedTriggerNames: string[];
  handledCreatedViewNames: string[];
  handledCreatedTriggerNames: string[];
} {
  const {
    tableName,
    baseline,
    desired,
    baselineTable,
    desiredTable,
    removedColumns,
    baselineViewDependencyFacts,
    desiredViewDependencyFacts,
    baselineTriggerDependencyFacts,
    desiredTriggerDependencyFacts,
  } = input;
  const removedColumnNames = new Set(removedColumns.map((column) => column.name));
  const cascadeExplanation = columnRemovalExplanation(tableName, removedColumnNames);
  const cascadeReason = (
    verb: 'dropping' | 'recreating',
    resourceType: 'view' | 'trigger' | 'index',
    resourceName: string,
  ): SchemadiffReason => ({verb, resourceType, resourceName, explanation: cascadeExplanation});
  const operations: SchemadiffOperation[] = [];
  const blockerDropIds: string[] = [];
  const handledRemovedViewNames: string[] = [];
  const handledRemovedTriggerNames: string[] = [];
  const handledCreatedViewNames: string[] = [];
  const handledCreatedTriggerNames: string[] = [];
  const baselineAnalysis = analyzeColumnDropDependencies({tableName, removedColumnNames, schema: baseline});
  const desiredAffectedViews = baselineAnalysis.affectedViewNames
    .map((viewName) => desired.views[viewName]!)
    .filter(Boolean);
  const baselineAffectedViews = baselineAnalysis.affectedViewNames
    .map((viewName) => baseline.views[viewName]!)
    .filter(Boolean);
  const baselineAffectedViewNames = new Set(baselineAffectedViews.map((view) => view.name));
  const desiredAffectedViewNames = new Set(desiredAffectedViews.map((view) => view.name));
  const baselineDropViewIds = new Map(baselineAffectedViews.map((view) => [view.name, `drop-view:${view.name}`]));
  const desiredCreateViewIds = new Map(desiredAffectedViews.map((view) => [view.name, `create-view:${view.name}`]));

  for (const index of Object.values(baselineTable.indexes).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!index.columns.some((columnName) => removedColumnNames.has(columnName))) {
      continue;
    }

    const id = `drop-index:${tableName}:${index.name}`;
    blockerDropIds.push(id);
    operations.push({
      id,
      kind: 'drop-index',
      sql: `drop index ${maybeQuoteIdentifier(index.name)};`,
      reason: cascadeReason('dropping', 'index', index.name),
      dependencies: [],
    });
  }

  const baselineTriggers = baselineAnalysis.affectedTriggerNames
    .map((triggerName) => baseline.triggers[triggerName]!)
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const trigger of baselineTriggers) {
    const id = `drop-trigger:${trigger.name}`;
    blockerDropIds.push(id);
    handledRemovedTriggerNames.push(trigger.name);
    operations.push({
      id,
      kind: 'drop-trigger',
      sql: `drop trigger ${maybeQuoteIdentifier(trigger.name)};`,
      reason: cascadeReason('dropping', 'trigger', trigger.name),
      dependencies: [],
    });
  }

  const dropTriggerIdsBySelectable = new Map<string, string[]>();
  for (const trigger of baselineTriggers) {
    const names = triggerSelectableNames(trigger.name, baselineAffectedViewNames, baselineTriggerDependencyFacts);
    for (const name of names) {
      const existing = dropTriggerIdsBySelectable.get(name) || [];
      existing.push(`drop-trigger:${trigger.name}`);
      dropTriggerIdsBySelectable.set(name, existing);
    }
  }

  for (const view of orderViewsForDrop(baselineAffectedViews, baseline)) {
    const id = `drop-view:${view.name}`;
    const dependencies = [...(dropTriggerIdsBySelectable.get(view.name) || [])];
    for (const dependentView of baselineAffectedViews) {
      if (!directViewDependencies(dependentView.name, baselineViewDependencyFacts).includes(view.name)) {
        continue;
      }

      const dependentDropId = baselineDropViewIds.get(dependentView.name);
      if (dependentDropId && dependentDropId !== id) {
        dependencies.push(dependentDropId);
      }
    }

    blockerDropIds.push(id);
    handledRemovedViewNames.push(view.name);
    operations.push({
      id,
      kind: 'drop-view',
      sql: `drop view ${maybeQuoteIdentifier(view.name)};`,
      reason: cascadeReason('dropping', 'view', view.name),
      dependencies: [...new Set(dependencies)].sort((left, right) => left.localeCompare(right)),
    });
  }

  const dropColumnId = `drop-column:${tableName}:${[...removedColumnNames].sort().join(',')}`;
  operations.push({
    id: dropColumnId,
    kind: 'drop-column',
    sql: removedColumns
      .map(
        (column) => `alter table ${maybeQuoteIdentifier(tableName)} drop column ${maybeQuoteIdentifier(column.name)};`,
      )
      .join('\n'),
    dependencies: blockerDropIds,
  });

  for (const index of Object.values(desiredTable.indexes).sort((left, right) => left.name.localeCompare(right.name))) {
    const baselineIndex = baselineTable.indexes[index.name];
    if (baselineIndex && indexEquals(baselineIndex, index)) {
      continue;
    }

    operations.push({
      id: `create-index:${tableName}:${index.name}`,
      kind: 'create-index',
      sql: withSemicolon(index.createSql),
      reason: cascadeReason('recreating', 'index', index.name),
      dependencies: [dropColumnId],
    });
  }

  for (const view of orderViewsForCreate(desiredAffectedViews, desired)) {
    handledCreatedViewNames.push(view.name);
    const dependencies = [dropColumnId];
    for (const dependencyName of directViewDependencies(view.name, desiredViewDependencyFacts)) {
      const viewDependency = desiredCreateViewIds.get(dependencyName);
      if (viewDependency) {
        dependencies.push(viewDependency);
      }
    }

    operations.push({
      id: desiredCreateViewIds.get(view.name)!,
      kind: 'create-view',
      sql: withSemicolon(view.createSql),
      reason: cascadeReason('recreating', 'view', view.name),
      dependencies: [...new Set(dependencies)].sort((left, right) => left.localeCompare(right)),
    });
  }

  const desiredTriggerNames = baselineAnalysis.affectedTriggerNames.filter(
    (triggerName) => triggerName in desired.triggers,
  );
  for (const trigger of desiredTriggerNames
    .map((triggerName) => desired.triggers[triggerName]!)
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const dependencies = [dropColumnId];
    for (const selectableName of triggerSelectableNames(
      trigger.name,
      desiredAffectedViewNames,
      desiredTriggerDependencyFacts,
    )) {
      const viewDependency = desiredCreateViewIds.get(selectableName);
      if (viewDependency) {
        dependencies.push(viewDependency);
      }
    }

    handledCreatedTriggerNames.push(trigger.name);
    operations.push({
      id: `create-trigger:${trigger.name}`,
      kind: 'create-trigger',
      sql: withSemicolon(trigger.createSql),
      reason: cascadeReason('recreating', 'trigger', trigger.name),
      dependencies,
    });
  }

  return {
    operations,
    handledRemovedViewNames,
    handledRemovedTriggerNames,
    handledCreatedViewNames,
    handledCreatedTriggerNames,
  };
}

function orderOperations(operations: SchemadiffOperation[]): string[] {
  const graph = new Map<string, string[]>();
  const operationsById = new Map<string, SchemadiffOperation>();

  for (const operation of operations) {
    graph.set(operation.id, [...operation.dependencies]);
    operationsById.set(operation.id, operation);
  }

  const result = graphSequencer(graph);
  if (!result.safe) {
    const cycles = result.cycles.map((cycle) => cycle.join(' -> ')).join('; ');
    throw new Error(`cannot resolve schemadiff operation dependencies: ${cycles}`);
  }

  const orderedIds = result.chunks.flatMap((chunk) => [...chunk].sort((left, right) => left.localeCompare(right)));
  return orderedIds.flatMap((id) => {
    const operation = operationsById.get(id)!;
    const lines = splitStatementForOutput(operation.sql);
    return operation.reason ? [`-- ${formatReason(operation.reason)}`, ...lines] : lines;
  });
}

function transitiveViewDependents(
  seedNames: string[],
  viewDependencyFacts: SqliteDependencyFact[],
  views: Record<string, SqliteInspectedView>,
): string[] {
  const seeds = new Set(seedNames);
  const result = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const view of Object.values(views)) {
      if (result.has(view.name)) {
        continue;
      }
      const fact = viewDependencyFacts.find((f) => f.ownerName === view.name);
      if (!fact) {
        continue;
      }
      if (fact.dependsOnNames.some((name) => seeds.has(name) || result.has(name))) {
        result.add(view.name);
        changed = true;
      }
    }
  }
  return [...result];
}

function orderViewsForCreate(views: SqliteInspectedView[], schema: SqliteInspectedDatabase): SqliteInspectedView[] {
  const viewNames = new Set(views.map((view) => view.name));
  const graph = new Map<string, string[]>();
  const dependencyFacts = analyzeViewDependencies(schema);

  for (const view of views) {
    graph.set(
      view.name,
      directViewDependencies(view.name, dependencyFacts).filter((name) => viewNames.has(name)),
    );
  }

  const result = graphSequencer(graph);
  if (!result.safe) {
    const cycles = result.cycles.map((cycle) => cycle.join(' -> ')).join('; ');
    throw new Error(`cannot resolve schemadiff view creation dependencies: ${cycles}`);
  }

  return result.chunks
    .flatMap((chunk) => [...chunk].sort((left, right) => left.localeCompare(right)))
    .map((viewName) => schema.views[viewName]!)
    .filter(Boolean);
}

function orderViewsForDrop(views: SqliteInspectedView[], schema: SqliteInspectedDatabase): SqliteInspectedView[] {
  return [...orderViewsForCreate(views, schema)].reverse();
}

function planTableRebuild(
  baseline: SqliteInspectedTable,
  desired: SqliteInspectedTable,
  reason: SchemadiffReason,
): string[] {
  const tempName = `__sqlfu_old_${desired.name}`;
  const introducedPrimaryKeyColumns = desired.primaryKey.filter(
    (columnName) =>
      !baseline.primaryKey.includes(columnName) && !baseline.columns.some((column) => column.name === columnName),
  );
  if (introducedPrimaryKeyColumns.length > 0) {
    throw new Error(
      `automatic table rebuild for ${desired.name} would invent values for new primary key columns: ${introducedPrimaryKeyColumns.join(', ')}`,
    );
  }
  const copyableColumns = desired.columns.filter((desiredColumn) => {
    if (desiredColumn.generated || desiredColumn.hidden !== 0) {
      return false;
    }

    return baseline.columns.some(
      (baselineColumn) => baselineColumn.name === desiredColumn.name && baselineColumn.hidden === 0,
    );
  });

  const statements = [
    `-- ${formatReason(reason)}`,
    `alter table ${renderTableName(baseline.name)} rename to ${renderTableName(tempName)};`,
  ];
  statements.push(withSemicolon(desired.createSql));

  if (copyableColumns.length > 0) {
    const columnList = copyableColumns.map((column) => maybeQuoteIdentifier(column.name)).join(', ');
    statements.push(
      `insert into ${renderTableName(desired.name)}(${columnList}) select ${columnList} from ${renderTableName(tempName)};`,
    );
  }

  statements.push(`drop table ${renderTableName(tempName)};`);

  for (const index of Object.values(desired.indexes).sort((left, right) => left.name.localeCompare(right.name))) {
    statements.push(withSemicolon(index.createSql));
  }

  return statements;
}

function tableCoreEquals(left: SqliteInspectedTable, right: SqliteInspectedTable): boolean {
  return (
    left.columns.length === right.columns.length &&
    left.columns.every((column, index) => columnEquals(column, right.columns[index]!)) &&
    arraysEqual(left.primaryKey, right.primaryKey) &&
    stableStringify(left.uniqueConstraints) === stableStringify(right.uniqueConstraints) &&
    stableStringify(left.foreignKeys) === stableStringify(right.foreignKeys)
  );
}

function columnEquals(left: SqliteInspectedColumn, right: SqliteInspectedColumn): boolean {
  return stableStringify(left) === stableStringify(right);
}

function indexEquals(left: SqliteInspectedIndex, right: SqliteInspectedIndex): boolean {
  return (
    stableStringify({
      createSql: normalizeComparableSql(left.createSql),
      unique: left.unique,
      origin: left.origin,
      columns: left.columns,
      where: left.where,
    }) ===
    stableStringify({
      createSql: normalizeComparableSql(right.createSql),
      unique: right.unique,
      origin: right.origin,
      columns: right.columns,
      where: right.where,
    })
  );
}

function viewEquals(left: SqliteInspectedView, right: SqliteInspectedView): boolean {
  return left.definition === right.definition;
}

function triggerEquals(left: SqliteInspectedTrigger, right: SqliteInspectedTrigger): boolean {
  return left.onName === right.onName && left.normalizedSql === right.normalizedSql;
}

function columnDefinition(column: SqliteInspectedColumn): string {
  let sql = `${maybeQuoteIdentifier(column.name)} ${column.declaredType}`.trimEnd();
  if (column.collation) {
    sql += ` collate ${column.collation}`;
  }
  if (column.notNull) {
    sql += ' not null';
  }
  if (column.defaultSql != null) {
    sql += ` default ${column.defaultSql}`;
  }
  return sql;
}

function topologicallySortTables(tables: Record<string, SqliteInspectedTable>): string[] {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const output: string[] = [];

  const visit = (tableName: string) => {
    if (visited.has(tableName)) {
      return;
    }
    if (visiting.has(tableName)) {
      return;
    }

    visiting.add(tableName);
    for (const foreignKey of tables[tableName]!.foreignKeys) {
      if (foreignKey.referencedTable in tables && foreignKey.referencedTable !== tableName) {
        visit(foreignKey.referencedTable);
      }
    }
    visiting.delete(tableName);
    visited.add(tableName);
    output.push(tableName);
  };

  for (const tableName of Object.keys(tables).sort((left, right) => left.localeCompare(right))) {
    visit(tableName);
  }

  return output;
}

function sortedRemovedKeys<T>(baseline: Record<string, T>, desired: Record<string, T>): string[] {
  return Object.keys(baseline)
    .filter((key) => !(key in desired))
    .sort((left, right) => left.localeCompare(right));
}

function sortedAddedKeys<T>(baseline: Record<string, T>, desired: Record<string, T>): string[] {
  return Object.keys(desired)
    .filter((key) => !(key in baseline))
    .sort((left, right) => left.localeCompare(right));
}

function sortedModifiedKeys<T>(
  baseline: Record<string, T>,
  desired: Record<string, T>,
  equals: (left: T, right: T) => boolean,
): string[] {
  return Object.keys(desired)
    .filter((key) => key in baseline)
    .filter((key) => !equals(baseline[key]!, desired[key]!))
    .sort((left, right) => left.localeCompare(right));
}

function withSemicolon(sql: string): string {
  return sql.trimEnd().endsWith(';') ? sql.trimEnd() : `${sql.trimEnd()};`;
}

function splitStatementForOutput(statement: string): string[] {
  const lines = statement
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.trim().length > 0);

  if (lines.length > 1 && /^create\s+table\b/iu.test(lines[0]!)) {
    return [lines[0]!, ...lines.slice(1, -1).map((line) => `  ${line}`), lines[lines.length - 1]!];
  }

  return lines;
}

function pushStatements(target: string[], source: string[]) {
  target.push(...source);
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, currentValue: unknown) => {
    if (Array.isArray(currentValue) || currentValue == null || typeof currentValue !== 'object') {
      return currentValue;
    }
    return Object.fromEntries(
      Object.entries(currentValue as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)),
    );
  });
}
