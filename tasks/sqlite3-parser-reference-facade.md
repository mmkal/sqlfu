---
status: in-progress
size: medium
branch: bedtime/2026-05-27-pr111-parser-facade
base: issue-110-sqlite3-parser-schemadiff
stacked_on_pr: 111
---

# SQLite3 Parser Reference Facade

## Status Summary

- Close to done: spec only.
- Main completed pieces: scope chosen for the implementation stacked on parser PR #111.
- Main missing pieces: implementation, tests, PR body, CI.

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

- [ ] Add or refine the sqlfu-owned reference/parser facade around `sqlite3-parser`.
- [ ] Ensure schemadiff analysis consumes facade facts, not raw parser AST shapes.
- [ ] Add focused tests for view, trigger, and `check(...)` reference extraction.
- [ ] Run targeted tests.
- [ ] Update this task with implementation notes.
- [ ] Push the branch and keep the PR body clear that it is stacked on PR #111.

## Implementation Notes

- 2026-05-27: Task split from bedtime architecture request. This branch is the PR #111-based implementation.
