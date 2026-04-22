import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function createTempFixtureRoot(slug: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), `sqlfu-${slug}-`));
}

export async function writeFixtureFiles(root: string, files: Record<string, string>) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath);
    await fs.mkdir(path.dirname(fullPath), {recursive: true});
    await fs.writeFile(fullPath, withTrailingNewline(contents));
  }
}

export async function dumpFixtureFs(
  root: string,
  input: {
    ignoredNames?: string[];
    includeGlobs?: string[];
    excludeGlobs?: string[];
  } = {},
) {
  const files = await collectFixtureFiles(root, '', new Set(input.ignoredNames ?? []));
  const filteredFiles = files.filter((file) => matchesGlobs(file.relativePath, input));
  const lines = await renderFixtureFiles(filteredFiles);
  return `${lines.join('\n')}\n`;
}

export function withTrailingNewline(value: string) {
  return value.endsWith('\n') ? value : `${value}\n`;
}

async function collectFixtureFiles(
  root: string,
  relativeDir: string,
  ignoredNames: ReadonlySet<string>,
): Promise<FixtureFile[]> {
  const dirPath = path.join(root, relativeDir);
  const entries = (await fs.readdir(dirPath, {withFileTypes: true}))
    .filter((entry) => !ignoredNames.has(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  const files: FixtureFile[] = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFixtureFiles(root, relativePath, ignoredNames)));
      continue;
    }

    files.push({
      relativePath: relativePath.split(path.sep).join('/'),
      contents: await fs.readFile(path.join(root, relativePath), 'utf8'),
    });
  }

  return files;
}

async function renderFixtureFiles(files: FixtureFile[]) {
  const lines: string[] = [];
  const seenDirectories = new Set<string>();

  for (const file of files) {
    const parts = file.relativePath.split('/');
    const fileName = parts.at(-1)!;
    for (let depth = 1; depth < parts.length; depth++) {
      const directory = parts.slice(0, depth).join('/');
      if (seenDirectories.has(directory)) {
        continue;
      }
      seenDirectories.add(directory);
      const prefix = '  '.repeat(depth - 1);
      lines.push(`${prefix}${parts[depth - 1]}/`);
    }

    const prefix = '  '.repeat(parts.length - 1);
    lines.push(`${prefix}${fileName}`);
    for (const line of file.contents.trimEnd().split('\n')) {
      lines.push(`${prefix}  ${line}`);
    }
  }

  return lines;
}

function matchesGlobs(
  relativePath: string,
  input: {
    includeGlobs?: string[];
    excludeGlobs?: string[];
  },
) {
  const included =
    !input.includeGlobs ||
    input.includeGlobs.length === 0 ||
    input.includeGlobs.some((glob) => path.matchesGlob(relativePath, glob));
  if (!included) {
    return false;
  }

  return !input.excludeGlobs || !input.excludeGlobs.some((glob) => path.matchesGlob(relativePath, glob));
}

interface FixtureFile {
  relativePath: string;
  contents: string;
}
