---
status: in-progress
size: medium
branch: bedtime/2026-05-27-parser-facade
base: main
---

# SQLite Parser Facade

## Status Summary

- Close to done: spec only.
- Main completed pieces: scope chosen for the dealer's-choice implementation.
- Main missing pieces: implementation, tests, PR body, CI.

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

- [ ] Add the common parser facade module.
- [ ] Replace at least two parser-like regex/string-scanning call sites with the facade.
- [ ] Add or update focused tests for quoted identifiers, comments, casts, and multi-statement SQL.
- [ ] Run targeted tests.
- [ ] Update this task with implementation notes.
- [ ] Push the branch and keep the PR body oriented toward reviewer-visible effects.

## Implementation Notes

- 2026-05-27: Task split from bedtime architecture request. This branch is the main-based dealer's-choice implementation.
