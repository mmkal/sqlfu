import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {ESLint, RuleTester} from 'eslint';
import {expect, test} from 'vitest';

import plugin, {formatSqlFileContents, resetQueryCache} from '../src/lint-plugin.js';

// ---------------------------------------------------------------------------
// query-naming
// ---------------------------------------------------------------------------

test('query-naming: flags an inline SQL template that duplicates a named .sql file', () => {
  using project = makeProject({
    'sqlfu.config.ts': `export default { queries: './sql' }`,
    'sql/list-users.sql': `select id, name from users order by name`,
  });

  ruleTester.run('query-naming', plugin.rules!['query-naming'] as any, {
    valid: [],
    invalid: [
      {
        filename: project.file('src/handler.js'),
        code: 'const rows = client.all(`select id, name from users order by name`)',
        errors: [{message: /list-users\.sql.*listUsers/}],
      },
    ],
  });
});

test('query-naming: ignores ad-hoc SQL with no matching file', () => {
  using project = makeProject({
    'sqlfu.config.ts': `export default { queries: './sql' }`,
    'sql/list-users.sql': `select id, name from users order by name`,
  });

  ruleTester.run('query-naming', plugin.rules!['query-naming'] as any, {
    valid: [
      {
        filename: project.file('src/handler.js'),
        code: 'const x = client.all(`select count(*) from sessions`)',
      },
    ],
    invalid: [],
  });
});

test('query-naming: ignores parameterized templates (interpolations)', () => {
  using project = makeProject({
    'sqlfu.config.ts': `export default { queries: './sql' }`,
    'sql/list-users.sql': `select id, name from users where id = :userId`,
  });

  ruleTester.run('query-naming', plugin.rules!['query-naming'] as any, {
    valid: [
      {
        filename: project.file('src/handler.js'),
        code: 'const userId = 1; const rows = client.all(`select id, name from users where id = ${userId}`)',
      },
    ],
    invalid: [],
  });
});

test('query-naming: matches regardless of whitespace and keyword case', () => {
  using project = makeProject({
    'sqlfu.config.ts': `export default { queries: './sql' }`,
    'sql/list-users.sql': `SELECT id, name\nFROM users\nORDER BY name`,
  });

  ruleTester.run('query-naming', plugin.rules!['query-naming'] as any, {
    valid: [],
    invalid: [
      {
        filename: project.file('src/handler.js'),
        code: 'const rows = client.all(`   select id, name   from users order by name   `)',
        errors: 1,
      },
    ],
  });
});

test('query-naming: flags client.sql tagged template literals too', () => {
  using project = makeProject({
    'sqlfu.config.ts': `export default { queries: './sql' }`,
    'sql/list-users.sql': `select id from users`,
  });

  ruleTester.run('query-naming', plugin.rules!['query-naming'] as any, {
    valid: [],
    invalid: [
      {
        filename: project.file('src/handler.js'),
        code: 'const rows = await client.sql`select id from users`',
        errors: 1,
      },
    ],
  });
});

test('query-naming: uses nested path in the message for subdirectory queries', () => {
  using project = makeProject({
    'sqlfu.config.ts': `export default { queries: './sql' }`,
    'sql/users/list.sql': `select id from users`,
  });

  ruleTester.run('query-naming', plugin.rules!['query-naming'] as any, {
    valid: [],
    invalid: [
      {
        filename: project.file('src/handler.js'),
        code: 'const rows = client.all(`select id from users`)',
        errors: [{message: /users\/list\.sql/}],
      },
    ],
  });
});

test('query-naming: no-ops when there is no sqlfu.config', () => {
  using project = makeProject({
    'package.json': `{"name": "not-a-sqlfu-project"}`,
  });

  ruleTester.run('query-naming', plugin.rules!['query-naming'] as any, {
    valid: [
      {
        filename: project.file('src/handler.js'),
        code: 'const rows = client.all(`select id from users`)',
      },
    ],
    invalid: [],
  });
});

