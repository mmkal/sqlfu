import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const websiteRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distRoot = path.join(websiteRoot, 'dist');

// Astro emits HTML with absolute paths like `/styles.css` and `/docs/`, which
// break whenever the site is served under a path prefix (e.g. the artifact.ci
// preview URL `/artifact/view/.../run/.../website/`). Walk every HTML file in
// dist/ and rewrite absolute hrefs/srcs to paths relative to the file's depth.

await walk(distRoot);
console.log(`rewrote absolute paths in html under ${path.relative(websiteRoot, distRoot)}`);

async function walk(dir) {
  const entries = await fs.readdir(dir, {withFileTypes: true});
  await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      if (entry.isFile() && entry.name.endsWith('.html')) return rewriteFile(full);
    }),
  );
}

async function rewriteFile(filePath) {
  const html = await fs.readFile(filePath, 'utf8');
  const depth = path.relative(distRoot, path.dirname(filePath)).split(path.sep).filter(Boolean).length;
  const prefix = depth === 0 ? './' : '../'.repeat(depth);
  const rewritten = html.replaceAll(/((?:href|src|poster)=")(\/)([^"/][^"]*|)"/g, (_match, attr, _slash, rest) => {
    return `${attr}${prefix}${rest}"`;
  });
  await fs.writeFile(filePath, rewritten);
}
