import type {RouterClient} from '@orpc/server';
import type {UiRouter} from 'sqlfu/ui/browser';
import {extractSchema} from 'sqlfu/browser';

import {buildQueryCatalog} from './catalog.js';
import type {WasmSqliteClient} from './sqlite-wasm-client.js';
import {createWasmAsyncClient} from './sqlfu-client-adapter.js';
import {diffBaselineSqlToDesiredSql, inspectSchemaFromSql, schemasCompareSyncable} from './schema-diff.js';
import {
  applyMigrations as applyMigrationsToLive,
  baselineMigrationHistory,
  migrationChecksum,
  migrationName,
  migrationsFromFiles,
  readMigrationHistory,
  replaceMigrationHistory,
  type Migration,
} from './migrations.js';
import {analyzeDatabase, findRecommendedTarget} from './analyze.js';
import type {CheckAnalysis, CheckRecommendation} from './analyze.js';
import {DemoVfs} from './vfs.js';

const DEMO_PROJECT_ROOT = 'demo.local.sqlfu.dev';
const DEMO_PROJECT_NAME = 'demo';
const PAGE_SIZE = 25;
const schemaDriftExcludedTables = ['sqlfu_migrations'] as const;

const SEED_DATA_SQL = `
insert into posts (slug, title, body, published) values
  ('hello-world', 'Hello World', 'First post body', 1),
  ('draft-notes', 'Draft Notes', 'Unpublished notes', 0);
`.trim();

type TableRowKey =
  | {kind: 'primaryKey'; values: Record<string, unknown>}
  | {kind: 'new'; value: string}
  | {kind: 'rowid'; value: number};

