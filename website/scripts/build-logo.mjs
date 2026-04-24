#!/usr/bin/env node
// Generates favicon + logo variants from docs/logo.png into website/public/.
// Re-run after changing the source logo.

import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';

const websiteRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(websiteRoot, '..');
const sourcePath = path.join(repoRoot, 'docs', 'logo.png');
const publicRoot = path.join(websiteRoot, 'public');
const srcAssetsRoot = path.join(websiteRoot, 'src', 'assets');
const packageDocsRoot = path.join(repoRoot, 'packages', 'sqlfu', 'docs');

const pngVariants = [
  {dir: publicRoot, name: 'favicon-16.png', size: 16},
  {dir: publicRoot, name: 'favicon-32.png', size: 32},
  {dir: publicRoot, name: 'apple-touch-icon.png', size: 180},
  {dir: publicRoot, name: 'logo.png', size: 256},
  // Starlight imports the docs sidebar logo through the Astro asset pipeline,
  // so it must live under src/ (not public/).
  {dir: srcAssetsRoot, name: 'logo.png', size: 256},
  // Package README renders on GitHub + npm + the website "Overview" doc.
  // It references ./docs/logo.png so the asset must sit next to it.
  // Kept small so GitHub/npm render it at a modest, non-dominant size.
  {dir: packageDocsRoot, name: 'logo.png', size: 128},
];

const icoSizes = [16, 32, 48];

const source = await fs.readFile(sourcePath);

for (const {dir, name, size} of pngVariants) {
  await fs.mkdir(dir, {recursive: true});
  const out = await sharp(source).resize(size, size, {fit: 'contain'}).png().toBuffer();
  const destination = path.join(dir, name);
  await fs.writeFile(destination, out);
  console.log(`wrote ${path.relative(websiteRoot, destination)} (${size}x${size})`);
}

const icoPngs = await Promise.all(
  icoSizes.map((size) => sharp(source).resize(size, size, {fit: 'contain'}).png().toBuffer()),
);
const ico = buildIco(icoSizes.map((size, i) => ({size, data: icoPngs[i]})));
await fs.writeFile(path.join(publicRoot, 'favicon.ico'), ico);
console.log(`wrote public/favicon.ico (${icoSizes.join(', ')})`);

// Minimal ICO writer. ICO allows embedded PNGs since Vista.
// Format: ICONDIR (6 bytes) + N × ICONDIRENTRY (16 bytes each) + N × image data.
function buildIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const bodies = [];

  for (let i = 0; i < count; i++) {
    const {size, data} = images[i];
    const entryBase = 16 * i;
    entries.writeUInt8(size >= 256 ? 0 : size, entryBase); // width
    entries.writeUInt8(size >= 256 ? 0 : size, entryBase + 1); // height
    entries.writeUInt8(0, entryBase + 2); // palette
    entries.writeUInt8(0, entryBase + 3); // reserved
    entries.writeUInt16LE(1, entryBase + 4); // color planes
    entries.writeUInt16LE(32, entryBase + 6); // bits per pixel
    entries.writeUInt32LE(data.length, entryBase + 8); // size of image data
    entries.writeUInt32LE(offset, entryBase + 12); // offset
    bodies.push(data);
    offset += data.length;
  }

  return Buffer.concat([header, entries, ...bodies]);
}
