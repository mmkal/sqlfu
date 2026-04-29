import {expect, test} from 'vitest';

import packageJson from '../package.json' with {type: 'json'};
import {SqlfuUiVersionMismatchError, resolveSqlfuUi} from '../src/ui/resolve-sqlfu-ui.js';

test('resolveSqlfuUi locates the workspace @sqlfu/ui package when versions match', async () => {
  const resolved = await resolveSqlfuUi({sqlfuVersion: packageJson.version});
  expect(resolved).toMatchObject({
    version: packageJson.version,
    assets: {
      '/index.html': expect.stringContaining('<!doctype html>') as unknown as string,
    },
  });
});

test('resolveSqlfuUi throws a version-mismatch error with a matching-install command', async () => {
  await expect(resolveSqlfuUi({sqlfuVersion: '999.0.0'})).rejects.toThrow(SqlfuUiVersionMismatchError);
  await expect(resolveSqlfuUi({sqlfuVersion: '999.0.0'})).rejects.toThrow(/npm install @sqlfu\/ui@999\.0\.0/u);
});
