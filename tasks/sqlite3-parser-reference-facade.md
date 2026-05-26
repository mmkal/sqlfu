---
status: in-progress
size: medium
branch: bedtime/2026-05-27-pr111-parser-facade
base: issue-110-sqlite3-parser-schemadiff
stacked_on_pr: 111
---

# SQLite3 Parser Reference Facade

## Status Summary

- Done for this slice: partial-index `where` references now go through the parser facade instead of `plan.ts` token scanning.
- Main completed pieces: facade helper in `references.ts`, planner callsite swap, and drop-column fixtures for `lower(...)`, `collate nocase`, and real `where y > 0` references.
- Main missing pieces: broader CI beyond the targeted `sqlfu` fixture suite/typecheck.

## Goal

Build on draft PR #111 by tightening the `sqlite3-parser` integration into a small sqlfu-owned parser/reference facade, so schemadiff consumes reference facts instead of parser-library AST details.

## Assumptions

- This branch is stacked on `issue-110-sqlite3-parser-schemadiff`, not `main`.
- The draft PR already introduces `sqlite3-parser` and parser-backed schemadiff reference extraction.
- The implementation should reduce complexity in the draft PR, not duplicate the main-based facade branch.
- The branch should make it easier to compare parser strategies by preserving PR #111's behavioral intent while improving locality.

## Suggested Scope

- Keep all `sqlite3-parser` imports behind one internal module.
- Split parser-library traversal from schemadiff dependency planning with sqlfu-owned facts.
- Add fallback boundaries for unsupported parser cases, so callers do not need to know parser failure modes.
- Add targeted tests or fixtures for the reference facts if the draft PR currently only tests planner output.

## Checklist

- [x] Add or refine the sqlfu-owned reference/parser facade around `sqlite3-parser`. _Added `indexWhereReferenceFacts` and `indexWhereReferencesDroppedColumns` in `packages/sqlfu/src/schemadiff/sqlite/references.ts`._
- [x] Ensure schemadiff analysis consumes facade facts, not raw parser AST shapes. _Replaced the remaining `plan.ts` partial-index `sqlMentionsIdentifier(index.where, ...)` token scan with the facade helper._
- [x] Add focused tests for partial-index `where` reference extraction. _Extended `packages/sqlfu/test/schemadiff/fixtures/drop-column.sql` with false positives for `lower(x)`/`collate nocase` and a true positive for `where y > 0`._
- [x] Run targeted tests. _Ran `pnpm --filter sqlfu exec vitest run test/schemadiff/fixtures.test.ts`, `pnpm --filter sqlfu typecheck`, and targeted `oxfmt --check`._
- [x] Update this task with implementation notes. _Recorded the implementation and verification notes below._
- [ ] Push the branch and keep the PR body clear that it is stacked on PR #111.

## Implementation Notes

- 2026-05-27: Task split from bedtime architecture request. This branch is the PR #111-based implementation.
- 2026-05-27: Extended the parser-backed reference facade to parse `CreateIndexStmt.whereClause` and return sqlfu-owned referenced-column facts. The fallback path still uses sqlfu tokenization when the parser cannot recognize the index SQL.
- 2026-05-27: `plan.ts` no longer imports `sqlMentionsIdentifier`; direct drop-column eligibility asks the facade whether any partial-index `where` expression references removed columns.
- 2026-05-27: Added fixtures for dropping columns named `lower` and `nocase` without treating function/collation names as column references, plus a rebuild case for a real dropped-column reference in `where y > 0`.
