#!/usr/bin/env node

import {createCli, yamlTableConsoleLogger} from 'trpc-cli';
import * as prompts from '@clack/prompts';

import {router} from './api.js';
import {loadProjectConfig} from './core/config.js';

export async function createSqlfuCli() {
  const projectConfig = await loadProjectConfig();
  return createCli({
    router,
    name: 'sqlfu',
    version: '0.0.0',
    description: `migrations, schema sync, and type generation for sqlite`,
    context: {projectConfig},
  });
}

const cli = await createSqlfuCli();
await cli.run({
  logger: yamlTableConsoleLogger,
  prompts,
});
