// sqlfu SQLite parser — consumed-surface type declarations.
//
// Phase 1 of `tasks/drop-antlr.md`: this file enumerates every AST node shape
// that `src/vendor/typesql/sqlite-query-analyzer/` and `shared-analyzer/`
// actually read from the ANTLR-generated parser today. The shape mirrors the
// ANTLR `*Context` classes from
// `src/vendor/typesql-parser/sqlite/SQLiteParser.ts`, but only documents the
// accessors the analyzer calls — not the full ANTLR surface.
//
// This is a target shape for the hand-rolled parser in phases 2–4. It is NOT
// yet wired up to anything. The analyzer and ANTLR parser remain the source of
// truth until phase 3 swaps consumers over one file at a time.
//
// ## How this file was derived
//
// 1. `rg "\bCtx\.|\b\w+Context\b"` across
//    `sqlite-query-analyzer/*.ts` + `shared-analyzer/*.ts` to enumerate every
//    `instanceof` site and every accessor invocation.
// 2. Cross-referenced against
//    `src/vendor/typesql-parser/sqlite/SQLiteParser.ts` to verify each
//    accessor returns the shape documented here.
// 3. Each node type below cites the 1–3 most common call sites in comments so
//    future agents can trace back "why does this field exist?".
//
// ## Surface summary
//
// - 24 node types are consumed by the analyzer.
// - 3 of them (`ExprContext`, `Select_stmtContext`, `Select_coreContext`) are
//   the heavy lifters — ~80% of accessor calls land here.
// - Terminal-token accessors on `ExprContext` (e.g. `.PLUS()`, `.IS_()`,
//   `.LIKE_()`) are boolean presence checks in the analyzer; we model them as
//   discriminated union `kind`s rather than as nullable TerminalNode accessors,
//   because the analyzer never reads a terminal's text — only its presence.
// - Labeled-rule outputs (`_whereExpr`, `_groupByExpr`, `_havingExpr` on
//   `Select_coreContext`) are ANTLR convention; we surface them as plain
//   optional properties.
//
// ## What we are NOT modeling
//
// - `ParserRuleContext` / `TerminalNode` infrastructure. The analyzer calls
//   `.getText()`, `.start`, `.stop`, `.parentCtx`, and `.getChildCount()` via a
//   shared `ParserRuleContext` base; we will replicate just the needed subset
//   (see `ParseNode` below).
// - Node types that exist in the grammar but have zero analyzer call sites
//   (e.g. `Vacuum_stmtContext`, `Pragma_stmtContext`, `Trigger_stmtContext`,
//   `Drop_stmtContext`, `Window_defnContext`).
// - Full SQLite grammar. The analyzer is the only consumer; anything it does
//   not read is out of scope for the replacement.
//
// ## Replacing these files
//
// The net goal is to delete:
// - `src/vendor/typesql-parser/sqlite/SQLiteParser.ts` (~9,800 lines, 445 kB)
// - `src/vendor/typesql-parser/sqlite/SQLiteLexer.ts` (~2,200 lines, 72 kB)
// - `src/vendor/typesql-parser/sqlite/index.ts` (re-exports)
// - `src/vendor/antlr4/` (runtime, ~115 kB)
//
// Replaced by a hand-rolled lexer + recursive-descent parser emitting the
// shapes in this file.

// -----------------------------------------------------------------------------
// Base node infrastructure
// -----------------------------------------------------------------------------

/**
 * Source range the node spans in the original SQL input.
 *
 * Analyzer call sites: `traverse.ts:1759-1764` `extractOriginalSql` reads
 * `rule.start.start` and `rule.stop?.stop`, then slices the original input.
 * `traverse.ts:368` reads `expr.BIND_PARAMETER().symbol.start` to locate
 * parameter markers by byte offset. `traverse.ts:2119` reads
 * `update_stmt.WHERE_().symbol.start` to distinguish SET-clause params from
 * WHERE-clause params.
 */
export interface SourceRange {
	/** Byte offset of the first character of the node in the source SQL. */
	start: number;
	/** Byte offset of the last character (inclusive) of the node. */
	stop: number;
}

