---
status: ready
size: large
---

# Replace ANTLR with a hand-written SQLite parser

Currently `vendor/typesql-parser/sqlite/SQLiteParser.ts` (ANTLR-generated, ~9 800 lines) + `SQLiteLexer.ts` + the `vendor/antlr4/` runtime are the biggest remaining weight in the published package — together ~450 kB on disk after minify, ~880 kB of bundle input before minify. After everything on the `slim-package` branch, removing ANTLR is the single remaining move that would cut the tarball meaningfully (packed would go from ~217 kB to an estimated 100-130 kB).

The sqlfu codebase only needs an AST rich enough to feed `sqlite-query-analyzer/traverse.ts` (the 64 kB inference engine that derives column types / nullability / parameter types). The test suite covers the shapes that matter.

## Phasing

### 1. Carve out the ANTLR surface area the analyzer actually depends on

Before writing any parser, enumerate what `sqlite-query-analyzer/*.ts` reads from the ANTLR AST. That's the shape of the AST the new parser needs to produce. Expected workflow:

- Grep all `instanceof *Context` checks and `ctx.foo_bar_list()` accessor calls from `sqlite-query-analyzer/`, `codegen/sqlite.ts`, and `shared-analyzer/`.
- Bucket them by node type (Sql_stmt, Select_stmt, Result_column, Table_or_subquery, Expr, Join_constraint, Update_stmt, Insert_stmt, Delete_stmt, Returning_clause, Select_core, Column_name, …).
- The analyzer uses ~40-ish node types by rough count. That's the target surface, not "full SQLite grammar".

Exit criterion: a short TypeScript `types.ts` listing every AST node kind the analyzer consumes, with an example of each accessor it calls.

### 2. MVP parser: DQL-only, no alternates

Write a recursive-descent parser for a *minimal* subset that covers most of the test fixtures:

- tokenizer (keywords, identifiers, literals, operators, parameter markers `?` / `:name`)
- `select_stmt` → with-clause + select-core + compound operators + order-by + limit
- `table_or_subquery` (single table, subquery in parens, joined table)
- `result_column` (star, table.star, expression [AS alias])
- `expr` — literals, columns, function calls, unary/binary ops, CASE, subquery, IN, BETWEEN, LIKE, NULL handling
- `insert_stmt` / `update_stmt` / `delete_stmt` / `returning_clause`

Skip: CREATE/ALTER/DROP (we use `sqlite_master` introspection), PRAGMA (handled separately), window functions (can fall back / defer), triggers, virtual tables.

Exit criterion: ≥ 80 % of `test/generate.test.ts` cases parsing and passing type-inference. Count how many, ship a passing partial run before moving on.

### 3. Swap the analyzer over one accessor at a time

In `sqlite-query-analyzer/traverse.ts` and friends, replace imports from `typesql-parser/sqlite/...` with imports from the new `vendor/sqlfu-sqlite-parser/` (or wherever we land it). Because the AST shape mirrors ANTLR's by design (step 1), each swap should be mostly an import rename. Go file-by-file, keep ANTLR alive alongside until every consumer is migrated.

Exit criterion: all 1071 tests passing on the new parser. `typesql-parser/sqlite/` and `vendor/antlr4/` can be deleted.

### 4. Expand to handle the remaining failing fixtures

From the MVP, work backwards through fixtures that don't pass yet. Each failing fixture is a feature to add: window functions, recursive CTEs, specific function calls, collations, etc. Each gets its own commit with a test case pinned to the fixture.

### 5. Delete ANTLR

Remove `src/vendor/typesql-parser/` entirely, remove `src/vendor/antlr4/`, remove the entry-point re-exports in `typesql-parser/index.ts`, drop `typesql-parser` from the bundle-vendor script's delete list. Verify the dist tree no longer mentions antlr.

## Scope and risk

- **Realistic effort**: 2-3 focused nights. Not one. The parser itself is ~2k lines; the long tail is making every test fixture produce exactly the same AST-shape the current analyzer expects.
- **Regression risk**: moderate. The test suite is good but covers *behaviors*, not every syntactic edge. Unknown unknowns likely in:
  - String literal quoting edge cases (single vs double, `''` escapes)
  - `NATURAL JOIN` / `USING (col)` — null propagation semantics
  - CASE expression nullability propagation (weirdly subtle)
  - Subquery correlation (referencing outer columns)
  - Compound SELECT (`UNION ALL` etc.) — type coercion rules
  - JSON path expressions, if any tests use them
- **What to do if a fixture won't parse**: do NOT quietly delete it. If the fixture exercises a feature sqlfu can't support without that grammar rule, either add the rule or open a separate task to drop the feature deliberately.

## What this is NOT

- **Not a typesql rewrite.** Keep `shared-analyzer/` and `sqlite-query-analyzer/` as-is; only swap out the parser layer underneath them.
- **Not a sql-formatter rewrite.** sql-formatter uses its own nearley grammar and is tiny (56 kB); leave it alone.
- **Not a grammar-completeness exercise.** If a SQLite feature has no existing test fixture *and* no real-world user asked for it, it's out of scope.

## Before-and-after size estimate

| Chunk | Now | After drop-antlr |
|---|---|---|
| `typesql-parser/sqlite/SQLiteParser.ts` (generated) | 445 kB input, ~250 kB minified | 0 |
| `typesql-parser/sqlite/SQLiteLexer.ts` (generated) | 72 kB input, ~40 kB minified | 0 |
| `antlr4` runtime | 115 kB input, ~60 kB minified | 0 |
| New hand-rolled parser | 0 | ~40-60 kB minified |
| **Net change to vendored bundle** | | **~−320 kB minified** |

Expected tarball impact: **217 kB packed → ~100-130 kB packed**, **967 kB unpacked → ~600 kB unpacked**.

## Dependencies / ordering

Depends on the `slim-package` branch landing first (PR #29). That branch sets up the \`shared-analyzer/\` structure this task swaps the parser under.
