#!/usr/bin/env tsx
/**
 * Runs sqlfu typegen against sqlfu's own internal queries — the SQL that
 * `src/migrations/index.ts` uses to talk to the `sqlfu_migrations` table. This is
 * sqlfu eating its own dogfood: the row type and SQL constants consumed by the
 * migration runtime are generated from `internal/definitions.sql` and
 * `src/migrations/queries/*.sql`, not hand-written.
 *
 * Invoked before `tsgo` in the build script so the generated wrappers exist when TS
 * compilation starts. The output files (`src/migrations/queries/.generated/*.ts`)
 * are committed so a fresh `pnpm install && pnpm build` works without this script
 * ever running — it's only needed when the internal SQL or definitions change.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import BetterSqlite3 from 'better-sqlite3';

import {createBetterSqlite3Client} from '../src/adapters/better-sqlite3.js';
import {generateQueryTypesForConfig} from '../src/typegen/index.js';
import type {SqlfuProjectConfig} from '../src/core/types.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const internalRoot = path.join(packageRoot, 'internal');
const definitionsPath = path.join(internalRoot, 'definitions.sql');
const queriesDir = path.join(packageRoot, 'src/migrations/queries');
const devDbPath = path.join(internalRoot, '.sqlfu', 'internal.db');

async function main() {
  await fs.mkdir(path.dirname(devDbPath), {recursive: true});
  await fs.rm(devDbPath, {force: true});
  await fs.rm(`${devDbPath}-shm`, {force: true});
  await fs.rm(`${devDbPath}-wal`, {force: true});

  const definitionsSql = await fs.readFile(definitionsPath, 'utf8');
  {
    // Use better-sqlite3 (not `node:sqlite`) because this script runs in CI's build job under
    // Node 20, and `node:sqlite` landed in Node 22. typegen's runtime path in openMainDevDatabase
    // dynamic-imports node:sqlite and is fine; only the build-time script needs the older driver.
    const database = new BetterSqlite3(devDbPath);
    const client = createBetterSqlite3Client(database);
    try {
      await client.raw(definitionsSql);
    } finally {
      database.close();
    }
  }

  const config: SqlfuProjectConfig = {
    projectRoot: internalRoot,
    db: devDbPath,
    definitions: definitionsPath,
    queries: queriesDir,
    generate: {
      validator: null,
      prettyErrors: false,
      sync: false,
      importExtension: '.js',
    },
  };

  await generateQueryTypesForConfig(config);
  console.log(`generated ${path.relative(packageRoot, queriesDir)}/.generated/`);
}

await main();