export function createDemoRouterClient(input: {
  client: WasmSqliteClient;
  onSchemaChange: () => void;
}): RouterClient<UiRouter> {
  const wasm = input.client;
  const sqlfuClient = createWasmAsyncClient(wasm);
  const vfs = new DemoVfs();
  seedLiveDatabase(wasm, vfs.definitions);

  const notify = input.onSchemaChange;
  const migrationsFromVfs = () => migrationsFromFiles(vfs.migrations);

  const list = (relationName: string, page: number) => listTableRows(wasm, relationName, page);

  const router = {
    project: {
      async status() {
        return {
          initialized: true as const,
          projectRoot: DEMO_PROJECT_ROOT,
        };
      },
    },
    schema: {
      async get() {
        const relations = wasm.all<{name: string; type: string; sql: string | null}>(
          `select name, type, sql from sqlite_schema
           where type in ('table', 'view')
             and name not like 'sqlite_%'
             and name not like 'sqlfu_%'
           order by type, name`,
          [],
        );
        return {
          projectName: DEMO_PROJECT_NAME,
          projectRoot: DEMO_PROJECT_ROOT,
          relations: relations.map((relation) => ({
            name: String(relation.name),
            kind: (relation.type === 'view' ? 'view' : 'table') as 'table' | 'view',
            rowCount: relation.type === 'table' ? getRelationCount(wasm, String(relation.name)) : undefined,
            columns: getRelationColumns(wasm, String(relation.name)),
            sql: typeof relation.sql === 'string' ? relation.sql : undefined,
          })),
        };
      },
      async check() {
        try {
          const analysis = await analyzeDatabase({
            liveClient: sqlfuClient,
            definitionsSql: vfs.definitions,
            migrations: migrationsFromVfs(),
          });
          return {
            cards: buildSchemaCheckCards(analysis),
            recommendations: analysis.recommendations.map((recommendation) => ({
              kind: recommendation.kind,
              command: recommendation.command,
              label: recommendation.label,
              rationale: recommendation.rationale,
            })),
          };
        } catch (error) {
          return {
            cards: [],
            recommendations: [],
            error: String(error),
          };
        }
      },
      authorities: {
        async get() {
          const migrations = migrationsFromVfs();
          const applied = await readMigrationHistory(sqlfuClient);
          const appliedByName = new Map(applied.map((migration) => [migration.name, migration]));
          const migrationByName = new Map(migrations.map((migration) => [migrationName(migration), migration]));

          const liveSchemaSql = await extractSchema(sqlfuClient, 'main', {excludedTables: schemaDriftExcludedTables});

          return {
            desiredSchemaSql: vfs.definitions,
            migrations: await Promise.all(migrations.map(async (migration) => {
              const name = migrationName(migration);
              const appliedEntry = appliedByName.get(name);
              return {
                ...parseMigrationId(name),
                id: name,
                fileName: `migrations/${basenameOf(migration.path)}`,
                content: migration.content,
                applied: Boolean(appliedEntry),
                appliedAt: appliedEntry?.appliedAt ?? null,
                integrity: appliedEntry ? getIntegrity(await migrationChecksum(migration.content), appliedEntry.checksum) : null,
              };
            })),
            migrationHistory: await Promise.all(applied.map(async (entry) => {
              const current = migrationByName.get(entry.name);
              return {
                ...parseMigrationId(entry.name),
                id: entry.name,
                fileName: current ? `migrations/${basenameOf(current.path)}` : null,
                content: current?.content ?? '-- migration file missing from repo',
                applied: true as const,
                appliedAt: entry.appliedAt,
                integrity: current ? getIntegrity(await migrationChecksum(current.content), entry.checksum) : 'checksum mismatch' as const,
              };
            })),
            liveSchemaSql,
          };
        },
        async resultantSchema({source, id}: {source: 'migrations' | 'history'; id: string}) {
          const migrations = migrationsFromVfs();
          if (source === 'migrations') {
            const targetIndex = migrations.findIndex((migration) => migrationName(migration) === id);
            if (targetIndex === -1) throw new Error(`migration ${id} not found`);
            const schemaSql = await materializeMigrationsPrefixSchema(migrations.slice(0, targetIndex + 1));
            return {sql: `-- schema that would be produced by \`sqlfu goto ${id}\`\n${schemaSql}`};
          }
          const applied = await readMigrationHistory(sqlfuClient);
          const appliedIndex = applied.findIndex((entry) => entry.name === id);
          if (appliedIndex === -1) throw new Error(`migration history entry ${id} not found`);
          const targetIndex = migrations.findIndex((migration) => migrationName(migration) === id);
          if (targetIndex === -1) throw new Error(`migration ${id} not found in repo`);
          const schemaSql = await materializeMigrationsPrefixSchema(migrations.slice(0, targetIndex + 1));
          return {sql: `-- schema produced by sqlfu goto ${id}\n${schemaSql}`};
        },
      },
      async command({command, confirmation}: {command: string; confirmation?: string}) {
        await runDemoCommand({
          command: command.trim(),
          confirmation,
          vfs,
          wasm,
          sqlfuClient,
        });
        notify();
        return {ok: true} as const;
      },
      async definitions({sql}: {sql: string}) {
        if (!sql.trim()) throw new Error('Desired Schema is required');
        vfs.writeDefinitions(sql);
        notify();
        return {ok: true} as const;
      },
    },
    catalog: async () => buildQueryCatalog(vfs),
    table: {
      list: async ({relationName, page}: {relationName: string; page: number}) => list(relationName, page),
      save: async (input: {
        relationName: string;
        page: number;
        originalRows: readonly Record<string, unknown>[];
        rows: readonly Record<string, unknown>[];
        rowKeys: readonly TableRowKey[];
      }) => {
        saveTableRows(wasm, input);
        notify();
        return list(input.relationName, input.page);
      },
      delete: async (input: {
        relationName: string;
        page: number;
        originalRow: Record<string, unknown>;
        rowKey: TableRowKey;
      }) => {
        deleteTableRow(wasm, input);
        notify();
        return list(input.relationName, input.page);
      },
    },
    sql: {
      run: async ({sql, params}: {sql: string; params?: unknown}) => {
        const trimmedSql = sql.trim();
        if (!trimmedSql) throw new Error('SQL is required');
        const boundArgs = resolveBindings(params);
        const returnsRows = wasm.columnCount(trimmedSql) > 0;
        if (returnsRows) {
          const rows = wasm.all<Record<string, unknown>>(trimmedSql, boundArgs as never);
          notify();
          return {sql: trimmedSql, mode: 'rows' as const, rows};
        }
        const result = wasm.run(trimmedSql, boundArgs as never);
        notify();
        return {
          sql: trimmedSql,
          mode: 'metadata' as const,
          metadata: {rowsAffected: result.rowsAffected, lastInsertRowid: result.lastInsertRowid},
        };
      },
      analyze: async () => ({}),
      save: async ({sql, name}: {sql: string; name: string}) => {
        const trimmed = sql.trim();
        if (!trimmed) throw new Error('SQL is required');
        const baseName = slugifyQueryName(name);
        if (!baseName) throw new Error('Query name is required');
        vfs.writeQuery({name: `${baseName}.sql`, content: `${trimmed}\n`});
        notify();
        return {savedPath: `sql/${baseName}.sql`};
      },
    },
    query: {
      execute: async ({queryId, data, params}: {queryId: string; data?: Record<string, unknown>; params?: Record<string, unknown>}) => {
        const file = vfs.findQuery(queryId);
        if (!file) throw new Error(`Unknown query: ${queryId}`);
        const sql = file.content.trim();
        const firstWord = sql.trimStart().split(/\s+/)[0]?.toLowerCase() ?? '';
        const returnsRows = firstWord !== 'insert' && firstWord !== 'update' && firstWord !== 'delete';
        const bind = {...(data ?? {}), ...(params ?? {})};
        if (returnsRows) {
          const rows = wasm.all<Record<string, unknown>>(sql, bind as never);
          return {mode: 'rows' as const, rows};
        }
        const result = wasm.run(sql, bind as never);
        return {
          mode: 'metadata' as const,
          metadata: {rowsAffected: result.rowsAffected, lastInsertRowid: result.lastInsertRowid},
        };
      },
      update: async ({queryId, sql}: {queryId: string; sql: string}) => {
        const file = vfs.findQuery(queryId);
        if (!file) throw new Error(`Unknown query: ${queryId}`);
        const trimmed = sql.trim();
        if (!trimmed) throw new Error('SQL is required');
        vfs.writeQuery({name: file.name, content: `${trimmed}\n`});
        notify();
        return {id: queryId, sqlFile: `sql/${file.name}`};
      },
      rename: async ({queryId, name}: {queryId: string; name: string}) => {
        const nextId = slugifyQueryName(name);
        if (!nextId) throw new Error('Query name is required');
        const oldName = `${queryId}.sql`;
        const newName = `${nextId}.sql`;
        vfs.renameQuery(oldName, newName);
        notify();
        return {id: nextId, sqlFile: `sql/${newName}`};
      },
      delete: async ({queryId}: {queryId: string}) => {
        const oldName = `${queryId}.sql`;
        vfs.deleteQuery(oldName);
        notify();
        return {id: queryId, sqlFile: `sql/${oldName}`};
      },
    },
  };

  return router as unknown as RouterClient<UiRouter>;
}

