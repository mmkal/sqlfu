import path from 'node:path';

import type {ProjectConfigOverrides, SqlfuProjectConfig} from './types.js';

export const defaultSqlite3defVersion = 'v3.10.1';

export function resolveProjectConfig(overrides: ProjectConfigOverrides = {}): SqlfuProjectConfig {
  const cwd = path.resolve(overrides.cwd ?? process.cwd());
  const tempDir = path.resolve(cwd, overrides.tempDir ?? '.sqlfu');
  const sqlite3defBinaryName = process.platform === 'win32' ? 'sqlite3def.exe' : 'sqlite3def';

  return {
    cwd,
    definitionsPath: path.resolve(cwd, overrides.definitionsPath ?? 'definitions.sql'),
    sqlDir: path.resolve(cwd, overrides.sqlDir ?? 'sql'),
    tempDir,
    tempDbPath: path.resolve(cwd, overrides.tempDbPath ?? path.join('.sqlfu', 'typegen.db')),
    typesqlConfigPath: path.resolve(cwd, overrides.typesqlConfigPath ?? 'typesql.json'),
    sqlite3defVersion: overrides.sqlite3defVersion ?? defaultSqlite3defVersion,
    sqlite3defBinaryPath:
      overrides.sqlite3defBinaryPath ?? path.resolve(tempDir, 'bin', sqlite3defBinaryName),
  };
}
