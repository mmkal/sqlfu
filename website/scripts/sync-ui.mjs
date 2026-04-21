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
// The UI entry HTML is moved from `website/dist/ui/index.html` to
// `website/dist/ui.html`, and its relative asset paths get prefixed
// (`./assets/…` → `./ui/assets/…`). Two reasons:
//
//   1. Static hosts (node `serve`, artifact.ci, Vercel, etc.) commonly
//      serve `/foo` as `/foo/index.html` *without* redirecting to
//      `/foo/`. The browser URL then has no trailing slash, relative
//      paths resolve against the parent of `ui`, and `./assets/foo.js`
//      becomes `/assets/foo.js` → 404. Prefixing with `./ui/` gives
//      correct resolution regardless of trailing slash.
//
//   2. This matches the pattern the Astro docs already use:
//      `website/dist/docs/sqlfu.html` is a sibling of the `docs/`
//      directory, not an `index.html` inside it, precisely so the same
//      trailing-slash-stripping bug doesn't break docs asset paths on
//      artifact.ci.
//
// On Cloudflare with the default `html_handling: auto-trailing-slash`:
//   - `/ui` → serves `ui.html`
//   - `/ui/` → no `ui/index.html`, so redirects to `/ui`, serves `ui.html`

const websiteRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(websiteRoot);
const uiDist = path.join(repoRoot, 'packages/ui/dist');
const targetDir = path.join(websiteRoot, 'dist/ui');
const targetHtml = path.join(websiteRoot, 'dist/ui.html');

try {
  await fs.stat(uiDist);
} catch {
  throw new Error(`expected ui build output at ${uiDist}. run \`pnpm --filter @sqlfu/ui build\` first.`);
}

await fs.rm(targetDir, {recursive: true, force: true});
await fs.rm(targetHtml, {force: true});
await fs.cp(uiDist, targetDir, {recursive: true});

const indexPath = path.join(targetDir, 'index.html');
const indexHtml = await fs.readFile(indexPath, 'utf8');
const prefixed = indexHtml.replaceAll(/((?:href|src)=")\.\//g, '$1./ui/');
await fs.writeFile(targetHtml, prefixed);
await fs.rm(indexPath);

console.log(`synced ${path.relative(repoRoot, uiDist)} → ${path.relative(repoRoot, targetHtml)} + ${path.relative(repoRoot, targetDir)}/ (assets)`);