// ---------------------------------------------------------------------------
// format-sql (inline templates)
// ---------------------------------------------------------------------------

test('format-sql: flags an inline SQL template that is not formatted', () => {
  ruleTester.run('format-sql', plugin.rules!['format-sql'] as any, {
    valid: [],
    invalid: [
      {
        code: 'const rows = client.all(`SELECT * FROM users WHERE id=1`)',
        errors: [{message: /not formatted/}],
        // reapplyTemplateIndent adds the surrounding line's indent + two
        // spaces to subsequent lines so the body stays visually aligned.
        output: 'const rows = client.all(`select *\n  from users\n  where id = 1`)',
      },
    ],
  });
});

test('format-sql: leaves already-formatted SQL alone', () => {
  ruleTester.run('format-sql', plugin.rules!['format-sql'] as any, {
    valid: [
      {
        code: 'const rows = client.all(`\n  select *\n  from users\n  where id = 1\n`)',
      },
    ],
    invalid: [],
  });
});

test('format-sql: ignores parameterized (interpolated) templates', () => {
  ruleTester.run('format-sql', plugin.rules!['format-sql'] as any, {
    valid: [
      {
        code: 'const id = 1; const rows = client.all(`SELECT * FROM users WHERE id=${id}`)',
      },
    ],
    invalid: [],
  });
});

test('format-sql: flags client.sql tagged template literals too', () => {
  ruleTester.run('format-sql', plugin.rules!['format-sql'] as any, {
    valid: [],
    invalid: [
      {
        code: 'const rows = await client.sql`SELECT id FROM users`',
        errors: 1,
        output: 'const rows = await client.sql`select id\n  from users`',
      },
    ],
  });
});

test('format-sql: preserves template indentation on multi-line autofix', () => {
  ruleTester.run('format-sql', plugin.rules!['format-sql'] as any, {
    valid: [],
    invalid: [
      {
        code: ['function load() {', '  return client.all(`', '    SELECT id, name FROM users WHERE id = 1', '  `)', '}'].join('\n'),
        errors: 1,
        output: [
          'function load() {',
          '  return client.all(`',
          '    select id, name',
          '    from users',
          '    where id = 1',
          '  `)',
          '}',
        ].join('\n'),
      },
    ],
  });
});

// ---------------------------------------------------------------------------
// formatSqlFileContents (pure helper)
// ---------------------------------------------------------------------------

test('formatSqlFileContents: reformats a standalone .sql file body', () => {
  expect(formatSqlFileContents('SELECT * FROM users WHERE id=1;\n')).toBe('select *\nfrom users\nwhere id = 1;\n');
});

test('formatSqlFileContents: is a no-op on already-formatted content', () => {
  const input = 'select id, name\nfrom users\norder by name;\n';
  expect(formatSqlFileContents(input)).toBe(input);
});

test('formatSqlFileContents: preserves absence of trailing newline', () => {
  const output = formatSqlFileContents('SELECT * FROM users');
  expect(output.endsWith('\n')).toBe(false);
  expect(output).toMatch(/select \*/);
});

test('formatSqlFileContents: leaves empty / whitespace-only input alone', () => {
  expect(formatSqlFileContents('')).toBe('');
  expect(formatSqlFileContents('\n\n')).toBe('\n\n');
});

// ---------------------------------------------------------------------------
// format-sql over the `sql` processor (whole-file integration)
//
// RuleTester can't drive processors — it talks to the rule directly on the
// raw JS source — so we keep one end-to-end test per processor behavior we
// care about, driving the full `ESLint` class through `configs.recommended`.
// ---------------------------------------------------------------------------