async function runDemoCommand(input: {
  command: string;
  confirmation?: string;
  vfs: DemoVfs;
  wasm: WasmSqliteClient;
  sqlfuClient: ReturnType<typeof createWasmAsyncClient>;
}) {
  const {command, confirmation, vfs, wasm, sqlfuClient} = input;

  if (command === 'sqlfu init') {
    // demo is always "initialized"; no-op, but surface a confirm so the UI flow is consistent
    return;
  }

  if (command === 'sqlfu draft') {
    const migrations = migrationsFromFiles(vfs.migrations);
    const baselineSql = migrations.length === 0 ? '' : await materializeMigrationsPrefixSchema(migrations);
    const diffLines = await diffBaselineSqlToDesiredSql({
      baselineSql,
      desiredSql: vfs.definitions,
      allowDestructive: true,
    });
    if (diffLines.length === 0) return;
    const body = await requireConfirmation(confirmation, {
      title: 'Create migration file?',
      body: diffLines.join('\n').trim(),
      bodyType: 'sql',
      editable: true,
    });
    const fileName = `${getMigrationPrefix(new Date())}_${slugify(migrationNickname(body))}.sql`;
    vfs.writeMigration({name: fileName, content: `${body.trim()}\n`});
    return;
  }

  if (command === 'sqlfu sync') {
    const baselineSql = await extractSchema(sqlfuClient, 'main', {excludedTables: schemaDriftExcludedTables});
    const diffLines = await diffBaselineSqlToDesiredSql({
      baselineSql,
      desiredSql: vfs.definitions,
      allowDestructive: true,
    });
    if (diffLines.length === 0) return;
    const body = await requireConfirmation(confirmation, {
      title: 'Apply sync SQL?',
      body: diffLines.join('\n').trim(),
      bodyType: 'sql',
      editable: true,
    });
    await sqlfuClient.transaction(async (tx) => {
      await tx.raw(body.trim());
    });
    return;
  }

  if (command === 'sqlfu migrate') {
    const migrations = migrationsFromFiles(vfs.migrations);
    const applied = await readMigrationHistory(sqlfuClient);
    const appliedNames = new Set(applied.map((row) => row.name));
    const pending = migrations.filter((migration) => !appliedNames.has(migrationName(migration)));
    if (pending.length > 0) {
      const ok = await requireConfirmation(confirmation, {
        title: 'Apply pending migrations?',
        body: pending.map((migration) => [`-- ${migrationName(migration)}`, migration.content.trim()].join('\n')).join('\n\n'),
        bodyType: 'sql',
      });
      if (!ok) return;
    }
    await applyMigrationsToLive(sqlfuClient, {migrations});
    return;
  }

  if (command.startsWith('sqlfu baseline ')) {
    const target = command.replace(/^sqlfu baseline /u, '').trim();
    const migrations = migrationsFromFiles(vfs.migrations);
    const targetMigrations = getMigrationsThroughTarget(migrations, target);
    const ok = await requireConfirmation(confirmation, {
      title: 'Record migration history?',
      body: [
        `Target: ${target}`,
        '',
        'These migrations will be recorded as applied:',
        ...targetMigrations.map((migration) => `- ${migrationName(migration)}`),
      ].join('\n'),
    });
    if (!ok) return;
    await baselineMigrationHistory(sqlfuClient, {migrations, target});
    return;
  }

  if (command.startsWith('sqlfu goto ')) {
    const target = command.replace(/^sqlfu goto /u, '').trim();
    const migrations = migrationsFromFiles(vfs.migrations);
    const targetMigrations = getMigrationsThroughTarget(migrations, target);
    const targetSchema = await materializeMigrationsPrefixSchema(targetMigrations);
    const liveSchema = await extractSchema(sqlfuClient, 'main', {excludedTables: schemaDriftExcludedTables});
    const diffLines = await diffBaselineSqlToDesiredSql({
      baselineSql: liveSchema,
      desiredSql: targetSchema,
      allowDestructive: true,
    });
    const body = await requireConfirmation(confirmation, {
      title: `Move database to ${target}?`,
      body: diffLines.join('\n').trim(),
      bodyType: 'sql',
      editable: true,
    });
    await sqlfuClient.transaction(async (tx) => {
      if (body.trim()) {
        await tx.raw(body.trim());
      }
      await replaceMigrationHistory(tx, targetMigrations);
    });
    return;
  }

  if (command === 'sqlfu check') {
    const analysis = await analyzeDatabase({
      liveClient: sqlfuClient,
      definitionsSql: vfs.definitions,
      migrations: migrationsFromFiles(vfs.migrations),
    });
    if (analysis.mismatches.length > 0) {
      throw new Error(analysis.mismatches.map((mismatch) => [mismatch.title, mismatch.summary].join('\n')).join('\n\n'));
    }
    return;
  }

  throw new Error(`Unsupported sqlfu command: ${command}`);
}

