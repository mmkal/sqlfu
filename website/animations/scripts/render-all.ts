/**
 * Render every composition declared in src/Root.tsx to webm + mp4 + a poster
 * jpg, into website/public/assets/animations/ (served at /assets/animations/
 * by astro at build time).
 *
 * Usage:
 *   pnpm -C website/animations render [compId1 compId2 ...]
 *
 * If no comp ids are passed, all compositions are rendered. For fast iteration
 * (`pnpm render anim-1-schema`), only render the ones you changed.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import {compositionIds} from '../src/Root';

const here = path.dirname(fileURLToPath(import.meta.url));
const animationsRoot = path.resolve(here, '..');
const outputRoot = path.resolve(animationsRoot, '..', 'public', 'assets', 'animations');

const requested = process.argv.slice(2);
const targets = requested.length ? requested : [...compositionIds];

for (const id of targets) {
  if (!compositionIds.includes(id as (typeof compositionIds)[number])) {
    throw new Error(`Unknown composition: ${id}`);
  }
}

await fs.mkdir(outputRoot, {recursive: true});

console.log(`[animations] bundling...`);
const bundleLocation = await bundle({
  entryPoint: path.resolve(animationsRoot, 'src', 'index.ts'),
  // Remotion's bundler expects a webpackOverride callback; the default is fine
  // for our pure-react compositions.
});

for (const id of targets) {
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id,
  });
  const base = path.join(outputRoot, id);

  console.log(`[animations] rendering ${id} (mp4)`);
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: 'h264',
    outputLocation: `${base}.mp4`,
  });

  console.log(`[animations] rendering ${id} (webm)`);
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: 'vp9',
    outputLocation: `${base}.webm`,
  });

  console.log(`[animations] rendering ${id} (poster)`);
  await renderStill({
    composition,
    serveUrl: bundleLocation,
    // Poster frame = the final held frame so the prefers-reduced-motion
    // fallback shows the payoff, not a blank leading frame.
    frame: composition.durationInFrames - 1,
    imageFormat: 'jpeg',
    output: `${base}.poster.jpg`,
  });
}

console.log(`[animations] done — outputs in ${path.relative(process.cwd(), outputRoot)}`);
