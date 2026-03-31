import dedent from 'dedent';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect, test} from 'vitest';

import {generateQueryTypes} from '../src/typegen/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sqlite3defBinaryPath = path.join(packageRoot, '.sqlfu', 'bin', 'sqlite3def');

test('generate writes wrappers and a barrel for every checked-in query', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: baseDefinitionsSql,
    sqlFiles: {
      'sql/list-post-summaries.sql': dedent`
        select
          id,
          slug,
          title,
          published_at,
          excerpt
        from post_summaries
        where published_at is not null
        order by published_at desc;
      `,
      'sql/find-post-by-slug.sql': dedent`
        select
          id,
          slug,
          title,
          published_at,
          body as excerpt
        from posts
        where slug = :slug
        limit 1;
      `,
    },
  });

  await project.generate();

  await expect(project.readFile('sql/index.ts')).resolves.toMatch(/list-post-summaries\.js/);
  await expect(project.readFile('sql/index.ts')).resolves.toMatch(/find-post-by-slug\.js/);
  await expect(project.readFile('sql/list-post-summaries.ts')).resolves.toMatch(/export async function listPostSummaries/);
  await expect(project.readFile('sql/find-post-by-slug.ts')).resolves.toMatch(/export async function findPostBySlug/);
  await expect(project.readFile('typesql.json')).resolves.toContain('"includeCrudTables": []');
});

test('generate emits named param types and a nullable single-row result for limit 1 queries', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: baseDefinitionsSql,
    sqlFiles: {
      'sql/find-post-by-slug.sql': dedent`
        select
          id,
          slug,
          title,
          published_at,
          body as excerpt
        from posts
        where slug = :slug
        limit 1;
      `,
    },
  });

  await project.generate();

  await expect(project.readFile('sql/find-post-by-slug.ts')).resolves.toMatch(/export type FindPostBySlugParams = \{/);
  await expect(project.readFile('sql/find-post-by-slug.ts')).resolves.toMatch(/slug: string;/);
  await expect(project.readFile('sql/find-post-by-slug.ts')).resolves.toMatch(
    /findPostBySlug\(client: Client \| Transaction, params: FindPostBySlugParams\): Promise<FindPostBySlugResult \| null>/,
  );
  await expect(project.readFile('sql/find-post-by-slug.ts')).resolves.toMatch(/args: \[params\.slug\]/);
});

test('generate uses schema types for aliased selected columns instead of leaving any behind', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: baseDefinitionsSql,
    sqlFiles: {
      'sql/find-post-preview.sql': dedent`
        select
          id,
          slug,
          body as excerpt
        from posts
        order by id desc
        limit 5;
      `,
    },
  });

  await project.generate();

  await expect(project.readFile('sql/find-post-preview.ts')).resolves.toMatch(/id: number;/);
  await expect(project.readFile('sql/find-post-preview.ts')).resolves.toMatch(/slug: string;/);
  await expect(project.readFile('sql/find-post-preview.ts')).resolves.toMatch(/excerpt: string;/);
  await expect(project.readFile('sql/find-post-preview.ts')).resolves.not.toMatch(/:\s*any;/);
});

test('generate treats selected columns as required when the query narrows them with is not null', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: baseDefinitionsSql,
    sqlFiles: {
      'sql/find-published-post-by-slug.sql': dedent`
        select
          id,
          slug,
          title,
          published_at
        from posts
        where slug = :slug
          and published_at is not null
        limit 1;
      `,
    },
  });

  await project.generate();

  await expect(project.readFile('sql/find-published-post-by-slug.ts')).resolves.toMatch(/published_at: string;/);
  await expect(project.readFile('sql/find-published-post-by-slug.ts')).resolves.not.toMatch(/published_at\?: string;/);
});

test('generate preserves useful result types for queries that read through views', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: baseDefinitionsSql,
    sqlFiles: {
      'sql/list-post-summaries.sql': dedent`
        select
          id,
          slug,
          title,
          published_at,
          excerpt
        from post_summaries
        where published_at is not null
        order by published_at desc;
      `,
    },
  });

  await project.generate();

  await expect(project.readFile('sql/list-post-summaries.ts')).resolves.toMatch(/id: number;/);
  await expect(project.readFile('sql/list-post-summaries.ts')).resolves.toMatch(/slug: string;/);
  await expect(project.readFile('sql/list-post-summaries.ts')).resolves.toMatch(/title: string;/);
  await expect(project.readFile('sql/list-post-summaries.ts')).resolves.toMatch(/published_at: string;/);
  await expect(project.readFile('sql/list-post-summaries.ts')).resolves.toMatch(/excerpt: string;/);
});

test('generate infers simple expression aliases like substr in result types', async () => {
  await using project = await createGenerateFixture({
    definitionsSql: baseDefinitionsSql,
    sqlFiles: {
      'sql/list-post-cards.sql': dedent`
        select
          id,
          substr(body, 1, 20) as excerpt
        from posts
        order by id desc
        limit 10;
      `,
    },
  });

  await project.generate();

  await expect(project.readFile('sql/list-post-cards.ts')).resolves.toMatch(/id: number;/);
  await expect(project.readFile('sql/list-post-cards.ts')).resolves.toMatch(/excerpt: string;/);
});

async function createGenerateFixture(input: {
  definitionsSql: string;
  sqlFiles: Record<string, string>;
}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-generate-'));
  await fs.writeFile(path.join(root, 'definitions.sql'), `${dedent(input.definitionsSql).trim()}\n`);
  await fs.writeFile(
    path.join(root, 'sqlfu.config.ts'),
    dedent`
      export default {
        dbPath: './app.db',
        snapshotFile: './snapshot.sql',
        definitionsPath: './definitions.sql',
        sqlDir: './sql',
        tempDir: './.sqlfu',
        tempDbPath: './.sqlfu/typegen.db',
        typesqlConfigPath: './typesql.json',
      };
    `,
  );

  for (const [relativePath, contents] of Object.entries(input.sqlFiles)) {
    const fullPath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(fullPath), {recursive: true});
    await fs.writeFile(fullPath, `${dedent(contents).trim()}\n`);
  }

  return {
    async generate() {
      await generateQueryTypes({
        cwd: root,
        sqlite3defBinaryPath,
      });
    },
    async readFile(relativePath: string) {
      return fs.readFile(path.join(root, relativePath), 'utf8');
    },
    async [Symbol.asyncDispose]() {
      await fs.rm(root, {recursive: true, force: true});
    },
  };
}

const baseDefinitionsSql = dedent`
  create table posts (
    id integer primary key,
    slug text not null unique,
    title text not null,
    body text not null,
    published_at text,
    created_at text not null default current_timestamp
  );

  create view post_summaries as
  select
    id,
    slug,
    title,
    published_at,
    substr(body, 1, 160) as excerpt
  from posts;
`;
