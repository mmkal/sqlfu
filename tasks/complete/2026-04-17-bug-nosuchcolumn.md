## Status

Done. Analyzer now recognizes `sqlite_schema` / `sqlite_master` so the SQL runner stops flagging queries against them with bogus "no such column" diagnostics.

## Original report

```sql
select name, type
from sqlite_schema
where name not like 'sqlite_%'
order by type, name;
```

in "SQL runner" shows: "no such column: name" even though it works fine
(i guess we're excluding sqlite_ tables or some such?)

## Checklist

- [x] diagnose _query actually runs; error came from `sql.analyze` → vendored typesql `findColumn` throwing from `select-columns.ts:296` because `sqlite_schema` wasn't in the analyzer's schema map_
- [x] fix _in `packages/sqlfu/src/vendor/typesql/sqlite-query-analyzer/query-executor.ts`, `getTables` now appends `sqlite_schema` and `sqlite_master` to the main-schema table list so the existing `PRAGMA table_xinfo` loop populates their columns from SQLite's own introspection (rather than hardcoding column names/types)_
- [x] test _new case in `packages/sqlfu/test/ui-server.test.ts` asserts the original query produces `{diagnostics: []}`_

## Implementation notes

- Sidebar (`schema.get` in `ui/server.ts`) and analyzer (`loadSchema` in `typegen/index.ts` + vendored analyzer) are separate paths, so enabling system tables in the analyzer doesn't leak into the sidebar's `sqlite_%` filter.
- First pass hardcoded column names/types in `virtual-tables.ts`. Replaced with a two-line addition in `getTables`: `sqlite_schema` isn't listed in itself (sqlite doesn't self-reference in `sqlite_schema`), so appending its name lets the existing `getTableInfo` → `PRAGMA table_xinfo` loop introspect the real columns.
- Guarded by `schema === 'main'` so the two names aren't registered under every attached/temp schema.
- Added `sqlite_master` alongside since SQLite treats it as an alias for `sqlite_schema` and `PRAGMA table_xinfo('sqlite_master')` returns the same columns.
