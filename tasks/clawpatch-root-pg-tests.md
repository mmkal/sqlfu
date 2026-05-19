---
status: ready
size: small
clawpatch_finding: fnd_sig-feat-config-7528cb5b98-913b2_958e290ecc
---

# Include pg tests in the root test gate

Status summary: Not implemented yet. The task is scoped to making the root test
entrypoint account for `@sqlfu/pg` and adding a small guard so future package
script edits do not silently drop package test suites.

## Assumptions

- `pnpm test` is the root quality gate and should cover every package that the
  root `build` script treats as part of the release.
- The PostgreSQL package tests still require a reachable Postgres server. This
  task should make that explicit rather than hiding or weakening the tests.
- This branch uses the shared clawpatch state directory from the main checkout:
  `/Users/mmkal/src/sqlfu/.clawpatch`.

## Checklist

- [ ] Add a readable regression check for root package-script coverage.
- [ ] Update the root test scripts so `@sqlfu/pg` is not skipped.
- [ ] Validate the focused script check and relevant package test commands.
- [ ] Revalidate the clawpatch finding with the shared state directory.

## Implementation Notes

- Source finding: `Root test script omits the @sqlfu/pg package tests`.
