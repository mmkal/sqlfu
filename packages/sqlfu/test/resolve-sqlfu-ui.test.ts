import path from 'node:path';

import {expect, test} from 'vitest';

import packageJson from '../package.json' with {type: 'json'};
import {
  SqlfuUiVersionMismatchError,
  resolveSqlfuUi,
} from '../src/ui/resolve-sqlfu-ui.js';

test('resolveSqlfuUi locates the workspace @sqlfu/ui package when versions match', () => {
  const resolved = resolveSqlfuUi({sqlfuVersion: packageJson.version});
  expect(resolved).toMatchObject({
    version: packageJson.version,
    root: expect.stringContaining(`${path.sep}ui`) as unknown as string,
  });
});

test('resolveSqlfuUi throws a version-mismatch error with a matching-install command', () => {
  expect(() => resolveSqlfuUi({sqlfuVersion: '999.0.0'})).toThrow(SqlfuUiVersionMismatchError);
  expect(() => resolveSqlfuUi({sqlfuVersion: '999.0.0'})).toThrow(/npm install @sqlfu\/ui@999\.0\.0/u);
});
