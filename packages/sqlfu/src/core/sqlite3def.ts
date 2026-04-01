import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

import {ensureSqlite3defBinary} from '../migrator/binary.js';

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

export function getMeaningfulDiffLines(output: string): string[] {
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

export async function diffSnapshotSqlToDesiredSql(
  config: Sqlite3defConfig,
  input: {
    snapshotSql: string;
    desiredSql: string;
  },
): Promise<string[]> {
  await fs.mkdir(config.tempDir, {recursive: true});
  const workDir = await fs.mkdtemp(path.join(config.tempDir, 'draft-'));
  const snapshotPath = path.join(workDir, 'snapshot.sql');
  const definitionsPath = path.join(workDir, 'definitions.sql');
  const baselineDbPath = path.join(workDir, 'baseline.db');

  try {
    await fs.mkdir(workDir, {recursive: true});
    await fs.writeFile(snapshotPath, input.snapshotSql);
    await fs.writeFile(definitionsPath, input.desiredSql);

    if (input.snapshotSql.trim()) {
      await runSqlite3def(config, ['--apply', '--file', snapshotPath, baselineDbPath]);
    }

    const diffOutput = await runSqlite3def(config, ['--dry-run', '--file', definitionsPath, baselineDbPath]);
    return getMeaningfulDiffLines(diffOutput);
  } finally {
    await fs.rm(workDir, {recursive: true, force: true});
  }
}
