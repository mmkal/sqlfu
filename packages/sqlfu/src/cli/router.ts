import {createCli, t} from 'trpc-cli';
import {z} from 'zod';

import {resolveProjectConfig} from '../core/config.js';
import {applyDefinitions, checkDatabase, diffDatabase, exportSchema} from '../migrator/index.js';
import {generateQueryTypes} from '../typegen/index.js';

const configShape = {
  cwd: z.string().optional(),
  definitionsPath: z.string().optional(),
  sqlDir: z.string().optional(),
  tempDir: z.string().optional(),
  tempDbPath: z.string().optional(),
  typesqlConfigPath: z.string().optional(),
  sqlite3defVersion: z.string().optional(),
  sqlite3defBinaryPath: z.string().optional(),
};

const configInput = z.object(configShape).default({});

const dbInput = z.object({
  ...configShape,
  dbPath: z.string().optional(),
});

export const router = t.router({
  generate: t.procedure.input(configInput).mutation(async ({input}) => {
    await generateQueryTypes(input);
    return 'Generated schema-derived database and TypeSQL outputs.';
  }),
  config: t.procedure.input(configInput).query(({input}) => resolveProjectConfig(input)),
  migrate: t.router({
    diff: t.procedure.input(dbInput).query(async ({input}) => {
      const result = await diffDatabase(input, input.dbPath);
      return result.output || 'Nothing is modified';
    }),
    apply: t.procedure.input(dbInput).mutation(async ({input}) => {
      return applyDefinitions(input, input.dbPath);
    }),
    check: t.procedure.input(dbInput).mutation(async ({input}) => {
      await checkDatabase(input, input.dbPath);
      return 'No schema drift detected.';
    }),
    export: t.procedure.input(dbInput).query(async ({input}) => {
      return exportSchema(input, input.dbPath);
    }),
  }),
});

export function createSqlfuCli() {
  return createCli({
    router,
    name: 'sqlfu',
  });
}
