---
status: ready
size: medium
---

# Make `sql.analyze` work in demo mode (red underlines in the browser)

## Problem

In demo mode (`?demo=1`, as served from the `artifact.ci` preview for each PR and eventually from `demo.local.sqlfu.dev`), the SQL runner does not render the wavy-red "lint" underlines for syntax errors. Typing `selet * from posts` should produce an underline + hover message like `near "selet": syntax error`, matching the local backend behavior.

The underline itself is wired via `@codemirror/lint` in `packages/ui/src/sql-codemirror.tsx` — no UI changes are needed. The underlines are driven by `analysisQuery.data?.diagnostics` which comes from the `sql.analyze` oRPC call (`packages/ui/src/client.tsx:1199`).

The reason it does not work in demo: `packages/ui/src/demo/browser-host.ts:117` stubs `analyzeSql()` to return `{}`. The stub was introduced in the "collapse demo fork" PR (commit `9ec450f`) and explicitly called out in `tasks/complete/2026-04-18-demo.md` ("returns `{}` from `analyzeSql` (typesql/ts-morph stay out of the browser bundle)"). Bundle size is no longer a concern for this task — the demo already ships sqlite-wasm, so shipping the analysis pipeline too is fine.

The Playwright tests at `packages/ui/test/studio.spec.ts:950` (`sql runner shows inline analysis diagnostics before execution`) and `:959` (`saved query edit mode shows inline analysis diagnostics before saving`) pass against the real backend harness. They do not cover demo mode, which is why the regression slipped.

## Goal

In demo mode, typing SQL that fails to parse (syntax error) or that references unknown columns should produce the same `SqlEditorDiagnostic[]` the node backend produces, so the CodeMirror linter shows the red wavy underline + hover message in the SQL runner and the saved-query editor.

## Scope

### In

- Make the vendored TypeSQL sqlite query analyzer usable against an already-open sqlite client (currently hardcodes `import('node:sqlite')` / `bun:sqlite` at `packages/sqlfu/src/vendor/typesql/sqlite-query-analyzer/query-executor.ts:26-35`).
- Extract the "run typesql against a db client + describe + refine" core of `analyzeAdHocSqlForConfig` so it can be called with a non-node DB.
- Implement `analyzeSql` on the browser `SqlfuHost` (`packages/ui/src/demo/browser-host.ts:117`) so it runs the real pipeline against the wasm DB.
- Add a Playwright test that loads `/?demo=1` and asserts `.cm-lintRange-error` appears after typing `selet * from posts` (parallels the existing studio tests).

### Out

- TypeSQL-style type inference for saved queries in demo mode (still regex-based; that is explicitly out of scope per the phase-3 notes in `2026-04-18-demo.md`).
- Any restructuring of the node path beyond what is needed to extract the shared core — don't refactor `materializeTypegenDatabase` / file-based paths for the node CLI.
- Bundle-size optimization (accept whatever the analyzer adds).

## Approach (draft — revise during implementation if needed)

1. **Make the vendored analyzer DB-injectable.** In `packages/sqlfu/src/vendor/typesql/sqlite-query-analyzer/query-executor.ts`, allow callers to pass an already-constructed `DatabaseType`-shaped object instead of a URI. Keep the existing URI path for the node typegen pipeline (minimal change to vendored code per `src/vendor/CLAUDE.md`).
2. **Expose a db-client-level entrypoint in `vendor/typesql/sqlfu.ts`.** New function (something like `analyzeSqliteQueriesWithClient(db, queries)`) that calls `loadSchemaInfo` + `validateAndDescribeQuery` against the passed client.
3. **Extract the ad-hoc describe+refine core.** Pull the part of `analyzeAdHocSqlForConfig` that runs after we have a DB client into a reusable function (e.g. `analyzeAdHocSqlWithDbClient(dbClient, schemaSql, sql)`), so both `node-host.ts` and `browser-host.ts` can call it.
4. **Wire the browser host.** `browser-host.ts`'s `analyzeSql` opens a fresh scratch wasm DB, applies the current desired definitions (from the vfs), runs the shared core, and returns `{diagnostics}` / `{paramsSchema, diagnostics: []}` mirroring `node-host.ts:144`.
5. **Match error-to-range mapping.** Reuse `toSqlEditorDiagnostic` (currently private in `node-host.ts`) — move it to a shared module so browser and node produce identical diagnostics.
6. **Playwright coverage.** Add a spec under `packages/ui/test/` (e.g. `demo-sql-analyze.spec.ts`) that navigates to `/?demo=1#sql`, replaces the editor contents with `selet * from posts`, and polls for `.cm-lintRange-error` count > 0. Small enough to sit alongside `local-sqlfu-dev.spec.ts`.

## Acceptance

- [ ] Typing `selet * from posts` in the SQL runner at `?demo=1#sql` shows the red wavy underline and a `near "selet": syntax error` message on hover.
- [ ] Typing `select nosuchcol from posts` (referencing an unknown column on a known table) produces an underline at the `nosuchcol` token.
- [ ] Valid SQL produces zero diagnostics (no false positives).
- [ ] New Playwright spec for demo-mode diagnostics passes.
- [ ] Existing `studio.spec.ts` diagnostic tests still pass.
- [ ] `pnpm --filter sqlfu typecheck` and `pnpm --filter sqlfu build` still pass; vendored typesql still resyncable (any local edits appended to the "Local changes that are expected" list in `packages/sqlfu/src/vendor/typesql/CLAUDE.md`).

## Out-of-band notes

- Originally observed on PR #17 artifact preview. User suspected dark-mode regression; it is not — demo mode has always had this stubbed since 9ec450f.
- The artifact.ci preview URLs use `?demo=1` so this fix makes the PR preview UX much more representative.
