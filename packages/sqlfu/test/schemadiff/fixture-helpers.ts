import {z} from 'zod';

import {diffSchemaSql} from '../../src/schemadiff/index.js';
import {createParser} from '../sql-fixture-parser.js';

export type SchemadiffFixtureCase = {
  readonly name: string;
  readonly config: Record<string, unknown>;
  readonly baselineSql: string;
  readonly desiredSql: string;
  readonly output?: string;
  readonly error?: string;
};

const schemadiffParser = createParser({
  commentPrefix: '--',
  config: z.object({
    allowDestructive: z.boolean().optional(),
    error: z.boolean().optional(),
  }),
  input: {
    baseline: z.string(),
    desired: z.string(),
  },
  getOutput: async ({config, input}) => {
    try {
      const diff = await diffSchemaSql({
        projectRoot: process.cwd(),
        baselineSql: input.baseline,
        desiredSql: input.desired,
        allowDestructive: false,
        ...config,
      });

      return diff.join('\n');
    } catch (error) {
      if (config.error) {
        return String(error).replace(/^Error:\s*/, '');
      }
      throw error;
    }
  },
});

export async function parseSchemadiffFixture(contents: string, filepath = '<fixture>'): Promise<SchemadiffFixtureCase[]> {
  const parsed = await schemadiffParser.parse({contents, filepath});
  return parsed.cases.map((fixtureCase) => {
    if ((fixtureCase.config as Record<string, unknown>).error) {
      return {
        name: fixtureCase.name,
        config: fixtureCase.config,
        baselineSql: fixtureCase.input.baseline,
        desiredSql: fixtureCase.input.desired,
        error: fixtureCase.expectedOutput,
      };
    }

    return {
      name: fixtureCase.name,
      config: fixtureCase.config,
      baselineSql: fixtureCase.input.baseline,
      desiredSql: fixtureCase.input.desired,
      output: fixtureCase.expectedOutput,
    };
  });
}

export async function runFixtureCase(fixtureCase: SchemadiffFixtureCase): Promise<string> {
  const diff = await diffSchemaSql({
    projectRoot: process.cwd(),
    baselineSql: fixtureCase.baselineSql,
    desiredSql: fixtureCase.desiredSql,
    allowDestructive: false,
    ...fixtureCase.config,
  } as Parameters<typeof diffSchemaSql>[0]);

  return diff.join('\n');
}
