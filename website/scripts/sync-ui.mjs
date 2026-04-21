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

const websiteRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(websiteRoot);
const uiDist = path.join(repoRoot, 'packages/ui/dist');
const target = path.join(websiteRoot, 'dist/ui');

try {
  await fs.stat(uiDist);
} catch {
  throw new Error(`expected ui build output at ${uiDist}. run \`pnpm --filter @sqlfu/ui build\` first.`);
}

await fs.rm(target, {recursive: true, force: true});
await fs.cp(uiDist, target, {recursive: true});
console.log(`synced ${path.relative(repoRoot, uiDist)} → ${path.relative(repoRoot, target)}`);
