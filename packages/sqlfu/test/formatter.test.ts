import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, test} from 'vitest';
import {z} from 'zod';

import {formatSql} from '../src/index.js';
import {createParser} from './sql-fixture-parser.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'formatter');

const parser = createParser({
  commentPrefix: '--',
  config: z.object({
    error: z.boolean().optional(),
  }).catchall(z.unknown()),
  input: {
    input: z.string(),
  },
  getOutput: ({config, input}) => {
    try {
      const output = formatSql(input.input, config);
      return output === input.input ? '<unchanged>' : output;
    } catch (error) {
      if (config.error) {
        return normalizeErrorMessage(String(error));
      }
      throw error;
    }
  },
});

await parser({
  glob: path.join(fixturesDir, '*.fixture.sql'),
  describe,
  test,
});

function normalizeErrorMessage(value: string): string {
  return value.replace(/^Error:\s*/, '').trimEnd();
}
