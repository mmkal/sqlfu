import fs from 'node:fs/promises';
import path from 'node:path';

import dedent from 'dedent';
import {expect, test} from 'vitest';

import {createSqlfuCli, runSqlfuCli} from '../src/node/sqlfu-cli.js';
import {loadProjectState} from '../src/node/config.js';
import {createTempFixtureRoot, writeFixtureFiles} from './fs-fixture.js';

test('the CLI accepts a non-default config file path', async () => {
  const root = await createTempFixtureRoot('cli-config');
  await writeFixtureFiles(root, {
    'counter.sqlfu.config.ts': dedent`
      export default {
        definitions: './counter-definitions.sql',
        queries: './counter-sql',
      };
    `,
    'counter-definitions.sql': dedent`
      create table counter (
        id integer primary key,
        value integer not null
      );
    `,
    'counter-sql/get.sql': 'select id, value from counter order by id;',
    'main-definitions.sql': 'create table main_database(id integer primary key);',
    'main-sql/get.sql': 'select id from main_database;',
  });

  using cwd = chdir(root);

  await runCli(['generate', '--config', 'counter.sqlfu.config.ts']);

  await expect(fs.readFile(path.join(root, 'counter-sql/.generated/get.sql.ts'), 'utf8')).resolves.toContain(
    'counter',
  );
  await expect(fs.stat(path.join(root, 'main-sql/.generated/get.sql.ts'))).rejects.toMatchObject({code: 'ENOENT'});

  void cwd;
});

test('commands that do not need config do not load the selected config file', async () => {
  const root = await createTempFixtureRoot('cli-config-lazy');
  using cwd = chdir(root);

  await runCli(['kill', '--port', '59999', '--config', 'missing.sqlfu.config.ts']);

  void cwd;
});

test('createSqlfuCli can still receive a config path programmatically', async () => {
  const root = await createTempFixtureRoot('cli-config-programmatic');
  await writeFixtureFiles(root, {
    'counter.sqlfu.config.ts': dedent`
      export default {
        definitions: './counter-definitions.sql',
        queries: './counter-sql',
      };
    `,
    'counter-definitions.sql': 'create table counter (id integer primary key);',
    'counter-sql/get.sql': 'select id from counter order by id;',
  });

  using cwd = chdir(root);
  const cli = await createSqlfuCli({configPath: 'counter.sqlfu.config.ts'});
  await runCli(['generate'], cli);

  await expect(fs.readFile(path.join(root, 'counter-sql/.generated/get.sql.ts'), 'utf8')).resolves.toContain(
    'counter',
  );

  void cwd;
});

test('loadProjectState resolves paths relative to the selected config file', async () => {
  const root = await createTempFixtureRoot('cli-config-loader');
  await writeFixtureFiles(root, {
    'durable-objects/counter/sqlfu.config.ts': dedent`
      export default {
        definitions: './definitions.sql',
        queries: './sql',
      };
    `,
  });

  using cwd = chdir(root);

  const project = await loadProjectState({configPath: 'durable-objects/counter/sqlfu.config.ts'});
  const projectRoot = path.join(process.cwd(), 'durable-objects/counter');

  expect(project).toMatchObject({
    initialized: true,
    projectRoot,
    configPath: path.join(projectRoot, 'sqlfu.config.ts'),
  });
  expect(project.initialized).toBe(true);
  if (project.initialized) {
    expect(path.normalize(project.config.definitions)).toBe(path.join(projectRoot, 'definitions.sql'));
    expect(path.normalize(project.config.queries)).toBe(path.join(projectRoot, 'sql'));
  }

  void cwd;
});

async function runCli(argv: string[], cli?: Awaited<ReturnType<typeof createSqlfuCli>>) {
  try {
    if (cli) {
      await cli.run({
        argv,
        logger: {info() {}, error() {}},
        process: {
          exit(code) {
            throw new CliExit(code);
          },
        },
      });
    } else {
      await runSqlfuCli(argv, {
        logger: {info() {}, error() {}},
        process: {
          exit(code) {
            throw new CliExit(code);
          },
        },
      });
    }
  } catch (error) {
    if (error instanceof CliExit && error.code === 0) {
      return;
    }
    throw error;
  }
}

function chdir(cwd: string) {
  const previous = process.cwd();
  process.chdir(cwd);
  return {
    [Symbol.dispose]() {
      process.chdir(previous);
    },
  };
}

class CliExit extends Error {
  constructor(public code: number) {
    super(`CLI exited with ${code}`);
  }
}
