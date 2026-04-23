import dedent from 'dedent';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {ts} from 'ts-morph';
import {expect, test} from 'vitest';

import {createNodeSqliteClient} from '../../src/index.js';
import {generateQueryTypes} from '../../src/typegen/index.js';
import {createTempFixtureRoot, withTrailingNewline, writeFixtureFiles} from '../fs-fixture.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Runtime-behaviour tests for `sqlfu generate`. The text-shape snapshot + TypeScript
 * compile pass lives in `fixtures.test.ts`; this file covers the things fixtures can't:
 * actually importing the transpiled wrapper, calling it against a real sqlite database,
 * and asserting on error messages / failure modes. One test per path that has observable
 * runtime behaviour different from a sibling (validator flavour × prettyErrors combination,
 * metadata-mode configs that the emitter treats specially, etc.).
 */

test('generate omits the migrations bundle when migrations is not configured', async () => {
  await using project = await createRuntimeFixture({
    definitionsSql: `create table posts (id integer primary key, slug text not null);`,
    files: {
      'sql/list-posts.sql': `select id, slug from posts;`,
    },
    omitMigrations: true,
  });

  await project.generate();

  expect(await project.fileExists('migrations/.generated/migrations.ts')).toBe(false);
  expect(await project.fileExists('sql/.generated/index.ts')).toBe(true);
});

test('generate with validator: zod validates params and rows at runtime', async () => {
  await using project = await createRuntimeFixture({
    definitionsSql: `create table posts (id integer primary key, slug text not null, title text);`,
    files: {
      'sql/find-post-by-slug.sql': `select id, slug, title from posts where slug = :slug limit 1;`,
    },
    config: {generate: {validator: 'zod'}},
  });

  await project.generate();
  await project.applyStatements(`insert into posts (id, slug, title) values (1, 'hello', 'Hello');`);

  const mod = await project.importTranspiledModule<{
    findPostBySlug: {
      (client: unknown, params: {slug: string}): Promise<{id: number; slug: string; title: string | null} | null>;
      Params: {parse: (value: unknown) => unknown};
      Result: {parse: (value: unknown) => unknown};
      sql: string;
    };
  }>('sql/.generated/find-post-by-slug.sql.ts');

  using database = project.openDatabase();
  const client = createNodeSqliteClient(database.database);

  await expect(mod.findPostBySlug(client, {slug: 'hello'})).resolves.toMatchObject({
    id: 1,
    slug: 'hello',
    title: 'Hello',
  });

  // zod's `prettifyError` formats the issue list into a readable per-line message; the test
  // just checks that the slug issue makes it to the thrown Error's message.
  await expect(mod.findPostBySlug(client, {slug: 42 as unknown as string})).rejects.toThrow(
    /Invalid input[\s\S]+slug/,
  );

  // Result-schema parse path — feed the wrapper a client that returns rows with a bogus `id`
  // so the post-query validation fires.
  const badClient = {
    ...client,
    all: async () => [{id: 'not-a-number', slug: 'oops', title: null}],
  };
  await expect(mod.findPostBySlug(badClient as never, {slug: 'x'})).rejects.toThrow(
    /Invalid input[\s\S]+id/,
  );

  expect(typeof mod.findPostBySlug.sql).toBe('string');
  expect(mod.findPostBySlug.sql).toContain('from posts where slug = ?');
});

test('generate with validator: valibot validates inputs at runtime via standard schema', async () => {
  await using project = await createRuntimeFixture({
    definitionsSql: dedent`
      create table posts (
        id integer primary key,
        slug text not null,
        title text,
        status text not null check (status in ('draft', 'published'))
      );
    `,
    files: {
      'sql/find-post-by-slug.sql': `select id, slug, title, status from posts where slug = :slug limit 1;`,
    },
    config: {generate: {validator: 'valibot'}},
  });

  await project.generate();
  await project.applyStatements(`insert into posts (id, slug, title, status) values (1, 'hello', 'Hello', 'draft');`);

  const mod = await project.importTranspiledModule<{
    findPostBySlug: (client: unknown, params: {slug: string}) => Promise<unknown>;
  }>('sql/.generated/find-post-by-slug.sql.ts');

  using database = project.openDatabase();
  const client = createNodeSqliteClient(database.database);

  await expect(mod.findPostBySlug(client, {slug: 'hello'})).resolves.toMatchObject({
    slug: 'hello',
    status: 'draft',
  });
  // Valibot's pretty path inlines the Standard Schema result-guard + calls the re-exported
  // `prettifyStandardSchemaError` for a readable message.
  await expect(mod.findPostBySlug(client, {slug: 42 as unknown as string})).rejects.toThrow(
    /Invalid type[\s\S]+slug/,
  );
});

