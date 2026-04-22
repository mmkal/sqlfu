import fs from 'node:fs/promises';
import path from 'node:path';

import {createNodeHost} from '../../src/core/node-host.js';
import {diffSchemaSql} from '../../src/schemadiff/index.js';

export type SchemadiffFixtureCase = {
  name: string;
  config: Record<string, unknown>;
  baselineSql: string;
  desiredSql: string;
  output?: string;
  error?: string;
};

let sharedHostPromise: ReturnType<typeof createNodeHost> | undefined;

export async function runFixtureCase(fixtureCase: SchemadiffFixtureCase): Promise<string> {
  sharedHostPromise ??= createNodeHost();
  const host = await sharedHostPromise;
  const diff = await diffSchemaSql(host, {
    baselineSql: fixtureCase.baselineSql,
    desiredSql: fixtureCase.desiredSql,
    allowDestructive: (fixtureCase.config as {allowDestructive?: boolean}).allowDestructive ?? false,
  });

  return diff.join('\n');
}

export async function listFixtureFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, {withFileTypes: true});
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => path.join(root, entry.name))
    .sort();
}

export function parseSchemadiffFixture(contents: string): SchemadiffFixtureCase[] {
  const cases: SchemadiffFixtureCase[] = [];
  const defaultConfig = parseDefaultConfig(contents);
  const regionPattern = /^-- #region: (?<name>.+)\n(?<body>[\s\S]*?)^-- #endregion$/gm;

  for (const match of contents.matchAll(regionPattern)) {
    const groups = match.groups;
    if (!groups) {
      continue;
    }

    const configMatch = groups.body.match(/^-- ?config: (?<json>.+)$/m);
    const baselineMarker = groups.body.match(/^-- ?baseline:$/m);
    const desiredMarker = groups.body.match(/^-- ?desired:$/m);
    const emptyOutputMarker = groups.body.match(/^-- ?output:\s*<empty>\s*$/m);
    const outputMarker = groups.body.match(/^-- ?output:$/m);
    const inlineErrorMatch = groups.body.match(/^-- ?error:\s*(?<json>"(?:\\.|[^"])*")\s*$/m);

    if (baselineMarker?.index === undefined || desiredMarker?.index === undefined) {
      throw new Error(`Invalid schemadiff fixture region "${groups.name}"`);
    }

    const resultMarkerIndex = emptyOutputMarker?.index ?? outputMarker?.index ?? inlineErrorMatch?.index;
    if (resultMarkerIndex === undefined) {
      throw new Error(`Invalid schemadiff fixture region "${groups.name}"`);
    }

    const baselineStart = baselineMarker.index + baselineMarker[0].length + 1;
    const desiredStart = desiredMarker.index + desiredMarker[0].length + 1;
    const baselineSql = trimFixtureBlock(groups.body.slice(baselineStart, desiredMarker.index));
    const desiredSql = trimFixtureBlock(groups.body.slice(desiredStart, resultMarkerIndex));
    const output = emptyOutputMarker
      ? ''
      : outputMarker
        ? trimFixtureBlock(groups.body.slice(outputMarker.index! + outputMarker[0].length + 1))
        : undefined;
    const error = inlineErrorMatch?.groups?.json ? (JSON.parse(inlineErrorMatch.groups.json) as string) : undefined;

    cases.push({
      name: groups.name,
      config: {
        ...defaultConfig,
        ...(configMatch?.groups?.json ? (JSON.parse(configMatch.groups.json) as Record<string, unknown>) : {}),
      },
      baselineSql,
      desiredSql,
      output,
      error,
    });
  }

  return cases;
}

/**
 * Rewrite a single region of a schemadiff fixture to match the current diff engine's output.
 * Called from the test harness in `-u` / `--update` mode, via `inject('updateSnapshots')`, so
 * a mismatched case is patched in place instead of failing.
 */
export async function updateSchemadiffFixtureCase(fixturePath: string, testName: string): Promise<void> {
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

  const rewritten = await rewriteRegion(testName, match.groups!.body, defaultConfig);
  const updated = contents.slice(0, match.index) + rewritten + contents.slice(match.index + match[0].length);
  if (updated !== contents) {
    await fs.writeFile(fixturePath, updated);
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseDefaultConfig(contents: string): Record<string, unknown> {
  const defaultConfigMatch = contents.match(/^-- default config: (?<json>.+)$/m);
  return defaultConfigMatch?.groups?.json
    ? (JSON.parse(defaultConfigMatch.groups.json) as Record<string, unknown>)
    : {};
}

function trimFixtureBlock(value: string): string {
  return value.replace(/\n+$/g, '');
}

async function rewriteRegion(name: string, body: string, defaultConfig: Record<string, unknown>): Promise<string> {
  const configMatch = body.match(/^-- ?config: (?<json>.+)$/m);
  const baselineMarker = body.match(/^-- ?baseline:$/m);
  const desiredMarker = body.match(/^-- ?desired:$/m);
  const resultMarker = body.match(/^-- ?(?:output:\s*<empty>|output:|error:.*)$/m);
  if (baselineMarker?.index === undefined || desiredMarker?.index === undefined || resultMarker?.index === undefined) {
    throw new Error(`Invalid schemadiff fixture region "${name}"`);
  }

  const baselineStart = baselineMarker.index + baselineMarker[0].length + 1;
  const desiredStart = desiredMarker.index + desiredMarker[0].length + 1;
  const baselineSql = trimFixtureBlock(body.slice(baselineStart, desiredMarker.index));
  const desiredSql = trimFixtureBlock(body.slice(desiredStart, resultMarker.index));
  const localConfig = configMatch?.groups?.json ? (JSON.parse(configMatch.groups.json) as Record<string, unknown>) : {};

  try {
    const output = await runFixtureCase({
      name,
      baselineSql,
      desiredSql,
      config: {...defaultConfig, ...localConfig},
    });

    return [
      `-- #region: ${name}`,
      ...(Object.keys(localConfig).length > 0 ? [`-- config: ${JSON.stringify(localConfig)}`] : []),
      '-- baseline:',
      baselineSql,
      '-- desired:',
      desiredSql,
      output ? '-- output:' : '-- output: <empty>',
      ...(output ? [output] : []),
      '-- #endregion',
    ].join('\n');
  } catch (error) {
    return [
      `-- #region: ${name}`,
      ...(Object.keys(localConfig).length > 0 ? [`-- config: ${JSON.stringify(localConfig)}`] : []),
      '-- baseline:',
      baselineSql,
      '-- desired:',
      desiredSql,
      `-- error: ${JSON.stringify(String(error))}`,
      '-- #endregion',
    ].join('\n');
  }
}
