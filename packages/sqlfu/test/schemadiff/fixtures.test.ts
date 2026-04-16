import {describe, test, expect} from 'vitest';
import {createParser} from '../sql-fixture-parser2.js';
import {z} from 'zod';
import { diffSchemaSql } from '../../src/index.js';

const parser = createParser({
  commentPrefix: '--',
  input: z.object({
    baseline: z.string(),
    desired: z.string(),
    error: z.boolean().optional(),
  }),
  getOutput: async ({input}) => {
    try {
      const diff = await diffSchemaSql({
        projectRoot: process.cwd(),
        baselineSql: input.baseline,
        desiredSql: input.desired,
        allowDestructive: false,
      });

      return diff.join('\n');
    } catch (error) {
      if (input.error) {
        return String(error);
      }
      throw error;
    }
  },
});

parser.registerTests({ glob: 'fixtures/*.sql', cwd: import.meta.dirname, describe, test, expect});
// import path from 'node:path';
// import {fileURLToPath} from 'node:url';

// import {describe, test} from 'vitest';
// import {z} from 'zod';

// import {diffSchemaSql} from '../../src/schemadiff/index.js';
// import {createParser} from '../sql-fixture-parser.js';

// const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

// const parser = createParser({
//   commentPrefix: '--',
//   config: z.object({
//     allowDestructive: z.boolean().optional(),
//     error: z.boolean().optional(),
//   }),
//   input: {
//     baseline: z.string(),
//     desired: z.string(),
//   },
//   getOutput: async ({config, input}) => {
//     try {
//       const diff = await diffSchemaSql({
//         projectRoot: process.cwd(),
//         baselineSql: input.baseline,
//         desiredSql: input.desired,
//         allowDestructive: false,
//         ...config,
//       });

//       return diff.join('\n');
//     } catch (error) {
//       if (config.error) {
//         return String(error).replace(/^Error:\s*/, '');
//       }
//       throw error;
//     }
//   },
// });

// await parser({
//   glob: path.join(fixturesDir, '*.sql'),
//   describe,
//   test,
// });