test('format-sql (sql processor): autofixes an unformatted .sql file (whole-file replacement)', async () => {
  await using project = await makeAsyncProject({
    'sql/list-users.sql': 'SELECT * FROM users WHERE id=1;\n',
  });

  const [result] = await lintSqlFile(project, 'sql/list-users.sql', {fix: true});

  expect(result.messages).toHaveLength(0);
  expect(result.output).toBe('select *\nfrom users\nwhere id = 1;\n');
});

test('format-sql (sql processor): reports one message per unformatted file without --fix', async () => {
  await using project = await makeAsyncProject({
    'sql/list-users.sql': 'SELECT * FROM users WHERE id=1;\n',
  });

  const [result] = await lintSqlFile(project, 'sql/list-users.sql', {fix: false});

  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]).toMatchObject({
    ruleId: 'sqlfu/format-sql',
    message: expect.stringContaining('not formatted'),
  });
});

test('format-sql (sql processor): is a no-op on already-formatted .sql files', async () => {
  await using project = await makeAsyncProject({
    'sql/list-users.sql': 'select id, name\nfrom users\norder by name;\n',
  });

  const [result] = await lintSqlFile(project, 'sql/list-users.sql', {fix: true});

  expect(result.messages).toHaveLength(0);
  expect(result.output).toBeUndefined();
});

test('format-sql (sql processor): round-trips backticks and ${} without corruption', async () => {
  await using project = await makeAsyncProject({
    'sql/tricky.sql': 'SELECT `weird col`, "$" FROM t WHERE x=1;\n',
  });

  const [result] = await lintSqlFile(project, 'sql/tricky.sql', {fix: true});

  if (result.output) {
    expect(result.output).toContain('`weird col`');
    expect(result.output).not.toContain('\\`');
  }
});

// ---------------------------------------------------------------------------
// generated-query-freshness over the `sql` processor
// ---------------------------------------------------------------------------

test('generated-query-freshness: reports a missing generated query manifest for a query file', async () => {
  await using project = await makeAsyncProject({
    'sqlfu.config.ts': `export default { queries: './sql' }`,
    'sql/list-users.sql': 'select id, name\nfrom users\norder by name;\n',
  });

  const [result] = await lintSqlFile(project, 'sql/list-users.sql', {fix: false});

  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]).toMatchObject({
    ruleId: 'sqlfu/generated-query-freshness',
    message: expect.stringContaining('generated query manifest is missing'),
  });
  expect(result.messages[0]?.message).not.toContain('--config');
});

test('generated-query-freshness: includes the found config path when it is not the cwd default', async () => {
  await using project = await makeAsyncProject({
    'apps/counter/sqlfu.config.ts': `export default { queries: './sql' }`,
    'apps/counter/sql/list-users.sql': 'select id, name\nfrom users\norder by name;\n',
  });

  const [result] = await lintSqlFile(project, 'apps/counter/sql/list-users.sql', {fix: false});

  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]).toMatchObject({
    ruleId: 'sqlfu/generated-query-freshness',
    message: expect.stringContaining('run sqlfu generate --config apps/counter/sqlfu.config.ts'),
  });
});

test('generated-query-freshness: includes the found config path for generated manifest reconciliation', async () => {
  const querySql = 'select id, name\nfrom users\norder by name;\n';
  await using project = await makeAsyncProject({
    'apps/counter/sqlfu.config.ts': `export default { queries: './sql' }`,
    'apps/counter/sql/list-users.sql': querySql,
    'apps/counter/sql/.generated/queries.ts': queriesManifest([{sqlFile: 'list-users.sql', sourceSql: querySql}]),
    'apps/counter/sql/.generated/list-users.sql.ts': 'export {};\n',
    'apps/counter/sql/.generated/deleted-query.sql.ts': 'export {};\n',
  });

  const [result] = await lintProjectFile(project, 'apps/counter/sql/.generated/queries.ts', {fix: false});

  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]).toMatchObject({
    ruleId: 'sqlfu/generated-query-freshness',
    message: expect.stringContaining('run sqlfu generate --config apps/counter/sqlfu.config.ts'),
  });
});

