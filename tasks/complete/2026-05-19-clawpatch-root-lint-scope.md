---
status: ready
size: small
clawpatch_finding: fnd_sig-feat-release-4862937c51-b1e9_003fc4b337
base_pr: 133
---

# Make the root lint script pass

Status summary: Done. `pnpm lint` passes after narrowing lint ignores for
vendored/fixture surfaces and fixing small maintained-source lint/typecheck
issues, and Clawpatch revalidation marked the finding fixed.

## Assumptions

- `pnpm lint` should be a usable root quality gate.
- The fix should prefer making lint scope match the maintained source surface
  over chasing intentionally vendored, generated, scratch, or fixture output.
- Real source violations found inside the maintained surface should be fixed
  directly when the fix is small.
- This branch uses the shared clawpatch state directory from the main checkout:
  `/Users/mmkal/src/sqlfu/.clawpatch`.

## Checklist

- [x] Reproduce the current root lint failure on this stacked branch. _`pnpm lint` failed with pg vendored rule-disable errors, maintained-source `readonly` violations, stale UI `eslint-disable` comments, and fixture/demo SQL freshness/format findings._
- [x] Decide which failures are maintained source issues versus scope/ignore issues. _Ignored pg vendor and copied/demo SQL fixture paths; fixed maintained TypeScript violations directly._
- [x] Update lint config or source files so `pnpm lint` passes. _Updated `eslint.config.js`, removed `readonly` from maintained source types, dropped stale disable comments, and added missing `generate.casing` to a pg typegen test fixture._
- [x] Validate `pnpm lint` and any focused checks exposed by the fix. _`pnpm lint`, `pnpm typecheck`, and focused `oxfmt --check` on touched files pass._
- [x] Revalidate the clawpatch finding with the shared state directory. _`clawpatch --state-dir /Users/mmkal/src/sqlfu/.clawpatch revalidate --finding fnd_sig-feat-release-4862937c51-b1e9_003fc4b337` returned `outcome: fixed`._

## Implementation Notes

- Source finding: `Root lint script fails on the current workspace`.
- Red check: `pnpm lint` failed with 41 errors and 18 warnings before the fix.
- Green checks:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm exec oxfmt --check eslint.config.js packages/pg/src/impl/scratch-database.ts packages/pg/src/impl/typegen.ts packages/pg/test/typegen.test.ts packages/sqlfu/src/dialect.ts packages/ui/src/client.tsx tasks/clawpatch-root-lint-scope.md`
- While validating, `pnpm typecheck` exposed a small stale pg test fixture
  missing `generate.casing`; this branch includes that fix because it blocked
  the quality gate and was a one-line config correction.
- Clawpatch revalidation outcome: `fixed`.
