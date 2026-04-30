---
status: ready
size: medium
---

# Fix better-auth definitions on empty databases

## Status summary

Not started. The task is scoped and ready: reproduce the `sqlfu draft` / `sqlfu sync` failure from iterate/iterate#1296 using that PR's `apps/auth/src/server/db/definitions.sql` verbatim, reduce it to a small DDL fixture, commit the failing regression test, then fix the implementation in the next commit. Main missing pieces are the reproducer, minimization, implementation, and verification.

## Summary

iterate/iterate#1296 has a single-line `apps/auth/src/server/db/definitions.sql` containing many better-auth tables and indexes followed by an app `project` table. The reported behavior is that this schema makes `sqlfu draft` and `sqlfu sync` unusable against an empty database.

The first implementation assumption is that the problem lives in sqlfu's SQLite schema diff / materialization path, not in iterate-specific application code. The test should exercise sqlfu through the same public surface used by `draft` or `sync` where practical. If the CLI layer is too noisy for the minimal regression, use the nearest public API that those commands call, but keep the fixture tied to the empty-database behavior.

## Reproduce

Use the PR schema verbatim first:

`https://raw.githubusercontent.com/iterate/iterate/3227e6a/apps/auth/src/server/db/definitions.sql`

After reproducing, trim distracting tables until the fixture is as small as possible. The likely target is one or two DDL statements that retain the exact parser/diff edge case.

## Checklist

- [ ] Add a regression test with the iterate PR `definitions.sql` verbatim and confirm it fails on the current branch.
- [ ] Minimize the fixture to the smallest DDL statements that still reproduce the empty database failure.
- [ ] Commit the failing minimized test by itself after the task-spec commit.
- [ ] Fix the schema diff / command implementation in the next commit after the failing test.
- [ ] Run the focused regression test and the relevant sqlfu test suite.
- [ ] Move this task to `tasks/complete/` once the fix is done and pushed.

## Implementation Notes

- Worktree branch: `fix-better-auth-definitions-empty-db`
- Source PR: iterate/iterate#1296, commit `3227e6a`.