test('generated-query-freshness: reports a missing generated wrapper for a query file', async () => {
  const querySql = 'select id, name\nfrom users\norder by name;\n';
  await using project = await makeAsyncProject({
    'sqlfu.config.ts': `export default { queries: './sql' }`,
    'sql/list-users.sql': querySql,
    'sql/.generated/queries.ts': queriesManifest([{sqlFile: 'list-users.sql', sourceSql: querySql}]),
  });

  const [result] = await lintSqlFile(project, 'sql/list-users.sql', {fix: false});

  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]).toMatchObject({
    ruleId: 'sqlfu/generated-query-freshness',
    message: expect.stringContaining('run sqlfu generate'),
  });
});

test('generated-query-freshness: reports stale generated query manifest SQL', async () => {
  const querySql = 'select id, name\nfrom users\norder by name;\n';
  await using project = await makeAsyncProject({
    'sqlfu.config.ts': `export default { queries: './sql' }`,
    'sql/list-users.sql': querySql,
    'sql/.generated/queries.ts': queriesManifest([{sqlFile: 'list-users.sql', sourceSql: 'select stale;\n'}]),
    'sql/.generated/list-users.sql.ts': 'export {};\n',
  });

  const [result] = await lintSqlFile(project, 'sql/list-users.sql', {fix: false});

  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]).toMatchObject({
    ruleId: 'sqlfu/generated-query-freshness',
    message: expect.stringContaining('stale'),
  });
});

test('generated-query-freshness: compares source query against the linted SQL text', async () => {
  const generatedSql = 'select id, name\nfrom users\norder by name;\n';
  const lintedSql = 'select id, name\nfrom users\nwhere active = 1\norder by name;\n';
  await using project = await makeAsyncProject({
    'sqlfu.config.ts': `export default { queries: './sql' }`,
    'sql/list-users.sql': generatedSql,
    'sql/.generated/queries.ts': queriesManifest([{sqlFile: 'list-users.sql', sourceSql: generatedSql}]),
    'sql/.generated/list-users.sql.ts': 'export {};\n',
  });

  const [result] = await lintSqlText(project, 'sql/list-users.sql', lintedSql, {fix: false});

  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]).toMatchObject({
    ruleId: 'sqlfu/generated-query-freshness',
    message: expect.stringContaining('stale'),
  });
});

test('generated-query-freshness: reports a source query missing from the generated query manifest', async () => {
  await using project = await makeAsyncProject({
    'sqlfu.config.ts': `export default { queries: './sql' }`,
    'sql/list-users.sql': 'select id, name\nfrom users\norder by name;\n',
    'sql/.generated/queries.ts': queriesManifest([]),
  });

  const [result] = await lintSqlFile(project, 'sql/list-users.sql', {fix: false});

  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]).toMatchObject({
    ruleId: 'sqlfu/generated-query-freshness',
    message: expect.stringContaining('does not include'),
  });
});

test('generated-query-freshness: accepts a generated query manifest with matching source SQL and wrapper', async () => {
  const querySql = 'select id, name\nfrom users\norder by name;\n';
  await using project = await makeAsyncProject({
    'sqlfu.config.ts': `export default { queries: './sql' }`,
    'sql/list-users.sql': querySql,
    'sql/.generated/queries.ts': queriesManifest([{sqlFile: 'list-users.sql', sourceSql: querySql}]),
    'sql/.generated/list-users.sql.ts': 'export {};\n',
  });

  const [result] = await lintSqlFile(project, 'sql/list-users.sql', {fix: false});

  expect(result.messages).toHaveLength(0);
});