/**
 * Minimum `ParserRuleContext`-shaped surface the analyzer needs from every
 * node. Mirrors the subset of ANTLR's `ParserRuleContext` that `traverse.ts`,
 * `select-columns.ts`, and `enum-parser.ts` actually use.
 */
export interface ParseNode {
	/**
	 * Returns the exact source text this node covers, uppercase/lowercase
	 * preserved. Used everywhere — `expr.getText()`, `result_column.getText()`,
	 * `column_name.getText()`, etc. The new parser must produce this either by
	 * slicing the source or by concatenating child token text.
	 */
	getText(): string;

	/**
	 * ANTLR-style `start.start` / `stop?.stop` offsets. `traverse.ts:1760-1761`
	 * reads them directly to compute `extractOriginalSql`. Also used for
	 * `update_stmt.WHERE_().symbol.start` comparisons.
	 */
	start: { start: number; getInputStream(): { getText(start: number, stop: number): string } | null };
	stop?: { stop: number };

	/**
	 * Parent pointer. `traverse.ts:654-655`: `expr.parentCtx instanceof
	 * ExprContext && expr.parentCtx.function_name()?.getText() === 'date'` —
	 * expressions need to know if they are inside a date() call so PLUS/MINUS
	 * don't double-constrain the inner type.
	 *
	 * Also `select-columns.ts:162`: `child instanceof ParserRuleContext` when
	 * walking children to find expressions.
	 *
	 * Also `traverse.ts:360`: `const expr = colRef.parentCtx as ExprContext`
	 * — we rely on parent being an `ExprContext` when a `Column_nameContext`
	 * appears inside an expression.
	 */
	parentCtx: ParseNode | null;

	/**
	 * Used only in `shared-analyzer/select-columns.ts:156-166` `collectExpr`,
	 * which walks children to find all `ExprContext`/`Column_nameContext`
	 * subnodes. The new parser can implement this via the AST's own child-
	 * iteration shape; the signature here is kept ANTLR-compatible for the
	 * phase 3 swap.
	 */
	getChildCount(): number;
	getChild(i: number): ParseNode;
}

/**
 * Terminal node shape the analyzer needs. The analyzer only reads
 * `.symbol.start` to locate byte offsets, and it checks presence (non-null
 * return from accessors like `.BIND_PARAMETER()`, `.WHERE_()`, etc.).
 */
export interface TerminalNode {
	symbol: { start: number };
}

// -----------------------------------------------------------------------------
// Entry point + top-level statement envelope
// -----------------------------------------------------------------------------

/**
 * The `parseSql` entry point returns an object whose `sql_stmt()` method
 * yields a `Sql_stmtContext`. `parser.ts:34-35`:
 *
 * ```ts
 * const parser = parseSqlite(processedSql);
 * const sql_stmt = parser.sql_stmt();
 * ```
 *
 * `enum-parser.ts:7` uses `parser.sql_stmt_list().children` to enumerate every
 * top-level statement. We expose both here because both call sites exist.
 */
export interface ParseResult {
	/**
	 * The single top-level statement at the root. In practice sqlfu always
	 * processes one statement at a time (the driver splits on `;` upstream), so
	 * this returns the first `Sql_stmt` in the input.
	 */
	sql_stmt(): Sql_stmtContext;

	/**
	 * Used only by `enum-parser.ts` to walk every CREATE TABLE in a .sql file.
	 * The analyzer reads `.children` and filters by `instanceof Sql_stmtContext`
	 * (ignoring `SEMI` terminal children).
	 */
	sql_stmt_list(): { children?: ParseNode[] };
}

/**
 * The `sql_stmt` rule is a thin wrapper that picks exactly one of
 * select/insert/update/delete/create_table. `traverse.ts:35-54` fans out via
 * optional accessors; `enum-parser.ts:9` reads `.create_table_stmt()`.
 */
export interface Sql_stmtContext extends ParseNode {
	select_stmt(): Select_stmtContext | null;
	insert_stmt(): Insert_stmtContext | null;
	update_stmt(): Update_stmtContext | null;
	delete_stmt(): Delete_stmtContext | null;
	create_table_stmt(): Create_table_stmtContext | null;
}

// -----------------------------------------------------------------------------
// SELECT
// -----------------------------------------------------------------------------

