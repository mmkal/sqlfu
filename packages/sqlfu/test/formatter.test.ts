import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, inject, test} from 'vitest';

import {formatSql} from '../src/index.js';

// Declared in vitest.config.ts → test.provide. `inject('updateSnapshots')` returns true when
// vitest was invoked with `-u` / `--update`; on mismatch the test rewrites its own region
// instead of failing.
declare module 'vitest' {
  export interface ProvidedContext {
    updateSnapshots: boolean;
  }
}

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'formatter');

for (const fixturePath of await listFixtureFiles(fixturesDir)) {
  describe(path.basename(fixturePath), async () => {
    const cases = parseFormatterFixture(await fs.readFile(fixturePath, 'utf8'));

    for (const fixtureCase of cases) {
      test(fixtureCase.name, async () => {
        if (inject('updateSnapshots')) {
          await updateFormatterFixtureCase(fixturePath, fixtureCase.name);
          return;
        }

        if (fixtureCase.error) {
          expect(normalizeThrownError(() => formatSql(fixtureCase.input, fixtureCase.config))).toBe(
            normalizeErrorMessage(fixtureCase.error),
          );
          return;
        }

        expect(formatSql(fixtureCase.input, fixtureCase.config)).toBe(fixtureCase.output);
      });
    }
  });
}

type FormatterFixtureCase = {
  name: string;
  config: Record<string, unknown>;
  input: string;
  output?: string;
  error?: string;
};

async function listFixtureFiles(fixturesDir: string): Promise<string[]> {
  const entries = await fs.readdir(fixturesDir, {withFileTypes: true});
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.fixture.sql'))
    .map((entry) => path.join(fixturesDir, entry.name))
    .sort();
}

function parseFormatterFixture(contents: string): FormatterFixtureCase[] {
  const cases: FormatterFixtureCase[] = [];
  const defaultConfig = parseDefaultConfig(contents);
  const regionPattern = /^-- #region: (?<name>.+)\n(?<body>[\s\S]*?)^-- #endregion$/gm;

  for (const match of contents.matchAll(regionPattern)) {
    const groups = match.groups;
    if (!groups) {
      continue;
    }

    const configMatch = groups.body.match(/^-- ?config: (?<json>.+)$/m);
    const inputMarker = groups.body.match(/^-- ?input:$/m);
    const unchangedOutputMarker = groups.body.match(/^-- ?output:\s*<unchanged>\s*$/m);
    const outputMarker = groups.body.match(/^-- ?output:$/m);
    const inlineErrorMatch = groups.body.match(/^-- ?error:\s*(?<json>"(?:\\.|[^"])*")\s*$/m);
    const errorMarker = groups.body.match(/^-- ?error:$/m);
    if (
      inputMarker?.index === undefined ||
      (!unchangedOutputMarker &&
        outputMarker?.index === undefined &&
        errorMarker?.index === undefined &&
        !inlineErrorMatch?.groups?.json)
    ) {
      throw new Error(`Invalid formatter fixture region "${groups.name}"`);
    }

    const inputStart = inputMarker.index + inputMarker[0].length + 1;
    const resolvedResultMarker = unchangedOutputMarker ?? outputMarker ?? errorMarker ?? inlineErrorMatch!;
    const resultStart = resolvedResultMarker.index!;
    const input = trimFixtureBlock(groups.body.slice(inputStart, resultStart));
    const output = unchangedOutputMarker
      ? input
      : outputMarker
        ? trimFixtureBlock(groups.body.slice(outputMarker.index! + outputMarker[0].length + 1))
        : undefined;
    const error = inlineErrorMatch?.groups?.json
      ? (JSON.parse(inlineErrorMatch.groups.json) as string)
      : errorMarker
        ? parseErrorBlock(groups.body.slice(errorMarker.index! + errorMarker[0].length + 1))
        : undefined;
    cases.push({
      name: groups.name,
      config: {
        ...defaultConfig,
        ...(configMatch?.groups?.json ? (JSON.parse(configMatch.groups.json) as Record<string, unknown>) : {}),
      },
      input,
      output,
      error,
    });
  }

  return cases;
}

function trimFixtureBlock(value: string): string {
  return value.replace(/\n+$/g, '');
}

function parseDefaultConfig(contents: string): Record<string, unknown> {
  const defaultConfigMatch = contents.match(/^-- default config: (?<json>.+)$/m);
  return defaultConfigMatch?.groups?.json
    ? (JSON.parse(defaultConfigMatch.groups.json) as Record<string, unknown>)
    : {};
}

function parseErrorBlock(value: string): string {
  return trimFixtureBlock(value)
    .split('\n')
    .map((line) => line.replace(/^-- ?/, ''))
    .join('\n');
}

function normalizeThrownError(fn: () => unknown): string {
  try {
    fn();
    throw new Error('Expected formatter to throw');
  } catch (error) {
    if (error instanceof Error && error.message === 'Expected formatter to throw') {
      throw error;
    }

    return normalizeErrorMessage(error instanceof Error ? String(error) : String(error));
  }
}

function normalizeErrorMessage(value: string): string {
  return value.replace(/^Error:\s*/, '').trimEnd();
}

async function updateFormatterFixtureCase(fixturePath: string, testName: string): Promise<void> {
  const contents = await fs.readFile(fixturePath, 'utf8');
  const defaultConfig = parseDefaultConfig(contents);
  const regionPattern = new RegExp(
    `^-- #region: ${escapeRegex(testName)}\\n(?<body>[\\s\\S]*?)^-- #endregion$`,
    'm',
  );
  const match = regionPattern.exec(contents);
  if (!match) {
    throw new Error(`Region "${testName}" not found in ${fixturePath}`);
  }

  const rewritten = rewriteRegion(testName, match.groups!.body, defaultConfig);
  const updated = contents.slice(0, match.index) + rewritten + contents.slice(match.index + match[0].length);
  if (updated !== contents) {
    await fs.writeFile(fixturePath, updated);
  }
}

function rewriteRegion(name: string, body: string, defaultConfig: Record<string, unknown>): string {
  const configMatch = body.match(/^-- ?config: (?<json>.+)$/m);
  const inputMarker = body.match(/^-- ?input:$/m);
  const resultMarker = body.match(/^-- ?(?:output:\s*<unchanged>|output:|error:.*)$/m);
  if (inputMarker?.index === undefined || resultMarker?.index === undefined) {
    throw new Error(`Invalid formatter fixture region "${name}"`);
  }

  const inputStart = inputMarker.index + inputMarker[0].length + 1;
  const input = trimFixtureBlock(body.slice(inputStart, resultMarker.index));
  const localConfig = configMatch?.groups?.json ? (JSON.parse(configMatch.groups.json) as Record<string, unknown>) : {};
  const config = {...defaultConfig, ...localConfig};

  let resultLines: string[];
  try {
    const output = formatSql(input, config);
    resultLines = output === input ? ['-- output: <unchanged>'] : ['-- output:', output];
  } catch (error) {
    resultLines = [
      `-- error: ${JSON.stringify(normalizeErrorMessage(error instanceof Error ? String(error) : String(error)))}`,
    ];
  }

  return [
    `-- #region: ${name}`,
    ...(Object.keys(localConfig).length > 0 ? [`-- config: ${JSON.stringify(localConfig)}`] : []),
    '-- input:',
    input,
    ...resultLines,
    '-- #endregion',
  ].join('\n');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
