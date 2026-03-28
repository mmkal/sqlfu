import {createCli, t} from 'trpc-cli';
import {z} from 'zod';

import {loadProjectConfig} from '../core/config.js';
import {checkDatabase, createMigrationDraft, diffDatabase, dumpSchemaFile, migrateStatus, migrateUp} from '../migrator/index.js';
import {generateQueryTypes} from '../typegen/index.js';

const configShape = {
  cwd: z.string().optional(),
  configPath: z.string().optional(),
  dbPath: z.string().optional(),
  migrationsDir: z.string().optional(),
  schemaFile: z.string().optional(),
  definitionsPath: z.string().optional(),
  sqlDir: z.string().optional(),
  tempDir: z.string().optional(),
  tempDbPath: z.string().optional(),
  typesqlConfigPath: z.string().optional(),
  sqlite3defVersion: z.string().optional(),
  sqlite3defBinaryPath: z.string().optional(),
};

const configInput = z.object(configShape).default({});

const dbInput = z.object(configShape);
const newMigrationInput = z.object({
  ...configShape,
  name: z.string().min(1),
});

export const router = t.router({
  generate: t.procedure.input(configInput).mutation(async ({input}) => {
    await generateQueryTypes(input);
    return 'Generated schema-derived database and TypeSQL outputs.';
  }),
  config: t.procedure.input(configInput).query(async ({input}) => loadProjectConfig(input)),
  migrate: t.router({
    new: t.procedure.input(newMigrationInput).mutation(async ({input}) => {
      return createMigrationDraft(input, input.name);
    }),
    up: t.procedure.input(dbInput).mutation(async ({input}) => {
      return migrateUp(input);
    }),
    status: t.procedure.input(dbInput).query(async ({input}) => {
      return migrateStatus(input);
    }),
    dumpSchema: t.procedure.input(dbInput).mutation(async ({input}) => {
      return dumpSchemaFile(input);
    }),
    diff: t.procedure.input(dbInput).query(async ({input}) => {
      const result = await diffDatabase(input, input.dbPath);
      return result.output || 'Nothing is modified';
    }),
    check: t.procedure.input(dbInput).mutation(async ({input}) => {
      await checkDatabase(input, input.dbPath);
      return 'No schema drift detected.';
    }),
  }),
});

export function createSqlfuCli() {
  return createCli({
    router,
    name: 'sqlfu',
  });
}