async function requireConfirmation(
  confirmation: string | undefined,
  params: {title: string; body: string; bodyType?: 'sql' | 'markdown' | 'typescript'; editable?: boolean},
) {
  const body = params.body.trim();
  if (!body) {
    return '';
  }
  const provided = confirmation?.trim();
  if (!provided) {
    throw new Error(`confirmation_missing:${JSON.stringify({...params, body})}`);
  }
  return provided;
}

async function materializeMigrationsPrefixSchema(migrations: readonly Migration[]): Promise<string> {
  const {createScratchDb} = await import('./scratch-db.js');
  await using scratch = await createScratchDb();
  await applyMigrationsToLive(scratch.client, {migrations});
  return await extractSchema(scratch.client, 'main', {excludedTables: schemaDriftExcludedTables});
}

function seedLiveDatabase(wasm: WasmSqliteClient, definitionsSql: string) {
  wasm.exec(definitionsSql);
  wasm.exec(SEED_DATA_SQL);
}

function getMigrationsThroughTarget(migrations: readonly Migration[], target: string): Migration[] {
  const targetIndex = migrations.findIndex((migration) => migrationName(migration) === target);
  if (targetIndex === -1) {
    throw new Error(`migration ${target} not found`);
  }
  return migrations.slice(0, targetIndex + 1);
}

