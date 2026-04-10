#!/usr/bin/env node

import {createClient} from '@libsql/client';
import {createCli, yamlTableConsoleLogger} from 'trpc-cli';
import * as prompts from '@clack/prompts';

import type {SqliteFileDatabaseFactory} from './api.js';
import {router} from './api.js';
import {loadProjectConfig} from './core/config.js';

export async function createSqlfuCli() {
  const projectConfig = await loadProjectConfig();
  return createCli({
    router,
    name: 'sqlfu',
    version: '0.0.0',
    description: `migrations, schema sync, and type generation for sqlite`,
    context: {
      projectConfig,
      createSqliteFileDatabase,
    },
  });
}

const cli = await createSqlfuCli();
await cli.run({
  logger: yamlTableConsoleLogger,
  prompts,
});

const createSqliteFileDatabase: SqliteFileDatabaseFactory = (dbPath) => {
  const client = createClient({url: `file:${dbPath}`});

  return {
    async query(sql: string) {
      const result = await client.execute(sql);
      return result.rows.map((row) => ({...row}));
    },
    async execute(sql: string) {
      await client.execute(sql);
    },
    async close() {
      client.close();
    },
  };
};
