/**
 * Inspired by `../pgkit/packages/migra/test/fixtures.ts`.
 * Adapted for `sqlfu`'s SQLite-native diff engine:
 * - SQLite-only fixtures
 * - verifies emitted diff lines directly
 * - verifies the diff can be applied to reach the target schema
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

import {expect, test} from 'vitest';

import {createNodeSqliteClient} from '../../src/client.js';
import {extractSchema} from '../../src/core/sqlite.js';
import {diffSchemaSql} from '../../src/schemadiff/index.js';
import {getSqliteMigraFixtures} from './fixtures.js';

const fixturesRoot = path.join(import.meta.dirname, 'FIXTURES');
const fixtures = await getSqliteMigraFixtures(fixturesRoot);

for (const fixture of fixtures) {
  test(`sqlite migra fixture: ${fixture.name}`, async () => {
    const diff = await diffSchemaSql({
      projectRoot: process.cwd(),
      baselineSql: fixture.fromSql,
      desiredSql: fixture.toSql,
      allowDestructive: true,
    });

    expect(diff).toEqual(fixture.expectedLines);

    const root = await fs.mkdtemp(path.join(os.tmpdir(), `sqlfu-sqlite-migra-${fixture.name}-`));
    const fromDbPath = path.join(root, 'from.db');
    const toDbPath = path.join(root, 'to.db');
    const fromDb = new DatabaseSync(fromDbPath);
    const toDb = new DatabaseSync(toDbPath);

    try {
      const fromClient = createNodeSqliteClient(fromDb);
      const toClient = createNodeSqliteClient(toDb);

      if (fixture.fromSql.trim()) {
        await fromClient.raw(fixture.fromSql);
      }

      if (fixture.toSql.trim()) {
        await toClient.raw(fixture.toSql);
      }

      if (diff.length > 0) {
        await fromClient.raw(diff.join('\n'));
      }

      const [fromSchema, toSchema] = await Promise.all([extractSchema(fromClient), extractSchema(toClient)]);
      const [fromToTo, toToFrom] = await Promise.all([
        diffSchemaSql({
          projectRoot: process.cwd(),
          baselineSql: fromSchema,
          desiredSql: toSchema,
          allowDestructive: true,
        }),
        diffSchemaSql({
          projectRoot: process.cwd(),
          baselineSql: toSchema,
          desiredSql: fromSchema,
          allowDestructive: true,
        }),
      ]);
      expect(fromToTo).toEqual([]);
      expect(toToFrom).toEqual([]);
    } finally {
      fromDb.close();
      toDb.close();
      await fs.rm(root, {recursive: true, force: true});
    }
  });
}
