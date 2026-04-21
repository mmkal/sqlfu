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

        // Every fixture's generated code has to typecheck against sqlfu's real source — a
        // missing import, wrong signature, or enum-narrowing goof shows up here even when
        // the text snapshot would still match.
        expect(result.diagnostics, `TypeScript errors in generated files:\n${result.diagnostics.join('\n')}`).toEqual([]);

        if (inject('updateSnapshots')) {
          // Rewrite exact-match outputs (.ts / text files) back into the fixture. JSON fences
          // are partial matches by design (the catalog's `generatedAt` timestamp + deeper
          // metadata fields aren't restated in the fixture) — so in glob-curated mode we still
          // honour whatever JSON fence the author hand-wrote without rewriting its body, and
          // in legacy mode we skip touching JSON fences too.
          const textActuals: Record<string, string> = {};
          for (const [filePath, content] of Object.entries(result.outputs)) {
            if (!filePath.endsWith('.json')) {
              textActuals[filePath] = content;
            }
          }
          updateFixtureOutputs(fixturePath, fixtureCase.name, textActuals, {
            outputGlobs: fixtureCase.outputGlobs,
          });
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
