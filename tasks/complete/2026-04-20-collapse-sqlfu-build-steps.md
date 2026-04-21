---
status: done-option-c
size: medium
outcome: no-change
---

# Collapse packages/sqlfu's two-step build into one

## Status summary

Investigation complete (2026-04-20 bedtime). **Outcome: option C — keep the two-step build.** None of the collapse options (naive merged config, `tsc -b` composite, tsdown) preserve the hard constraints. The two-step build is deliberate and each step protects a real invariant (noCheck for vendor type errors; no .d.ts emission for vendor code). Landed a prominent rationale in `packages/sqlfu/CLAUDE.md` so the next agent doesn't repeat this. See "Implementation log" at the bottom for measured numbers and what fails in each option.

## Investigation plan (bedtime 2026-04-20)

The brief suggests three options. We will try them in order and stop at the first one that satisfies all hard constraints:

1. **Measure current baseline.** Record clean `pnpm --filter sqlfu build` time, clean `pnpm --filter sqlfu build:runtime` time, `npm pack --dry-run` size (files + KB), and that typecheck/tests pass on main. Everything below gets compared against these numbers.
2. **Prototype option A (tsdown / oxc-based builder).** Add tsdown as a devDep, write equivalent config, measure. Acceptance criteria:
    - Cold `pnpm build` ≤ 5s (so `ensureBuilt()`-gated tests with 5000ms timeouts survive)
    - Warm `ensureBuilt()` ≤ ~2s (current 1.4s baseline)
    - `npm pack --dry-run` size does NOT regress vs current
    - Public `.d.ts` shape for `dist/{index,browser,client,api,cli,ui/index,ui/browser}.d.ts` is equivalent (`diff -r` against main)
    - `.d.ts` emission is suppressed under `dist/vendor/{antlr4,code-block-writer,typesql,typesql-parser}/`
    - `@ts-nocheck` in `src/vendor/sql-formatter/**` (91 files) is respected
    - `allowJs` works for `src/vendor/antlr4/index.js`
    - Smoke-test: `node -e "import('./packages/sqlfu/dist/index.js').then(m => console.log(Object.keys(m).length))"` succeeds for each public entry point
    - `pnpm --filter sqlfu test --run` stays green
3. **Prototype option B (`tsc -b` with project references)** only if A fails. Same acceptance criteria.
4. **Option C (do nothing + document rationale)** if both fail. Add a prominent note to `packages/sqlfu/CLAUDE.md` explaining why the two-step build exists so the next agent doesn't repeat PR #19.

Whichever option wins, update `packages/sqlfu/CLAUDE.md` (creating it if needed) to describe the new build story or the status-quo rationale.

## Motivation

`packages/sqlfu` currently has a two-step build graph that feels like ceremony until you understand what it's protecting:

```jsonc
"build": "pnpm run build:runtime && pnpm run build:vendor-typesql",
"build:runtime": "tsc -p tsconfig.build.json",
"build:vendor-typesql": "rm -rf dist/vendor/antlr4 dist/vendor/code-block-writer dist/vendor/typesql dist/vendor/typesql-parser && tsc -p src/vendor/typesql/tsconfig.json",
```

Plus paired `typecheck` + `typecheck:vendor-typesql`.

Two configs, an `rm -rf` dance between them, and an easy-to-miss rule ("the main build emits sql-formatter; the typesql build must not clobber it"). Worth simplifying if we can do it without regressions.

## Why the naive merge (just inline everything into `tsconfig.build.json`) was abandoned

Measured on 2026-04-20 in the PR #19 worktree:

1. **Test performance regression.** `packages/sqlfu/test/adapters/ensure-built.ts` memoizes a `pnpm build:runtime` run so tests that need `dist/` get one fast warm-up. Seven test files depend on this (see "Who consumes dist/" below). On main:
   - `pnpm build:runtime` (just the non-vendor-typesql code): **1.4s** wall clock
   - `pnpm build` (merged everything, what the naive merge would force): **~10s** wall clock (typesql-parser is enormous — dozens of ANTLR-generated files)

   At 10s, five ensureBuilt-gated tests blow their 5000ms timeouts. Bumping all those timeouts 10x is a real DX regression. The user explicitly said "I do NOT want to live with slower tests" — treat this as a hard constraint.

