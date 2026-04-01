import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {expect, test} from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sqlite3defBinaryPath = path.join(packageRoot, '.sqlfu', 'bin', 'sqlite3def');
const {checkDatabase, createMigrationDraft, diffDatabase, dumpSnapshotFile, generateQueryTypes, loadProjectConfig, migrateStatus, migrateUp} = await import(
  pathToFileURL(path.join(packageRoot, 'dist', 'index.js')).href,
);

test('generate and dbmate-backed migrations honor sqlfu.config.ts defaults', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-smoke-'));

  try {
    await fs.cp(path.join(packageRoot, 'definitions.sql'), path.join(tempRoot, 'definitions.sql'));
    await fs.cp(path.join(packageRoot, 'sql'), path.join(tempRoot, 'sql'), {recursive: true});
    await fs.writeFile(
      path.join(tempRoot, 'sqlfu.config.ts'),
      `
export default {
  dbPath: './app.db',
  migrationsDir: './migrations',
  snapshotFile: './snapshot.sql',
  definitionsPath: './definitions.sql',
  sqlDir: './sql',
  sqlite3defBinaryPath: ${JSON.stringify(sqlite3defBinaryPath)},
};
`,
    );
    await fs.writeFile(
      path.join(tempRoot, 'sql', 'find-post-by-slug.sql'),
      `
SELECT
  id,
  slug,
  title,
  published_at,
  body AS excerpt
FROM posts
WHERE slug = :slug
  AND published_at IS NOT NULL
LIMIT 1;
`,
    );

    const resolvedConfig = await loadProjectConfig({cwd: tempRoot});
    await generateQueryTypes({cwd: tempRoot});
    const createOutput = await createMigrationDraft({cwd: tempRoot}, 'initial_schema');
    await migrateUp({cwd: tempRoot});

    const generatedQueryPath = path.join(tempRoot, 'sql', 'list-post-summaries.ts');
    const generatedParameterizedQueryPath = path.join(tempRoot, 'sql', 'find-post-by-slug.ts');
    const migrationPath = path.join(tempRoot, 'migrations');
    const generatedIndexPath = path.join(tempRoot, 'sql', 'index.ts');
    const generatedTypesqlConfigPath = path.join(tempRoot, '.sqlfu', 'typesql.json');
    const configuredDbPath = path.join(tempRoot, 'app.db');
    const snapshotFilePath = path.join(tempRoot, 'snapshot.sql');
    const [migrationFileName] = await fs.readdir(migrationPath);

    const [generatedQuery, generatedParameterizedQuery, generatedTypesqlConfig, generatedMigration, diffResult, statusOutput, dumpOutput] =
      await Promise.all([
      fs.readFile(generatedQueryPath, 'utf8'),
      fs.readFile(generatedParameterizedQueryPath, 'utf8'),
      fs.readFile(generatedTypesqlConfigPath, 'utf8'),
      fs.readFile(path.join(migrationPath, migrationFileName), 'utf8'),
      diffDatabase({cwd: tempRoot}),
      migrateStatus({cwd: tempRoot}),
      dumpSnapshotFile({cwd: tempRoot}),
    ]);

    await fs.access(generatedIndexPath);
    await fs.access(generatedTypesqlConfigPath);
    await fs.access(configuredDbPath);
    await fs.access(snapshotFilePath);

    expect(resolvedConfig.configPath).toBe(path.join(tempRoot, 'sqlfu.config.ts'));
    expect(resolvedConfig.dbPath).toBe(configuredDbPath);
    expect(resolvedConfig.migrationsDir).toBe(migrationPath);
    expect(resolvedConfig.snapshotFile).toBe(snapshotFilePath);
    expect(createOutput).toMatch(/Created .*initial_schema\.sql/);
    expect(generatedQuery).toMatch(/export async function listPostSummaries/);
    expect(generatedQuery).toMatch(/id: number;/);
    expect(generatedQuery).toMatch(/slug: string;/);
    expect(generatedQuery).toMatch(/title: string;/);
    expect(generatedQuery).toMatch(/published_at: string;/);
    expect(generatedQuery).toMatch(/excerpt: string;/);
    expect(generatedQuery).not.toMatch(/:\s*any;/);

    expect(generatedParameterizedQuery).toMatch(/export type FindPostBySlugParams = \{/);
    expect(generatedParameterizedQuery).toMatch(/slug: string;/);
    expect(generatedParameterizedQuery).toMatch(/Promise<FindPostBySlugResult \| null>/);
    expect(generatedParameterizedQuery).toMatch(/body AS excerpt/);

    expect(generatedMigration).toMatch(/-- migrate:up/);
    expect(generatedMigration).toMatch(/CREATE TABLE posts/);
    expect(generatedMigration).toMatch(/-- migrate:down/);
    expect(generatedTypesqlConfig).toMatch(/"includeCrudTables": \[\]/);
    expect(diffResult.drift).toBe(false);
    expect(statusOutput).toMatch(/Applied/);
    expect(typeof dumpOutput).toBe('string');

    await checkDatabase({cwd: tempRoot});
  } finally {
    await fs.rm(tempRoot, {recursive: true, force: true});
  }
});