test('generated-query-freshness: reports orphaned generated wrappers from the generated query manifest', async () => {
  const querySql = 'select id, name\nfrom users\norder by name;\n';
  await using project = await makeAsyncProject({
    'sqlfu.config.ts': `export default { queries: './sql' }`,
    'sql/list-users.sql': querySql,
    'sql/.generated/queries.ts': queriesManifest([{sqlFile: 'list-users.sql', sourceSql: querySql}]),
    'sql/.generated/list-users.sql.ts': 'export {};\n',
    'sql/.generated/deleted-query.sql.ts': 'export {};\n',
  });

  const [result] = await lintProjectFile(project, 'sql/.generated/queries.ts', {fix: false});

  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]).toMatchObject({
    ruleId: 'sqlfu/generated-query-freshness',
    message: expect.stringContaining("orphaned generated query wrapper 'deleted-query.sql.ts'"),
  });
});

test('generated-query-freshness: ignores sql files outside the configured queries directory', async () => {
  await using project = await makeAsyncProject({
    'sqlfu.config.ts': `export default { queries: './sql' }`,
    'other/list-users.sql': 'select id, name\nfrom users\norder by name;\n',
  });

  const [result] = await lintSqlFile(project, 'other/list-users.sql', {fix: false});

  expect(result.messages).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

interface SyncProject {
  root: string;
  file(relativePath: string): string;
  [Symbol.dispose](): void;
}

function makeProject(files: Record<string, string>): SyncProject {
  resetQueryCache();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlfu-lint-'));
  for (const [relativePath, contents] of Object.entries(files)) {
    const full = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(full), {recursive: true});
    fs.writeFileSync(full, contents);
  }
  return {
    root,
    file(relativePath: string) {
      return path.join(root, relativePath);
    },
    [Symbol.dispose]() {
      fs.rmSync(root, {recursive: true, force: true});
    },
  };
}

interface AsyncProject {
  root: string;
  [Symbol.asyncDispose](): Promise<void>;
}

async function makeAsyncProject(files: Record<string, string>): Promise<AsyncProject> {
  resetQueryCache();
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sqlfu-lint-'));
  for (const [relativePath, contents] of Object.entries(files)) {
    const full = path.join(root, relativePath);
    await fsp.mkdir(path.dirname(full), {recursive: true});
    await fsp.writeFile(full, contents);
  }
  return {
    root,
    async [Symbol.asyncDispose]() {
      await fsp.rm(root, {recursive: true, force: true});
    },
  };
}

async function lintSqlFile(project: AsyncProject, relativePath: string, {fix}: {fix: boolean}) {
  return lintProjectFile(project, relativePath, {fix});
}

async function lintSqlText(project: AsyncProject, relativePath: string, text: string, {fix}: {fix: boolean}) {
  const eslint = createProjectEslint(project, {fix});
  return eslint.lintText(text, {filePath: path.join(project.root, relativePath)});
}

async function lintProjectFile(project: AsyncProject, relativePath: string, {fix}: {fix: boolean}) {
  const eslint = createProjectEslint(project, {fix});
  return eslint.lintFiles([path.join(project.root, relativePath)]);
}

function createProjectEslint(project: AsyncProject, {fix}: {fix: boolean}) {
  const eslint = new ESLint({
    cwd: project.root,
    overrideConfigFile: true,
    overrideConfig: [...(plugin.configs?.recommended as any[])],
    fix,
  });
  return eslint;
}

function queriesManifest(entries: {sqlFile: string; sourceSql: string}[]): string {
  return [
    '// Generated by `sqlfu generate`. Do not edit.',
    '',
    ...entries.map((entry) => `export * from "./${entry.sqlFile}.js";`),
    ...(entries.length === 0 ? [] : ['']),
    'export const sqlfuQuerySources = [',
    ...entries.map(
      (entry) =>
        `\t{ sqlFile: ${JSON.stringify(entry.sqlFile)}, generatedFile: ${JSON.stringify(`${entry.sqlFile}.ts`)}, sourceSql: ${JSON.stringify(entry.sourceSql)} },`,
    ),
    '];',
    '',
  ].join('\n');
}