/**
 * Top-level select (simple or compound). Has an optional WITH clause, one or
 * more `select_core`s (joined by UNION/INTERSECT/EXCEPT compound operators),
 * and optional ORDER BY / LIMIT.
 *
 * Analyzer call sites: `traverse.ts:82` (common_table_stmt),
 * `traverse.ts:108` (select_core_list), `traverse.ts:139` (order_by_stmt),
 * `traverse.ts:160` (limit_stmt), `traverse.ts:1851` (select_core_list —
 * length check for isMultipleRowResult), `traverse.ts:1858` (select_core_list
 * — group-by check).
 */
export interface Select_stmtContext extends ParseNode {
	common_table_stmt(): Common_table_stmtContext | null;
	select_core_list(): Select_coreContext[];
	/** Indexed access used only in `traverse.ts:1853` for the first select_core. */
	select_core(i: number): Select_coreContext;
	order_by_stmt(): Order_by_stmtContext | null;
	limit_stmt(): Limit_stmtContext | null;
}

/**
 * A single SELECT body. ANTLR exposes `_whereExpr`, `_groupByExpr`,
 * `_havingExpr` as labeled-rule properties; the analyzer reads them directly
 * rather than through accessors.
 *
 * Analyzer call sites: `traverse.ts:216,308,323,331,1854` (all the labeled
 * properties), `traverse.ts:221,867` (join_clause), `traverse.ts:230,1862`
 * (result_column_list), `traverse.ts:1854` (FROM_ presence),
 * `traverse.ts:1858` (GROUP_ presence), `traverse.ts:216` (table_or_subquery_list).
 */
export interface Select_coreContext extends ParseNode {
	/** Result columns (the `SELECT x, y, z` list). Never empty for a well-formed SELECT. */
	result_column_list(): Result_columnContext[];

	/** Tables/subqueries in the FROM clause (comma-separated). Empty if no FROM. */
	table_or_subquery_list(): Table_or_subqueryContext[];

	/** Present when the FROM uses explicit JOIN syntax rather than comma joins. */
	join_clause(): Join_clauseContext | null;

	/** Presence of the `FROM` keyword — `traverse.ts:1854` `isMultipleRowResult` uses this. */
	FROM_(): TerminalNode | null;

	/** Presence of the `GROUP BY` clause — `traverse.ts:1858` `isMultipleRowResult`. */
	GROUP_(): TerminalNode | null;

	/**
	 * The WHERE expression. ANTLR labels this `_whereExpr`. The analyzer reads
	 * it directly (not via accessor). Null when no WHERE.
	 */
	_whereExpr?: ExprContext;

	/** ANTLR-labeled GROUP BY expressions. Empty/undefined when no GROUP BY. */
	_groupByExpr?: ExprContext[];

	/** ANTLR-labeled HAVING expression. Null when no HAVING. */
	_havingExpr?: ExprContext;
}

/**
 * A single entry in the `SELECT ...` list. Three shapes:
 * - `*` (bare star) — `STAR()` returns a terminal, `expr()`/`table_name()`
 *   return null.
 * - `table.*` — both `STAR()` and `table_name()` non-null.
 * - `<expr> [AS alias]` — `expr()` non-null, `STAR()` null, `column_alias()`
 *   optionally set.
 *
 * Analyzer call sites: `traverse.ts:234-260` (all branches),
 * `traverse.ts:1862,1893-1899` (isAgregateFunction).
 */
export interface Result_columnContext extends ParseNode {
	/** The `*` token. Present for `*` and `table.*` forms. */
	STAR(): TerminalNode | null;

	/** Only present in `table.*` form (paired with non-null `STAR()`). */
	table_name(): Table_nameContext | null;

	/** The expression — present for `<expr> [AS alias]`, null for any star form. */
	expr(): ExprContext | null;

	/** Optional alias after AS. Analyzer reads `.getText()` and strips surrounding `"..."`. */
	column_alias(): Column_aliasContext | null;
}

// -----------------------------------------------------------------------------
// FROM / JOIN
// -----------------------------------------------------------------------------

/**
 * Wraps the table-or-subquery list when explicit JOIN syntax is used.
 *
 * Analyzer call sites: `traverse.ts:223-225`, `traverse.ts:1867`.
 */
