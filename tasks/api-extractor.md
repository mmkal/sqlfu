---
status: ready
size: medium
---

# Adopt api-extractor for the public type surface

Currently `pnpm build` emits 156 `.d.ts` files totalling ~670 kB across `dist/`. Every public entry (`index`, `browser`, `client`, `api`, `cli`, `ui/index`, `ui/browser`) has its declarations spread across dozens of per-file `.d.ts` modules that cross-import each other. Two motivations for rolling these through api-extractor:

1. **Bundle size**: collapsing into one `.d.ts` per entry would drop tarball unpacked size by an estimated 100-200 kB (the per-file overhead + duplication). Each rollup also tree-shakes unused type-only symbols.
2. **API reports** (the real win): api-extractor can emit a human-reviewable summary of every exported symbol. Checked into the repo, it turns accidental breaking changes into visible diffs in PR review. In a pre-pre-pre-alpha lib where we're still willing to delete stuff aggressively, this lets us do that *deliberately* rather than by accident.

## Scope

- Install `@microsoft/api-extractor` as a devDep.
- One `api-extractor.json` config per public entry (7 of them), or one config with `entryPoints`. api-extractor traditionally wants one config per entry; the TSDoc-style `mainEntryPointFilePath` points at the relevant `dist/<entry>.d.ts`.
- Output one rolled-up `.d.ts` per entry into `dist/<entry>.bundled.d.ts` (or replace the raw ones).
- Update `publishConfig.exports` so each `types` field points at the rolled-up file.
- New `build:bundle-types` script that runs after `build:runtime`. Consider: it needs the raw `.d.ts` files as input, so it has to run *before* anything that would delete them.
- Commit an initial set of API reports (`etc/sqlfu-*.api.md`) so subsequent runs can diff against them.

## What'll hurt

- api-extractor is strict about "forgotten exports": any type referenced by a public export that isn't itself exported from the entry will get a warning (TS2550). This will surface places where sqlfu re-exports a deeply nested internal type without explicitly adding it to the public surface — good to know, but an afternoon of tagging `@internal` or re-exporting properly.
- The CLI entry (`dist/cli.js`) has no real "types" to extract — it's a script. Configure it to emit a stub or skip api-extractor for this one.
- Vendor `.d.ts` files under `dist/vendor/*` shouldn't be run through api-extractor; they're internal. Filter by path in the config.
- TSDoc comments (`@public`, `@internal`, `@alpha`, `@beta`) become load-bearing. If we use any of them incorrectly the report gets noisy.

## Non-goals

- Not trying to get api-extractor to emit for our vendored trees. They ship via the esbuild bundle with no declarations; that's fine.
- Not trying to change how consumers import from sqlfu. The `@sqlfu/*` entry points stay exactly the same — only their `.d.ts` resolution changes.

## Success criteria

- `pnpm build` produces exactly one `.d.ts` file per public entry.
- Tarball unpacked size drops measurably (target: ≥100 kB cut, i.e. 967 kB → ≤850 kB).
- `etc/*.api.md` files are committed and reviewed in PRs whenever the public API changes.
- `pnpm typecheck` still clean. All 1071 tests still pass.
- Consumers in `packages/ui/` still get full type information.

## Ordering

Can land independently of `tasks/drop-antlr.md`. Good candidate for a self-contained afternoon of work.
