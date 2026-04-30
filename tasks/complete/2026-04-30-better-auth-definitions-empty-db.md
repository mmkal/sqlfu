---
status: done
size: medium
---

# Fix better-auth definitions on empty databases

## Status summary

Done. The iterate PR schema reproduced the empty-database failure in both `sqlfu draft` and `sqlfu sync`; the minimized fixture is a leading section comment before `create table` followed by a `create index`. The fix teaches the scratch schema loader to classify DDL after stripping leading SQL comments. No missing implementation pieces remain.

## Summary

iterate/iterate#1296 has an `apps/auth/src/server/db/definitions.sql` containing many better-auth tables and indexes followed by an app `project` table. The reported behavior is that this schema makes `sqlfu draft` and `sqlfu sync` unusable against an empty database.

The first implementation assumption is that the problem lives in sqlfu's SQLite schema diff / materialization path, not in iterate-specific application code. The test should exercise sqlfu through the same public surface used by `draft` or `sync` where practical. If the CLI layer is too noisy for the minimal regression, use the nearest public API that those commands call, but keep the fixture tied to the empty-database behavior.

## Reproduce

Use the PR schema verbatim first:

`https://raw.githubusercontent.com/iterate/iterate/3227e6a/apps/auth/src/server/db/definitions.sql`

After reproducing, trim distracting tables until the fixture is as small as possible. The minimized reproducer is:

```sql
-- generated schema section
create table project(id integer primary key);
create index project_id_idx on project(id);
```

## Checklist

- [x] Add a regression test with the iterate PR `definitions.sql` verbatim and confirm it fails on the current branch. _Verified via `createMigrationsFixture` scratch script; both `draft` and `sync` failed with `no such table: main.project`._
- [x] Minimize the fixture to the smallest DDL statements that still reproduce the empty database failure. _Reduced to a section comment before `create table project(...)` plus `create index project_id_idx ...`._
- [x] Commit the failing minimized test by itself after the task-spec commit. _Commit `3fda1fa` adds the red `draft` and `sync` edge-case tests._
- [x] Fix the schema diff / command implementation in the next commit after the failing test. _Commit `ccc1c1c` strips leading comments before classifying scratch schema statements for ordering._
- [x] Run the focused regression test and the relevant sqlfu test suite. _`vitest test/migrations/edge-cases.test.ts --run`, `vitest test/migrations test/schemadiff --run`, `pnpm --filter sqlfu typecheck`, and a verbatim iterate schema smoke check passed._
- [x] Move this task to `tasks/complete/` once the fix is done and pushed. _Moved to `tasks/complete/2026-04-30-better-auth-definitions-empty-db.md`._

## Implementation Notes

- Worktree branch: `fix-better-auth-definitions-empty-db`
- Source PR: iterate/iterate#1296, commit `3227e6a`.
- Root cause: `applySchemaSql` sorted scratch schema statements by simple `^create ...` regexes. A statement that began with `-- better-auth-schema END` before `CREATE TABLE project` fell into the catch-all bucket, while `CREATE INDEX project_*` stayed in the index bucket, so the indexes ran before the table.
- The drafted migration drops the leading section comment because the diff is generated from inspected schema, not by copying raw `definitions.sql`.
