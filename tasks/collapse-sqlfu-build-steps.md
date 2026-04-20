---
status: needs-investigation
size: medium
---

# Collapse packages/sqlfu's two-step build into one

## Status summary

Not started. Requires investigation before committing to an approach. Spawned from PR #19 where we discussed merging `build:runtime` + `build:vendor-typesql` → one step and hit two concrete regressions that killed the naive merge.

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

- [ ] Prototype chosen approach on a worktree branch
- [ ] Verify `pnpm build` produces `dist/` that matches the current dist's shape for public entry points (file-by-file diff of `.d.ts` at least for `dist/{index,browser,client,api,cli}.{js,d.ts}`)
- [ ] Run full `pnpm --filter sqlfu test --run` — all 1668 passing tests still pass
- [ ] Time warm and cold `ensureBuilt()` runs — stay under the constraint above
- [ ] `npm pack --dry-run` size comparison vs main — no regression
- [ ] If the public `.d.ts` for sqlfu changes shape at all, diff against main and spot-check the important exports
- [ ] Update `packages/sqlfu/CLAUDE.md` to describe the new build story

## Reference: the PR #19 conversation that spawned this

Three attempts made in sequence, escalating in ambition:
1. Dropped nearley npm dep, vendored the runtime. Uncontroversial, shipped.
2. Fixed a pre-existing bug where `build:vendor-typesql`'s `rm -rf dist/vendor` destroyed sql-formatter output from `build:runtime`. Also fixed via `verbatimModuleSyntax: false` in `tsconfig.build.json`. Shipped.
3. Attempted to merge `build:runtime` + `build:vendor-typesql` into one tsc invocation. Aborted after measuring the two regressions above. This task file is the retrospective on what would make that merge actually work.
