---
status: ready
size: small
clawpatch_finding: fnd_sig-feat-config-7528cb5b98-913b2_958e290ecc
---

# Include pg tests in the root test gate

Status summary: Done. The root test gate now delegates to serialized `pnpm
--recursive test`, so workspace package test scripts are picked up directly,
including `@sqlfu/pg` and `sqlfu-website`. The website package test now builds
the UI and website artifact before running artifact assertions. Clawpatch
revalidation marked the original pg coverage finding fixed before review
simplified the implementation.

## Assumptions

- `pnpm test` is the root quality gate and should cover every package that the
  root `build` script treats as part of the release.
- The PostgreSQL package tests still require a reachable Postgres server. This
  task should make that explicit rather than hiding or weakening the tests.
- This branch uses the shared clawpatch state directory from the main checkout:
  `/Users/mmkal/src/sqlfu/.clawpatch`.

## Checklist

- [x] ~~Add a readable regression check for root package-script coverage.~~ _Removed after review; `pnpm --recursive test` is the simpler guard because it discovers workspace package tests directly._
- [x] Update the root test scripts so `@sqlfu/pg` is not skipped. _Changed the root `test` script to serialized recursive workspace test execution, which includes workspace packages with package-level test scripts._
- [x] Validate the focused script check and relevant package test commands. _Earlier validation covered the pg package test with the pg docker compose service; review follow-up validation uses the single root `pnpm test` command._
- [x] Revalidate the clawpatch finding with the shared state directory. _`clawpatch --state-dir /Users/mmkal/src/sqlfu/.clawpatch revalidate --finding fnd_sig-feat-config-7528cb5b98-913b2_958e290ecc` returned `outcome: fixed`._

## Implementation Notes

- Source finding: `Root test script omits the @sqlfu/pg package tests`.
- Red check: the original Clawpatch finding showed root `pnpm test` omitted
  `@sqlfu/pg`; the first branch version added a custom guard test, but review
  correctly simplified that to workspace-recursive test discovery.
- Green checks:
  - `docker compose -f packages/pg/test/docker-compose.yml up -d --wait`
  - `pnpm --filter @sqlfu/pg exec vitest --run`
  - `docker compose -f packages/pg/test/docker-compose.yml down`
- Review follow-up:
  - Replaced the split `test:*` scripts and custom guard with `pnpm
    --recursive --workspace-concurrency=1 test`. The explicit concurrency
    keeps the pg package tests and UI pg-studio tests from racing on the shared
    local Postgres fixture.
  - Removed `scripts/workspace-package-scripts.test.mjs`; Bugbot's website
    traversal finding is resolved by deleting the custom traversal entirely.
  - Made `sqlfu-website`'s package-level `test` self-sufficient by building
    the UI and website before running the existing `dist` assertions, since the
    recursive root test now invokes website tests directly.
  - Made `ensureFixtureRoles` atomic under concurrent pg test-file imports by
    creating the shared role directly and ignoring duplicate-role races.
  - Validation after review:
    - `pnpm exec oxfmt --check package.json website/package.json
      packages/pg/test/pg-fixture.ts
      tasks/complete/2026-05-19-clawpatch-root-pg-tests.md`
    - `CI=1 pnpm --filter @sqlfu/pg test`
    - `CI=1 pnpm test` now picks up website and pg package tests, but still
      fails later in `sqlfu` on the existing strict import-surface
      `node:sqlite` violation and the Miniflare D1 path timeout.
    - `pnpm typecheck` still fails on the pg fixture `generate.casing` gap
      fixed by the stacked root-lint PR.
- Clawpatch revalidation outcome: `fixed`.
