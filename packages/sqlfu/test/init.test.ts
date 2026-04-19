import {expect, test} from 'vitest';

import {runSqlfuCommand} from '../src/api.js';
import {createNodeHost} from '../src/core/node-host.js';
import {createTempFixtureRoot, dumpFixtureFs} from './fs-fixture.js';

test('sqlfu init creates the default scaffold in a fresh directory', async () => {
  const root = await createTempFixtureRoot('init-command');
  const host = await createNodeHost();

  await runSqlfuCommand(
    {projectRoot: root, host},
    'sqlfu init',
    async (params) => params.body,
  );

  expect(await dumpFixtureFs(root)).toContain('sqlfu.config.ts');
  expect(await dumpFixtureFs(root)).toContain('definitions.sql');
  expect(await dumpFixtureFs(root)).toContain('migrations/');
  expect(await dumpFixtureFs(root)).toContain('sql/');
  expect(await dumpFixtureFs(root)).toContain(`db: './db/app.sqlite'`);
  expect(await dumpFixtureFs(root)).toContain('.gitkeep');
});
