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

  await expect(fs.readFile(path.join(root, 'counter-sql/.generated/get.sql.ts'), 'utf8')).resolves.toContain('counter');
  await expect(fs.stat(path.join(root, 'main-sql/.generated/get.sql.ts'))).rejects.toMatchObject({code: 'ENOENT'});

  void cwd;
});

test('generate prints the files it updated', async () => {
  const root = await createTempFixtureRoot('cli-generate-output');
  await writeFixtureFiles(root, {
    'sqlfu.config.ts': dedent`
      export default {
        definitions: './definitions.sql',
        queries: './sql',
      };
    `,
    'definitions.sql': dedent`
      create table posts (
        id integer primary key,
        title text not null
      );
    `,
    'sql/get-posts.sql': 'select id, title from posts order by id;',
  });

  using cwd = chdir(root);

  const output = await runCli(['generate']);

  expect(output).toContain('Updated generated files:');
  expect(output).toContain('sql/.generated/get-posts.sql.ts');
  expect(output).toContain('sql/.generated/index.ts');
  expect(output).toContain('sql/.generated/queries.ts');
  expect(output).toContain('sql/.generated/tables.ts');
  expect(output).toContain('.sqlfu/query-catalog.json');

  void cwd;
});

test("generate with authority 'live_schema' refuses an empty live database when the project has migrations", async () => {
  const root = await createTempFixtureRoot('cli-generate-live-schema-preflight');
  await writeFixtureFiles(root, {
    'sqlfu.config.ts': dedent`
      export default {
        db: './app.db',
        definitions: './definitions.sql',
        migrations: './migrations',
        queries: './sql',
        generate: {
          authority: 'live_schema',
        },
      };
    `,
    'definitions.sql': dedent`
      create table posts (
        id integer primary key,
        title text not null
      );
    `,
    'migrations/2026-05-14T00.00.00.000Z_create_posts.sql': dedent`
      create table posts (
        id integer primary key,
        title text not null
      );
    `,
    'sql/list-posts.sql': 'select id, title from posts order by id;',
  });

  using cwd = chdir(root);

  const result = await runCliWithExit(['generate']);

  expect(result).toMatchObject({exitCode: 1});
  expect(result.output).toContain('sqlfu generate');
  expect(result.output).toMatch(/empty live database|no live schema/u);
  expect(result.output).toContain('schema definitions');
  expect(result.output).toContain('pending migrations');
  expect(result.output).toContain('sqlfu migrate');
  await expect(fs.stat(path.join(root, 'sql/.generated/list-posts.sql.ts'))).rejects.toMatchObject({code: 'ENOENT'});

  void cwd;
});

test("generate with authority 'live_schema' explains definitions-only empty databases without suggesting migrate", async () => {
  const root = await createTempFixtureRoot('cli-generate-live-schema-definitions-preflight');
  await writeFixtureFiles(root, {
    'sqlfu.config.ts': dedent`
      export default {
        db: './app.db',
        definitions: './definitions.sql',
        queries: './sql',
        generate: {
          authority: 'live_schema',
        },
      };
    `,
    'definitions.sql': dedent`
      create table posts (
        id integer primary key,
        title text not null
      );
    `,
    'sql/list-posts.sql': 'select id, title from posts order by id;',
  });

  using cwd = chdir(root);

  const result = await runCliWithExit(['generate']);

  expect(result).toMatchObject({exitCode: 1});
  expect(result.output).toContain('schema definitions');
  expect(result.output).not.toContain('sqlfu migrate');
  expect(result.output).toContain('sqlfu sync');
  expect(result.output).toContain("'desired_schema'");
  expect(result.output).not.toContain("'migrations'");
  await expect(fs.stat(path.join(root, 'sql/.generated/list-posts.sql.ts'))).rejects.toMatchObject({code: 'ENOENT'});

  void cwd;
});

test('database commands use a project-local sqlite database when config omits db', async () => {
  const root = await createTempFixtureRoot('cli-default-db');
  await writeFixtureFiles(root, {
    'sqlfu.config.ts': dedent`
      export default {
        definitions: './definitions.sql',
        migrations: './migrations',
        queries: './sql',
      };
    `,
    'definitions.sql': dedent`
      create table posts (
        id integer primary key,
        title text not null
      );
    `,
    'migrations/2026-05-06T00.00.00.000Z_create_posts.sql': dedent`
      create table posts (
        id integer primary key,
        title text not null
      );
    `,
    'sql/list-posts.sql': 'select id, title from posts order by id;',
  });

  using cwd = chdir(root);

  await runCli(['migrate', '--yes']);
  const defaultDb = await fs.stat(path.join(root, '.sqlfu/app.db'));
  expect(defaultDb.isFile()).toBe(true);

  await runCli(['check']);
  await runCli(['sync']);

  void cwd;
});

test('format rewrites .sql files from a positional glob', async () => {
  const root = await createTempFixtureRoot('cli-format');
  await writeFixtureFiles(root, {
    'sql/get-posts.sql': 'SELECT * FROM posts WHERE id=1;\n',
    'sql/nested/get-comments.sql': 'SELECT id, body FROM comments ORDER BY id;',
  });

  using cwd = chdir(root);

  const output = await runCli(['format', 'sql/**/*.sql']);

  expect(output).toContain('Formatted files:');
  expect(output).toContain('sql/get-posts.sql');
  expect(output).toContain('sql/nested/get-comments.sql');
  await expect(fs.readFile(path.join(root, 'sql/get-posts.sql'), 'utf8')).resolves.toBe(
    'select *\nfrom posts\nwhere id = 1;\n',
  );
  await expect(fs.readFile(path.join(root, 'sql/nested/get-comments.sql'), 'utf8')).resolves.toBe(
    'select id, body\nfrom comments\norder by id;\n',
  );

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

  await expect(fs.readFile(path.join(root, 'counter-sql/.generated/get.sql.ts'), 'utf8')).resolves.toContain('counter');

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
  if (project.initialized && !('inline' in project)) {
    expect(path.normalize(project.config.definitions)).toBe(path.join(projectRoot, 'definitions.sql'));
    expect(path.normalize(project.config.queries)).toBe(path.join(projectRoot, 'sql'));
  }

  void cwd;
});

async function runCli(argv: string[], cli?: Awaited<ReturnType<typeof createSqlfuCli>>) {
  const result = await runCliWithExit(argv, cli);
  if (result.exitCode === 0) {
    return result.output;
  }
  throw new CliExit(result.exitCode);
}

async function runCliWithExit(argv: string[], cli?: Awaited<ReturnType<typeof createSqlfuCli>>) {
  const output: string[] = [];
  const logger = {
    info(...args: unknown[]) {
      output.push(args.map(String).join(' '));
    },
    error(...args: unknown[]) {
      output.push(args.map(String).join(' '));
    },
  };
  try {
    if (cli) {
      await cli.run({
        argv,
        logger,
        process: {
          exit(code) {
            throw new CliExit(code);
          },
        },
      });
    } else {
      await runSqlfuCli(argv, {
        logger,
        process: {
          exit(code) {
            throw new CliExit(code);
          },
        },
      });
    }
  } catch (error) {
    if (error instanceof CliExit) {
      return {exitCode: error.code, output: output.join('\n')};
    }
    throw error;
  }

  return {exitCode: 0, output: output.join('\n')};
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
