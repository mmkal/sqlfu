/**
 * Runs @microsoft/api-extractor across every public entry point to:
 *
 * 1. Emit a single rolled-up `.d.ts` per entry (`dist/<entry>.bundled.d.ts`).
 * 2. Regenerate the committed api reports under `etc/api-reports/`. These
 *    are human-reviewable summaries of every exported symbol — diffing them
 *    in PR review is the point of this step; the rolled-up `.d.ts` files
 *    are a nice side-effect.
 *
 * After api-extractor runs, each rolled-up `.d.ts` is promoted in-place to
 * `dist/<entry>.d.ts`, and every orphaned per-file `.d.ts` / `.d.ts.map`
 * under `dist/` is deleted. That's where the tarball size win comes from:
 * the 60-odd raw declaration files from tsgo are replaced by 6 self-contained
 * rollups.
 *
 * Runs AFTER `build:runtime` and BEFORE `build:vendor-typesql` /
 * `build:bundle-vendor`. It needs the raw per-file `.d.ts` from tsgo to be
 * present (so api-extractor can follow imports) and it needs the vendor
 * bundler hasn't yet deleted sql-formatter's per-file `.js` files (they'd
 * make api-extractor's TypeScript program choke, see the `(ae-wrong-input
 * -file-type)` path in `etc/api-extractor/tsconfig.json`).
 *
 * Important: the `etc/api-extractor/tsconfig.json` is kept separate from
 * `tsconfig.build.json` so its `paths` remap of `sqlfu` / `sqlfu/*` points
 * at `dist/*.d.ts` rather than `src/*.ts`. The generated query files in
 * `src/migrations/queries/.generated/*.ts` do `import type {Client} from
 * 'sqlfu'`; without the paths remap, TypeScript follows the package.json
 * `exports` field back into `src/`, dragging .ts files into the program and
 * breaking api-extractor's `.d.ts`-only invariant.
 */
import {execa} from 'execa';
import {existsSync} from 'node:fs';
import {copyFile, mkdir, readdir, rename, rm, stat} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';

const pkgRoot = resolve(import.meta.dirname, '..');
const distRoot = resolve(pkgRoot, 'dist');
const apiExtractorBin = resolve(pkgRoot, 'node_modules/.bin/api-extractor');

// Each entry maps a config file name (under etc/api-extractor/) to the
// post-rollup path that should live at `dist/<path>.d.ts`. Flat config
// names (`ui-index`) intentionally differ from the output path (`ui/index`)
// because filesystems don't love slashes in filenames.
const entries: ReadonlyArray<{config: string; output: string}> = [
  {config: 'index', output: 'index'},
  {config: 'browser', output: 'browser'},
  {config: 'client', output: 'client'},
  {config: 'api', output: 'api'},
  {config: 'ui-index', output: 'ui/index'},
  {config: 'ui-browser', output: 'ui/browser'},
];

async function runApiExtractor(configName: string): Promise<void> {
  const configPath = resolve(pkgRoot, `etc/api-extractor/${configName}.json`);
  const {exitCode} = await execa(apiExtractorBin, ['run', '--local', '--config', configPath], {
    cwd: pkgRoot,
    stdio: 'inherit',
    reject: false,
  });
  if (exitCode !== 0) {
    throw new Error(`api-extractor failed for ${configName} (exit code ${exitCode})`);
  }
}

async function promoteRollup(outputName: string): Promise<void> {
  const bundled = resolve(distRoot, `${outputName}.bundled.d.ts`);
  const target = resolve(distRoot, `${outputName}.d.ts`);
  if (!existsSync(bundled)) {
    throw new Error(`expected rolled-up file ${bundled} was not produced`);
  }
  await rename(bundled, target);
}

async function walkDistDeclarations(dir: string, acc: string[]): Promise<string[]> {
  const entries = await readdir(dir, {withFileTypes: true});
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      // Vendor trees are not owned by us; bundle-vendor handles them.
      if (full === resolve(distRoot, 'vendor')) continue;
      await walkDistDeclarations(full, acc);
    } else if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.ts.map')) {
      acc.push(full);
    }
  }
  return acc;
}

async function deleteOrphanDeclarations(keep: Set<string>): Promise<{deleted: number; kept: number}> {
  const allDts = await walkDistDeclarations(distRoot, []);
  let deleted = 0;
  let kept = 0;
  for (const p of allDts) {
    if (keep.has(p)) {
      kept++;
    } else {
      await rm(p);
      deleted++;
    }
  }
  return {deleted, kept};
}

// Checked-in source files that have no corresponding `.ts` to compile but
// still need to land in `dist/` alongside tsgo's output. See the comment at
// the top of the file for the browser-safe typesql re-export rationale.
const sidecarSources: ReadonlyArray<{from: string; to: string}> = [
  {
    from: 'src/typegen/analyze-vendored-typesql-with-client.js',
    to: 'dist/typegen/analyze-vendored-typesql-with-client.js',
  },
  {
    from: 'src/typegen/analyze-vendored-typesql-with-client.d.ts',
    to: 'dist/typegen/analyze-vendored-typesql-with-client.d.ts',
  },
];

async function copySidecars(): Promise<void> {
  for (const {from, to} of sidecarSources) {
    const src = resolve(pkgRoot, from);
    const dst = resolve(pkgRoot, to);
    if (!existsSync(src)) {
      throw new Error(`sidecar source ${src} does not exist`);
    }
    await mkdir(dirname(dst), {recursive: true});
    await copyFile(src, dst);
  }
}

async function main() {
  if (!existsSync(distRoot)) {
    throw new Error(`dist/ not found at ${distRoot} — run build:runtime first`);
  }

  // Copy the checked-in browser-safe typesql sidecar before running
  // api-extractor: src/browser.ts re-exports from it, and the `.d.ts` must be
  // resolvable from `dist/browser.d.ts` or the rollup for `browser` fails.
  await copySidecars();

  // api-extractor writes the api reports into etc/api-reports/temp first, then
  // compares against the committed file. The --local flag tells it to write
  // the committed file directly if the temp differs. Make sure temp exists;
  // api-extractor creates it if needed.
  const reportsTemp = resolve(pkgRoot, 'etc/api-reports/temp');
  await rm(reportsTemp, {recursive: true, force: true});

  for (const {config} of entries) {
    await runApiExtractor(config);
  }

  for (const {output} of entries) {
    await promoteRollup(output);
  }

  // Clean up the temp/ folder so it doesn't end up in the package.
  await rm(reportsTemp, {recursive: true, force: true});

  const keep = new Set<string>(entries.map(({output}) => resolve(distRoot, `${output}.d.ts`)));
  const {deleted, kept} = await deleteOrphanDeclarations(keep);

  const rolledStat = await Promise.all([...keep].map(async p => ({path: p, size: (await stat(p)).size})));
  const totalRolled = rolledStat.reduce((sum, {size}) => sum + size, 0);

  console.log(`bundle-types: kept ${kept} rolled-up .d.ts (${(totalRolled / 1024).toFixed(1)} kB total), deleted ${deleted} orphans`);
}

await main();
