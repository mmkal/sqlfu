status: in-progress
size: medium

# Add DDL support to vendored typesql, drop the regex shim in typegen

## Executive summary (for humans skimming)

In-progress as of 2026-04-20. Goal: teach the vendored typesql sqlite analyzer to recognize DDL/connection-control statements (`create`, `drop`, `alter`, `pragma`, `vacuum`, `begin`/`commit`, etc.) and return a new `queryType: 'Ddl'` descriptor, then wire that through every downstream consumer. Once the analyzer knows about DDL, we delete the `isDdlStatement` regex + `ddlFiles` partition in `typegen/index.ts` and branch on `descriptor.queryType === 'Ddl'` inside the normal analysis path.

Main completed pieces: TBD (filled in as work lands).
Main missing pieces: TBD.

## Context

Today `packages/sqlfu/src/typegen/index.ts` has an `isDdlStatement` regex that pre-filters `.sql` files whose content starts with `create`/`drop`/`alter`/`pragma`/`vacuum`/etc. Those files skip typesql analysis entirely and get a trivial `client.run(sql)` wrapper.

The regex exists because the vendored typesql dispatcher `sqlite-query-analyzer/traverse.ts::traverse_Sql_stmtContext` throws `traverse_Sql_stmtContext` for every statement kind that isn't select/insert/update/delete. A code-review comment on PR #23 correctly flagged this as a workaround: we've vendored typesql precisely so we can fix parser-level bugs in-tree, and regexing around them feels wrong.

Quoting the review:

> we have vendored typesql for a reason, so maybe we could just... fix this bug instead of working around it. after all, it's our bug now

The companion null-deref bug (parameterless `delete from <t>;` crashing on `expr.function_name()`) was fixed in the same PR inside `traverse_delete_stmt`. That one was a 3-line null guard. DDL support is bigger, which is why it's its own task.

## Concrete design

### 1. New `DdlResult` variant in the shared traverse result union

`packages/sqlfu/src/vendor/typesql/shared-analyzer/traverse.ts` exports `TraverseResult2 = SelectResult | InsertResult | UpdateResult | DeleteResult`. Add a fifth member:

```ts
export type DdlResult = {
  queryType: 'Ddl';
  constraints: Constraint[];
  parameters: TypeAndNullInferParam[];
  returningColumns: TypeAndNullInfer[];
};
```

`constraints`, `parameters`, `returningColumns` are always empty arrays. They're included so downstream code that does `queryResult.parameters.forEach(...)` on the union keeps type-checking without a narrowing branch.

### 2. Recognize DDL in the sqlite dispatcher

In `packages/sqlfu/src/vendor/typesql/sqlite-query-analyzer/traverse.ts::traverse_Sql_stmtContext`, after the select/insert/update/delete branches, check each DDL context returned by the `Sql_stmtContext` accessors (see `SQLiteParser.ts` lines 10671+):

- `create_table_stmt`, `create_index_stmt`, `create_view_stmt`, `create_trigger_stmt`, `create_virtual_table_stmt`
- `alter_table_stmt`, `drop_stmt`
- `pragma_stmt`, `vacuum_stmt`, `reindex_stmt`, `analyze_stmt`, `attach_stmt`, `detach_stmt`
- `begin_stmt`, `commit_stmt`, `rollback_stmt`, `savepoint_stmt`, `release_stmt`

If any of these is non-null, return a `DdlResult` descriptor with empty arrays.

Implementation: collect the accessor calls and check with `.some(ctx => ctx != null)`; return early with the trivial result.

### 3. Handle `Ddl` in `createSchemaDefinition`

`packages/sqlfu/src/vendor/typesql/sqlite-query-analyzer/parser.ts::createSchemaDefinition` has a `if (queryResult.queryType === 'Select' | 'Insert' | 'Update' | 'Delete') { ... }` ladder. Add a `Ddl` branch that returns a minimal `SchemaDef`:

```ts
if (queryResult.queryType === 'Ddl') {
  return right({
    sql,
    queryType: 'Ddl',
    multipleRowsResult: false,
    columns: [],
    parameters: [],
  });
}
```

Add `'Ddl'` to `QueryType` in `packages/sqlfu/src/vendor/typesql/types.ts`.

### 4. Handle `Ddl` in `createTsDescriptor`

`packages/sqlfu/src/vendor/typesql/codegen/sqlite.ts::createTsDescriptor` builds a `TsDescriptor`. For DDL the output is trivially `{sql, queryType: 'Ddl', multipleRowsResult: false, columns: [], parameterNames: [], parameters: []}`. The existing code already handles the generic case; branch `mapColumns` explicitly: `if (queryType === 'Ddl') return [];` so it doesn't pretend there's an insert/update/delete-shaped metadata row.

### 5. Explain/prepare DDL