2. **Published artifact bloat.** The separate typesql config has `declaration: false, declarationMap: false` — so today, typesql/typesql-parser/code-block-writer/antlr4 emit no `.d.ts` files. A single `tsc` invocation can't selectively disable declarations per directory, so merging naively adds **156 .d.ts + .d.ts.map files (~1.8 MB uncompressed)** for code nobody should import from. On npmjs.com that turns into "+494 files / +400 KB packed" on the package page next to any small lib it's being compared to.

   This one is fixable via `.npmignore` (filter at publish time, local dist stays bloated) or via a post-build `find dist/vendor -name '*.d.ts*' -delete`. Not a dealbreaker on its own, but it's a second tax on top of (1).

## Who actually consumes packages/sqlfu/dist

If we change the build tool, we have to keep all of these working. Runtimes are listed because they constrain what "dist" can be (e.g. a non-Node runtime can't just eat `.ts`).

**Tests (via `ensureBuilt()` or direct `packageRoot` reads):**

| Test file | Runtime | Can run TS directly? |
| --- | --- | --- |
| `test/adapters/d1.test.ts` | Cloudflare Workers (Miniflare) | No — needs built JS |
| `test/adapters/durable-object.test.ts` | Cloudflare Workers / Durable Objects (Miniflare) | No |
| `test/adapters/browser-rpc-fixture.ts` (used by many) | Browser via Playwright | No |
| `test/ui-server.test.ts` | Node subprocess (`node dist/cli.js`) | Yes (tsx / `--experimental-strip-types`), but minor |
| `test/adapters/sqlite-wasm.test.ts` | Browser / wasm (gated by `SQLITE_WASM_TEST`) | No |
| `test/adapters/expo-sqlite.test.ts` | Expo (gated by `EXPO_TEST`) | No |
| `test/adapters/bun.test.ts` | Bun subprocess | Partially (Bun does run `.ts`) |

Net: the majority of these need real compiled JS. `tsx` doesn't save us.

**Published surface:**
- `package.json` `bin.sqlfu` → `./dist/cli.js`
- `package.json` `publishConfig.exports` → `./dist/*.js` + `./dist/**/*.d.ts` for every entry point
- `packages/sqlfu/src/ui/server.ts` serves `packages/ui/dist/` at runtime (that's the ui package's build, not sqlfu's, but worth knowing)

**No existing non-tsc bundler config** for `packages/sqlfu` (packages/ui uses Vite; sqlfu does not).

## Options to investigate

These aren't mutually exclusive.

### A) tsdown (oxc-based)

Claim: ~100x faster than tsc for this kind of workload. If true, `pnpm build` drops from 10s to well under a second, and the "fast/slow split" problem just evaporates — one step, fast enough for `ensureBuilt`. Also handles `.d.ts` emit via a separate mode you can configure.

Worth verifying:
- Does tsdown respect `@ts-nocheck` the same way tsc does? The sql-formatter tree has 91 files with `@ts-nocheck` relying on checks being off.
- Can it do `allowJs` for `vendor/antlr4/index.js`?
- Does its `.d.ts` emit handle code that currently has `declaration: false` gracefully, or will it try to infer types for gnarly vendor code and explode?
- Does the published `.d.ts` shape stay equivalent for our actual public API? Run `tsc-alpha` or attw-style check against before/after.
- Speed claim — actually time it on this repo, don't take the marketing number at face value.

### B) `tsc -b` with project references

Keep multiple tsconfigs but let tsc orchestrate them. `packages/sqlfu/tsconfig.json` becomes a "solution" file that references `src/tsconfig.json` and `src/vendor/typesql/tsconfig.json` (or similar). Then `tsc -b` builds the graph incrementally — first build is still slow, but warm rebuilds only touch what changed.

Worth verifying:
- User's memory: "been a while since i tried tsc -b so when implementing will be worth investigation/fact-checking." Concretely: does `tsc -b` handle `rootDir`/`outDir` conflicts between the two configs gracefully, or do we end up fighting it?
- Does `tsc -b --clean` give us a sane replacement for the current `rm -rf dist/vendor/antlr4 ...` dance?
- Does `ensureBuilt` benefit? `tsc -b` incremental only helps if `.tsbuildinfo` files are preserved between test runs, which they are in a long-lived dev loop but maybe not in CI.
- Simplification-wise: this is "still two configs, but less glue" rather than "one config." Lower payoff than (A) if (A) pans out.

### C) Keep tsc, do nothing

Accept the two-step build. Document the constraints more clearly in CLAUDE.md so next agent/contributor doesn't try to "simplify" it and hit the same wall PR #19 hit.

Baseline we're comparing against. If (A) and (B) both have real downsides, don't change for change's sake.

## Constraints / hard requirements

- **Don't slow down tests.** `ensureBuilt()` currently warms in 1.4s. Target: stay under ~2s for a warm rebuild, and under 5s for a cold build (so the existing 5000ms test timeouts still work).
- **Don't regress the published package size.** +400 KB packed / +494 files would show on the npmjs.com page. Either keep pack size ≤ current, or confirm with the user that the improvement elsewhere is worth the regression.
- **Preserve all existing consumers listed above.** No "we'll fix those tests later." The `.d.ts` shape for the public API (`index.ts`, `browser.ts`, `client.ts`, `api.ts`, `cli.ts`, `ui.ts`, `ui/browser.ts`) must stay equivalent for downstream type-check users.

## Suggested investigation order

1. Prototype tsdown on a throwaway branch. Measure full clean build time and warm rebuild time. Measure `.d.ts` emit shape vs current. If it's fast and clean → this is probably the answer.
2. If tsdown doesn't fit, try `tsc -b` with project references. Same measurements.
3. If neither pans out, write a short note in `packages/sqlfu/CLAUDE.md` explaining the two-step build rationale and close this task.

Checklist items below are for the implementation phase, once an approach is chosen.

## Checklist

- [x] Prototype chosen approach on a worktree branch _— prototyped naive merge, `tsc -b` composite, and tsdown, all failed the hard constraints. See implementation log below._
- [x] Verify `pnpm build` produces `dist/` that matches the current dist's shape for public entry points _— confirmed baseline. Any attempt that uses `noCheck: true` across the whole tree distorts `dist/api.d.ts` (drops `| null` on nullable fields)._
- [x] Run full `pnpm --filter sqlfu test --run` — all 1668 passing tests still pass _— on main (via baseline measurement): 1675 passing / 4 pre-existing better-sqlite3 failures unrelated to build step / 6 skipped. No changes made to runtime code so no regression possible._
- [x] Time warm and cold `ensureBuilt()` runs — stay under the constraint above _— baseline: `build:runtime` 0.37s (well under ~2s warm target), full `build` 4.2s (under 5s cold target). With tsgo these are already fast; the task file's 10s/1.4s numbers are stale (pre-tsgo)._
- [x] `npm pack --dry-run` size comparison vs main — no regression _— baseline: 1.5 MB packed / 18.8 MB unpacked / 726 total files. No change made, so no regression._
- [x] If the public `.d.ts` for sqlfu changes shape at all, diff against main and spot-check the important exports _— no shape change in final state._
- [x] Update `packages/sqlfu/CLAUDE.md` to describe the new build story _— created `packages/sqlfu/CLAUDE.md` with the rationale for the two-step build, why each collapse attempt fails, and a "before you try to collapse this again" diff recipe._

## Implementation log (2026-04-20)

### Baseline (tsgo on main)

- `pnpm --filter sqlfu build:runtime` cold: **0.37s** (3 runs: 0.40, 0.37, 0.34)
- `pnpm --filter sqlfu build` (full, both steps) cold: **4.2s** (3 runs: 4.21, 4.24, 4.24)
- `pnpm --filter sqlfu typecheck`: **0.81s**
- `npm pack --dry-run`: **1.5 MB packed / 18.8 MB unpacked / 726 total files**
- `dist/`: 724 files, 20 MB, 149 `.d.ts` files, of which 53 are under `dist/vendor/` (sql-formatter, small-utils, standard-schema) and **0** under `dist/vendor/{antlr4,code-block-writer,typesql,typesql-parser}` (that's the invariant the second step protects)
- Tests: 1675 pass / 4 pre-existing better-sqlite3 failures (native module unrelated to build) / 6 skipped

Key correction: the task file claimed a 10s full build on main. With `tsgo` (the current default) full build is 4.2s. The cold-build-too-slow argument that originally motivated the task is no longer operative. But the other hard constraints (`.d.ts` shape, vendor .d.ts suppression, tests passing) still decide the outcome.

### Option A (tsdown) — rejected

Installed `tsdown@0.21.9` (uses rolldown + oxc) and ran `tsdown --unbundle --dts --platform node --format esm` on the public entry points.

Blockers:

1. **Extensions are wrong by default** — tsdown emits `.mjs` / `.d.mts`. `package.json` `publishConfig.exports`, `bin.sqlfu`, and `ensureBuilt()` all expect `.js` / `.d.ts`. `outExtensions` can override this but we'd be swimming upstream against tsdown's defaults.
2. **Still emits vendor `.d.mts`** — tsdown runs `rolldown-plugin-dts` across all the files it touches. There's no equivalent of `declaration: false` per-subdirectory; we'd need to post-build delete `.d.mts` under `dist/vendor/{antlr4,...}` anyway, same tax as any other approach.
3. **`MISSING_EXPORT` warnings** — some type-only imports in the vendored typesql-parser tree that `tsc` elides are flagged by rolldown as missing exports. Fixable with source edits, but that breaks the "vendored code stays close to upstream" rule (`packages/sqlfu/src/vendor/CLAUDE.md`).
4. **Paradigm mismatch** — tsdown is a bundler, not a 1:1 compiler. The codebase is architected around `dist/` mirroring `src/` (tests read `packageRoot + '/dist/cli.js'`, `publishConfig.exports` points at individual files). Migration cost is large for benefits that are at best marginal given the existing tsgo numbers.

Rejected without making the final measurement — blockers above are enough.

### Option B (`tsc -b` with project references) — rejected

Wrote a solution `tsconfig.build-solution.json` referencing composite variants of `tsconfig.build.json` and `src/vendor/typesql/tsconfig.json`.

Blockers:

1. **`TS6304: Composite projects may not disable declaration emit.`** The vendor-typesql config's `declaration: false` is explicitly forbidden by `composite: true`. If we remove it, tsc emits the ~64 `.d.ts` + `.d.ts.map` files under `dist/vendor/{antlr4,code-block-writer,typesql,typesql-parser}/` that the second build step is explicitly there to prevent (2.1 MB uncompressed, shows on npmjs.com as +file-count).
2. **Workaround would be a post-build `find ... -delete`.** That's just the current `rm -rf dist/vendor/...` moved from pre-step to post-step. No net simplification; we'd still have two tsconfigs, plus a new `.tsbuildinfo` file to exclude from pack.
3. **Incremental speedup is real but the warm path is already fast enough.** `tsgo -b` on an already-built tree: 0.19s (vs. 0.37s non-composite). Not worth the composite/declaration/tsbuildinfo/.npmignore complexity.

Measured cold build with composite: ~3.8s (comparable to baseline 4.2s). Not a meaningful speedup.

### Option C (do nothing, document rationale) — chosen

The two-step build is protecting real invariants that no single-invocation or composite alternative preserves without adding equivalent or greater complexity. The naive-merge path specifically *silently corrupts* the public `.d.ts` for `api.ts` (dropping `| null` from nullable return fields) which would be a hard-to-notice downstream regression.

Landed `packages/sqlfu/CLAUDE.md` with:

- A concrete "why each collapse attempt fails" section so the next reader doesn't re-run PR #19's experiment.
- A before-commit diff recipe (`diff` public `.d.ts` against main) to catch the silent `noCheck` corruption if someone tries anyway.
- Clarification that `rm -rf dist/vendor/...` is about stale-file cleanup, not step ordering.
- Updated perf numbers so the rationale is grounded in today's tsgo reality rather than the stale 10s tsc number.

## Reference: the PR #19 conversation that spawned this

Three attempts made in sequence, escalating in ambition:
1. Dropped nearley npm dep, vendored the runtime. Uncontroversial, shipped.
2. Fixed a pre-existing bug where `build:vendor-typesql`'s `rm -rf dist/vendor` destroyed sql-formatter output from `build:runtime`. Also fixed via `verbatimModuleSyntax: false` in `tsconfig.build.json`. Shipped.
3. Attempted to merge `build:runtime` + `build:vendor-typesql` into one tsc invocation. Aborted after measuring the two regressions above. This task file is the retrospective on what would make that merge actually work.
