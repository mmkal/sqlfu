/**
 * Dogfood entry point for sqlfu's lint plugin, loading the TypeScript source
 * directly via `tsx` so we can iterate on `packages/sqlfu/src/lint-plugin.ts`
 * without a build step.
 *
 * Why the CJS require dance: the VS Code / Cursor ESLint extension loads
 * `eslint.config.js` through Node's sync CJS→ESM path
 * (`importSyncForRequire`), which rejects any top-level await in the graph
 * with `ERR_REQUIRE_ASYNC_MODULE`. Using `await import()` here poisoned the
 * whole config for the IDE (CLI was fine — it uses real `import()`). tsx's
 * CJS hook gives us a synchronous `require()` that still rewrites NodeNext
 * `.js` specifiers to `.ts`, so we get dogfooding without TLA.
 *
 * Consumed by `eslint.config.js` at the repo root.
 *
 * Downstream packages consume `sqlfu/lint-plugin` from the published `dist/`,
 * which is a plain JS module and needs no tsx. This file is a repo-local
 * development convenience only.
 */

import {createRequire} from 'node:module';
import {register} from 'tsx/cjs/api';

register();

const require = createRequire(import.meta.url);
const mod = require('../packages/sqlfu/src/lint-plugin.ts');

export default mod.default;
