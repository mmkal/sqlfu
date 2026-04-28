import {expect, test} from 'vitest';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import {checkStrictImports, formatViolations} from '../scripts/check-strict-imports.js';

const packageRoot = path.resolve(path.dirname(import.meta.filename), '..');

// dist/ is built by test/global-setup.ts (vitest globalSetup) before any
// test file runs. That keeps the vendor-bundle step — which `rm -rf`'s
// dist/vendor/ — from racing parallel adapter tests reading dist.
test('strict-tier entries import no node:* or disallowed bare specifiers', async () => {
  const violations = await checkStrictImports();
  if (violations.length > 0) {
    throw new Error(formatViolations(violations));
  }
  expect(violations).toEqual([]);
});

test('built api entry can load its runtime vendor dependencies', async () => {
  const apiEntry = path.join(packageRoot, 'dist/api.js');
  const api = await import(pathToFileURL(apiEntry).href);
  expect(api).toMatchObject({
    diffSchemaSql: expect.any(Function),
  });
});
