import fs from 'node:fs/promises';
import path from 'node:path';

import {loadProjectConfig} from '../core/config.js';
import {createDefaultSqlite3defConfig, getMeaningfulDiffLines, runSqlite3def} from '../core/sqlite3def.js';
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
