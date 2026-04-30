---
status: done
size: medium
branch: try/process-result-sync-async
---

# Split Observability Hooks By Client Syncness

## Status Summary

Done. The experiment works: sync and async hook authoring are split, built-in hooks still work as one-liners for either client kind, and the observability docs/tests no longer use `processResult`. Focused tests and typecheck pass; the only remaining verification caveat is that repo-wide `pnpm format:check` still fails on pre-existing formatting drift outside this diff.

## Assumptions

- The docs concern is real: `processResult` makes the PostHog and DogStatsD recipes look more complicated than the sync `node:sqlite` examples need to be.
- `instrumentClient` already knows whether a client is sync or async via `client.sync`, so the wrapper should be able to choose a sync or async hook path without asking custom hook authors to write a promise-shape helper.
- Built-in helpers like `instrument.otel()` and `instrument.onError()` should remain one-liners that work for either client kind.
- It is acceptable for public custom hook types to have explicit sync and async variants, even if that means generic "works for both" hooks use a small adapter type.

## Checklist

- [x] Add readable sync and async query hook types that do not expose `processResult`. *Added `SyncQueryExecutionHook`, `AsyncQueryExecutionHook`, and their args/input types in `packages/sqlfu/src/instrument.ts`.*
- [x] Update instrumentation internals to select the sync or async hook path from `client.sync`. *`instrument` now composes sync or async hook chains after checking `client.sync`.*
- [x] Keep `instrument.otel({tracer})` and `instrument.onError(report)` usable with both sync and async clients. *Both helpers now return paired `QueryExecutionHook` objects with `sync` and `async` implementations.*
- [x] Rewrite docs and observability recipe tests to remove `processResult` from sync examples. *Updated `packages/sqlfu/docs/observability.md` plus PostHog/DogStatsD/Sentry recipe tests; `rg` finds no `processResult` references in `src`, `test`, or `docs`.*
- [x] Run focused observability tests and typecheck. *Passed `pnpm --filter sqlfu typecheck` and focused `vitest run` for `test/instrument.test.ts` plus all observability tests.*
- [x] If the experiment works, move this task to `tasks/complete/` with a date prefix before final handoff. *Moved to `tasks/complete/2026-04-30-process-result-sync-async.md` in the implementation commit.*

## Implementation Notes

- 2026-04-30: Current API has a single generic `QueryExecutionHook` that receives `{context, execute, processResult}`. The proposed shape is to split sync and async hook args so sync recipes can use ordinary `try/catch`, while built-in helpers can provide both variants behind a single value.
- 2026-04-30: Implemented the split. `QueryExecutionHook` is now the dual hook object for helpers, while inline hooks are accepted as `SyncQueryExecutionHookInput` or `AsyncQueryExecutionHookInput` based on the concrete client type.
- 2026-04-30: Added `packages/sqlfu/test/instrument.test.ts` to cover an async libsql client using an ordinary `async` hook and promise rejection handling.
- 2026-04-30: Verification: focused `vitest run` passed for the new instrument test and all observability tests; `pnpm --filter sqlfu typecheck` passed. Touched-file `oxfmt --check` passed. Repo-wide `pnpm format:check` still reports many pre-existing files.
