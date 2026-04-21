# Vendored TypeSQL Notes

This directory is a near-copy of `https://github.com/wsporto/typesql` `src/`, initially vendored from commit `f0356201d41f3f317824968a3f1c7a90fbafdc99`.

Keep changes here mechanical where possible. Prefer preserving upstream structure over "cleaning it up" for local style.

Local changes that are expected:
- ESM-compatible relative import suffixes
- `cli.ts` exports `compile` and `loadVendoredConfig`, and does not auto-run when imported
- attribution comments on touched files
- local imports to `src/vendor/small-utils.ts`
- vendored support code may live alongside this tree under `src/vendor/*`
- `sqlfu.ts` exports `analyzeSqliteQueriesWithClient` so browser callers can run
  analysis against an already-open sqlite client (e.g. sqlite-wasm in demo mode)
- `sqlite-query-analyzer/traverse.ts` — `traverse_delete_stmt` guards the optional
  where-clause expr before calling `traverse_expr`. Upstream crashes on
  `delete from <t>;` with no where clause (null-deref on `expr.function_name()`).
- `sqlite-query-analyzer/traverse.ts` — `traverse_Sql_stmtContext` recognizes DDL /
  connection-control statements (`create_*_stmt`, `alter_table_stmt`, `drop_stmt`,
  `pragma_stmt`, `vacuum_stmt`, `reindex_stmt`, `analyze_stmt`, `attach_stmt`,
  `detach_stmt`, and the transaction statements) and returns a `queryType: 'Ddl'`
  descriptor. Upstream throws `traverse_Sql_stmtContext` for anything other than
  select/insert/update/delete. Callers turn the `Ddl` descriptor into a trivial
  `client.run(sql)` wrapper. The `Ddl` variant also shows up in
  `shared-analyzer/traverse.ts::TraverseResult2`, `types.ts::QueryType`, and
  `codegen/sqlite.ts::mapColumns` (which returns `[]` for it). The new parser
  in `src/vendor/sqlfu-sqlite-parser/` doesn't fully parse DDL structure — the
  shim's `Sql_stmtContext.<ddl_kind>_stmt()` accessor returns an opaque truthy
  marker for the matching `DdlKind`, and the analyzer reads only presence.

When updating from upstream:
- copy upstream `src/` over this directory again rather than editing file-by-file
- reapply only the local compatibility changes above
- keep sqlfu-specific behavior outside this folder when possible
- verify with `pnpm --filter sqlfu test --run test/generate.test.ts`, `pnpm --filter sqlfu typecheck`, and `pnpm --filter sqlfu build`
