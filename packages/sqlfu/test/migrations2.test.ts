import dedent from 'dedent';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {createClient} from '@libsql/client';
import {createRouterClient} from '@orpc/server';
import {expect, test} from 'vitest';

import {migrations2Router} from '../src/migrations2.js';
import type {SqlfuProjectConfig} from '../src/core/types.js';

test('draft creates the first draft migration from definitions.sql when there is no migration history yet', async () => {
  await using fixture = await createMigrationsFixture('first-draft-from-empty-history', {
    definitionsSql: dedent`
      create table person(name text not null);
    `,
  });

  await fixture.client.draft({name: 'create_person'});

  expect(await fixture.dumpFs()).toMatchInlineSnapshot(`
    "definitions.sql
      create table person(name text not null);
    migrations/
      20260410000000_create_person.sql
        -- status: draft
        create table person(name text not null);
    "
  `);
});

test('finalize validates the draft and flips only the metadata line in place', async () => {
  await using fixture = await createMigrationsFixture('finalize-in-place', {
    definitionsSql: dedent`
      create table person(name text not null);
    `,
    migrations: {
      'migrations/20260410000000_create_person.sql': dedent`
        -- status: draft
        create table person(name text not null);
      `,
    },
  });

  await fixture.client.finalize();

  expect(await fixture.dumpFs()).toMatchInlineSnapshot(`
    "definitions.sql
      create table person(name text not null);
    migrations/
      20260410000000_create_person.sql
        -- status: final
        create table person(name text not null);
    "
  `);
});

test('draft appends new generated SQL to the existing draft without discarding manual edits', async () => {
  await using fixture = await createMigrationsFixture('append-to-existing-draft', {
    definitionsSql: dedent`
      create table person(name text not null);
      create table pet(name text not null);
      create index pet_name_idx on pet(name);
    `,
    migrations: {
      'migrations/20260410000000_create_person.sql': dedent`
        -- status: final
        create table person(name text not null);
      `,
      'migrations/20260410000001_add_pet.sql': dedent`
        -- status: draft
        create table pet(name text not null);
        insert into pet(name) values ('spot');
      `,
    },
  });

  await fixture.client.draft();

  expect(await fixture.dumpFs()).toMatchInlineSnapshot(`
    "definitions.sql
      create table person(name text not null);
      create table pet(name text not null);
      create index pet_name_idx on pet(name);
    migrations/
      20260410000000_create_person.sql
        -- status: final
        create table person(name text not null);
      20260410000001_add_pet.sql
        -- status: draft
        create table pet(name text not null);
        insert into pet(name) values ('spot');
        
        create index pet_name_idx on pet(name);
    "
  `);
});

test('draft is a no-op when the existing draft already matches definitions.sql', async () => {
  await using fixture = await createMigrationsFixture('draft-no-op', {
    definitionsSql: dedent`
      create table person(name text not null);
      create table pet(name text not null);
    `,
    migrations: {
      'migrations/20260410000000_create_person.sql': dedent`
        -- status: final
        create table person(name text not null);
      `,
      'migrations/20260410000001_add_pet.sql': dedent`
        -- status: draft
        create table pet(name text not null);
      `,
    },
  });

  const before = await fixture.readFile('migrations/20260410000001_add_pet.sql');

  await fixture.client.draft();

  expect(await fixture.readFile('migrations/20260410000001_add_pet.sql')).toBe(before);
});

async function createMigrationsFixture(
  slug: string,
  input: {
    definitionsSql: string;
    migrations?: Record<string, string>;
  },
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `sqlfu-${slug}-`));
  const dbPath = path.join(root, 'dev.db');
  const projectConfig: SqlfuProjectConfig = {
    projectRoot: root,
    dbPath,
    migrationsDir: path.join(root, 'migrations'),
    snapshotFile: path.join(root, 'snapshot.sql'),
    definitionsPath: path.join(root, 'definitions.sql'),
    sqlDir: path.join(root, 'sql'),
    generatedImportExtension: '.js',
  };

  await fs.mkdir(projectConfig.migrationsDir, {recursive: true});
  await fs.writeFile(projectConfig.definitionsPath, withTrailingNewline(input.definitionsSql));

  for (const [filePath, contents] of Object.entries(input.migrations ?? {})) {
    const fullPath = path.join(root, filePath);
    await fs.mkdir(path.dirname(fullPath), {recursive: true});
    await fs.writeFile(fullPath, withTrailingNewline(contents));
  }

  const client = createRouterClient(migrations2Router, {
    context: {
      projectConfig,
      now: () => new Date('2026-04-10T00:00:00.000Z'),
    },
  });

  return {
    root,
    projectConfig,
    client,
    async readFile(relativePath: string) {
      return fs.readFile(path.join(root, relativePath), 'utf8');
    },
    async writeFile(relativePath: string, contents: string) {
      const fullPath = path.join(root, relativePath);
      await fs.mkdir(path.dirname(fullPath), {recursive: true});
      await fs.writeFile(fullPath, contents);
    },
    async dumpFs() {
      const lines: string[] = [];
      await dumpInto(lines, root, '');
      return `${lines.join('\n')}\n`;
    },
    async [Symbol.asyncDispose]() {
      await fs.rm(root, {recursive: true, force: true});
    },
  };
}

async function dumpInto(lines: string[], root: string, relativeDir: string) {
  const dirPath = path.join(root, relativeDir);
  const entries = (await fs.readdir(dirPath, {withFileTypes: true}))
    .filter((entry) => entry.name !== 'dev.db')
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    const indent = relativeDir.split(path.sep).filter(Boolean).length;
    const prefix = '  '.repeat(indent);
    if (entry.isDirectory()) {
      lines.push(`${prefix}${entry.name}/`);
      await dumpInto(lines, root, relativePath);
      continue;
    }

    lines.push(`${prefix}${entry.name}`);
    const contents = await fs.readFile(path.join(root, relativePath), 'utf8');
    for (const line of contents.trimEnd().split('\n')) {
      lines.push(`${prefix}  ${line}`);
    }
  }
}

function withTrailingNewline(value: string) {
  return value.endsWith('\n') ? value : `${value}\n`;
}