function getMigrationPrefix(now: Date) {
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

function slugifyQueryName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function migrationNickname(sql: string) {
  const firstLine = sql.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? 'migration';
  return firstLine.replace(/;$/, '').slice(0, 40);
}

function parseMigrationId(id: string) {
  const separatorIndex = id.indexOf('_');
  if (separatorIndex === -1) return {timestamp: undefined, name: id};
  return {timestamp: id.slice(0, separatorIndex), name: id.slice(separatorIndex + 1)};
}

function basenameOf(filePath: string) {
  return filePath.split('/').pop() ?? filePath;
}

function getIntegrity(current: string, appliedChecksum: string) {
  return current === appliedChecksum ? ('ok' as const) : ('checksum mismatch' as const);
}

function buildSchemaCheckCards(analysis: CheckAnalysis) {
  const mismatchByKind = new Map(analysis.mismatches.map((mismatch) => [mismatch.kind, mismatch]));
  const recommendationKinds = new Set(analysis.recommendations.map((recommendation: CheckRecommendation) => recommendation.kind));
  const cards = [
    makeCard('repoDrift', 'Repo Drift', '✅ No Repo Drift', 'Desired Schema matches Migrations.', mismatchByKind.get('repoDrift')),
    makeCard('pendingMigrations', 'Pending Migrations', '✅ No Pending Migrations', 'Migration History matches Migrations.', mismatchByKind.get('pendingMigrations')),
    makeCard('historyDrift', 'History Drift', '✅ No History Drift', 'Applied migrations still match the repo versions.', mismatchByKind.get('historyDrift')),
    makeCard('schemaDrift', 'Schema Drift', '✅ No Schema Drift', 'Live Schema matches Migration History.', mismatchByKind.get('schemaDrift')),
    makeCard('syncDrift', 'Sync Drift', '✅ No Sync Drift', 'Desired Schema matches Live Schema.', mismatchByKind.get('syncDrift'), recommendationKinds, mismatchByKind),
  ];
  return cards;
}

function makeCard(
  key: 'repoDrift' | 'pendingMigrations' | 'historyDrift' | 'schemaDrift' | 'syncDrift',
  title: string,
  okTitle: string,
  explainer: string,
  mismatch: {summary: string; details: readonly string[]} | undefined,
  recommendationKinds?: ReadonlySet<string>,
  mismatchByKind?: ReadonlyMap<string, unknown>,
) {
  let variant: 'ok' | 'warn' | 'info' = 'ok';
  if (mismatch) {
    variant = 'warn';
    if (
      key === 'syncDrift'
      && mismatchByKind?.has('pendingMigrations')
      && !recommendationKinds?.has('sync')
    ) {
      variant = 'info';
    }
  }
  return {
    key,
    variant,
    title,
    okTitle,
    explainer,
    ok: !mismatch,
    summary: mismatch?.summary ?? '',
    details: mismatch?.details ?? [],
  };
}

function resolveBindings(params: unknown): unknown[] | Record<string, unknown> {
  if (params == null || params === '') return [];
  if (Array.isArray(params)) return params.map(normalizeDbValue);
  if (typeof params !== 'object') throw new Error('SQL runner params must be an object or array');
  const paramsRecord = params as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(paramsRecord).map(([name, value]) => [`:${name.replace(/^[:@$]/, '')}`, normalizeDbValue(value)]),
  );
}

