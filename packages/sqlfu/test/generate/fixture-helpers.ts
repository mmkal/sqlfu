import dedent from 'dedent';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

import {createNodeSqliteClient} from '../../src/client.js';
import {generateQueryTypes} from '../../src/typegen/index.js';
import {createTempFixtureRoot, withTrailingNewline, writeFixtureFiles} from '../fs-fixture.js';

export type FixtureFile = {
  readonly path: string;
  readonly lang: string;
  readonly content: string;
};

export type FixtureCase = {
  readonly name: string;
  readonly inputFiles: readonly FixtureFile[];
  readonly outputFiles: readonly FixtureFile[];
  readonly expectedError?: string;
};

export type FixtureRunResult =
  | {readonly kind: 'ok'; readonly outputs: Record<string, string>}
  | {readonly kind: 'error'; readonly message: string};

export function listFixtureFiles(root: string): string[] {
  return fs
    .globSync('*.md', {cwd: root})
    .map((name) => path.join(root, name))
    .sort();
}

export async function runFixtureCase(fixtureCase: FixtureCase): Promise<FixtureRunResult> {
  const root = await createTempFixtureRoot('generate-fixture');
  try {
    const files: Record<string, string> = {};
    for (const file of fixtureCase.inputFiles) {
      files[file.path] = file.content;
    }
    await writeFixtureFiles(root, files);

    const definitionsSql = files['definitions.sql'];
    if (definitionsSql) {
      await applyDefinitionsToDatabase(path.join(root, 'app.db'), definitionsSql);
    }

    try {
      await inWorkingDirectory(root, () => generateQueryTypes());
    } catch (error) {
      return {kind: 'error', message: error instanceof Error ? error.message : String(error)};
    }

    const outputs: Record<string, string> = {};
    for (const file of fixtureCase.outputFiles) {
      try {
        outputs[file.path] = await fsp.readFile(path.join(root, file.path), 'utf8');
      } catch {
        outputs[file.path] = '<MISSING>';
      }
    }

    return {kind: 'ok', outputs};
  } finally {
    await fsp.rm(root, {recursive: true, force: true});
  }
}

/**
 * A fixture file looks like:
 *
 *     intro paragraph...
 *
 *     <details>
 *     <summary>default config</summary>
 *
 *     ```ts (sqlfu.config.ts)
 *     ...
 *     ```
 *
 *     </details>
 *
 *     ## test name
 *
 *     <details>
 *     <summary>input</summary>
 *     ...
 *     </details>
 *
 *     <details>
 *     <summary>output</summary>
 *     ...
 *     </details>
 *
 * Each `##` heading is one test; its input/output (and optional error) live in nested
 * `<details>` blocks. The optional `default config` block at the top of the file supplies a
 * `sqlfu.config.ts` used by any test that doesn't declare its own.
 */
export function parseGenerateFixture(contents: string): FixtureCase[] {
  const cases: FixtureCase[] = [];
  const {defaultConfig, testArea} = extractDefaultConfig(contents);

  const headingPattern = /^##\s+(?<name>.+)$/gm;
  const headings = [...testArea.matchAll(headingPattern)];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const next = headings[i + 1];
    const start = heading.index! + heading[0].length;
    const end = next ? next.index! : testArea.length;
    const body = testArea.slice(start, end);
    const name = heading.groups!.name.trim();

    const inputFiles = parseFileBlocks(extractDetailsBody(body, 'input') || '');
    const outputFiles = parseFileBlocks(extractDetailsBody(body, 'output') || '');
    const expectedError = extractDetailsBody(body, 'error')?.trim() || undefined;

    if (defaultConfig && !inputFiles.some((file) => file.path === 'sqlfu.config.ts')) {
      inputFiles.unshift(defaultConfig);
    }

    if (inputFiles.length === 0) {
      throw new Error(`Fixture "${name}" has no input files`);
    }

    cases.push({name, inputFiles, outputFiles, expectedError});
  }

  return cases;
}

function extractDefaultConfig(contents: string): {defaultConfig?: FixtureFile; testArea: string} {
  const firstHeading = contents.search(/^##\s+/m);
  const headArea = firstHeading >= 0 ? contents.slice(0, firstHeading) : contents;
  const testArea = firstHeading >= 0 ? contents.slice(firstHeading) : '';

  const body = extractDetailsBody(headArea, 'default config');
  if (!body) {
    return {testArea};
  }

  const files = parseFileBlocks(body);
  const configFile = files.find((file) => file.path === 'sqlfu.config.ts');
  if (!configFile) {
    throw new Error(`"default config" block must contain a sqlfu.config.ts fence`);
  }
  return {defaultConfig: configFile, testArea};
}

function extractDetailsBody(container: string, summary: string): string | undefined {
  const escaped = summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<details>\\s*<summary>${escaped}</summary>([\\s\\S]*?)</details>`,
    'i',
  );
  const match = container.match(pattern);
  return match ? match[1] : undefined;
}

function parseFileBlocks(section: string): FixtureFile[] {
  const files: FixtureFile[] = [];
  const fencePattern = /^```(?<lang>[\w-]+)\s*\((?<path>[^)]+)\)\s*\n(?<content>[\s\S]*?)^```\s*$/gm;

  for (const match of section.matchAll(fencePattern)) {
    const {lang, path: filePath, content} = match.groups!;
    files.push({
      path: filePath.trim(),
      lang,
      content,
    });
  }

  return files;
}

async function inWorkingDirectory<TResult>(cwd: string, fn: () => Promise<TResult>): Promise<TResult> {
  const previousCwd = process.cwd();
  process.chdir(cwd);
  try {
    return await fn();
  } finally {
    process.chdir(previousCwd);
  }
}

async function applyDefinitionsToDatabase(dbPath: string, definitionsSql: string) {
  const database = new DatabaseSync(dbPath);
  const client = createNodeSqliteClient(database);
  try {
    await client.raw(withTrailingNewline(dedent(definitionsSql)));
  } finally {
    database.close();
  }
}
