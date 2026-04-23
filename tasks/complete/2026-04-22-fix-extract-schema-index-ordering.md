---
status: done
size: small
---

# Fix `extractSchema` replays indexes before tables

## Status summary

Fix shipped. One-line change in `extractSchema` (`packages/sqlfu/src/core/sqlite.ts`) replaces `order by type, name` with a `case` expression that orders `table → view → index → trigger`. A new test in `packages/sqlfu/test/core-sqlite.test.ts` asserts the extracted SQL replays cleanly against an empty database (covers the original iterate/iterate#1278 failure mode). One inline snapshot in `migrations.test.ts` was updated to reflect the new correct ordering. Pre-existing formatter test failures on `origin/main` are unrelated to this change.

## Summary

`extractSchema` (`packages/sqlfu/src/core/sqlite.ts`) reads rows from `sqlite_schema` with `order by type, name`. In SQLite's `sqlite_schema`, `type` is one of `'table' | 'view' | 'index' | 'trigger'`. Alphabetically `'index'` sorts before `'table'`, so the concatenated SQL string puts `create index` statements ahead of the `create table` they reference. Anyone using that string to rebuild the schema on an empty database — e.g. seeding a scratch DB for typegen — hits `no such table: …` on the first index.

Found while integrating sqlfu into iterate/iterate#1278. That PR worked around it with a two-step `sqlfu-seed.mjs` script (seed from migrations, generate, reseed from extracted schema). Once this is fixed, the consumer's workaround collapses back to a single `sqlfu generate`.

## Reproduce (red test first)

Add a test in `packages/sqlfu/test/core-sqlite.test.ts` that:

1. Opens a sync sqlite client (see existing adapter test helpers; `better-sqlite3` fixture is fine).
2. Executes `create table t(id int primary key); create index t_idx on t(id);` — the index name `t_idx` sorts before the table name `t` won't trigger the bug on its own (both under 'table' vs 'index'); the bug is driven by the *type* comparison, so any index + table pair reproduces.
3. Calls `extractSchema(client)`.
4. Asserts the returned string starts with `create table` (or more precisely: the `create table` statement appears before the `create index` statement).

The current implementation will produce `create index ...; create table ...;` and the assertion should fail.

A stronger assertion — the one that would actually catch the downstream bug — is to feed the extracted SQL back into a fresh empty database and expect it to execute cleanly. Either assertion is fine; the second is closer to the real-world failure mode.

## Fix

In `extractSchema`, replace:

```sql
order by type, name
```

with:

```sql
order by
  case type
    when 'table' then 0
    when 'view' then 1
    when 'index' then 2
    when 'trigger' then 3
  end,
  name
```

Rationale for this ordering (stricter than the iterate PR's suggested `case when type in ('table','view') then 0 else 1 end`):

- Tables must come first — everything else can reference them.
- Views come second — views can reference tables. (Views-referencing-views isn't handled here; if it ever matters we'd need a topological sort, but it's never bitten us.)
- Indexes come third — they reference tables only.
- Triggers last — they can reference tables and views.

## Scope

- Only `extractSchema` needs changing. `inspectSchemaFingerprint` filters to `type in ('table','view')` so the identical `order by type, name` in that query is harmless — leave it alone.
- No public-API change. The return type of `extractSchema` stays `Promise<string>`; only the ordering of statements within the string changes.

## Checklist

- [x] Add red test in `packages/sqlfu/test/core-sqlite.test.ts` _replays extracted SQL against a fresh db; covers table+index+view+trigger_
- [x] Verify it fails on main _`SqliteError: no such table: main.t`_
- [x] Update `order by` in `extractSchema` _explicit `case type ... end, name`_
- [x] Test passes
- [x] Run `pnpm --filter sqlfu test` to confirm no snapshot regressions _only the expected extractSchema snapshot in `migrations.test.ts:608` moved; 840 pre-existing formatter failures unchanged_
- [x] Update any inline snapshots whose ordering shifts _one, `goto > preserves surviving data while other schema objects change`, now `create table person(...); create index person_name_idx on person(name);`_

## Out of scope

- Fixing consumer workarounds in iterate/iterate#1278 — that's their repo's follow-up once a sqlfu release with this fix lands.
- Any change to `inspectSchemaFingerprint`.
- Topological sort for inter-view dependencies.
