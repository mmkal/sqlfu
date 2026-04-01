import fs from 'node:fs/promises';
import path from 'node:path';

import {loadProjectConfig} from '../core/config.js';
import {runPackageBinary} from '../core/tooling.js';
import {createDefaultSqlite3defConfig, diffSnapshotSqlToDesiredSql, getMeaningfulDiffLines, runSqlite3def} from '../core/sqlite3def.js';
import type {MigrateDiffResult, SqlfuProjectConfig} from '../core/types.js';

export async function diffDatabase(dbPath?: string): Promise<MigrateDiffResult> {
  const config = await loadProjectConfig();
  await assertDefinitionsExists(config);
  const target = dbPath ?? config.dbPath;
  const output = await runSqlite3def(sqlite3defConfig(config), ['--dry-run', '--file', config.definitionsPath, target]);
  const drift = hasMeaningfulDiff(output);
  return {
    drift,
    output: drift ? output : '',
  };
}

export async function applyDefinitions(dbPath?: string): Promise<string> {
  const config = await loadProjectConfig();
  await assertDefinitionsExists(config);
  const target = dbPath ?? config.dbPath;
  await fs.mkdir(path.dirname(target), {recursive: true});
  return runSqlite3def(sqlite3defConfig(config), ['--apply', '--file', config.definitionsPath, target]);
}

export async function exportSchema(dbPath?: string): Promise<string> {
  const config = await loadProjectConfig();
  const target = dbPath ?? config.dbPath;
  return runSqlite3def(sqlite3defConfig(config), ['--export', target]);
}

export async function createMigrationDraft(name: string): Promise<string> {
  const config = await loadProjectConfig();
  await assertDefinitionsExists(config);
  await fs.mkdir(config.migrationsDir, {recursive: true});

  const output = await runDbmate(config, ['new', name]);
  const migrationPath = output.match(/Creating migration:\s+(.+)$/m)?.[1]?.trim();

  if (!migrationPath) {
    throw new Error(`dbmate did not report the created migration path.\n${output}`.trim());
  }

  const migrationSql = await draftMigrationSql(config);
  await writeMigrationDraft(migrationPath, migrationSql);
  return `Created ${migrationPath}`;
}

export async function migrateUp(): Promise<string> {
  const config = await loadProjectConfig();
  return runDbmate(config, ['up']);
}

export async function migrateStatus(): Promise<string> {
  const config = await loadProjectConfig();
  return runDbmate(config, ['status']);
}

export async function dumpSnapshotFile(): Promise<string> {
  const config = await loadProjectConfig();
  return runDbmate(config, ['dump']);
}

export async function checkDatabase(dbPath?: string): Promise<void> {
  const result = await diffDatabase(dbPath);
  if (result.drift) {
    throw new Error(result.output.trim() || 'Schema drift detected.');
  }
}

export async function materializeSchemaDatabase(dbPath: string): Promise<string> {
  await loadProjectConfig();
  const target = dbPath;

  await fs.mkdir(path.dirname(target), {recursive: true});
  await fs.rm(target, {force: true});
  await fs.rm(`${target}-shm`, {force: true});
  await fs.rm(`${target}-wal`, {force: true});
  await applyDefinitions(target);
  return target;
}

async function assertDefinitionsExists(config: SqlfuProjectConfig): Promise<void> {
  try {
    await fs.access(config.definitionsPath);
  } catch {
    throw new Error(`No definitions.sql found at ${config.definitionsPath}`);
  }
}

function hasMeaningfulDiff(output: string): boolean {
  return getMeaningfulDiffLines(output).length > 0;
}

function sqlite3defConfig(config: SqlfuProjectConfig) {
  return {
    ...createDefaultSqlite3defConfig('project'),
    projectRoot: config.projectRoot,
  };
}

async function draftMigrationSql(config: SqlfuProjectConfig): Promise<string> {
  const snapshotSql = (await fileExists(config.snapshotFile)) ? await fs.readFile(config.snapshotFile, 'utf8') : '';
  const desiredSql = await fs.readFile(config.definitionsPath, 'utf8');
  const lines = await diffSnapshotSqlToDesiredSql(sqlite3defConfig(config), {snapshotSql, desiredSql});

  if (lines.length === 0) {
    return '-- No schema changes detected between snapshot.sql and definitions.sql.';
  }

  const warningLines = lines.some(isDestructiveStatement)
    ? ['-- WARNING: destructive statements were detected in this draft. Review carefully before applying.', '']
    : [];

  return [...warningLines, ...lines].join('\n');
}

async function writeMigrationDraft(migrationPath: string, upSql: string): Promise<void> {
  const contents = `-- migrate:up\n${upSql}\n\n-- migrate:down\n-- Write rollback SQL here if you need it.\n`;
  await fs.writeFile(migrationPath, contents);
}

async function runDbmate(config: SqlfuProjectConfig, args: readonly string[]): Promise<string> {
  await fs.mkdir(config.migrationsDir, {recursive: true});
  await fs.mkdir(path.dirname(config.snapshotFile), {recursive: true});
  await fs.mkdir(path.dirname(config.dbPath), {recursive: true});

  return runPackageBinary(
    'dbmate',
    [
      '--url',
      toDbmateSqliteUrl(config.dbPath),
      '--migrations-dir',
      config.migrationsDir,
      '--schema-file',
      config.snapshotFile,
      ...args,
    ],
    config.projectRoot,
  );
}

function toDbmateSqliteUrl(dbPath: string): string {
  return `sqlite:${dbPath}`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isDestructiveStatement(statement: string): boolean {
  return /\bDROP\s+(TABLE|COLUMN|INDEX|VIEW|TRIGGER)\b/i.test(statement);
}
