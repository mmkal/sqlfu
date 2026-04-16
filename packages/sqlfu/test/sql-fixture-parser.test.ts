import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import dedent from 'dedent';
import {expect, test} from 'vitest';
import {z} from 'zod';

import {createParser} from './sql-fixture-parser2.js';

// this is our fake system under test. below we'll set up a parser which exercises it.
function fakeSqlDiffer(params: {baseline: string, desired: string, allowDestructive: boolean}): string {
  if (params.baseline.includes('drop') && !params.allowDestructive) throw new Error(`baseline had drop but allowDestructive is false`);
  return `/* idk the diff: ${JSON.stringify([params.baseline, params.desired])} */`;
}

const parser = createParser({
  commentPrefix: '--',
  input: z.object({
    config: z.object({
      allowDestructive: z.boolean(),
      error: z.boolean().optional(),
    }).optional(),
    baseline: z.string(),
    desired: z.string(),
  }),
  getOutput: ({input, header, defaultInput}) => {
    // map what the parser provides us into our SUT's inputs
    const config = {...(defaultInput as typeof input)?.config, ...input.config};
    try {
      const result = fakeSqlDiffer({
        baseline: input.baseline,
        desired: input.desired,
        allowDestructive: config?.allowDestructive || false,
      });
      return result;
    } catch (error) {
      if (config.error) return String(error);
      throw error;
    }
  },
});

test('createParser registers tests from matching fixture files', async () => {
  await using fixtureDir = await makeTempDir();
  const fixturePath = path.join(fixtureDir.path, 'fixtures.sql');

  await fs.writeFile(
    fixturePath,
    dedent`
      -- default input: {"config":{"allowDestructive":false}}

      -- #region: emits diff output
      -- baseline:
      create table users (id integer primary key);
      -- desired:
      create table users (id integer primary key, name text);
      -- output:
      /* idk the diff: ["create table users (id integer primary key);","create table users (id integer primary key, name text);"] */
      -- #endregion

      -- #region: derives thrown output from config and input
      -- config: {"allowDestructive":false,"error":true}
      -- baseline:
      drop table foo;
      -- desired:
      drop table bar;
      -- error: "baseline had drop but allowDestructive is false"
      -- #endregion
    `,
  );

  const groups: string[] = [];
  const tests: {group: string | undefined; test: string, run: () => unknown}[] = [];

  parser.registerTests({
    argv: ['vitest'],
    glob: fixturePath,
    describe: async (name, run) => {
      groups.push(name);
      run();
    },
    test: async (name, run) => {
      tests.push({group: groups.at(-1)?.split('/').pop(), test: name, run});
    },
    expect,
  });

  expect(tests).toMatchObject([
    {group: 'fixtures.sql', test: 'emits diff output'},
    {group: 'fixtures.sql', test: 'derives thrown output from config and input'},
  ]);
});

test('createParser rewrites fixture files when argv includes --update', async () => {
  await using fixtureDir = await makeTempDir();
  const fixturePath = path.join(fixtureDir.path, 'fixtures.sql');

  await fs.writeFile(
    fixturePath,
    dedent`
      -- default input: {"config":{"allowDestructive":false}}

      -- #region: rewrites output
      -- baseline:
      select 1;
      -- desired:
      select 2;
      -- output:
      stale output
      -- #endregion

      -- #region: preserves unchanged sentinel
      -- baseline:
      select 3;
      -- desired:
      select 3;
      -- output:
      diff: select 3;
      -- #endregion

      -- #region: rewrites thrown output
      -- config: {"allowDestructive":false,"error":true}
      -- baseline:
      drop table foo;
      -- desired:
      drop table bar;
      -- #endregion
    `,
  );

  const tests = [] as Function[];
  parser.registerTests({
    argv: ['vitest', '--update'],
    glob: fixturePath,
    describe: async (_name, run) => run(),
    test: async (_name, run) => tests.push(run),
    expect,
  });

  for (const test of tests) {
    await test();
  }

  expect(await fs.readFile(fixturePath, 'utf8')).toBe(
    dedent`
      -- default input: {"config":{"allowDestructive":false}}

      -- #region: rewrites output
      -- baseline:
      select 1;
      -- desired:
      select 2;
      -- output:
      /* idk the diff: ["select 1;","select 2;"] */
      -- #endregion

      -- #region: preserves unchanged sentinel
      -- baseline:
      select 3;
      -- desired:
      select 3;
      -- output:
      /* idk the diff: ["select 3;","select 3;"] */
      -- #endregion

      -- #region: rewrites thrown output
      -- config: {"allowDestructive":false,"error":true}
      -- baseline:
      drop table foo;
      -- desired:
      drop table bar;
      -- output:
      Error: baseline had drop but allowDestructive is false
      -- #endregion
    `,
  );
});

async function makeTempDir() {
  const tempPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sql-fixture-parser-'));
  return {
    path: tempPath,
    async [Symbol.asyncDispose]() {
      await fs.rm(tempPath, {recursive: true, force: true});
    },
  };
}