export interface Join_clauseContext extends ParseNode {
	table_or_subquery_list(): Table_or_subqueryContext[];
	join_operator_list(): Join_operatorContext[];
	join_constraint_list(): Join_constraintContext[];
}

/**
 * A single "from target": a named table, a subquery in parens, a
 * table-valued function, or a nested joined construct. The analyzer has four
 * separate branches driven by which accessor returns non-null.
 *
 * Analyzer call sites: `traverse.ts:388-466`. `traverse.ts:1866,1870,1879`
 * also reads `.table_name()` and `.schema_name()` for `isMultipleRowResult`.
 */
export interface Table_or_subqueryContext extends ParseNode {
	/** Named table form. Paired with optional `schema_name()` and `table_alias()`. */
	table_name(): Table_nameContext | null;

	/** Optional schema qualifier, e.g. `main.foo` or `"quoted".foo`. */
	schema_name(): Schema_nameContext | null;

	/**
	 * Table-valued function form (e.g. `FROM email('fts5')`). Paired with
	 * `expr_list()` for the function's arguments. `traverse.ts:388-389`.
	 */
	table_function_name(): Table_function_nameContext | null;

	/** `AS` keyword presence — distinguishes explicit vs implicit aliasing. */
	AS_(): TerminalNode | null;

	/** Optional alias. */
	table_alias(): Table_aliasContext | null;

	/** Function-call arguments when `table_function_name()` is non-null. */
	expr(i: number): ExprContext | null;

	/** Subquery form: `FROM (SELECT ...) alias`. */
	select_stmt(): Select_stmtContext | null;

	/**
	 * Nested-joined form: `FROM (a JOIN b ON ...)`. Recursive — each entry is
	 * itself a `Table_or_subqueryContext`. `traverse.ts:462-466`.
	 */
	table_or_subquery_list(): Table_or_subqueryContext[];
}

/**
 * A single join operator token sequence (e.g. `INNER JOIN`, `LEFT OUTER
 * JOIN`, `,`, `NATURAL CROSS JOIN`). Only `LEFT_()` is consumed today, to
 * set null-propagation for outer-joined columns.
 *
 * Analyzer call sites: `traverse.ts:387`.
 */
export interface Join_operatorContext extends ParseNode {
	/** Presence of `LEFT` — drives nullability flipping for joined columns. */
	LEFT_(): TerminalNode | null;
}

/**
 * The ON / USING clause that follows a join operator.
 *
 * Analyzer call sites: `traverse.ts:427-428` (USING_ + column_name_list),
 * `traverse.ts:478-480` (ON expr), plus `extractOriginalSql` for the dynamic
 * SQL fragment.
 */
export interface Join_constraintContext extends ParseNode {
	/** Presence of `USING` — distinguishes `USING (cols)` from `ON expr`. */
	USING_(): TerminalNode | null;

	/** Column list for USING. */
	column_name_list(): Column_nameContext[];

	/** ON expression. */
	expr(): ExprContext | null;
}

// -----------------------------------------------------------------------------
// WITH / CTE
// -----------------------------------------------------------------------------

/**
 * `WITH [RECURSIVE] cte1, cte2, ...`. Analyzer call sites: `traverse.ts:82-86`.
 */
export interface Common_table_stmtContext extends ParseNode {
	RECURSIVE_(): TerminalNode | null;
	common_table_expression_list(): Common_table_expressionContext[];
}

/**
 * A single CTE: `name (col1, col2) AS (SELECT ...)`.
 *
 * Analyzer call sites: `traverse.ts:86-105`.
 */
export interface Common_table_expressionContext extends ParseNode {
	table_name(): Table_nameContext;
	column_name_list(): Column_nameContext[];
	select_stmt(): Select_stmtContext;
}

// -----------------------------------------------------------------------------
// ORDER BY / LIMIT
// -----------------------------------------------------------------------------

/**
 * `ORDER BY ordering_term, ...`. Analyzer call sites: `traverse.ts:143`.
 */
export interface Order_by_stmtContext extends ParseNode {
	ordering_term_list(): Ordering_termContext[];
}

