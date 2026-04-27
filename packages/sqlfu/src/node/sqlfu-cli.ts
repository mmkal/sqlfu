import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as prompts from '@clack/prompts';
import {createCli, getCliContext, yamlTableConsoleLogger, type TrpcCliRunParams} from 'trpc-cli';

import type {SqlfuCommandConfirm} from '../api.js';
import {router} from './cli-router.js';
import {loadProjectState} from './config.js';
import {createNodeHost} from './host.js';
import packageJson from '../../package.json' with {type: 'json'};

export async function createSqlfuCli(input: {configPath?: string} = {}) {
  const cwd = process.cwd();
  const host = await createNodeHost();
  let cached: Awaited<ReturnType<typeof loadProjectState>> | undefined;
  let cachedConfigPath: string | undefined;

  async function loadProjectStateForCommand() {
    const configPath = input.configPath || readConfigPathFromCliContext();
    if (!cached || cachedConfigPath !== configPath) {
      cached = await loadProjectState({configPath});
      cachedConfigPath = configPath;
    }
    return cached;
  }

  return createCli({
    router,
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
    context: {
      projectRoot: cwd,
      configPath: input.configPath,
      loadProjectState: loadProjectStateForCommand,
      host,
      confirm,
    },
  });
}

export async function runSqlfuCli(argv: string[], input: Pick<TrpcCliRunParams, 'logger' | 'process'> = {}) {
  const cli = await createSqlfuCli();
  const runParams = {
    logger: input.logger || yamlTableConsoleLogger,
    formatError: formatCliError,
    process: input.process,
    prompts,
  };
  const program = cli.buildProgram(runParams);
  addConfigOptionToHelp(program);

  await cli.run(
    {
      ...runParams,
      argv,
    },
    program,
  );
}

function addConfigOptionToHelp(command: unknown) {
  if (hasOptionMethod(command)) {
    command.option('--config [path]', 'Path to a sqlfu config file.');
  }
  if (hasCommands(command)) {
    for (const child of command.commands) {
      addConfigOptionToHelp(child);
    }
  }
}

function hasOptionMethod(command: unknown): command is {option(flags: string, description: string): unknown} {
  return typeof command === 'object' && command !== null && 'option' in command && typeof command.option === 'function';
}

function hasCommands(command: unknown): command is {commands: unknown[]} {
  return typeof command === 'object' && command !== null && 'commands' in command && Array.isArray(command.commands);
}

function readConfigPathFromCliContext() {
  const context = getCliContext();
  if (!context) {
    return undefined;
  }

  const values = [context.program.opts().config, context.command.opts().config].filter((value) => value !== undefined);
  if (values.length === 0) {
    return undefined;
  }
  if (values.length > 1) {
    throw new Error('Pass --config at most once.');
  }
  const value = values[0];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Missing value for --config.');
  }
  return value;
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
