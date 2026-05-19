---
status: ready
size: small
clawpatch_finding: fnd_sig-feat-release-51170e0f9c-5084_7f56aedbab
base_pr: 134
---

# Revalidate pg build-test coverage

Status summary: Not implemented yet. This final stacked task handles the
remaining Clawpatch finding that the root build gate includes `@sqlfu/pg` while
the root test gate skips its tests.

## Assumptions

- PR 133 probably fixed the underlying source issue by adding `test:pg` to the
  root `test` gate and adding a workspace-script regression check.
- This branch should use Clawpatch revalidation to confirm whether the finding
  is now fixed before adding more source changes.
- If revalidation still reports the finding open, this branch should make the
  smallest additional change needed on top of PRs 133 and 134.
- This branch uses the shared clawpatch state directory from the main checkout:
  `/Users/mmkal/src/sqlfu/.clawpatch`.

## Checklist

- [ ] Revalidate the build/test coverage finding against the stacked branch.
- [ ] Add source changes only if revalidation shows the finding is still open.
- [ ] Validate any additional source changes if needed.
- [ ] Move this task to `tasks/complete/` when the finding is resolved.

## Implementation Notes

- Source finding: `Root test command skips the PostgreSQL package tests tied to this release feature`.
