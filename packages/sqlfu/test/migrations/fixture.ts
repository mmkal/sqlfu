import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

import {createRouterClient} from '@orpc/server';

import {getMigrationPrefix} from '../../src/api.js';
import {router} from '../../src/cli-router.js';
import {createNodeSqliteClient} from '../../src/client.js';
import {createNodeHost} from '../../src/core/node-host.js';
import {extractSchema} from '../../src/core/sqlite.js';
import type {Client, SqlfuProjectConfig} from '../../src/core/types.js';
import {createTempFixtureRoot, dumpFixtureFs, writeFixtureFiles} from '../fs-fixture.js';

type DisposableClient = {
  readonly client: Client;
  [Symbol.asyncDispose](): Promise<void>;
};

export async function createMigrationsFixture(
  slug: string,
  input: {
    desiredSchema?: string;
    migrations?: Record<string, string>;
  } = {},
) {
  const root = await createTempFixtureRoot(slug);
  const dbPath = path.join(root, 'dev.db');
  const projectConfig: SqlfuProjectConfig = {
    projectRoot: root,
    db: dbPath,
    migrations: path.join(root, 'migrations'),
    definitions: path.join(root, 'definitions.sql'),
    queries: path.join(root, 'sql'),
    generatedImportExtension: '.js',
  };

  let nowUsage = 0;
  const fakeNow = () => {
    const addHours = nowUsage++;
    return new Date(new Date('2026-04-10T00:00:00.000Z').getTime() + addHours * 60 * 60_000);
  };

  const baseHost = await createNodeHost();
  const host = {...baseHost, now: fakeNow};

  const migrations = Object.fromEntries(
    Object.entries(input.migrations ?? {}).map(([name, content]) => [
      `migrations/${getMigrationPrefix(fakeNow())}_${name}.sql`,
      content,
    ]),
  );

  // when the test does not specify desiredSchema, default to a schema that replays the
  // migrations. this keeps the repo internally consistent by default, which matches what a real
  // user would have. tests that want to exercise repo drift specifically still pass their own
  // desiredSchema.
  const definitionsSql = input.desiredSchema ?? (await replayMigrationsSchema(Object.values(migrations)));

  await writeFixtureFiles(root, {
    'definitions.sql': definitionsSql,
    ...migrations,
  });

  const api = createRouterClient(router, {
    context: {
      projectRoot: root,
      config: projectConfig,
      host,
      confirm: async ({body}: {body: string}) => body,
    },
  });
  const db = createNodeSqliteClient(new DatabaseSync(dbPath));

  return {
    root,
    api,
    db,
    async readFile(relativePath: string) {
      return fs.readFile(path.join(root, relativePath), 'utf8');
    },
    async writeFile(relativePath: string, contents: string) {
      const fullPath = path.join(root, relativePath);
      await fs.mkdir(path.dirname(fullPath), {recursive: true});
      await fs.writeFile(fullPath, contents);
    },
    async globOne(pattern: string) {
      const results = await Array.fromAsync(fs.glob(pattern, {cwd: root}));
      if (results.length !== 1) throw new Error(`expected 1 file for ${pattern}, got ${results.join(',') || 'none'}`);
      return results[0];
    },
    async readMigration(name: string) {
      return this.readFile(await this.globOne(`migrations/*${name}*`));
    },
    async listMigrationFiles() {
      return Array.fromAsync(fs.glob('migrations/*.sql', {cwd: root})).then((files) => files.sort());
    },
    async writeMigration(name: string, content: string) {
      await this.writeFile(`migrations/${getMigrationPrefix(fakeNow())}_${name}.sql`, content);
    },
    async dumpFs() {
      return dumpFixtureFs(root, {ignoredNames: ['dev.db', '.sqlfu']});
    },
    async readMigrationHistory() {
      return readMigrationHistory(dbPath);
    },
    async migrationNames() {
      const history = await this.readMigrationHistory();
      return history.map((m) => m.name.split('Z_').pop());
    },
    async [Symbol.asyncDispose]() {
      await fs.rm(root, {recursive: true, force: true});
    },
  };
}

async function replayMigrationsSchema(migrationContents: readonly string[]): Promise<string> {
  if (migrationContents.length === 0) {
    return '';
  }
  const database = new DatabaseSync(':memory:');
  const client = createNodeSqliteClient(database);
  try {
    for (const content of migrationContents) {
      await client.raw(content);
    }
    return await extractSchema(client, 'main', {excludedTables: ['sqlfu_migrations']});
  } catch {
    // if a fixture provides intentionally broken migration SQL to test failure paths, fall back
    // to an empty desired schema. the test can still override this via input.desiredSchema.
    return '';
  } finally {
    database.close();
  }
}

async function createNodeSqliteDatabase(dbPath: string): Promise<DisposableClient> {
  await fs.mkdir(path.dirname(dbPath), {recursive: true});
  const database = new DatabaseSync(dbPath);

  return {
    client: createNodeSqliteClient(database),
    async [Symbol.asyncDispose]() {
      database.close();
    },
  } satisfies DisposableClient;
}

async function readMigrationHistory(dbPath: string) {
  await using database = await createNodeSqliteDatabase(dbPath);
  try {
    return await database.client.all<{name: string; checksum: string}>({
      sql: `
        select name, checksum
        from sqlfu_migrations
        order by name
      `,
      args: [],
    });
  } catch (error: unknown) {
    if (String(error).includes('no such table')) {
      return [];
    }
    throw error;
  }
}
