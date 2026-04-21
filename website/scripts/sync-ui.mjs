import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Copy the built UI bundle into `website/dist/ui` so a single Cloudflare
// deployment at `sqlfu.dev` serves both the marketing/docs site and the UI.
//
// The UI entry HTML is moved from `website/dist/ui/index.html` to
// `website/dist/ui.html`, and its relative asset paths get prefixed
// (`./assets/…` → `./ui/assets/…`). That way:
//
//   - `sqlfu.dev/ui?demo=1` serves `ui.html` directly (no 307 to add a
//     trailing slash, which is what CF's default html_handling does when
//     only `ui/index.html` exists)
//   - `sqlfu.dev/ui/?demo=1` 307s to `sqlfu.dev/ui?demo=1` (since no
//     `ui/index.html` exists, CF falls back to the file form)
//   - On artifact.ci, which strips trailing slashes before serving, the
//     stripped URL lands on `ui.html` and the prefixed paths keep
//     working — once artifact.ci implements .html extension resolution.
//
// This matches the pattern the Astro docs already use
// (`website/dist/docs/sqlfu.html` is a sibling of the `docs/` directory,
// not an `index.html` inside it).

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
