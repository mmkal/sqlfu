import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {resolveProjectConfig} from '../core/config.js';
import type {ProjectConfigOverrides} from '../core/types.js';
import {materializeSchemaDatabase} from '../migrator/index.js';

export async function writeTypesqlConfig(overrides: ProjectConfigOverrides = {}): Promise<string> {
  const config = resolveProjectConfig(overrides);

  await fs.writeFile(
    config.typesqlConfigPath,
    JSON.stringify(
      {
        databaseUri: config.tempDbPath,
        sqlDir: relativeToCwd(config.cwd, config.sqlDir),
        client: 'libsql',
        target: 'node',
      },
      null,
      2,
    ) + '\n',
  );

  return config.typesqlConfigPath;
}

export async function generateQueryTypes(overrides: ProjectConfigOverrides = {}): Promise<void> {
  const config = resolveProjectConfig(overrides);
  await materializeSchemaDatabase(overrides, config.tempDbPath);
  const typesqlConfigPath = await writeTypesqlConfig(overrides);
  await runLocalCli('typesql', ['compile', '--config', typesqlConfigPath], packageRoot);
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(new URL('../../package.json', import.meta.url))));

async function runLocalCli(command: string, args: readonly string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['exec', command, ...args], {
      cwd,
      stdio: 'inherit',
      env: process.env,
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
    });

    child.on('error', reject);
  });
}

function relativeToCwd(cwd: string, targetPath: string): string {
  const relative = targetPath.startsWith(cwd) ? targetPath.slice(cwd.length + 1) : targetPath;
  return relative.length > 0 ? relative : '.';
}
