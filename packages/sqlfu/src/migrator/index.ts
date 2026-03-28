import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';

import {loadProjectConfig} from '../core/config.js';
import {runPackageBinary} from '../core/tooling.js';
import type {MigrateDiffResult, ProjectConfigOverrides, SqlfuProjectConfig} from '../core/types.js';
import {ensureSqlite3defBinary} from './binary.js';

export async function diffDatabase(overrides: ProjectConfigOverrides = {}, dbPath?: string): Promise<MigrateDiffResult> {
  const config = await loadProjectConfig(overrides);
  await assertDefinitionsExists(config);
  const target = dbPath ?? config.dbPath;
  const output = await runSqlite3def(config, ['--dry-run', '--file', config.definitionsPath, target]);
  const drift = hasMeaningfulDiff(output);
  return {
    drift,
    output: drift ? output : '',
  };
}

export async function applyDefinitions(overrides: ProjectConfigOverrides = {}, dbPath?: string): Promise<string> {
  const config = await loadProjectConfig(overrides);
  await assertDefinitionsExists(config);
  const target = dbPath ?? config.dbPath;
  await fs.mkdir(path.dirname(target), {recursive: true});
  return runSqlite3def(config, ['--apply', '--file', config.definitionsPath, target]);
}

export async function exportSchema(overrides: ProjectConfigOverrides = {}, dbPath?: string): Promise<string> {
  const config = await loadProjectConfig(overrides);
  const target = dbPath ?? config.dbPath;
  return runSqlite3def(config, ['--export', target]);
}

export async function createMigrationDraft(overrides: ProjectConfigOverrides = {}, name: string): Promise<string> {
  const config = await loadProjectConfig(overrides);
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

export async function migrateUp(overrides: ProjectConfigOverrides = {}): Promise<string> {
  const config = await loadProjectConfig(overrides);
  return runDbmate(config, ['up']);
}

export async function migrateStatus(overrides: ProjectConfigOverrides = {}): Promise<string> {
  const config = await loadProjectConfig(overrides);
  return runDbmate(config, ['status']);
}

export async function dumpSchemaFile(overrides: ProjectConfigOverrides = {}): Promise<string> {
  const config = await loadProjectConfig(overrides);
  return runDbmate(config, ['dump']);
}

export async function checkDatabase(overrides: ProjectConfigOverrides = {}, dbPath?: string): Promise<void> {
  const result = await diffDatabase(overrides, dbPath);
  if (result.drift) {
    throw new Error(result.output.trim() || 'Schema drift detected.');
  }
}

export async function materializeSchemaDatabase(overrides: ProjectConfigOverrides = {}, dbPath?: string): Promise<string> {
  const config = await loadProjectConfig(overrides);
  const target = dbPath ?? config.tempDbPath;

  await fs.mkdir(path.dirname(target), {recursive: true});
  await fs.rm(target, {force: true});
  await fs.rm(`${target}-shm`, {force: true});
  await fs.rm(`${target}-wal`, {force: true});
  await applyDefinitions(overrides, target);
  return target;
}

export async function runSqlite3def(config: SqlfuProjectConfig, args: readonly string[]): Promise<string> {
  const binaryPath = await ensureSqlite3defBinary(config);

  return new Promise<string>((resolve, reject) => {
    const child = spawn(binaryPath, [...args], {
      cwd: config.cwd,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error([stdout, stderr].filter(Boolean).join('\n').trim() || `sqlite3def exited with code ${code ?? 'unknown'}`));
    });

    child.on('error', reject);
  });
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

function getMeaningfulDiffLines(output: string): string[] {
  if (/Nothing is modified/i.test(output)) {
    return [];
  }

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== '-- dry run --')
    .filter((line) => line !== 'BEGIN;')
    .filter((line) => line !== 'COMMIT;')
    .filter((line) => line !== 'DROP TABLE "schema_migrations";')
    .filter((line) => line !== '-- Skipped: DROP TABLE "schema_migrations";')
    .filter((line) => !/^-- Skipped: DROP TABLE ".*_fts_(data|idx|content|docsize|config)";$/i.test(line))
    .filter((line) => line !== 'finished!');
}

async function draftMigrationSql(config: SqlfuProjectConfig): Promise<string> {
  const baselineDbPath = path.join(config.tempDir, 'migration-draft.db');

  await fs.mkdir(path.dirname(baselineDbPath), {recursive: true});
  await fs.rm(baselineDbPath, {force: true});
  await fs.rm(`${baselineDbPath}-shm`, {force: true});
  await fs.rm(`${baselineDbPath}-wal`, {force: true});

  if (await fileExists(config.schemaFile)) {
    await runSqlite3def(config, ['--apply', '--file', config.schemaFile, baselineDbPath]);
  }

  const diffOutput = await runSqlite3def(config, ['--dry-run', '--file', config.definitionsPath, baselineDbPath]);
  const lines = getMeaningfulDiffLines(diffOutput);

  if (lines.length === 0) {
    return '-- No schema changes detected between schema.sql and definitions.sql.';
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
  await fs.mkdir(path.dirname(config.schemaFile), {recursive: true});
  await fs.mkdir(path.dirname(config.dbPath), {recursive: true});

  return runPackageBinary(
    'dbmate',
    [
      '--url',
      toDbmateSqliteUrl(config.dbPath),
      '--migrations-dir',
      config.migrationsDir,
      '--schema-file',
      config.schemaFile,
      ...args,
    ],
    config.cwd,
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
