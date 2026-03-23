import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';

import {resolveProjectConfig} from '../core/config.js';
import type {MigrateDiffResult, ProjectConfigOverrides, SqlfuProjectConfig} from '../core/types.js';
import {ensureSqlite3defBinary} from './binary.js';

export async function diffDatabase(overrides: ProjectConfigOverrides = {}, dbPath?: string): Promise<MigrateDiffResult> {
  const config = resolveProjectConfig(overrides);
  await assertDefinitionsExists(config);
  const target = dbPath ?? config.tempDbPath;
  const output = await runSqlite3def(config, ['--dry-run', '--file', config.definitionsPath, target]);
  const drift = hasMeaningfulDiff(output);
  return {
    drift,
    output: drift ? output : '',
  };
}

export async function applyDefinitions(overrides: ProjectConfigOverrides = {}, dbPath?: string): Promise<string> {
  const config = resolveProjectConfig(overrides);
  await assertDefinitionsExists(config);
  const target = dbPath ?? config.tempDbPath;
  await fs.mkdir(config.tempDir, {recursive: true});
  return runSqlite3def(config, ['--apply', '--file', config.definitionsPath, target]);
}

export async function exportSchema(overrides: ProjectConfigOverrides = {}, dbPath?: string): Promise<string> {
  const config = resolveProjectConfig(overrides);
  const target = dbPath ?? config.tempDbPath;
  return runSqlite3def(config, ['--export', target]);
}

export async function checkDatabase(overrides: ProjectConfigOverrides = {}, dbPath?: string): Promise<void> {
  const result = await diffDatabase(overrides, dbPath);
  if (result.drift) {
    throw new Error(result.output.trim() || 'Schema drift detected.');
  }
}

export async function materializeSchemaDatabase(overrides: ProjectConfigOverrides = {}, dbPath?: string): Promise<string> {
  const config = resolveProjectConfig(overrides);
  const target = dbPath ?? config.tempDbPath;

  await fs.mkdir(config.tempDir, {recursive: true});
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
  if (/Nothing is modified/i.test(output)) {
    return false;
  }

  const meaningfulLines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== '-- dry run --')
    .filter((line) => line !== 'BEGIN;')
    .filter((line) => line !== 'COMMIT;')
    .filter((line) => !/^-- Skipped: DROP TABLE ".*_fts_(data|idx|content|docsize|config)";$/i.test(line))
    .filter((line) => line !== 'finished!');

  return meaningfulLines.length > 0;
}
