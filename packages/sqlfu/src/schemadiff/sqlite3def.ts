import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import {ensureSqlite3defBinary} from './binary.js';

/**
 * Legacy sqlite3def helpers kept only for direct binary-backed utilities.
 * Schema diff correctness now lives in `sqlite-native.ts`.
 */
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const sharedSqlite3defDir = path.join(packageRoot, '.sqlfu');

export interface Sqlite3defConfig {
  readonly projectRoot: string;
  readonly tempDir: string;
}

export function createDefaultSqlite3defConfig(scope = 'default'): Sqlite3defConfig {
  const tempDir = path.join(sharedSqlite3defDir, scope);
  return {
    projectRoot: process.cwd(),
    tempDir,
  };
}

export async function runSqlite3def(config: Sqlite3defConfig, args: readonly string[]): Promise<string> {
  const binaryPath = await ensureSqlite3defBinary(config);

  return new Promise<string>((resolve, reject) => {
    const child = spawn(binaryPath, [...args], {
      cwd: config.projectRoot,
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

export async function applySchemaFile(input: {
  projectRoot: string;
  schemaPath: string;
  dbPath: string;
}): Promise<string> {
  await fs.mkdir(path.dirname(input.dbPath), {recursive: true});
  return runSqlite3def(createDefaultSqlite3defConfigForRoot(input.projectRoot), ['--apply', '--file', input.schemaPath, input.dbPath]);
}

export async function exportDatabaseSchema(input: {
  projectRoot: string;
  dbPath: string;
}): Promise<string> {
  return runSqlite3def(createDefaultSqlite3defConfigForRoot(input.projectRoot), ['--export', input.dbPath]);
}

export async function diffDatabaseSchemaFile(input: {
  projectRoot: string;
  definitionsPath: string;
  dbPath: string;
}): Promise<string> {
  return runSqlite3def(createDefaultSqlite3defConfigForRoot(input.projectRoot), ['--dry-run', '--file', input.definitionsPath, input.dbPath]);
}

function createDefaultSqlite3defConfigForRoot(projectRoot: string): Sqlite3defConfig {
  return {
    ...createDefaultSqlite3defConfig('project'),
    projectRoot,
  };
}