/**
 * A single ordering term: an expression plus optional ASC/DESC/NULLS
 * FIRST/LAST (those modifiers are ignored by the analyzer today).
 *
 * Analyzer call sites: `traverse.ts:144-145`.
 */
export interface Ordering_termContext extends ParseNode {
	expr(): ExprContext;
}

/**
 * `LIMIT expr [OFFSET expr]` or `LIMIT expr, expr`. The analyzer reads
 * `expr_list()` which has 1 or 2 entries.
 *
 * Analyzer call sites: `traverse.ts:160-187`, `traverse.ts:1921-1922`
 * (`isLimitOne`).
 */
export interface Limit_stmtContext extends ParseNode {
	expr_list(): ExprContext[];
	expr(i: number): ExprContext;
}

// -----------------------------------------------------------------------------
// EXPR — the big one
// -----------------------------------------------------------------------------

/**
 * The universal expression node. In ANTLR, `ExprContext` is a single rule
 * with ~30 alternates; the analyzer disambiguates by checking which accessors
 * return non-null.
 *
 * This interface lists every accessor the analyzer calls, grouped by the
 * expression shape each accessor identifies. The new parser should produce
 * node instances where exactly the accessors for the matching shape return
 * truthy values.
 *
 * ## Unary / atomic forms
 *
 * - Literal: `literal_value()` non-null, all others null.
 * - Bound parameter: `BIND_PARAMETER()` non-null.
 * - Column reference: `column_name()` non-null, optional `table_name()`.
 * - Function call: `function_name()` non-null, `expr_list()` has the args.
 * - Parenthesised: `OPEN_PAR()` and `CLOSE_PAR()` both non-null with no
 *   operator / function_name — `expr_list()` has inner exprs.
 * - Subquery: `select_stmt()` non-null (optional `EXISTS_()` prefix).
 * - Unary op: `unary_operator()` non-null, `expr(0)` has operand.
 * - CAST: `CAST_()` + `AS_()` + `type_name()`.
 *
 * ## Binary / ternary forms
 *
 * All these set exactly one of the operator terminals non-null and have
 * `expr(0)` / `expr(1)` as operands:
 *
 * - Arithmetic: `STAR()` / `DIV()` / `MOD()` / `PLUS()` / `MINUS()`
 * - Bitwise / shift: `LT2()` / `GT2()` / `AMP()` / `PIPE()`
 * - Comparison: `LT()` / `LT_EQ()` / `GT()` / `GT_EQ()` / `ASSIGN()` (`=`)
 *   / `EQ()` (`==`) / `NOT_EQ1()` (`!=`) / `NOT_EQ2()` (`<>`)
 * - String concat: `PIPE2()` (`||`)
 * - Boolean: `AND_()` / `OR_()`
 * - `IS` family: `IS_()` — `expr(1)` may be `NULL`/`NOT NULL`/`TRUE`/`FALSE`/
 *   `notnull` etc.; analyzer treats it as general equality.
 *
 * ## Special ternary / list forms
 *
 * - `BETWEEN`: `BETWEEN_()` + `expr(0)` (value) / `expr(1)` (low) / `expr(2)` (high).
 * - `IN`: `IN_()` with either `select_stmt()` (subquery) or `expr_list()` (list).
 *   Analyzer checks `NOT_()` for NOT IN handling.
 * - `LIKE` / `GLOB` / `MATCH`: operator terminal + `expr(0)` / `expr(1)`.
 * - `CASE`: `CASE_()` + `expr_list()` alternating when/then, plus optional
 *   `ELSE_()` terminal and trailing else-expr.
 *
 * Analyzer call sites are spread across `traverse.ts:533-985` (main `traverse_expr`),
 * `traverse.ts:987-1756` (`traverse_function` — dispatches on `function_name`
 * getText + indexes into `expr_list()`), `traverse.ts:1803-1845` (isNotNull
 * walk — reads `AND_()`/`OR_()`/comparison operators), `traverse.ts:1894`
 * (`result_column.expr()?.over_clause()` — window function detection —
 * note over_clause is referenced ONCE and set to null for the simplest MVP).
 */
export interface ExprContext extends ParseNode {
	// --- atomic forms ---
	literal_value(): Literal_valueContext | null;
	BIND_PARAMETER(): TerminalNode | null;
	column_name(): Column_nameContext | null;
	table_name(): Table_nameContext | null;
	function_name(): Function_nameContext | null;
	unary_operator(): Unary_operatorContext | null;

