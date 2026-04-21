import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, inject, test} from 'vitest';

import {
  listFixtureFiles,
  parseSchemadiffFixture,
  runFixtureCase,
  updateSchemadiffFixtureCase,
} from './fixture-helpers.js';

// Declared in vitest.config.ts → test.provide. `inject('updateSnapshots')` returns true when
// vitest was invoked with `-u` / `--update`; on mismatch the test rewrites its own region
// instead of failing.
declare module 'vitest' {
  export interface ProvidedContext {
    updateSnapshots: boolean;
  }
}

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

for (const fixturePath of await listFixtureFiles(fixturesDir)) {
  describe(path.basename(fixturePath), async () => {
    const cases = parseSchemadiffFixture(await fs.readFile(fixturePath, 'utf8'));

    for (const fixtureCase of cases) {
      test(fixtureCase.name, async () => {
        if (inject('updateSnapshots')) {
          await updateSchemadiffFixtureCase(fixturePath, fixtureCase.name);
          return;
        }

        if (fixtureCase.error) {
          await expect(runFixtureCase(fixtureCase)).rejects.toThrow(fixtureCase.error);
          return;
        }

        await expect(runFixtureCase(fixtureCase)).resolves.toBe(fixtureCase.output);
      });
    }
  });
}