`validateAndDescribeQuery` calls `explainSql` which does `db.prepare(sql)`. For DDL this should succeed (sqlite prepares DDL fine). For multi-statement DDL files (`create table x(...); create index y on x(...);`), sqlite's `prepare` only compiles the first statement — we're using prepare as a syntax check, which still works.

For statements sqlite would reject before execution (malformed `create table`), the existing prepare error flows through as-is. Good.

### 6. Propagate `'Ddl'` through the generated descriptor type

In `packages/sqlfu/src/typegen/analyze-vendored-typesql.ts`, add `'Ddl'` to the `queryType` union on `GeneratedQueryDescriptor`.

In `packages/sqlfu/src/typegen/query-catalog.ts`, add `'Ddl'` where the queryType union appears (if we do emit DDL entries). For v1 we skip DDL from the catalog, matching today's behavior, so this is a no-op.

### 7. Update `typegen/index.ts`

Delete:
- `isDdlStatement` function
- `ddlFiles` / `nonDdlFiles` partition
- `ddlFiles` parameter on `writeQueryCatalog`

Keep `renderDdlWrapper` but call it based on `descriptor.queryType === 'Ddl'` inside the normal per-query loop. The analysis result (`analysis.ok === true` with a DDL descriptor) becomes the trigger.

`getResultMode` / `getReturnType` / `getResultFields` don't need new branches because we short-circuit to `renderDdlWrapper` before any of them are reached. The catalog writer filters DDL out before building catalog entries (same as today).

### 8. Document the divergence

Add a line to `packages/sqlfu/src/vendor/typesql/CLAUDE.md`:

> `sqlite-query-analyzer/traverse.ts::traverse_Sql_stmtContext` — recognizes DDL / connection-control statements (create/drop/alter/pragma/vacuum/begin/commit/etc.) and returns a `DdlResult` descriptor with empty arrays. Upstream throws for anything that isn't select/insert/update/delete.

## Test cases

Add / keep:

- Existing: `create table if not exists sqlfu_migrations(...)` — trivial wrapper + no catalog entry.
- New: `drop table foo` — trivial wrapper.
- New: `pragma foreign_keys = on` — trivial wrapper.
- New: multi-statement DDL file (`create table x (...); create index ix on x(...);`) — trivial wrapper, both statements preserved in the emitted SQL constant.
- New: DDL file with leading SQL comments — trivial wrapper. (The deleted regex stripped comments before matching; the ANTLR parser natively ignores them, so this is a free improvement.)
- New: `alter table posts add column title text` — trivial wrapper.

## Checklist

- [ ] Add `DdlResult` to shared-analyzer/traverse.ts `TraverseResult2` union
- [ ] Recognize DDL contexts in sqlite-query-analyzer/traverse.ts `traverse_Sql_stmtContext`
- [ ] Handle `Ddl` branch in sqlite-query-analyzer/parser.ts `createSchemaDefinition`
- [ ] Add `'Ddl'` to `QueryType` in vendor/typesql/types.ts
- [ ] Handle `Ddl` in codegen/sqlite.ts (`createTsDescriptor`, `mapColumns`)
- [ ] Add `'Ddl'` to `GeneratedQueryDescriptor` in typegen/analyze-vendored-typesql.ts
- [ ] Delete `isDdlStatement`, `ddlFiles` partition in typegen/index.ts; branch on `queryType === 'Ddl'` instead
- [ ] Update `writeQueryCatalog` signature (drop `ddlFiles` param, skip Ddl descriptors inline)
- [ ] Document divergence in vendor/typesql/CLAUDE.md
- [ ] Red test: DDL file with leading SQL comments produces a valid wrapper
- [ ] Red test: multi-statement DDL file (`create table ...; create index ...;`) produces a valid wrapper
- [ ] Verify existing DDL test (`create table if not exists sqlfu_migrations...`) still passes
- [ ] Add tests: `drop table`, `pragma foreign_keys = on`, `alter table`
- [ ] `pnpm --filter sqlfu test --run` all green
- [ ] `pnpm --filter sqlfu typecheck` clean
- [ ] `pnpm --filter sqlfu build` succeeds

## Not in scope

- MySQL / Postgres DDL support. typesql supports multiple dialects; this fix targets the sqlite path only.
- DDL validation beyond what `db.prepare(sql)` already provides.
- Runtime behavior changes. Wrappers still call `client.run(sql)` — no smarter handling of `if not exists` semantics or similar.
- Emitting a `kind: 'ddl'` catalog entry variant. For v1 we skip DDL from the catalog (same as today), leaving that as a follow-up if/when the UI wants to render DDL cards.

## Breadcrumb

Raised in review of PR #23 at comments [#3111996426](https://github.com/mmkal/sqlfu/pull/23#discussion_r3111996426) and [#3112007601](https://github.com/mmkal/sqlfu/pull/23#discussion_r3112007601). PR #23 shipped with the regex shim + documented it as a conscious stopgap; this task is the proper fix.

## Implementation log

(Added as work progresses.)
