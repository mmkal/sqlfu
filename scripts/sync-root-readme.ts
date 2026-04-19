#!/usr/bin/env tsx

import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(repoRoot, 'packages/sqlfu/README.md');
const targetPath = path.join(repoRoot, 'README.md');

const mode = process.argv[2] || 'sync';

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});

async function main() {
  if (mode === 'pre-commit') {
    await runPreCommit();
  } else if (mode === 'check') {
    await runCheck();
  } else if (mode === 'sync') {
    await writeRootReadme();
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }
}

async function runPreCommit() {
  const stagedFiles = getStagedFiles();
  const sourceChanged = stagedFiles.includes('packages/sqlfu/README.md');
  const targetChanged = stagedFiles.includes('README.md');

  if (targetChanged && !sourceChanged) {
    const nextContent = await renderRootReadme();
    const currentContent = await readFileIfExists(targetPath);
    if (currentContent !== nextContent) {
      fail('README.md is generated from packages/sqlfu/README.md. Edit packages/sqlfu/README.md instead.');
    }
  }

  if (!sourceChanged) {
    return;
  }

  await writeRootReadme();
  execFileSync('git', ['add', 'README.md'], {cwd: repoRoot, stdio: 'inherit'});
}

async function runCheck() {
  const nextContent = await renderRootReadme();
  const currentContent = await readFileIfExists(targetPath);
  if (currentContent !== nextContent) {
    fail('README.md is out of sync with packages/sqlfu/README.md. Run `pnpm sync:root-readme`.');
  }
}

async function writeRootReadme() {
  const nextContent = await renderRootReadme();
  await fs.writeFile(targetPath, nextContent);
  console.log('wrote README.md');
}

async function renderRootReadme() {
  const sourceContent = await fs.readFile(sourcePath, 'utf8');
  return rewriteRelativeLinks(sourceContent);
}

function rewriteRelativeLinks(markdown) {
  return markdown.replace(/(!?\[[^\]]*\]\()([^\)]+)(\))/g, (fullMatch, prefix, rawTarget, suffix) => {
    const parsed = splitMarkdownTarget(rawTarget);
    if (!parsed) {
      return fullMatch;
    }

    const rewrittenTarget = rewriteTarget(parsed.target);
    return `${prefix}${rewrittenTarget}${parsed.trailing}${suffix}`;
  });
}

function splitMarkdownTarget(rawTarget) {
  const trimmed = rawTarget.trim();
  if (!trimmed) {
    return null;
  }

  const titleMatch = trimmed.match(/^(\S+)(\s+.+)$/);
  if (!titleMatch) {
    return {target: trimmed, trailing: ''};
  }

  return {
    target: titleMatch[1],
    trailing: titleMatch[2],
  };
}

function rewriteTarget(target) {
  const bareTarget = target.replace(/^<|>$/g, '');
  if (isExternalTarget(bareTarget)) {
    return target;
  }

  const [pathPart, hashPart] = bareTarget.split('#');
  const resolvedPath = path.resolve(path.dirname(sourcePath), pathPart);
  const relativePath = path.relative(repoRoot, resolvedPath).split(path.sep).join('/') || '.';
  const rebuilt = hashPart ? `${relativePath}#${hashPart}` : relativePath;
  return target.startsWith('<') ? `<${rebuilt}>` : rebuilt;
}

function isExternalTarget(target) {
  return (
    target.startsWith('#') || target.startsWith('data:') || target.startsWith('mailto:') || /^[a-z]+:\/\//i.test(target)
  );
}

function getStagedFiles() {
  return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function readFileIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