function getRelationColumns(wasm: WasmSqliteClient, relationName: string) {
  const rows = wasm.all<Record<string, unknown>>(
    `pragma table_xinfo("${escapeIdentifier(relationName)}")`,
    [],
  );
  return rows
    .filter((row) => Number(row.hidden ?? 0) === 0)
    .map((row) => ({
      name: String(row.name),
      type: typeof row.type === 'string' ? row.type : '',
      notNull: Number(row.notnull ?? 0) === 1,
      primaryKey: Number(row.pk ?? 0) >= 1,
    }));
}

function getRelationCount(wasm: WasmSqliteClient, relationName: string) {
  const rows = wasm.all<{count: number}>(
    `select count(*) as count from "${escapeIdentifier(relationName)}"`,
    [],
  );
  return Number(rows[0]?.count ?? 0);
}

function getRelationInfo(wasm: WasmSqliteClient, relationName: string) {
  const rows = wasm.all<{name: string; type: string}>(
    `select name, type from sqlite_schema where name = ?`,
    [relationName],
  );
  const relation = rows[0];
  if (!relation || (relation.type !== 'table' && relation.type !== 'view')) {
    throw new Error(`Unknown relation "${relationName}"`);
  }
  return relation;
}

function listTableRows(wasm: WasmSqliteClient, relationName: string, page: number) {
  const safePage = Math.max(0, page);
  const relation = getRelationInfo(wasm, relationName);
  const relationColumns = getRelationColumns(wasm, relationName);
  const columns = relationColumns.map((column) => column.name);
  const primaryKeyColumns = relationColumns.filter((column) => column.primaryKey).map((column) => column.name);
  const includeRowid = relation.type === 'table' && primaryKeyColumns.length === 0;
  const rows = wasm.all<Record<string, unknown>>(
    `select ${includeRowid ? 'rowid as "__sqlfu_rowid__", ' : ''}* from "${escapeIdentifier(relationName)}" limit ? offset ?`,
    [PAGE_SIZE, safePage * PAGE_SIZE],
  );
  return {
    relation: relationName,
    page: safePage,
    pageSize: PAGE_SIZE,
    editable: relation.type === 'table',
    rowKeys: relation.type === 'table' ? rows.map((row) => buildTableRowKey(row, primaryKeyColumns)) : [],
    columns,
    rows: rows.map(stripInternalRowValues),
  };
}

function saveTableRows(
  wasm: WasmSqliteClient,
  input: {
    relationName: string;
    originalRows: readonly Record<string, unknown>[];
    rows: readonly Record<string, unknown>[];
    rowKeys: readonly TableRowKey[];
  },
) {
  const relation = getRelationInfo(wasm, input.relationName);
  if (relation.type !== 'table') throw new Error(`Relation "${input.relationName}" is not editable`);
  if (input.originalRows.length !== input.rows.length || input.rows.length !== input.rowKeys.length) {
    throw new Error('Edited rows payload is malformed');
  }
  for (let index = 0; index < input.rows.length; index += 1) {
    const nextRow = input.rows[index]!;
    const originalRow = input.originalRows[index]!;
    const normalizedNextRow = normalizeEditedRow(nextRow, originalRow);
    const changedColumns = Object.keys(normalizedNextRow).filter(
      (column) => !isSameValue(normalizedNextRow[column], originalRow[column]),
    );
    if (changedColumns.length === 0) continue;
    const rowKey = input.rowKeys[index]!;
    const statement = rowKey.kind === 'new'
      ? buildInsertRowStatement(input.relationName, normalizedNextRow, changedColumns)
      : buildUpdateRowStatement(input.relationName, rowKey, normalizedNextRow, changedColumns);
    wasm.run(statement.sql, statement.args as never);
  }
}

