#!/usr/bin/env node
// Delegation shim so `npm install -g sqlfu` can still pick up a project-local
// copy when one exists. Resolution order:
//   1. Workspace source/build inside the sqlfu monorepo (pnpm-workspace.yaml above cwd)
//   2. `node_modules/sqlfu/dist/cli.js` resolvable from cwd
//   3. The globally-installed copy that ships alongside this file

import {existsSync, realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve, sep} from 'node:path';
import process from 'node:process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const selfReal = realpathSync(fileURLToPath(import.meta.url));
const pkgRoot = dirname(dirname(selfReal));

const isSelf = (p) => {
  try {
    return realpathSync(p) === selfReal;
  } catch {
    return false;
  }
};

const findUp = (relativePath) => {
  let dir = resolve(process.cwd());
  while (true) {
    if (existsSync(join(dir, relativePath))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

const findWorkspaceCli = () => {
  const repoRoot = findUp('pnpm-workspace.yaml');
  if (!repoRoot) return null;
  const sqlfuPkg = join(repoRoot, 'packages/sqlfu');
  if (!existsSync(join(sqlfuPkg, 'package.json'))) return null;
  const src = join(sqlfuPkg, 'src/cli.ts');
  const dist = join(sqlfuPkg, 'dist/cli.js');
  if (existsSync(src) && !isSelf(src)) return src;
  if (existsSync(dist) && !isSelf(dist)) return dist;
  return null;
};

const findNodeModulesCli = () => {
  // Walk up looking for node_modules/sqlfu/dist/cli.js. Can't rely on
  // createRequire + require.resolve because the published package's `exports`
  // field intentionally doesn't list `./package.json` or the CLI as subpaths.
  let dir = resolve(process.cwd());
  while (true) {
    if (!dir.split(sep).includes('node_modules')) {
      const candidate = join(dir, 'node_modules/sqlfu/dist/cli.js');
      if (existsSync(candidate) && !isSelf(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

const registerTsLoader = async (anchor) => {
  // Node's own `--experimental-strip-types` strips annotations but doesn't
  // rewrite `.js` imports to `.ts`, which the workspace source relies on.
  // Prefer tsx's programmatic register() when it's resolvable from the
  // workspace; fall back to native stripping otherwise.
  try {
    const localRequire = createRequire(anchor);
    const apiPath = localRequire.resolve('tsx/esm/api');
    const {register} = await import(pathToFileURL(apiPath).href);
    register();
  } catch {}
};

const importCli = async (target) => {
  if (target.endsWith('.ts')) await registerTsLoader(target);
  await import(pathToFileURL(target).href);
};

const runFallback = () => importCli(join(pkgRoot, 'dist/cli.js'));

const target = findWorkspaceCli() ?? findNodeModulesCli();

if (!target) {
  await runFallback();
} else {
  try {
    await importCli(target);
  } catch (err) {
    if (err?.code === 'ERR_UNKNOWN_FILE_EXTENSION' && target.endsWith('.ts')) {
      const workspaceDist = join(dirname(dirname(target)), 'dist/cli.js');
      if (existsSync(workspaceDist) && !isSelf(workspaceDist)) {
        await importCli(workspaceDist);
      } else {
        await runFallback();
      }
    } else {
      throw err;
    }
  }
}
