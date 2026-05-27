---
status: complete
size: medium
branch: bedtime/2026-05-27-parser-facade
base: main
---

# SQLite Parser Facade

## Status Summary

- Done: internal facade, caller migrations, focused tests, package typecheck, and formatter check are complete.
- Main completed pieces: token-backed keyword helpers and CREATE header spans now drive runtime sync, schemadiff SQL application/virtual-table detection, and row-return classification.
- Main missing pieces: named-parameter scanning still uses its existing scanner.

## Goal

Replace a meaningful set of ad hoc SQLite regex/string-scanning call sites with a small sqlfu-owned parser facade backed by the existing vendored SQLite tokenizer/parser.

## Assumptions

- The first pass should reduce local complexity without forcing a new public API.
- Existing parser code in `packages/sqlfu/src/vendor/sqlfu-sqlite-parser/` is the preferred dependency for this branch.
- The facade should expose sqlfu-shaped facts and helpers, not raw third-party or vendored ASTs at every caller.
- It is acceptable to leave non-SQLite, filesystem, URL, and presentation regexes alone.

## Suggested Scope

- Create a common internal SQLite parsing module near `packages/sqlfu/src/sqlite-*.ts`.
- Move statement classification and leading-comment handling out of `api/sync.ts` / `schemadiff/sqlite/index.ts`.
- Move named-parameter/reference scanning in `typegen/query-parameters.ts` onto the tokenizer instead of manual quote/comment loops.
- Prefer focused tests that show previously fragile SQL shapes rather than snapshot churn.

## Checklist

- [x] Add the common parser facade module. _Implemented `packages/sqlfu/src/sqlite-parser.ts` with first-keyword, keyword-presence, CREATE statement classification, and CREATE identifier-span helpers._
- [x] Replace at least two parser-like regex/string-scanning call sites with the facade. _Runtime sync and schemadiff now use token-backed CREATE classification; runtime sync rewrites CREATE names from token spans; `sqlReturnsRows` uses facade keyword helpers instead of local regexes._
- [x] Add or update focused tests for quoted identifiers, comments, casts, and multi-statement SQL. _Added `sqlite-parser`, `sqlite-text`, `api-sync`, and schemadiff plumbing coverage for comments, strings, quoted identifiers, PostgreSQL-style casts, and index-before-table ordering._
- [x] Run targeted tests. _Passed `pnpm --filter sqlfu exec vitest run test/sqlite-parser.test.ts test/sqlite-text.test.ts test/api-sync.test.ts test/schemadiff/plumbing.test.ts`, `pnpm --filter sqlfu typecheck`, and targeted `oxfmt --check`._
- [x] Update this task with implementation notes. _Moved to `tasks/complete/2026-05-27-sqlite-parser-facade.md` with completion breadcrumbs._
- [x] Push the branch and keep the PR body oriented toward reviewer-visible effects. _Handled by pushing `bedtime/2026-05-27-parser-facade` and updating the PR body with reviewer-visible scope and test notes._

## Implementation Notes

- 2026-05-27: Task split from bedtime architecture request. This branch is the main-based dealer's-choice implementation.
- 2026-05-27: Chose not to move named-parameter scanning in this pass. The first branch value was higher in centralizing CREATE/keyword classification, and the existing query-parameter scanner already has cast/comment/string coverage.
- 2026-05-27: The facade catches tokenizer failures only for tolerant keyword/classification helpers so existing row-return behavior for PostgreSQL-ish ad hoc SQL such as `select value::json` does not regress.
- 2026-05-27: Parent review found the old runtime-sync rewrite regexes still failed for comments between CREATE keywords. The facade now returns object-name and `on`-table spans from the tokenizer, and runtime sync uses those spans instead of regex groups for prefixing/qualifying CREATE statements.
- 2026-05-27: Review found two facade regressions before merge: bare identifiers with `$` could be partially rewritten, and PostgreSQL `show`/`fetch` row-return classification was lost because those words are not SQLite keywords. Fixed by allowing `$` as an identifier continuation in the tokenizer and letting `firstSqliteKeyword` fall back to the first word when tokenization succeeds but the first token is an identifier.
