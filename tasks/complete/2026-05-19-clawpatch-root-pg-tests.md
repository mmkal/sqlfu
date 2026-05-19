---
status: ready
size: small
clawpatch_finding: fnd_sig-feat-config-7528cb5b98-913b2_958e290ecc
---

# Include pg tests in the root test gate

Status summary: Done. The root test gate now includes `@sqlfu/pg`, a focused
workspace-script regression check guards that coverage, and Clawpatch
revalidation marked the finding fixed.

## Assumptions

- `pnpm test` is the root quality gate and should cover every package that the
  root `build` script treats as part of the release.
- The PostgreSQL package tests still require a reachable Postgres server. This
  task should make that explicit rather than hiding or weakening the tests.
- This branch uses the shared clawpatch state directory from the main checkout:
  `/Users/mmkal/src/sqlfu/.clawpatch`.

## Checklist

- [x] Add a readable regression check for root package-script coverage. _Added `scripts/workspace-package-scripts.test.mjs`, which fails when a built package with a test script is missing from the expanded root `test` gate._
- [x] Update the root test scripts so `@sqlfu/pg` is not skipped. _Split the root test gate into `test:workspace-scripts`, `test:sqlfu`, `test:pg`, and `test:ui`, with `test` calling all four._
- [x] Validate the focused script check and relevant package test commands. _Ran `node --test scripts/workspace-package-scripts.test.mjs`, `pnpm test:workspace-scripts`, and `pnpm test:pg` with the pg docker compose service._
- [x] Revalidate the clawpatch finding with the shared state directory. _`clawpatch --state-dir /Users/mmkal/src/sqlfu/.clawpatch revalidate --finding fnd_sig-feat-config-7528cb5b98-913b2_958e290ecc` returned `outcome: fixed`._

## Implementation Notes

- Source finding: `Root test script omits the @sqlfu/pg package tests`.
- Red check: `node --test scripts/workspace-package-scripts.test.mjs` initially
  failed with `@sqlfu/pg` missing from the root test gate.
- Green checks:
  - `node --test scripts/workspace-package-scripts.test.mjs`
  - `pnpm test:workspace-scripts`
  - `docker compose -f packages/pg/test/docker-compose.yml up -d --wait`
  - `pnpm test:pg`
  - `docker compose -f packages/pg/test/docker-compose.yml down`
- Clawpatch revalidation outcome: `fixed`.