	// --- sub-expressions ---
	expr(i: number): ExprContext;
	expr_list(): ExprContext[];
	select_stmt(): Select_stmtContext | null;

	// --- binary/ternary/list keyword operators (presence checks only) ---
	OPEN_PAR(): TerminalNode | null;
	CLOSE_PAR(): TerminalNode | null;
	STAR(): TerminalNode | null;
	DIV(): TerminalNode | null;
	MOD(): TerminalNode | null;
	PLUS(): TerminalNode | null;
	MINUS(): TerminalNode | null;
	LT2(): TerminalNode | null;
	GT2(): TerminalNode | null;
	AMP(): TerminalNode | null;
	PIPE(): TerminalNode | null;
	PIPE2(): TerminalNode | null;
	LT(): TerminalNode | null;
	LT_EQ(): TerminalNode | null;
	GT(): TerminalNode | null;
	GT_EQ(): TerminalNode | null;
	ASSIGN(): TerminalNode | null;
	EQ(): TerminalNode | null;
	NOT_EQ1(): TerminalNode | null;
	NOT_EQ2(): TerminalNode | null;
	IS_(): TerminalNode | null;
	IN_(): TerminalNode | null;
	NOT_(): TerminalNode | null;
	LIKE_(): TerminalNode | null;
	GLOB_(): TerminalNode | null;
	MATCH_(): TerminalNode | null;
	AND_(): TerminalNode | null;
	OR_(): TerminalNode | null;
	BETWEEN_(): TerminalNode | null;
	EXISTS_(): TerminalNode | null;
	CASE_(): TerminalNode | null;
	ELSE_(): TerminalNode | null;

	// --- window function / OVER — touched only at call site `traverse.ts:1894`;
	// phase-2 MVP can return null always. ---
	over_clause(): { present: true } | null;
}

/**
 * Literal subclass: exactly one of the terminal checks returns truthy.
 *
 * Analyzer call sites: `traverse.ts:554-587` (string/numeric/bool/null),
 * `enum-parser.ts:50` (STRING_LITERAL check for enum detection).
 */
export interface Literal_valueContext extends ParseNode {
	STRING_LITERAL(): TerminalNode | null;
	NUMERIC_LITERAL(): TerminalNode | null;
	TRUE_(): TerminalNode | null;
	FALSE_(): TerminalNode | null;
	NULL_(): TerminalNode | null;
}

/**
 * Placeholder for `unary_operator` — the analyzer only checks presence via
 * `expr.unary_operator()` returning non-null, never inspects which operator.
 * `traverse.ts:589-592`.
 */
export interface Unary_operatorContext extends ParseNode {
	// intentionally minimal — analyzer treats it as "some unary op was applied"
	// and returns the inner expr's type.
}

// -----------------------------------------------------------------------------
// INSERT
// -----------------------------------------------------------------------------

/**
 * `INSERT INTO table (cols) VALUES (...) [ON CONFLICT ...] [RETURNING ...]`
 * or `INSERT INTO table (cols) SELECT ...`.
 *
 * Analyzer call sites: `traverse.ts:1982-2071`.
 */
export interface Insert_stmtContext extends ParseNode {
	table_name(): Table_nameContext;
	column_name_list(): Column_nameContext[];
	values_clause(): Values_clauseContext | null;
	select_stmt(): Select_stmtContext | null;
	upsert_clause(): Upsert_clauseContext | null;
	returning_clause(): Returning_clauseContext | null;
}

/**
 * `VALUES (a, b), (c, d), ...` — a list of rows.
 *
 * Analyzer call sites: `traverse.ts:1989`.
 */
export interface Values_clauseContext extends ParseNode {
	value_row_list(): Value_rowContext[];
}

/**
 * A single `(a, b, c)` row inside a VALUES clause.
 *
 * Analyzer call sites: `traverse.ts:1991`.
 */
export interface Value_rowContext extends ParseNode {
	expr_list(): ExprContext[];
}

