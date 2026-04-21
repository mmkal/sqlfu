import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, test} from 'vitest';

import {listFixtureFiles, parseGenerateFixture, runFixtureCase} from './fixture-helpers.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

for (const fixturePath of await listFixtureFiles(fixturesDir)) {
  describe(path.basename(fixturePath), async () => {
    const cases = parseGenerateFixture(await fs.readFile(fixturePath, 'utf8'));

    for (const fixtureCase of cases) {
      test(fixtureCase.name, async () => {
        const result = await runFixtureCase(fixtureCase);

        if (fixtureCase.expectedError) {
          expect(result.kind).toBe('error');
          if (result.kind === 'error') {
            expect(result.message).toMatch(new RegExp(fixtureCase.expectedError));
          }
          return;
        }

        expect(result.kind).toBe('ok');
        if (result.kind !== 'ok') return;

        for (const file of fixtureCase.outputFiles) {
          const actual = result.outputs[file.path];
          if (file.path.endsWith('.json')) {
            // JSON outputs are partial matches — forward-compat field additions (and volatile
            // ones like `generatedAt`) don't need to be restated in the fixture.
            expect(JSON.parse(actual), `content mismatch at ${file.path}`).toMatchObject(
              JSON.parse(file.content),
            );
          } else {
            expect(actual, `content mismatch at ${file.path}`).toBe(file.content);
          }
        }
      });
    }
  });
}