test('generate with validator: zod-mini validates at runtime via standard schema', async () => {
  await using project = await createRuntimeFixture({
    definitionsSql: `create table posts (id integer primary key, slug text not null, title text);`,
    files: {
      'sql/find-post-by-slug.sql': `select id, slug, title from posts where slug = :slug limit 1;`,
    },
    config: {generate: {validator: 'zod-mini'}},
  });

  await project.generate();
  await project.applyStatements(`insert into posts (id, slug, title) values (1, 'hello', 'Hello');`);

  const mod = await project.importTranspiledModule<{
    findPostBySlug: (client: unknown, params: {slug: string}) => Promise<unknown>;
  }>('sql/.generated/find-post-by-slug.sql.ts');

  using database = project.openDatabase();
  const client = createNodeSqliteClient(database.database);

  await expect(mod.findPostBySlug(client, {slug: 'hello'})).resolves.toMatchObject({
    id: 1,
    slug: 'hello',
    title: 'Hello',
  });
  await expect(mod.findPostBySlug(client, {slug: 42 as unknown as string})).rejects.toThrow(
    /Invalid input[\s\S]+slug/,
  );
});

test('generate with validator: arktype validates at runtime via standard schema', async () => {
  await using project = await createRuntimeFixture({
    definitionsSql: dedent`
      create table posts (
        id integer primary key,
        slug text not null,
        title text,
        status text not null check (status in ('draft', 'published'))
      );
    `,
    files: {
      'sql/find-post-by-slug.sql': `select id, slug, title, status from posts where slug = :slug limit 1;`,
    },
    config: {generate: {validator: 'arktype'}},
  });

  await project.generate();
  await project.applyStatements(`insert into posts (id, slug, title, status) values (1, 'hello', 'Hello', 'draft');`);

  const mod = await project.importTranspiledModule<{
    findPostBySlug: (client: unknown, params: {slug: string}) => Promise<unknown>;
  }>('sql/.generated/find-post-by-slug.sql.ts');

  using database = project.openDatabase();
  const client = createNodeSqliteClient(database.database);

  await expect(mod.findPostBySlug(client, {slug: 'hello'})).resolves.toMatchObject({
    slug: 'hello',
    status: 'draft',
  });
  // Arktype's standard-schema output feeds through the same prettifyStandardSchemaError
  // helper as valibot / zod-mini, so the message is also a per-issue formatted string.
  await expect(mod.findPostBySlug(client, {slug: 42 as unknown as string})).rejects.toThrow(/slug/);
});

test('generate with prettyErrors: false + validator: zod lets the raw ZodError propagate', async () => {
  await using project = await createRuntimeFixture({
    definitionsSql: `create table posts (id integer primary key, slug text not null);`,
    files: {
      'sql/find-post-by-slug.sql': `select id, slug from posts where slug = :slug limit 1;`,
    },
    config: {generate: {validator: 'zod', prettyErrors: false}},
  });

  await project.generate();

  const mod = await project.importTranspiledModule<{
    findPostBySlug: (client: unknown, params: {slug: string}) => Promise<unknown>;
  }>('sql/.generated/find-post-by-slug.sql.ts');

  using database = project.openDatabase();
  const client = createNodeSqliteClient(database.database);

  // Without pretty errors we're calling `Schema.parse(...)` directly, so the failure surfaces
  // as a raw ZodError with `.issues` — no prettified "Validation failed" wrapper string.
  await expect(mod.findPostBySlug(client, {slug: 42 as unknown as string})).rejects.toSatisfy((error: unknown) => {
    if (!(error instanceof Error)) return false;
    if (error.message.includes('Validation failed')) return false;
    return Array.isArray((error as unknown as {issues?: unknown}).issues);
  });
});

for (const validator of ['valibot', 'zod-mini', 'arktype'] as const) {
  test(`generate with prettyErrors: false + validator: ${validator} throws raw issues inline`, async () => {
    await using project = await createRuntimeFixture({
      definitionsSql: `create table posts (id integer primary key, slug text not null);`,
      files: {
        'sql/find-post-by-slug.sql': `select id, slug from posts where slug = :slug limit 1;`,
      },
      config: {generate: {validator, prettyErrors: false}},
    });

    await project.generate();

    const mod = await project.importTranspiledModule<{
      findPostBySlug: (client: unknown, params: {slug: string}) => Promise<unknown>;
    }>('sql/.generated/find-post-by-slug.sql.ts');

    using database = project.openDatabase();
    const client = createNodeSqliteClient(database.database);

    // Standard-schema flavours throw an `Object.assign(new Error('Validation failed'), {issues})`
    // so consumers can reach the raw issue list without another import.
    await expect(mod.findPostBySlug(client, {slug: 42 as unknown as string})).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof Error)) return false;
      return Array.isArray((error as unknown as {issues?: unknown}).issues);
    });
  });
}

