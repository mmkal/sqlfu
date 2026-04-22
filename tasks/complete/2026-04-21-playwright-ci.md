---
status: done
size: medium
---

# Run Playwright tests in GitHub Actions

## Summary

The repo has a mature Playwright suite at `packages/ui/test/*.spec.ts` that runs locally (`pnpm --filter @sqlfu/ui test`) but nothing in `.github/workflows/` exercised it. This task adds a CI workflow that runs the full UI e2e suite on every PR and push to `main`, and made the product/test-side changes needed to get it green on Ubuntu runners.

## High-level status

Done, pending review. PR: https://github.com/mmkal/sqlfu/pull/37. CI green (8m19s for the full 51-test suite on a single runner).

## Checklist

- [x] Add `.github/workflows/playwright.yml` that installs pnpm deps, installs Playwright browsers (with system deps), and runs `pnpm --filter @sqlfu/ui test` _implemented in .github/workflows/playwright.yml. No explicit build step — sqlfu/ui is consumed via source-first workspace exports._
- [x] Upload `playwright-report/` and `test-results/` as artifacts on failure _report always uploaded (artifact.ci picks it up for preview); test-results only on failure._
- [x] Handle the `column-width.spec.ts` platform-specific snapshot _set `snapshotPathTemplate` to drop the `{platform}` suffix and renamed `column-widths-darwin.txt` → `column-widths.txt`._
- [x] Verify demo specs and studio specs pass on Linux _final run: 50 passed / 1 skipped (ngrok)._
- [x] Leave the ngrok spec (`local-sqlfu-dev.spec.ts`) skipped in CI _already gated on `SQLFU_TEST_NGROK`; shows up as "1 skipped" in the CI output._
- [x] Open PR, iterate on failures

## Notes

- Node version: bumped to 22 (not 20 as `preview.yml` uses). `packages/sqlfu/src/core/node-host.ts` imports `node:sqlite` unconditionally, which only exists in Node 22+. Node 20 crashes the webServer with `ERR_UNKNOWN_BUILTIN_MODULE` before Playwright can begin.
- The ngrok spec stays skipped; adding ngrok to CI is a separate piece of work.
- Kept the suite single-shard for now (8m19s). Shard if this starts blocking developer flow.

## Implementation log

1. **Node 22 bump** — Node 20 in CI fails the webServer startup on `import('node:sqlite')`. Bumped to 22.
2. **Platform-neutral snapshot** — `column-width.spec.ts` snapshots pure algorithm output. Dropped the `{platform}` suffix via `snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}'` and renamed the snapshot file. One file covers mac + linux.
3. **Project-init race fix** — `startSqlfuServer`'s first-request init (template copy + seed insert) was not atomic. Concurrent `page.goto('/')` calls in the two-worker Playwright setup could see a half-populated project. Wrapped the init pair in a per-project promise cache. (`packages/sqlfu/src/ui/server.ts`)
4. **Warmup globalSetup** — Added `test/global-setup.ts` that pings `/` + a couple of RPCs once after webServer is ready. Keeps the first test's latency predictable (Vite compile, typegen, seed all happen here, not in test #1).
5. **Editor keymap** — `packages/ui/src/sql-codemirror.tsx` used `key: 'Cmd-Enter'` with a `win: 'Ctrl-Enter'` alternative. In CodeMirror's convention, `Cmd-` is Mac-only and `win:` is Windows-only, so Linux users had no binding at all. The "sql runner executes from the editor with cmd-or-ctrl-enter" test caught this. Replaced with the cross-platform `Mod-Enter`.
6. **Test #20 bug fix** — Since bd396be the root `/` route lands on the schema view, not the first relation. `studio.spec.ts`'s table-browser test was still asserting the posts heading at `/`; failed both locally and in CI. Click the `posts` link explicitly — closer to what the test's name implies.
