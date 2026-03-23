import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {checkDatabase, diffDatabase, generateQueryTypes} from '../dist/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binaryName = process.platform === 'win32' ? 'sqlite3def.exe' : 'sqlite3def';
const sqlite3defBinaryPath = path.join(packageRoot, '.sqlfu', 'bin', binaryName);

test('generate materializes schema and migrate check stays clean', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-smoke-'));

  try {
    await fs.cp(path.join(packageRoot, 'definitions.sql'), path.join(tempRoot, 'definitions.sql'));
    await fs.cp(path.join(packageRoot, 'sql'), path.join(tempRoot, 'sql'), {recursive: true});

    await generateQueryTypes({cwd: tempRoot, sqlite3defBinaryPath});

    const generatedQueryPath = path.join(tempRoot, 'sql', 'list-post-summaries.ts');
    const generatedIndexPath = path.join(tempRoot, 'sql', 'index.ts');
    const generatedTypesqlConfigPath = path.join(tempRoot, 'typesql.json');

    const [generatedQuery, diffResult] = await Promise.all([
      fs.readFile(generatedQueryPath, 'utf8'),
      diffDatabase({cwd: tempRoot, sqlite3defBinaryPath}, path.join(tempRoot, '.sqlfu', 'typegen.db')),
    ]);

    await fs.access(generatedIndexPath);
    await fs.access(generatedTypesqlConfigPath);
    assert.match(generatedQuery, /export async function listPostSummaries/);
    assert.equal(diffResult.drift, false);

    await checkDatabase({cwd: tempRoot, sqlite3defBinaryPath}, path.join(tempRoot, '.sqlfu', 'typegen.db'));
  } finally {
    await fs.rm(tempRoot, {recursive: true, force: true});
  }
});
