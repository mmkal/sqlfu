status: ready
size: medium

# Add DDL support to vendored typesql, drop the regex shim in typegen

## Context

Today `packages/sqlfu/src/typegen/index.ts` has an `isDdlStatement` regex that pre-filters `.sql` files whose content starts with `create`/`drop`/`alter`/`pragma`/`vacuum`/etc. Those files skip typesql analysis entirely and get a trivial `client.run(sql)` wrapper.

The regex exists because the vendored typesql dispatcher `sqlite-query-analyzer/traverse.ts::traverse_Sql_stmtContext` throws `traverse_Sql_stmtContext` for every statement kind that isn't select/insert/update/delete. A code-review comment on PR #23 correctly flagged this as a workaround: we've vendored typesql precisely so we can fix parser-level bugs in-tree, and regexing around them feels wrong.

Quoting the review:

> we have vendored typesql for a reason, so maybe we could just... fix this bug instead of working around it. after all, it's our bug now

The companion null-deref bug (parameterless `delete from <t>;` crashing on `expr.function_name()`) was fixed in the same PR inside `traverse_delete_stmt`. That one was a 3-line null guard. DDL support is bigger, which is why it's its own task.

## Why this wasn't done in PR #23

Extending typesql to recognize DDL requires:

1. A new `queryType: 'Ddl'` variant (or similar) on the descriptor shape produced by `validateAndDescribeQuery`.
2. Plumbing that variant through every downstream consumer — typesql's own codegen paths in `codegen/sqlite.ts`, the `TsDescriptor` type, the re-exported `GeneratedQueryDescriptor` in `typegen/index.ts`, and everywhere that switches on `queryType` (wrapper rendering, query catalog, ad-hoc analysis).
3. A `traverse_ddl_stmt` (or equivalent branch in `traverse_Sql_stmtContext`) that introspects the ANTLR parse tree for DDL statements and returns a descriptor with empty `parameters`, empty `columns`, and the raw SQL text.

Of these (3) is the only one we'd want to touch — the others are bookkeeping. But even (3) is non-trivial: the ANTLR grammar covers `create_table_stmt`, `create_index_stmt`, `create_view_stmt`, `drop_table_stmt`, `alter_table_stmt`, plus `pragma_stmt` and the transactional statements (`begin`, `commit`, etc.). Each has its own ANTLR rule context. We need to either handle each case or have a fallback that says "this is an unanalyzable side-effect-only statement, here's the SQL text, trust me."

## Proposed shape

Minimum viable version:

1. In `traverse_Sql_stmtContext`, after checking select/insert/update/delete, inspect `sql_stmt.getChildCount()` and pull the single child. If it's any of the DDL contexts, return a new descriptor:

   ```ts
   const ddlResult: DdlResult = {
     queryType: 'Ddl',
     constraints: [],
     parameters: [],
     returningColumns: [],
   };
   ```

2. Add `'Ddl'` to the `queryType` union in the descriptor + TsDescriptor types.

3. In `typegen/index.ts`, branch on `descriptor.queryType === 'Ddl'` inside the main renderer and call `renderDdlWrapper`. Delete `isDdlStatement` and the `ddlFiles` partition.

4. Update the catalog writer to either skip DDL entries (current behavior — they aren't form-useful) or emit a `kind: 'ddl'` catalog variant.

Open question: do we want typesql to validate the DDL (e.g. "does the column type exist in SQLite") before emitting the descriptor? Probably yes for `create table`, not for `pragma`. For v1, skip validation — just recognize the statement type and emit the trivial descriptor.

## Why it's worth doing

- Removes a `\b(create|drop|...)\b` regex from sqlfu's own source. Less surface area to maintain.
- Edge cases the regex won't catch today: leading comments before the DDL statement, multi-statement `.sql` files (`create table ...; create index ...;`), DDL with a `RETURNING` clause (PostgreSQL; not SQLite yet, but typesql aims to support other dialects). typesql's ANTLR grammar handles all these.
- A future `queryType: 'Ddl'` also unlocks proper DDL handling in the UI query catalog and ad-hoc analysis flow — they currently don't understand DDL at all.

## Vendor update hygiene

`packages/sqlfu/src/vendor/typesql/CLAUDE.md` notes the null-deref divergence that landed in PR #23. Adding DDL support is another divergence worth documenting before landing. If upstream typesql later adds DDL support independently, the update workflow is: copy upstream `src/`, reapply the DDL branch on top (or pick upstream's shape if it's compatible).

## Not in scope

- MySQL / Postgres DDL support. typesql supports multiple dialects; the fix should target the sqlite path only. Bringing the other dialects along is a separate task.
- DDL validation (checking that referenced columns exist, etc.).
- Runtime behavior changes. Wrappers still call `client.run(sql)` — no smarter handling of `if not exists` semantics or similar.

## Breadcrumb

Raised in review of PR #23 at comments [#3111996426](https://github.com/mmkal/sqlfu/pull/23#discussion_r3111996426) and [#3112007601](https://github.com/mmkal/sqlfu/pull/23#discussion_r3112007601). PR #23 shipped with the regex shim + documented it as a conscious stopgap; this task is the proper fix.
