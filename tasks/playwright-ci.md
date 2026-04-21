---
status: ready
size: medium
---

# Run Playwright tests in GitHub Actions

## Summary

The repo has a mature Playwright suite at `packages/ui/test/*.spec.ts` that runs locally (`pnpm --filter @sqlfu/ui test`) but nothing in `.github/workflows/` exercises it. This task adds a CI workflow that runs the full UI e2e suite on every PR and push to `main`, and makes whatever product/test-side changes are needed to get it green on Ubuntu runners.

## High-level status

WIP. Fleshed spec committed; implementation in progress.

## Checklist

- [ ] Add `.github/workflows/playwright.yml` that installs pnpm deps, installs Playwright browsers (with system deps), builds `sqlfu` + `@sqlfu/ui`, and runs `pnpm --filter @sqlfu/ui test`
- [ ] Upload `playwright-report/` and `test-results/` as artifacts on failure
- [ ] Handle the `column-width.spec.ts` platform-specific snapshot. Today it produces `column-widths-darwin.txt`; CI is Linux. Prefer pinning snapshot path via `snapshotPathTemplate` so the snapshot is platform-independent (the algorithm is pure, no browser rendering, so it shouldn't differ across OS)
- [ ] Verify demo specs and studio specs pass on Linux
- [ ] Leave the ngrok spec (`local-sqlfu-dev.spec.ts`) skipped in CI — it already guards on `SQLFU_TEST_NGROK`
- [ ] Open PR, iterate on failures

## Notes

- `playwright.config.ts` already starts the webServer via `pnpm exec tsx test/start-server.ts --dev --port 3218` and uses `reuseExistingServer: false`, so CI doesn't need to start anything itself.
- Tests depend on `sqlfu` being built? `packages/ui` imports `sqlfu/ui` which is a workspace source-first export per `packages/ui/CLAUDE.md`, so no prebuild should be required for the Playwright server. But the demo mode relies on `@sqlite.org/sqlite-wasm` at runtime — that's in `packages/ui` deps already, should be fine in CI.
- Keep the job single-shard initially; shard later if runtime is a pain.
- Node version: match `preview.yml` (node 20) for consistency.

## Implementation log

(to be filled in during work)
