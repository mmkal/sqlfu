import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, inject, test} from 'vitest';

import {
  listFixtureFiles,
  parseGenerateFixture,
  runFixtureCase,
  updateFixtureOutputs,
} from './fixture-helpers.js';

// Declared in vitest.config.ts → test.provide. `inject('updateSnapshots')` returns true when
// vitest was invoked with `-u` / `--update`, letting this suite behave like a real snapshot
// suite: mismatches become fixture rewrites instead of failures.
declare module 'vitest' {
  export interface ProvidedContext {
    updateSnapshots: boolean;
  }
}

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

for (const fixturePath of listFixtureFiles(fixturesDir)) {
  describe(path.basename(fixturePath), () => {
    const cases = parseGenerateFixture(fs.readFileSync(fixturePath, 'utf8'));

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

        if (inject('updateSnapshots')) {
          // Rewrite exact-match outputs (.ts / text files) back into the fixture. JSON outputs
          // are partial matches by design — e.g. the query catalog's `generatedAt` timestamp
          // and deeper metadata fields aren't restated in the fixture — so we skip those to
          // avoid bloating the fixture with every field generate happens to emit today.
          const textActuals: Record<string, string> = {};
          for (const file of fixtureCase.outputFiles) {
            if (!file.path.endsWith('.json')) {
              textActuals[file.path] = result.outputs[file.path];
            }
          }
          updateFixtureOutputs(fixturePath, fixtureCase.name, textActuals);
          return;
        }

        const mismatchMessage = `content mismatch at ${fixturePath} ${fixtureCase.name}. Run again with -u or --update to update the expected outputs.`;

        for (const file of fixtureCase.outputFiles) {
          const actual = result.outputs[file.path];
          if (file.path.endsWith('.json')) {
            expect(JSON.parse(actual), mismatchMessage).toMatchObject(
              JSON.parse(file.content),
            );
          } else {
            expect(actual, mismatchMessage).toBe(file.content);
          }
        }
      });
    }
  });
}
