/**
 * Dogfood entry point for sqlfu's lint plugin, loading the TypeScript source
 * directly via `tsx` so we can iterate on `packages/sqlfu/src/lint-plugin.ts`
 * without a build step.
 *
 * Why this file exists: Node's built-in type-stripping (as of 24.x) erases
 * type annotations but does NOT rewrite NodeNext-style `.js` import
 * specifiers to `.ts`, so `.oxlintrc.json` pointing at the raw `.ts` file
 * would fail at import time. tsx's ESM loader does rewrite those specifiers,
 * so we register it once at module-load and then import the plugin.
 *
 * Consumed by:
 *   - `.oxlintrc.json`  via `jsPlugins: [{name, specifier: './scripts/dogfood-lint-plugin.js'}]`
 *   - `eslint.config.js` via `import sqlfuPlugin from './scripts/dogfood-lint-plugin.js'`
 *
 * Downstream packages consume `sqlfu/lint-plugin` from the published `dist/`,
 * which is a plain JS module and needs no tsx. This file is a repo-local
 * development convenience only.
 */

import {register} from 'tsx/esm/api';

// `register()` is idempotent per-process; calling it once here is enough to
// make the subsequent dynamic import resolve the TS source with its `.js`
// specifiers rewritten to `.ts`.
register();

const mod = await import('../packages/sqlfu/src/lint-plugin.ts');

export default mod.default;
