import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {Linter} from 'eslint';
import {expect, test} from 'vitest';

import plugin from '../src/index.js';
import {resetQueryCache} from '../src/lib/load-queries.js';

test('flags an inline SQL template that duplicates a named .sql file', async () => {
  await using project = await setupProject({
    'sqlfu.config.ts': `export default { db: './app.db', migrations: './migrations', definitions: './definitions.sql', queries: './sql' }`,
    'sql/list-users.sql': `select id, name from users order by name`,
  });

  const messages = lintSource({
    project,
    filename: 'src/handler.js',
    source: `const rows = client.all(\`select id, name from users order by name\`)`,
  });

  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({
    ruleId: 'sqlfu/no-unnamed-inline-sql',
    message: expect.stringContaining('list-users.sql'),
  });
  expect(messages[0].message).toContain('listUsers');
});

test('does not flag ad-hoc SQL with no matching file', async () => {
  await using project = await setupProject({
    'sqlfu.config.ts': `export default { queries: './sql' }`,
    'sql/list-users.sql': `select id, name from users order by name`,
  });

  const messages = lintSource({
    project,
    filename: 'src/handler.js',
    source: `const x = client.all(\`select count(*) from sessions\`)`,
  });

  expect(messages).toHaveLength(0);
});

test('does not flag parameterized queries (template with interpolations)', async () => {
  await using project = await setupProject({
    'sqlfu.config.ts': `export default { queries: './sql' }`,
    'sql/list-users.sql': `select id, name from users where id = :userId`,
  });

  const messages = lintSource({
    project,
    filename: 'src/handler.js',
    source: `
      const userId = 1
      const rows = client.all(\`select id, name from users where id = \${userId}\`)
    `,
  });

  expect(messages).toHaveLength(0);
});

test('matches regardless of whitespace and keyword casing', async () => {
  await using project = await setupProject({
    'sqlfu.config.ts': `export default { queries: './sql' }`,
    'sql/list-users.sql': `SELECT id, name\nFROM users\nORDER BY name`,
  });

  const messages = lintSource({
    project,
    filename: 'src/handler.js',
    source: `const rows = client.all(\`   select id, name   from users order by name   \`)`,
  });

  expect(messages).toHaveLength(1);
  expect(messages[0].ruleId).toBe('sqlfu/no-unnamed-inline-sql');
});

test('flags client.sql tagged template literals too', async () => {
  await using project = await setupProject({
    'sqlfu.config.ts': `export default { queries: './sql' }`,
    'sql/list-users.sql': `select id from users`,
  });

  const messages = lintSource({
    project,
    filename: 'src/handler.js',
    source: `const rows = await client.sql\`select id from users\``,
  });

  expect(messages).toHaveLength(1);
  expect(messages[0].ruleId).toBe('sqlfu/no-unnamed-inline-sql');
});

test('flags nested query directories using relative name', async () => {
  await using project = await setupProject({
    'sqlfu.config.ts': `export default { queries: './sql' }`,
    'sql/users/list.sql': `select id from users`,
  });

  const messages = lintSource({
    project,
    filename: 'src/handler.js',
    source: `const rows = client.all(\`select id from users\`)`,
  });

  expect(messages).toHaveLength(1);
  expect(messages[0].message).toContain('users/list.sql');
});

test('is a no-op when there is no sqlfu.config', async () => {
  await using project = await setupProject({
    'package.json': `{"name": "not-a-sqlfu-project"}`,
  });

  const messages = lintSource({
    project,
    filename: 'src/handler.js',
    source: `const rows = client.all(\`select id from users\`)`,
  });

  expect(messages).toHaveLength(0);
});

// ---

interface Project {
  root: string;
  [Symbol.asyncDispose](): Promise<void>;
}

async function setupProject(files: Record<string, string>): Promise<Project> {
  resetQueryCache();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-eslint-'));
  for (const [relativePath, contents] of Object.entries(files)) {
    const full = path.join(root, relativePath);
    await fs.mkdir(path.dirname(full), {recursive: true});
    await fs.writeFile(full, contents);
  }
  return {
    root,
    async [Symbol.asyncDispose]() {
      await fs.rm(root, {recursive: true, force: true});
    },
  };
}

function lintSource(args: {project: Project; filename: string; source: string}) {
  const linter = new Linter({configType: 'flat', cwd: args.project.root});
  const messages = linter.verify(
    args.source,
    [
      {
        files: ['**/*.{js,cjs,mjs,ts,tsx,jsx}'],
        plugins: {sqlfu: plugin as any},
        rules: {'sqlfu/no-unnamed-inline-sql': 'error'},
        languageOptions: {ecmaVersion: 2022, sourceType: 'module'},
      },
    ],
    path.join(args.project.root, args.filename),
  );
  return messages;
}
