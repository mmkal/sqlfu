import fs from 'node:fs/promises';
import path from 'node:path';
import {expect, test, vi} from 'vitest';

import {createNodeHost} from '../src/node/host.js';
import type {SqlfuProjectConfig} from '../src/types.js';
import {watchGenerateQueryTypesForConfig} from '../src/typegen/watch.js';
import {createTempFixtureRoot, writeFixtureFiles} from './fs-fixture.js';

test('regenerates query wrapper when the SQL file changes', async () => {
  await using fixture = await createWatchFixture({
    definitionsSql: `create table person(name text not null, age integer);`,
    queries: {
      'get_person.sql': 'select name from person where name = :name',
    },
  });

  await using watcher = await fixture.startWatcher();

  const wrapperPath = path.join(fixture.root, 'sql', '.generated', 'get_person.sql.ts');
  const initial = await fs.readFile(wrapperPath, 'utf8');
  expect(initial).toMatch(/name: string/);
  expect(initial).not.toMatch(/\bage\b/);

  await fixture.writeQuery('get_person.sql', 'select name, age from person where name = :name');

  await waitFor(async () => {
    const updated = await fs.readFile(wrapperPath, 'utf8');
    expect(updated).toMatch(/\bage\b/);
  });
});

test('regenerates tables file when definitions.sql changes', async () => {
  await using fixture = await createWatchFixture({
    definitionsSql: `create table person(name text not null);`,
    queries: {
      'list_people.sql': 'select name from person',
    },
  });

  await using _watcher = await fixture.startWatcher();

  const tablesPath = path.join(fixture.root, 'sql', '.generated', 'tables.ts');
  const initial = await fs.readFile(tablesPath, 'utf8');
  expect(initial).toMatch(/PersonRow/);
  expect(initial).not.toMatch(/PetRow/);

  await fixture.writeDefinitions(
    `create table person(name text not null);\ncreate table pet(name text not null);`,
  );

  await waitFor(async () => {
    const updated = await fs.readFile(tablesPath, 'utf8');
    expect(updated).toMatch(/PetRow/);
  });
});

test("errors out on authority 'live_schema' with a helpful message", async () => {
  await using fixture = await createWatchFixture({
    definitionsSql: `create table person(name text not null);`,
    queries: {},
    authority: 'live_schema',
  });

  await expect(watchGenerateQueryTypesForConfig(fixture.config, fixture.host)).rejects.toThrow(
    /does not support.*live_schema/,
  );
});

test('survives a generation failure and recovers on the next change', async () => {
  await using fixture = await createWatchFixture({
    definitionsSql: `create table person(name text not null);`,
    queries: {
      'get_person.sql': 'select name from person',
    },
  });

  const errorLog = vi.fn();
  await using _watcher = await fixture.startWatcher({logger: {log: () => {}, error: errorLog}});

  const tablesPath = path.join(fixture.root, 'sql', '.generated', 'tables.ts');

  // Break definitions.sql — materializeDefinitionsSchemaFor throws on invalid SQL.
  await fixture.writeDefinitions('this is not valid sql');
  await waitFor(() => {
    expect(errorLog).toHaveBeenCalled();
  });

  // Now fix it — watcher should recover and pick up the new schema.
  await fixture.writeDefinitions('create table person(name text not null); create table pet(name text not null);');
  await waitFor(async () => {
    const recovered = await fs.readFile(tablesPath, 'utf8');
    expect(recovered).toMatch(/PetRow/);
  });
});

async function createWatchFixture(input: {
  definitionsSql: string;
  queries: Record<string, string>;
  authority?: 'desired_schema' | 'migrations' | 'migration_history' | 'live_schema';
}) {
  const root = await createTempFixtureRoot('generate-watch');

  const config: SqlfuProjectConfig = {
    projectRoot: root,
    db: undefined,
    migrations: {path: path.join(root, 'migrations'), prefix: 'iso'},
    definitions: path.join(root, 'definitions.sql'),
    queries: path.join(root, 'sql'),
    generate: {
      validator: null,
      prettyErrors: true,
      sync: false,
      importExtension: '.js',
      authority: input.authority ?? 'desired_schema',
    },
  };

  await writeFixtureFiles(root, {
    'definitions.sql': input.definitionsSql,
    'sql/.gitkeep': '',
    ...Object.fromEntries(
      Object.entries(input.queries).map(([name, content]) => [`sql/${name}`, content]),
    ),
  });

  const host = await createNodeHost();

  return {
    root,
    config,
    host,
    async writeQuery(name: string, content: string) {
      await fs.writeFile(path.join(root, 'sql', name), content.endsWith('\n') ? content : `${content}\n`);
    },
    async writeDefinitions(content: string) {
      await fs.writeFile(config.definitions, content.endsWith('\n') ? content : `${content}\n`);
    },
    async startWatcher(options: {logger?: {log: (msg: string) => void; error: (msg: string) => void}} = {}) {
      const logger = options.logger ?? {log: () => {}, error: () => {}};
      const abortController = new AbortController();
      let runPromise!: Promise<void>;
      const ready = new Promise<void>((resolve) => {
        runPromise = watchGenerateQueryTypesForConfig(config, host, {
          signal: abortController.signal,
          onReady: () => resolve(),
          logger: {...console, ...logger},
        });
        runPromise.catch((error) => {
          logger.error(String(error));
        });
      });
      await ready;
      return {
        async [Symbol.asyncDispose]() {
          abortController.abort();
          await runPromise;
        },
      };
    },
    async [Symbol.asyncDispose]() {
      await fs.rm(root, {recursive: true, force: true});
    },
  };
}

async function waitFor(assertion: () => void | Promise<void>, {timeout = 3000, interval = 50} = {}) {
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
  throw lastError;
}
