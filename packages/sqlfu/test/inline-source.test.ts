import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect, inject, test} from 'vitest';

import {appendInlineMigration, writeInlineQueryTypes, type InlineQueryType} from '../src/node/inline-source.js';
import {createTempFixtureRoot, writeFixtureFiles} from './fs-fixture.js';

declare module 'vitest' {
  export interface ProvidedContext {
    updateSnapshots: boolean;
  }
}

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'inline-source', 'fixtures');

for (const fixturePath of listFixtureFiles(fixturesDir)) {
  const cases = parseInlineSourceFixture(fs.readFileSync(fixturePath, 'utf8'));

  for (const fixtureCase of cases) {
    test(`${path.basename(fixturePath)} ${fixtureCase.name}`, async () => {
      await using fixture = await createInlineSourceFixture(fixtureCase.inputFiles);

      const output = await fixture.applyEdits(fixtureCase.modulePath, fixtureCase.edits);

      if (inject('updateSnapshots')) {
        updateFixtureOutput(fixturePath, fixtureCase.name, {
          path: fixtureCase.outputFile.path,
          lang: fixtureCase.outputFile.lang,
          content: output,
        });
        return;
      }

      expect(
        output,
        `content mismatch at ${fixturePath} ${fixtureCase.name}. Run again with -u or --update to update the expected output.`,
      ).toBe(fixtureCase.outputFile.content);
    });
  }
}

type InlineSourceFixtureCase = {
  name: string;
  inputFiles: FixtureFile[];
  modulePath: string;
  edits: InlineSourceEdits;
  outputFile: FixtureFile;
};

type InlineSourceEdits = {
  types?: InlineQueryType[];
  migration?: {
    app?: string;
    name: string;
    content: string;
  };
};

type FixtureFile = {
  path: string;
  lang: string;
  content: string;
};

type InlineSourceFixture = {
  applyEdits(modulePath: string, edits: InlineSourceEdits): Promise<string>;
  [Symbol.asyncDispose](): Promise<void>;
};

async function createInlineSourceFixture(inputFiles: FixtureFile[]): Promise<InlineSourceFixture> {
  const root = await createTempFixtureRoot('inline-source');
  const files = Object.fromEntries(inputFiles.map((file) => [file.path, file.content]));
  await writeFixtureFiles(root, files);

  return {
    async applyEdits(modulePath: string, edits: InlineSourceEdits) {
      const fullModulePath = path.join(root, modulePath);
      if (edits.types) {
        await writeInlineQueryTypes(fullModulePath, edits.types);
      }
      if (edits.migration) {
        await appendInlineMigration(fullModulePath, edits.migration);
      }
      return fsp.readFile(fullModulePath, 'utf8');
    },
    async [Symbol.asyncDispose]() {
      await fsp.rm(root, {recursive: true, force: true});
    },
  };
}

function listFixtureFiles(root: string): string[] {
  return fs
    .globSync('*.md', {cwd: root})
    .map((name) => path.join(root, name))
    .sort();
}

