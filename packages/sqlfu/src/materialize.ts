// Helpers that materialise a schema from some source (definitions.sql, a
// migrations list, the migration history recorded in a live DB) into a scratch
// DB and return the resulting schema SQL. Extracted from api.ts so callers that
// only need these (typegen's authority dispatcher) don't have to pull api.ts's
// full import graph (schemadiff, formatter, vendored sql-formatter) along for
// the ride.

import type {SqlfuHost} from './host.js';
import {joinPath} from './paths.js';
import type {SqlfuMigrationPreset, SqlfuProjectConfig} from './types.js';
import {applyMigrations, type Migration} from './migrations/index.js';
import {extractSchema} from './sqlite-text.js';

export type MaterializeSchemaOptions = {
  /**
   * Tables to strip from the extracted schema. The schema-drift callers in
   * api.ts pass `['sqlfu_migrations']` so bookkeeping noise doesn't affect
   * comparison; typegen leaves this empty so the user's schema is reflected
   * verbatim.
   */
  excludedTables?: readonly string[];
};

export type MaterializeMigrationsSchemaOptions = MaterializeSchemaOptions & {
  /**
   * Preset to use when populating the scratch DB. Defaults to `'sqlfu'`. This
   * must match the caller's `excludedTables` choice — if the scratch DB
   * creates `sqlfu_migrations` but `excludedTables` only strips
   * `d1_migrations`, the bookkeeping table leaks into the baseline and the
   * schema-diff engine concludes it should be dropped. Callers that know the
   * user's configured preset should pass it explicitly.
   */
  preset?: SqlfuMigrationPreset;
};

export async function materializeDefinitionsSchemaFor(
  host: SqlfuHost,
  definitionsSql: string,
  options: MaterializeSchemaOptions = {},
): Promise<string> {
  await using database = await host.openScratchDb('materialize-definitions');
  await database.client.raw(definitionsSql);
  return extractSchema(database.client, 'main', {excludedTables: [...(options.excludedTables ?? [])]});
}

export async function materializeMigrationsSchemaFor(
  host: SqlfuHost,
  migrations: Migration[],
  options: MaterializeMigrationsSchemaOptions = {},
): Promise<string> {
  await using database = await host.openScratchDb('materialize-migrations');
  await applyMigrations(database.client, {migrations, preset: options.preset ?? 'sqlfu'});
  return extractSchema(database.client, 'main', {excludedTables: [...(options.excludedTables ?? [])]});
}

export async function readMigrationFiles(host: SqlfuHost, config: SqlfuProjectConfig): Promise<Migration[]> {
  if (!config.migrations) return [];
  const migrationsDir = config.migrations.path;

  let fileNames: string[];
  try {
    fileNames = (await host.fs.readdir(migrationsDir))
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const migrations: Migration[] = [];
  for (const fileName of fileNames) {
    const filePath = joinPath(migrationsDir, fileName);
    const content = await host.fs.readFile(filePath);
    migrations.push({path: filePath, content});
  }
  return migrations;
}
