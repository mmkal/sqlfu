import dedent from 'dedent';
import fs from 'node:fs/promises';
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

export async function listFixtureFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, {withFileTypes: true});
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(root, entry.name))
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
        outputs[file.path] = await fs.readFile(path.join(root, file.path), 'utf8');
      } catch {
        outputs[file.path] = '<MISSING>';
      }
    }

    return {kind: 'ok', outputs};
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
}

/**
 * A fixture case is one `<details>` block in the markdown. The `<summary>` carries the test
 * name; the body carries `### input`, `### output`, and optionally `### error` sections, each
 * populated by fenced code blocks of the form:
 *
 * ```ts (path/inside/fixture.ts)
 * ...content...
 * ```
 */
export function parseGenerateFixture(contents: string): FixtureCase[] {
  const cases: FixtureCase[] = [];
  const detailsPattern = /<details>\s*\n<summary>(?<name>[\s\S]+?)<\/summary>(?<body>[\s\S]*?)<\/details>/g;

  for (const match of contents.matchAll(detailsPattern)) {
    const {name, body} = match.groups!;
    const sections = splitBodyIntoSections(body);

    const inputFiles = sections.input ? parseFileBlocks(sections.input) : [];
    const outputFiles = sections.output ? parseFileBlocks(sections.output) : [];
    const expectedError = sections.error?.trim() || undefined;

    if (inputFiles.length === 0) {
      throw new Error(`Fixture "${name.trim()}" has no input files`);
    }

    cases.push({
      name: name.trim(),
      inputFiles,
      outputFiles,
      expectedError,
    });
  }

  return cases;
}

function splitBodyIntoSections(body: string): {input?: string; output?: string; error?: string} {
  const sectionPattern = /^###\s+(?<title>input|output|error)\s*$/gim;
  const matches = [...body.matchAll(sectionPattern)];
  const sections: {input?: string; output?: string; error?: string} = {};

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];
    const start = current.index! + current[0].length;
    const end = next ? next.index! : body.length;
    const title = current.groups!.title.toLowerCase() as 'input' | 'output' | 'error';
    sections[title] = body.slice(start, end);
  }

  return sections;
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
