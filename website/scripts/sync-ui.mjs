import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Copy the built UI bundle into `website/dist/ui` so a single Cloudflare
// deployment at `sqlfu.dev` serves both the marketing/docs site and the UI.
//
// Relies on `packages/ui/dist` having been built already — the root
// `pnpm build` builds @sqlfu/ui before sqlfu-website, and `pnpm deploy`
// runs `pnpm build` before alchemy. This script runs as the last step of
// the website's build, after astro build + make-portable.
//
// Also emits a sibling `ui.html` with paths prefixed (`./assets/…` →
// `./ui/assets/…`). When the request URL has no trailing slash, the
// browser resolves relative paths against the parent path — for `/ui`
// that's `/`, so `./assets/foo.js` would hit `/assets/foo.js` instead of
// `/ui/assets/foo.js`. The prefixed sibling fixes that case. On Cloudflare
// with the default `html_handling: auto-trailing-slash`, `/ui/` continues
// to serve `ui/index.html` (same-dir relative paths, unchanged). On
// artifact.ci, which 308-strips trailing slashes, the stripped URL lands
// on `ui.html` instead and the prefixed paths keep working.

const websiteRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(websiteRoot);
const uiDist = path.join(repoRoot, 'packages/ui/dist');
const targetDir = path.join(websiteRoot, 'dist/ui');
const siblingHtml = path.join(websiteRoot, 'dist/ui.html');

try {
  await fs.stat(uiDist);
} catch {
  throw new Error(`expected ui build output at ${uiDist}. run \`pnpm --filter @sqlfu/ui build\` first.`);
}

await fs.rm(targetDir, {recursive: true, force: true});
await fs.rm(siblingHtml, {force: true});
await fs.cp(uiDist, targetDir, {recursive: true});

const indexHtml = await fs.readFile(path.join(targetDir, 'index.html'), 'utf8');
const prefixed = indexHtml.replaceAll(/((?:href|src)=")\.\//g, '$1./ui/');
await fs.writeFile(siblingHtml, prefixed);

console.log(`synced ${path.relative(repoRoot, uiDist)} → ${path.relative(repoRoot, targetDir)} (+ ${path.relative(repoRoot, siblingHtml)} for trailing-slash-stripping hosts)`);
