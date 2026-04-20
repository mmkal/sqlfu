---
status: in-progress
size: large
---

# Replace ANTLR with a hand-written SQLite parser

## Status (high-level, human-skim)

Multi-night task. Currently on **night 1**.

- [x] Phase 0: plan refinement + per-phase acceptance criteria (this commit)
- [ ] Phase 1: surface-area analysis (`types.ts` listing consumed AST shape) — in progress this session
- [ ] Phase 2: tokenizer + minimal `select_stmt` recursive-descent parser — likely started this session, not finished
- [ ] Phase 3: per-file analyzer swap (future session)
- [ ] Phase 4: fixture tail (future session)
- [ ] Phase 5: delete ANTLR + `typesql-parser/sqlite/` + `antlr4/` (future session)

All of the ANTLR code stays in place the whole time until phase 5. New parser lands alongside it under a new directory, then consumers migrate one at a time. Tests must pass on every push.

## Per-phase acceptance criteria

These are the concrete "done" signals that should be satisfied before each phase's commit/push lands.

### Phase 1 — surface-area analysis

- `packages/sqlfu/src/vendor/sqlfu-sqlite-parser/types.ts` exists and is the *only* new file in this commit.
- It documents every `*Context` kind the analyzer `instanceof`-checks or constructs from ANTLR output, by:
  - grouping by statement (SELECT / INSERT / UPDATE / DELETE / common) and by construct (expr / join / with-clause / returning / etc.);
  - one TypeScript interface per node kind;
  - each interface includes a comment citing the 1–2 most common accessors the analyzer calls on it (`ctx.result_column_list()`, `ctx.table_name()`, etc.);
  - a short top-of-file summary noting total node count and which ANTLR generator files we are replacing.
- Nothing in `typesql/` or `typesql-parser/` is modified. No `instanceof`/accessor call sites migrate in this phase.
- `pnpm --filter sqlfu test --run` still green; `pnpm --filter sqlfu typecheck` still green.

### Phase 2 — tokenizer + select skeleton

- `packages/sqlfu/src/vendor/sqlfu-sqlite-parser/tokenizer.ts` is self-contained (no imports from `typesql-parser/`), exports `tokenize(sql: string): Token[]` and a `TokenKind` union.
- Handles: keywords (case-insensitive), identifiers (bare + `"quoted"` + `` `backtick` `` + `[bracket]`), string literals (`''` escape), numeric literals (int, float, hex `0x...`), parameter markers (`?`, `?N`, `:name`, `@name`, `$name`), the SQLite operator set (`||`, `<>`, `!=`, `<=`, `>=`, `==`, `<<`, `>>`), punctuation, `--` line + `/* */` block comments.
- `tokenizer.test.ts` uses a small sample of queries pulled from `test/generate.test.ts` / `test/fixtures/**` and asserts token streams via `toMatchInlineSnapshot` (readable, no magic numbers).
- `select_stmt.ts` recursive-descent parses the simplest subset — literal `SELECT x FROM t WHERE y = ?`-class queries — and produces AST nodes conforming to `types.ts`. Its test asserts parse shape on 2–3 tiny fixtures.
- Nothing in `typesql/` or `typesql-parser/` is modified.
- `pnpm --filter sqlfu test --run` still green; `pnpm --filter sqlfu typecheck` still green.

### Phase 3 — analyzer swap (future session)

One PR per consumer file under `sqlite-query-analyzer/`, in topological order (leaves first: `util-nullability.ts`, then `traverse.ts`, then the orchestrator). Each swap keeps ANTLR alive; only when the last consumer migrates does the old import disappear.

### Phase 4 — fixture tail (future session)

One failing fixture per commit. Red test first, then minimal grammar addition to pass.

### Phase 5 — delete (future session)

Drop `typesql-parser/sqlite/`, `antlr4/`, the re-exports, the bundle-vendor delete list entries. Confirm tarball size drop against the estimate in this task.

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

## Implementation log

### 2026-04-20 (night 1, bedtime session)

- Task file fleshed out with concrete per-phase acceptance criteria so future sessions (or other agents) can pick up without re-deriving "what's done-enough for phase N".
- Landed on directory name `packages/sqlfu/src/vendor/sqlfu-sqlite-parser/` (matches the hint in the original phase 3 bullet and puts it under `vendor/` alongside the ANTLR tree it's ultimately replacing; still "vendored" in the sense that `typesql` is the consumer — keeps future pure-typesql resync mechanics clean).
- Ground rule for this session: no deletion of anything, no consumer swaps. Everything is additive.