/**
 * `ON CONFLICT (target) DO UPDATE SET col = expr, col = expr ...`.
 *
 * Analyzer call sites: `traverse.ts:2031-2058`. Notable: the analyzer uses
 * `ASSIGN_list().length` to count the SET assignments, then calls
 * `column_name(index)` + `expr(index)` to pair columns with their assigned
 * expressions. This is ANTLR's positional-access pattern.
 */
export interface Upsert_clauseContext extends ParseNode {
	ASSIGN_list(): TerminalNode[];
	column_name(i: number): Column_nameContext;
	expr(i: number): ExprContext;
}

// -----------------------------------------------------------------------------
// UPDATE
// -----------------------------------------------------------------------------

/**
 * `UPDATE [OR ...] table SET col = expr, ... [WHERE ...] [RETURNING ...]`.
 *
 * Analyzer call sites: `traverse.ts:2099-2151`. Uses the same ASSIGN_list +
 * positional-accessor pattern as upsert.
 *
 * Key sublety: `update_stmt.WHERE_()` returns a terminal with `.symbol.start`.
 * The analyzer uses that byte offset to split assigned-expr parameters from
 * where-clause parameters (see `traverse.ts:2119`).
 */
export interface Update_stmtContext extends ParseNode {
	qualified_table_name(): Qualified_table_nameContext;
	ASSIGN_list(): TerminalNode[];
	column_name(i: number): Column_nameContext;
	expr_list(): ExprContext[];
	WHERE_(): TerminalNode | null;
	returning_clause(): Returning_clauseContext | null;
}

/**
 * Table target for UPDATE / DELETE (`table` or `schema.table [AS alias]`).
 * Analyzer call sites: `traverse.ts:2100,2155` — both call `.getText()` and
 * pass it through `splitName()`.
 */
export interface Qualified_table_nameContext extends ParseNode {
	// analyzer only calls getText() on this, so no further structure needed
	// from the analyzer's perspective. We keep it as a named interface so the
	// new parser produces a node with the correct `.getText()` semantic.
}

// -----------------------------------------------------------------------------
// DELETE
// -----------------------------------------------------------------------------

/**
 * `DELETE FROM table [WHERE ...] [RETURNING ...]`. The `expr()` call is the
 * WHERE expression (may be null — sqlfu guards this; see
 * `src/vendor/typesql/CLAUDE.md`).
 *
 * Analyzer call sites: `traverse.ts:2154-2178`.
 */
export interface Delete_stmtContext extends ParseNode {
	qualified_table_name(): Qualified_table_nameContext;
	expr(): ExprContext | null;
	returning_clause(): Returning_clauseContext | null;
}

// -----------------------------------------------------------------------------
// RETURNING
// -----------------------------------------------------------------------------

/**
 * `RETURNING result_column, ...`. Structurally identical to the SELECT
 * result-column list.
 *
 * Analyzer call sites: `traverse.ts:2073-2097`.
 */
export interface Returning_clauseContext extends ParseNode {
	result_column_list(): Result_columnContext[];
}

// -----------------------------------------------------------------------------
// CREATE TABLE (used only for enum-parser)
// -----------------------------------------------------------------------------

/**
 * `CREATE TABLE` — consumed only by `enum-parser.ts` to find
 * `CHECK (col IN ('a', 'b', 'c'))` constraints that we model as enums.
 *
 * Analyzer call sites: `enum-parser.ts:9,19-29`.
 */
export interface Create_table_stmtContext extends ParseNode {
	table_name(): Table_nameContext;
	column_def_list(): Column_defContext[];
}

/**
 * A single column definition inside CREATE TABLE. Analyzer only uses the
 * column name and any CHECK constraints.
 *
 * Analyzer call sites: `enum-parser.ts:22-27,33-40`.
 */
export interface Column_defContext extends ParseNode {
	column_name(): Column_nameContext;
	column_constraint_list(): Column_constraintContext[];
}

/**
 * A single column-level constraint. Only CHECK constraints are read.
 *
 * Analyzer call sites: `enum-parser.ts:34-37`.
 */
export interface Column_constraintContext extends ParseNode {
	CHECK_(): TerminalNode | null;
	expr(): ExprContext | null;
}

// -----------------------------------------------------------------------------
// Leaf identifier nodes
// -----------------------------------------------------------------------------

