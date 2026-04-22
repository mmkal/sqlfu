/**
 * Bundle the compositions to check they at least build successfully. Does not
 * render anything. Useful as a quick check in CI.
 */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, '..', 'src', 'index.ts');

console.log('[animations] smoke-bundling...');
const location = await bundle({entryPoint: entry});
console.log(`[animations] bundled OK at ${location}`);