async function createRuntimeFixture(input: {
  definitionsSql: string;
  files: Record<string, string>;
  config?: {
    generate?: {
      validator?: 'arktype' | 'valibot' | 'zod' | 'zod-mini' | null;
      prettyErrors?: boolean;
      sync?: boolean;
      importExtension?: '.js' | '.ts';
    };
  };
  omitMigrations?: boolean;
}) {
  const root = await createTempFixtureRoot('generate-runtime');
  const dbPath = path.join(root, 'app.db');
  const configBodyLines = [
    `db: './app.db',`,
    ...(input.omitMigrations ? [] : [`migrations: './migrations',`]),
    `definitions: './definitions.sql',`,
    `queries: './sql',`,
    ...(input.config?.generate ? [`generate: ${JSON.stringify(input.config.generate)},`] : []),
  ];
  await writeFixtureFiles(root, {
    'definitions.sql': input.definitionsSql,
    'sqlfu.config.ts': dedent`
      export default {
        ${configBodyLines.join('\n        ')}
      };
    `,
    ...input.files,
  });

  await applyDefinitionsToDatabase(dbPath, input.definitionsSql);

  return {
    async generate() {
      await inWorkingDirectory(root, () => generateQueryTypes());
    },
    async applyStatements(sql: string) {
      await applyDefinitionsToDatabase(dbPath, sql);
    },
    openDatabase() {
      const database = new DatabaseSync(dbPath);
      return {
        database,
        [Symbol.dispose]() {
          database.close();
        },
      };
    },
    async fileExists(relativePath: string): Promise<boolean> {
      try {
        await fs.access(path.join(root, relativePath));
        return true;
      } catch {
        return false;
      }
    },
    /**
     * Transpile the generated .ts to .mjs with esnext module + target, rewrite bare
     * specifiers (`'sqlfu'`, `'zod'`, …) to absolute file URLs so Node's ESM loader can
     * resolve them outside the workspace node_modules, then import the rewritten file.
     */
    async importTranspiledModule<TModule>(relativePath: string): Promise<TModule> {
      const sourcePath = path.join(root, relativePath);
      const source = await fs.readFile(sourcePath, 'utf8');
      const outputPath = sourcePath.replace(/\.ts$/, '.mjs');
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ESNext,
        },
      });
      const resolvedSource = rewriteBareImports(transpiled.outputText);
      await fs.writeFile(outputPath, resolvedSource);
      return import(pathToFileURL(outputPath).href) as Promise<TModule>;
    },
    async [Symbol.asyncDispose]() {
      await fs.rm(root, {recursive: true, force: true});
    },
  };
}

async function inWorkingDirectory<TResult>(cwd: string, fn: () => Promise<TResult>): Promise<TResult> {
  const previousCwd = process.cwd();
  process.chdir(cwd);
  try {
    return await fn();
  } finally {
    process.chdir(previousCwd);
  }
}

async function applyDefinitionsToDatabase(dbPath: string, definitionsSql: string) {
  const database = new DatabaseSync(dbPath);
  const client = createNodeSqliteClient(database);
  try {
    await client.raw(withTrailingNewline(dedent(definitionsSql)));
  } finally {
    database.close();
  }
}

/**
 * The transpiled .mjs lives in os.tmpdir() where `import 'zod'` / `import 'sqlfu'` etc.
 * can't be resolved by Node's default ESM walk. Rewrite bare specifiers in `from "…"`
 * clauses to absolute file URLs pointing at the packages the workspace already resolved.
 * sqlfu specifically points at the `.ts` source — the vitest process has a TS loader in
 * place, so importing a `.ts` file works.
 */
function rewriteBareImports(source: string): string {
  const mapping: Record<string, string> = {
    sqlfu: pathToFileURL(path.join(packageRoot, 'src', 'index.ts')).href,
    zod: pathToFileURL(path.join(packageRoot, 'node_modules', 'zod', 'index.js')).href,
    'zod/mini': pathToFileURL(path.join(packageRoot, 'node_modules', 'zod', 'mini', 'index.js')).href,
    valibot: pathToFileURL(path.join(packageRoot, 'node_modules', 'valibot', 'dist', 'index.mjs')).href,
    arktype: pathToFileURL(path.join(packageRoot, 'node_modules', 'arktype', 'out', 'index.js')).href,
  };
  return source.replace(/from\s+["']([^"']+)["']/g, (match, specifier) => {
    const replacement = mapping[specifier];
    return replacement ? `from "${replacement}"` : match;
  });
}