function parseInlineSourceFixture(contents: string): InlineSourceFixtureCase[] {
  const cases: InlineSourceFixtureCase[] = [];
  const headings = [...contents.matchAll(/^##\s+(?<name>.+)$/gm)];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const next = headings[i + 1];
    const start = heading.index! + heading[0].length;
    const end = next ? next.index! : contents.length;
    const body = contents.slice(start, end);
    const name = heading.groups!.name.trim();

    const inputFiles = parseFileBlocks(requiredDetailsBody(body, 'input', name));
    const editsFiles = parseFileBlocks(requiredDetailsBody(body, 'edits', name));
    const outputFiles = parseFileBlocks(requiredDetailsBody(body, 'output', name));
    const editsFile = editsFiles.find((file) => file.path === 'edits.json') || editsFiles[0];
    const outputFile = outputFiles[0];

    if (!editsFile) {
      throw new Error(`Fixture "${name}" has no edits file`);
    }
    if (!outputFile) {
      throw new Error(`Fixture "${name}" has no output file`);
    }
    if (!inputFiles.some((file) => file.path === outputFile.path)) {
      throw new Error(`Fixture "${name}" output file "${outputFile.path}" has no matching input file`);
    }

    cases.push({
      name,
      inputFiles,
      modulePath: outputFile.path,
      edits: parseEdits(editsFile),
      outputFile,
    });
  }

  return cases;
}

function requiredDetailsBody(container: string, summary: string, testName: string): string {
  const body = extractDetailsBody(container, summary);
  if (!body) {
    throw new Error(`Fixture "${testName}" has no "${summary}" details block`);
  }
  return body;
}

function extractDetailsBody(container: string, summary: string): string | undefined {
  const escaped = summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<details[^>]*>\\s*<summary>${escaped}</summary>([\\s\\S]*?)</details>`, 'i');
  return container.match(pattern)?.[1];
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

function parseEdits(file: FixtureFile): InlineSourceEdits {
  const raw = JSON.parse(file.content);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${file.path} must contain a JSON object`);
  }

  const edits = raw as Record<string, unknown>;
  const result: InlineSourceEdits = {};

  if (edits.types) {
    if (!Array.isArray(edits.types)) {
      throw new Error(`${file.path} "types" must be a JSON array`);
    }
    result.types = parseQueryTypes(edits.types, file.path);
  }

  if (edits.migration) {
    if (typeof edits.migration !== 'object' || Array.isArray(edits.migration)) {
      throw new Error(`${file.path} "migration" must be a JSON object`);
    }
    const migration = edits.migration as Record<string, unknown>;
    if (typeof migration.name !== 'string') {
      throw new Error(`${file.path} "migration.name" must be a string`);
    }
    if (typeof migration.content !== 'string') {
      throw new Error(`${file.path} "migration.content" must be a string`);
    }
    result.migration = {
      app: typeof migration.app === 'string' ? migration.app : undefined,
      name: migration.name,
      content: migration.content,
    };
  }

  if (!result.types && !result.migration) {
    throw new Error(`${file.path} must contain "types" or "migration"`);
  }

  return result;
}

function parseQueryTypes(raw: unknown[], filePath: string): InlineQueryType[] {
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${filePath} "types[${index}]" must be a JSON object`);
    }
    const queryType = entry as Record<string, unknown>;
    if (typeof queryType.configName !== 'string') {
      throw new Error(`${filePath} "types[${index}].configName" must be a string`);
    }
    if (queryType.className && typeof queryType.className !== 'string') {
      throw new Error(`${filePath} "types[${index}].className" must be a string`);
    }
    if (typeof queryType.queryName !== 'string') {
      throw new Error(`${filePath} "types[${index}].queryName" must be a string`);
    }
    if (typeof queryType.type !== 'string') {
      throw new Error(`${filePath} "types[${index}].type" must be a string`);
    }
    if (!isQueryResultMode(queryType.mode)) {
      throw new Error(`${filePath} "types[${index}].mode" must be one of many, nullableOne, one, metadata`);
    }
    return {
      className: typeof queryType.className === 'string' ? queryType.className : undefined,
      configName: queryType.configName,
      queryName: queryType.queryName,
      type: queryType.type,
      mode: queryType.mode,
    };
  });
}

function isQueryResultMode(value: unknown): value is InlineQueryType['mode'] {
  return value === 'many' || value === 'nullableOne' || value === 'one' || value === 'metadata';
}

function updateFixtureOutput(fixturePath: string, testName: string, outputFile: FixtureFile): void {
  const contents = fs.readFileSync(fixturePath, 'utf8');
  const updated = rewriteFixtureOutput(contents, testName, outputFile);
  if (updated !== contents) {
    fs.writeFileSync(fixturePath, updated);
  }
}

function rewriteFixtureOutput(contents: string, testName: string, outputFile: FixtureFile): string {
  const headings = [...contents.matchAll(/^##[ \t]+(.+?)[ \t]*$/gm)];
  const target = headings.findIndex((heading) => heading[1].trim() === testName);
  if (target < 0) {
    throw new Error(`Test section "${testName}" not found in fixture`);
  }

  const sectionStart = headings[target].index!;
  const sectionEnd = headings[target + 1]?.index || contents.length;
  const section = contents.slice(sectionStart, sectionEnd);
  const rewritten = section.replace(
    /(<details[^>]*>\s*<summary>output<\/summary>)([\s\S]*?)(<\/details>)/i,
    (_match, open: string, _inner: string, close: string) => {
      return `${open}\n\n${renderFileBlock(outputFile)}\n\n${close}`;
    },
  );
  return `${contents.slice(0, sectionStart)}${rewritten}${contents.slice(sectionEnd)}`;
}

function renderFileBlock(file: FixtureFile): string {
  const body = file.content.endsWith('\n') ? file.content : `${file.content}\n`;
  return `\`\`\`${file.lang} (${file.path})\n${body}\`\`\``;
}
