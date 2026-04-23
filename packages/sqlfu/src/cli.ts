#!/usr/bin/env node

import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {createCli, yamlTableConsoleLogger} from 'trpc-cli';
import * as prompts from '@clack/prompts';

import type {SqlfuCommandConfirm} from './api.js';
import {router} from './node/cli-router.js';
import {loadProjectState} from './node/config.js';
import {createNodeHost} from './node/host.js';
import packageJson from '../package.json' with {type: 'json'};

export async function createSqlfuCli() {
  const [project, host] = await Promise.all([loadProjectState(), createNodeHost()]);
  return createCli({
    router,
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
    context: {
      projectRoot: project.projectRoot,
      config: project.initialized ? project.config : undefined,
      host,
      confirm,
    },
  });
}

export const confirm: SqlfuCommandConfirm = async (params) => {
  let currentBody = params.body.trim();

  while (currentBody) {
    prompts.note(currentBody, params.title);
    const editors = availableEditors();
    const choice = await prompts.select({
      message: 'Continue with this body?',
      options: [
        {label: 'Yes', value: 'yes'},
        {label: 'No', value: 'no'},
        ...editors.map((editor) => ({
          label: `Edit with ${editor}`,
          hint: 'Save and close the file, then you will be asked again.',
          value: `edit:${editor}`,
          disabled: params.editable === true ? false : true,
        })),
      ],
    });

    if (prompts.isCancel(choice) || choice === 'no') {
      return null;
    }
    if (choice === 'yes') {
      return currentBody;
    }

    const editor = String(choice).replace(/^edit:/u, '');
    currentBody = await editTempFile(currentBody, editor, params.bodyType);
  }

  return null;
};

const cli = await createSqlfuCli();
await cli.run({
  logger: yamlTableConsoleLogger,
  formatError: formatCliError,
  prompts,
});

function formatCliError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function availableEditors() {
  return [...new Set([process.env.VISUAL, process.env.EDITOR, 'cursor', 'code', 'vi', 'emacs', 'nano', 'notepad'])]
    .filter((value): value is string => typeof value === 'string' && !/\W/u.test(value))
    .filter((value) => {
      try {
        return (
          childProcess
            .execSync(`sh -c 'which ${value} || echo ""'`, {stdio: ['ignore', 'pipe', 'ignore']})
            .toString()
            .trim().length > 0
        );
      } catch {
        return false;
      }
    });
}

async function editTempFile(input: string, editor: string, bodyType: 'markdown' | 'sql' | 'typescript' | undefined) {
  const tempFile = path.join(os.tmpdir(), 'sqlfu-confirm', `changes-${Date.now()}${bodyTypeToExtension(bodyType)}`);
  fs.mkdirSync(path.dirname(tempFile), {recursive: true});
  fs.writeFileSync(tempFile, `${input.trim()}\n`);

  try {
    await new Promise<void>((resolve, reject) => {
      const child = childProcess.spawn(editor, [tempFile], {stdio: 'inherit'});
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`Editor exited with code ${code}`));
      });
    });

    const done = await prompts.text({
      message: 'Press Enter after saving the file',
      initialValue: '',
    });
    if (prompts.isCancel(done)) {
      return '';
    }

    return fs.readFileSync(tempFile, 'utf8').trim();
  } finally {
    fs.rmSync(tempFile, {force: true});
  }
}

function bodyTypeToExtension(bodyType: 'markdown' | 'sql' | 'typescript' | undefined) {
  if (bodyType === 'sql') {
    return '.sql';
  }
  if (bodyType === 'typescript') {
    return '.ts';
  }
  if (bodyType === 'markdown') {
    return '.md';
  }
  return '.txt';
}
