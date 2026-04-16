import {glob, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {expect} from 'vitest';

import {prettifyStandardSchemaError} from './standard-schema/errors.js';
import {StandardSchemaV1} from './standard-schema/contract.js';

type InputSchemas = Record<string, StandardSchemaV1>;

type ParsedInput<TInput extends InputSchemas> = {
  [TKey in keyof TInput]: StandardSchemaV1.InferOutput<TInput[TKey]>;
};

type DescribeLike = (name: string, run: () => void) => void;
type TestLike = (name: string, run: () => void | Promise<void>) => void;

type ParsedFixtureCase<TConfig, TInput extends Record<string, string>> = {
  readonly name: string;
  readonly filepath: string;
  readonly localConfig: Record<string, unknown>;
  readonly config: TConfig;
  readonly input: TInput;
  readonly expectedOutput: string;
};

type ParsedFixtureFile<TConfig, TInput extends Record<string, string>> = {
  readonly filepath: string;
  readonly defaultConfig: TConfig;
  readonly defaultConfigSource: Record<string, unknown>;
  readonly cases: ParsedFixtureCase<TConfig, TInput>[];
};

type FixtureParserRunner<TConfigSchema extends StandardSchemaV1, TInput extends InputSchemas> = ((args: {
  argv?: string[];
  glob: string;
  describe: DescribeLike;
  test: TestLike;
}) => Promise<void>) & {
  parse: (args: {
    contents: string;
    filepath: string;
  }) => Promise<ParsedFixtureFile<StandardSchemaV1.InferOutput<TConfigSchema>, ParsedInput<TInput>>>;
};

export function createParser<TConfigSchema extends StandardSchemaV1, TInput extends InputSchemas>(options: {
  commentPrefix: string;
  config: TConfigSchema;
  input: TInput;
  getOutput: (args: {
    defaultConfig: StandardSchemaV1.InferOutput<TConfigSchema>;
    config: StandardSchemaV1.InferOutput<TConfigSchema>;
    input: ParsedInput<TInput>;
    filepath: string;
    test: string;
  }) => string | Promise<string>;
}): FixtureParserRunner<TConfigSchema, TInput> {
  const resultMarkerPrefix = `${options.commentPrefix} output:`;
  const errorMarkerPrefix = `${options.commentPrefix} error:`;

  const parseFixtures: FixtureParserRunner<TConfigSchema, TInput> = async function parseFixtures(args: {
    argv?: string[];
    glob: string;
    describe: DescribeLike;
    test: TestLike;
  }): Promise<void> {
    const fixturePaths = await listFixtureFiles(args.glob);
    const shouldUpdate = hasUpdateFlag(args.argv || process.argv);
    const parsedFixtures: ParsedFixtureFile<StandardSchemaV1.InferOutput<TConfigSchema>, ParsedInput<TInput>>[] = [];

    for (const fixturePath of fixturePaths) {
      const fixtureFile = await parseFixtureFile(fixturePath);
      if (shouldUpdate) {
        await rewriteFixtureFile(fixtureFile);
      }
      parsedFixtures.push(shouldUpdate ? await parseFixtureFile(fixturePath) : fixtureFile);
    }

    for (const parsedFixture of parsedFixtures) {
      args.describe(path.basename(parsedFixture.filepath), () => {
        for (const fixtureCase of parsedFixture.cases) {
          args.test(fixtureCase.name, async () => {
            const output = await options.getOutput({
              defaultConfig: parsedFixture.defaultConfig,
              config: fixtureCase.config,
              filepath: fixtureCase.filepath,
              input: fixtureCase.input,
              test: fixtureCase.name,
            });

            expect(output).toBe(fixtureCase.expectedOutput);
          });
        }
      });
    }
  };
  parseFixtures.parse = async ({contents, filepath}) => parseFixtureContents(contents, filepath);
  return parseFixtures;

  async function parseFixtureFile(filepath: string): Promise<ParsedFixtureFile<StandardSchemaV1.InferOutput<TConfigSchema>, ParsedInput<TInput>>> {
    const contents = await readFile(filepath, 'utf8');
    return parseFixtureContents(contents, filepath);
  }

  async function parseFixtureContents(
    contents: string,
    filepath: string,
  ): Promise<ParsedFixtureFile<StandardSchemaV1.InferOutput<TConfigSchema>, ParsedInput<TInput>>> {
    const defaultConfigSource = parseDefaultConfigSource(contents, options.commentPrefix);
    const defaultConfig = await validateWithSchema(options.config, defaultConfigSource, `${filepath} default config`);
    const cases: ParsedFixtureCase<StandardSchemaV1.InferOutput<TConfigSchema>, ParsedInput<TInput>>[] = [];
    const regionPattern = new RegExp(
      `^${escapeRegex(options.commentPrefix)} #region: (?<name>.+)\\n(?<body>[\\s\\S]*?)^${escapeRegex(options.commentPrefix)} #endregion$`,
      'gm',
    );

    for (const match of contents.matchAll(regionPattern)) {
      const groups = match.groups;
      if (!groups) {
        continue;
      }

      const parsedRegion = await parseRegion(filepath, groups.name, groups.body, defaultConfigSource);
      cases.push(parsedRegion);
    }

    return {
      filepath,
      defaultConfig,
      defaultConfigSource,
      cases,
    };
  }

  async function parseRegion(
    filepath: string,
    name: string,
    body: string,
    defaultConfigSource: Record<string, unknown>,
  ): Promise<ParsedFixtureCase<StandardSchemaV1.InferOutput<TConfigSchema>, ParsedInput<TInput>>> {
    const lines = body.split('\n');
    const inputSectionLines = new Map<keyof TInput, string>();
    const inputNames = Object.keys(options.input) as (keyof TInput)[];
    const expectedOutputLines: string[] = [];
    let localConfigSource: Record<string, unknown> = {};
    let currentSection: keyof TInput | 'output' | 'error' | null = null;
    let outputMarkerSuffix = '';
    let errorMarkerSuffix = '';

    const finishSection = () => {
      if (!currentSection) {
        return;
      }

      if (currentSection === 'output') {
        return;
      }

      if (currentSection === 'error') {
        return;
      }

      inputSectionLines.set(currentSection, trimTrailingNewlines(expectedOutputLines.splice(0)));
    };

    const switchSection = (nextSection: keyof TInput | 'output' | 'error' | null) => {
      if (currentSection && currentSection !== 'output' && currentSection !== 'error') {
        inputSectionLines.set(currentSection, trimTrailingNewlines(expectedOutputLines.splice(0)));
      }
      currentSection = nextSection;
    };

    for (const line of lines) {
      const configMatch = line.match(new RegExp(`^${escapeRegex(options.commentPrefix)} ?config: (?<json>.+)$`));
      if (configMatch?.groups?.json && !currentSection) {
        localConfigSource = JSON.parse(configMatch.groups.json) as Record<string, unknown>;
        continue;
      }

      const inputName = inputNames.find((candidate) => line === `${options.commentPrefix} ${String(candidate)}:`);
      if (inputName) {
        switchSection(inputName);
        continue;
      }

      if (line.startsWith(resultMarkerPrefix)) {
        switchSection('output');
        outputMarkerSuffix = line.slice(resultMarkerPrefix.length).trim();
        continue;
      }

      if (line.startsWith(errorMarkerPrefix)) {
        switchSection('error');
        errorMarkerSuffix = line.slice(errorMarkerPrefix.length).trim();
        localConfigSource = {...localConfigSource, error: true};
        continue;
      }

      if (!currentSection) {
        if (!line.trim()) {
          continue;
        }

        throw new Error(`Invalid fixture region "${name}" in ${filepath}`);
      }

      expectedOutputLines.push(line);
    }

    finishSection();

    const input = {} as ParsedInput<TInput>;
    for (const inputName of inputNames) {
      const rawValue = inputSectionLines.get(inputName);
      if (rawValue === undefined) {
        throw new Error(`Missing "${String(inputName)}" section in fixture region "${name}" in ${filepath}`);
      }

      input[inputName] = await validateWithSchema(options.input[inputName], rawValue, `${filepath} region "${name}" input "${String(inputName)}"`) as ParsedInput<TInput>[typeof inputName];
    }

    const config = await validateWithSchema(
      options.config,
      {
        ...defaultConfigSource,
        ...localConfigSource,
      },
      `${filepath} region "${name}" config`,
    );

    let expectedOutput: string | null = null;
    if (currentSection === 'output' || outputMarkerSuffix) {
      expectedOutput = normalizeOutputMarker(outputMarkerSuffix, expectedOutputLines.join('\n'));
    }
    if (currentSection === 'error' || errorMarkerSuffix) {
      expectedOutput = normalizeErrorMarker(errorMarkerSuffix, expectedOutputLines.join('\n'));
    }
    if (expectedOutput === null) {
      throw new Error(`Missing output section in fixture region "${name}" in ${filepath}`);
    }

    return {
      name,
      filepath,
      localConfig: localConfigSource,
      config,
      input,
      expectedOutput,
    };
  }

  async function rewriteFixtureFile(
    fixtureFile: ParsedFixtureFile<StandardSchemaV1.InferOutput<TConfigSchema>, ParsedInput<TInput>>,
  ): Promise<void> {
    const rewrittenCases: string[] = [];

    for (const fixtureCase of fixtureFile.cases) {
      const output = await options.getOutput({
        defaultConfig: fixtureFile.defaultConfig,
        config: fixtureCase.config,
        filepath: fixtureCase.filepath,
        input: fixtureCase.input,
        test: fixtureCase.name,
      });

      rewrittenCases.push(
        [
          `${options.commentPrefix} #region: ${fixtureCase.name}`,
          ...(Object.keys(fixtureCase.localConfig).length
            ? [`${options.commentPrefix} config: ${JSON.stringify(fixtureCase.localConfig)}`]
            : []),
          ...renderInputSections(fixtureCase.input),
          `${options.commentPrefix} output:`,
          ...(output ? output.split('\n') : []),
          `${options.commentPrefix} #endregion`,
        ].join('\n'),
      );
    }

    const rewrittenContents = [
      ...(Object.keys(fixtureFile.defaultConfigSource).length
        ? [`${options.commentPrefix} default config: ${JSON.stringify(fixtureFile.defaultConfigSource)}`, '']
        : []),
      rewrittenCases.join('\n\n'),
      '',
    ].join('\n');

    await writeFile(fixtureFile.filepath, rewrittenContents);
  }

  function renderInputSections(input: ParsedInput<TInput>): string[] {
    const sections: string[] = [];
    for (const inputName of Object.keys(options.input) as (keyof TInput)[]) {
      sections.push(`${options.commentPrefix} ${String(inputName)}:`);
      sections.push(...input[inputName].split('\n'));
    }
    return sections;
  }
}

async function validateWithSchema<TSchema extends StandardSchemaV1>(
  schema: TSchema,
  value: unknown,
  label: string,
): Promise<StandardSchemaV1.InferOutput<TSchema>> {
  const result = await schema['~standard'].validate(value);
  if ('issues' in result) {
    const pretty = prettifyStandardSchemaError(result) || JSON.stringify(result.issues);
    throw new Error(`${label} is invalid\n${pretty}`);
  }

  return result.value as StandardSchemaV1.InferOutput<TSchema>;
}

function parseDefaultConfigSource(contents: string, commentPrefix: string): Record<string, unknown> {
  const match = contents.match(new RegExp(`^${escapeRegex(commentPrefix)} default config: (?<json>.+)$`, 'm'));
  if (!match?.groups?.json) {
    return {};
  }

  return JSON.parse(match.groups.json) as Record<string, unknown>;
}

async function listFixtureFiles(pattern: string): Promise<string[]> {
  const fixturePaths: string[] = [];
  for await (const filepath of glob(pattern)) {
    fixturePaths.push(String(filepath));
  }
  return fixturePaths.sort();
}

function normalizeOutputMarker(markerSuffix: string, body: string): string {
  if (!markerSuffix) {
    return trimTrailingNewlines(body);
  }
  if (markerSuffix === '<empty>') {
    return '';
  }
  return markerSuffix;
}

function normalizeErrorMarker(markerSuffix: string, body: string): string {
  if (markerSuffix) {
    return JSON.parse(markerSuffix) as string;
  }

  return trimTrailingNewlines(stripCommentPrefix(body));
}

function stripCommentPrefix(value: string): string {
  return value
    .split('\n')
    .map((line) => line.replace(/^-- ?/, ''))
    .join('\n');
}

function hasUpdateFlag(argv: readonly string[]): boolean {
  return argv.includes('-u') || argv.includes('--update');
}

function trimTrailingNewlines(value: string | string[]): string {
  const text = Array.isArray(value) ? value.join('\n') : value;
  return text.replace(/\n+$/g, '');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