/**
 * `column_name` — an identifier. Analyzer only calls `.getText()` on it (and
 * passes through `removeDoubleQuotes` / `splitName`).
 *
 * Analyzer call sites: ubiquitous — `traverse.ts:87,236,1770,1985,2037,2104`
 * plus others.
 */
export interface Column_nameContext extends ParseNode {
	// analyzer-visible surface is just getText() from ParseNode.
}

/**
 * `table_name` — an identifier. Analyzer only calls `.getText()` + one call
 * to `.any_name().getText()` (`traverse.ts:410`). The `any_name` layer is an
 * ANTLR grammar quirk; we expose it so the swap is mechanical, then can
 * simplify later.
 */
export interface Table_nameContext extends ParseNode {
	any_name(): Any_nameContext;
}

/**
 * `schema_name` — identifier, getText() only.
 */
export interface Schema_nameContext extends ParseNode {
	// getText() only.
}

/**
 * `table_alias` — identifier, getText() only.
 *
 * Analyzer call sites: `traverse.ts:390,408,409`.
 */
export interface Table_aliasContext extends ParseNode {
	// getText() only.
}

/**
 * `column_alias` — identifier, getText() only.
 *
 * Analyzer call sites: `traverse.ts:260`.
 */
export interface Column_aliasContext extends ParseNode {
	// getText() only. Caller strips optional wrapping quotes.
}

/**
 * `function_name` — identifier, getText().toLowerCase() for dispatch.
 *
 * Analyzer call sites: `traverse.ts:534,655,1909`.
 */
export interface Function_nameContext extends ParseNode {
	// getText() only.
}

/**
 * `table_function_name` — identifier, getText() only.
 *
 * Analyzer call sites: `traverse.ts:388-389`.
 */
export interface Table_function_nameContext extends ParseNode {
	// getText() only.
}

/**
 * `any_name` — an ANTLR grammar indirection for "any identifier-looking
 * thing (ident, keyword-as-ident, quoted string, parenthesised any_name)".
 * Analyzer calls `.getText()` once (`traverse.ts:410`).
 */
export interface Any_nameContext extends ParseNode {
	// getText() only.
}

// -----------------------------------------------------------------------------
// Summary: 24 node types, ~16 marked as getText-only.
// -----------------------------------------------------------------------------
//
// The node types actively discriminated-against by the analyzer (i.e. where
// the hand-rolled parser needs to produce structurally-rich output) are:
//
// 1. Sql_stmtContext        — 4-way statement discriminator
// 2. Select_stmtContext     — with, cores[], compound ops, order-by, limit
// 3. Select_coreContext     — result cols, from, join, where/groupby/having
// 4. Result_columnContext   — star / table.star / expr+alias
// 5. Table_or_subqueryContext — 4-way from-target discriminator
// 6. Join_clauseContext     — parallel lists of t_or_sq + operator + constraint
// 7. Join_operatorContext   — only LEFT_() consumed
// 8. Join_constraintContext — ON expr / USING cols
// 9. Common_table_stmtContext — RECURSIVE_ + CTE list
// 10. Common_table_expressionContext — name, col aliases, body
// 11. Order_by_stmtContext  — ordering_term list
// 12. Ordering_termContext  — expr
// 13. Limit_stmtContext     — 1-or-2 expr list
// 14. ExprContext           — the mega-node; ~40 accessors
// 15. Literal_valueContext  — 5-way literal discriminator
// 16. Unary_operatorContext — presence-only
// 17. Insert_stmtContext    — 5-field discriminator
// 18. Values_clauseContext  — row list
// 19. Value_rowContext      — expr list
// 20. Upsert_clauseContext  — parallel ASSIGN / column / expr lists
// 21. Update_stmtContext    — parallel ASSIGN / column / expr lists + WHERE
// 22. Delete_stmtContext    — table / where / returning
// 23. Returning_clauseContext — result_column list
// 24. Create_table_stmtContext + Column_defContext + Column_constraintContext
//     — enum-detection only
//
// Identifier-ish leaves (getText-only): Column_name, Table_name (+any_name),
// Schema_name, Table_alias, Column_alias, Function_name, Table_function_name,
// Qualified_table_name.