function deleteTableRow(
  wasm: WasmSqliteClient,
  input: {
    relationName: string;
    originalRow: Record<string, unknown>;
    rowKey: TableRowKey;
  },
) {
  const relation = getRelationInfo(wasm, input.relationName);
  if (relation.type !== 'table') throw new Error(`Relation "${input.relationName}" is not editable`);
  if (input.rowKey.kind === 'new') throw new Error('Cannot delete a new row');
  const whereClauseParts = buildRowWhereClause(input.rowKey);
  const exactMatchParts = buildExactRowMatchClause(input.originalRow);
  const result = wasm.run(
    `delete from "${escapeIdentifier(input.relationName)}" where (${whereClauseParts.sql}) and (${exactMatchParts.sql})`,
    [...whereClauseParts.args, ...exactMatchParts.args] as never,
  );
  if (result.rowsAffected !== 1) throw new Error(`Delete affected ${result.rowsAffected} rows`);
}

function buildTableRowKey(row: Record<string, unknown>, primaryKeyColumns: readonly string[]): TableRowKey {
  if (primaryKeyColumns.length > 0) {
    return {kind: 'primaryKey', values: Object.fromEntries(primaryKeyColumns.map((column) => [column, row[column]]))};
  }
  const rowid = row.__sqlfu_rowid__;
  if (typeof rowid !== 'number') throw new Error('Editable table row is missing rowid');
  return {kind: 'rowid', value: rowid};
}

function stripInternalRowValues(row: Record<string, unknown>) {
  const next = {...row};
  delete next.__sqlfu_rowid__;
  return next;
}

function buildRowWhereClause(rowKey: Exclude<TableRowKey, {kind: 'new'}>) {
  if (rowKey.kind === 'rowid') return {sql: 'rowid = ?', args: [rowKey.value] as unknown[]};
  const entries = Object.entries(rowKey.values);
  return {
    sql: entries.map(([column, value]) => (value == null ? `"${escapeIdentifier(column)}" is null` : `"${escapeIdentifier(column)}" = ?`)).join(' and '),
    args: entries.flatMap(([, value]) => (value == null ? [] : [normalizeDbValue(value)])),
  };
}

function buildExactRowMatchClause(row: Record<string, unknown>) {
  const entries = Object.entries(row);
  return {
    sql: entries.map(([column, value]) => (value == null ? `"${escapeIdentifier(column)}" is null` : `"${escapeIdentifier(column)}" = ?`)).join(' and '),
    args: entries.flatMap(([, value]) => (value == null ? [] : [normalizeDbValue(value)])),
  };
}

function buildInsertRowStatement(relationName: string, nextRow: Record<string, unknown>, changedColumns: readonly string[]) {
  const columns = changedColumns.map((column) => `"${escapeIdentifier(column)}"`).join(', ');
  const placeholders = changedColumns.map(() => '?').join(', ');
  return {
    sql: `insert into "${escapeIdentifier(relationName)}" (${columns}) values (${placeholders})`,
    args: changedColumns.map((column) => normalizeDbValue(nextRow[column])),
  };
}

function buildUpdateRowStatement(
  relationName: string,
  rowKey: Exclude<TableRowKey, {kind: 'new'}>,
  nextRow: Record<string, unknown>,
  changedColumns: readonly string[],
) {
  const setSql = changedColumns.map((column) => `"${escapeIdentifier(column)}" = ?`).join(', ');
  const setArgs = changedColumns.map((column) => normalizeDbValue(nextRow[column]));
  const whereClause = buildRowWhereClause(rowKey);
  return {
    sql: `update "${escapeIdentifier(relationName)}" set ${setSql} where ${whereClause.sql}`,
    args: [...setArgs, ...whereClause.args],
  };
}

function normalizeEditedRow(nextRow: Record<string, unknown>, originalRow: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(nextRow).map(([column, value]) => [column, coerceEditedValue(value, originalRow[column])]),
  );
}

function coerceEditedValue(value: unknown, originalValue: unknown) {
  if (typeof originalValue === 'number' && typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  return value;
}

function normalizeDbValue(value: unknown) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function isSameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function escapeIdentifier(value: string) {
  return value.replaceAll('"', '""');
}
