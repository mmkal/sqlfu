/**
 * Render a handful of stills from a composition so we can eyeball specific
 * frames without watching the whole video. Useful when iterating on beat
 * timings. Outputs go to /tmp with a .ignoreme suffix.
 *
 * Usage:
 *   pnpm tsx scripts/sample-stills.ts <compId> <frame> [frame...]
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {renderStill, selectComposition} from '@remotion/renderer';

const here = path.dirname(fileURLToPath(import.meta.url));
const animationsRoot = path.resolve(here, '..');

const [compId, ...frameArgs] = process.argv.slice(2);
if (!compId || frameArgs.length === 0) {
  console.error('usage: pnpm tsx scripts/sample-stills.ts <compId> <frame> [frame...]');
  process.exit(1);
}

const frames = frameArgs.map((s) => Number.parseInt(s, 10));

console.log(`[sample-stills] bundling...`);
const serveUrl = await bundle({entryPoint: path.resolve(animationsRoot, 'src', 'index.ts')});
const composition = await selectComposition({serveUrl, id: compId});

for (const frame of frames) {
  const output = `/tmp/ignoreme-${compId}-f${frame}.jpg`;
  console.log(`[sample-stills] ${compId} @ f${frame} → ${output}`);
  await renderStill({composition, serveUrl, frame, imageFormat: 'jpeg', output});
}
console.log('[sample-stills] done');
