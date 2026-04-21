// Tests for the hand-rolled shim layer (see
// `src/vendor/typesql/sqlite-query-analyzer/antlr-shim.ts`).
//
// These assert that shim instances:
//   1. Pass `instanceof` checks against the shim identity base classes
//      (`ShimParserRuleContext`, `ShimExprContextBase`, `ShimSelect_coreContextBase`).
//      These are the identities the analyzer actually checks for — see
//      `shared-analyzer/select-columns.ts:collectExpr` and the two
//      `instanceof ExprContext` guards in `traverse.ts`.
//   2. Expose the accessor methods the analyzer calls, with the same semantics
//      (presence checks, sub-node types, terminal offsets).

import {test, expect} from 'vitest';
// The shim lives under `src/vendor/typesql/` which is excluded from the strict
// `tsconfig.typecheck.json`. We import it via a non-literal URL specifier so
// TypeScript doesn't descend into the vendored typesql tree (which has
// upstream loose types). See `packages/sqlfu/CLAUDE.md` for background.
const shimModSpec = new URL('../../src/vendor/typesql/sqlite-query-analyzer/antlr-shim.js', import.meta.url).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const shim: any = await import(shimModSpec);
const wrapSqlStmt = shim.wrapSqlStmt;
const shimParseResult = shim.shimParseResult;
const ShimParserRuleContext = shim.ShimParserRuleContext;
const ShimExprContextBase = shim.ShimExprContextBase;
const ShimSelect_coreContextBase = shim.ShimSelect_coreContextBase;
const ShimExprContext = shim.ShimExprContext;
const ShimSql_stmtContext = shim.ShimSql_stmtContext;
const ShimSelect_stmtContext = shim.ShimSelect_stmtContext;
const ShimSelect_coreContext = shim.ShimSelect_coreContext;

import {parseSelectStmt} from '../../src/vendor/sqlfu-sqlite-parser/select_stmt.js';
import {parseInsertStmt, parseUpdateStmt, parseDeleteStmt} from '../../src/vendor/sqlfu-sqlite-parser/dml_stmt.js';

// -----------------------------------------------------------------------------
// instanceof compatibility — the shim base classes carry the identity that
// analyzer code reads.
// -----------------------------------------------------------------------------

test('shim select statement is a ShimParserRuleContext + ShimSql_stmtContext', () => {
	const sql = 'select id from users';
	const parsed = parseSelectStmt(sql);
	const wrapped = wrapSqlStmt(sql, {kind: 'select', stmt: parsed});

	expect(wrapped).toBeInstanceOf(ShimSql_stmtContext);
	expect(wrapped).toBeInstanceOf(ShimParserRuleContext);

	const selectStmt = wrapped.select_stmt();
	expect(selectStmt).toBeInstanceOf(ShimSelect_stmtContext);
	expect(selectStmt).toBeInstanceOf(ShimParserRuleContext);
	expect(wrapped.insert_stmt()).toBeNull();
	expect(wrapped.update_stmt()).toBeNull();
	expect(wrapped.delete_stmt()).toBeNull();
});

test('shim nodes expose core parser surface (result_column, table, literal, expr)', () => {
	const sql = 'select id, name from users';
	const parsed = parseSelectStmt(sql);
	const wrapped = wrapSqlStmt(sql, {kind: 'select', stmt: parsed}).select_stmt();

	const cores = wrapped.select_core_list();
	expect(cores.length).toBe(1);
	expect(cores[0]).toBeInstanceOf(ShimSelect_coreContextBase);
	expect(cores[0]).toBeInstanceOf(ShimSelect_coreContext);

	const rcs = cores[0].result_column_list();
	expect(rcs).toHaveLength(2);
	expect(rcs[0]).toBeInstanceOf(ShimParserRuleContext);
	expect(rcs[0].STAR()).toBeNull();
	expect(rcs[0].expr()).toBeInstanceOf(ShimExprContextBase);
	expect(rcs[0].expr()).toBeInstanceOf(ShimExprContext);

	const tables = cores[0].table_or_subquery_list();
	expect(tables).toHaveLength(1);
	expect(tables[0]).toBeInstanceOf(ShimParserRuleContext);
	expect(tables[0].table_name()?.getText()).toBe('users');
});

test('getText returns exact source substring', () => {
	const sql = 'select id from users where id = 1';
	const parsed = parseSelectStmt(sql);
	const wrapped = wrapSqlStmt(sql, {kind: 'select', stmt: parsed}).select_stmt();

	expect(wrapped.getText()).toContain('select id from users where id = 1');
	const where = wrapped.select_core_list()[0]._whereExpr;
	expect(where).toBeDefined();
	expect(where!.getText()).toBe('id = 1');
});

test('extractOriginalSql-style offsets work via start/stop + getInputStream', () => {
	// This mirrors `extractOriginalSql` from traverse.ts.
	const sql = 'select name from users where id = 42';
	const parsed = parseSelectStmt(sql);
	const wrapped = wrapSqlStmt(sql, {kind: 'select', stmt: parsed}).select_stmt();
	const selectCore = wrapped.select_core_list()[0];
	const whereExpr = selectCore._whereExpr!;

	const startIndex = whereExpr.start.start;
	const stopIndex = whereExpr.stop?.stop || startIndex;
	const sliced = whereExpr.start.getInputStream()?.getText(startIndex, stopIndex);
	expect(sliced).toBe('id = 42');
});

// -----------------------------------------------------------------------------
// Analyzer-facing accessor surface on representative queries
// -----------------------------------------------------------------------------

test('shim SELECT exposes select_core_list + result_column_list + FROM_ presence', () => {
	const sql = 'select id, name from users where id > 1';
	const shimResult = wrapSqlStmt(sql, {kind: 'select', stmt: parseSelectStmt(sql)});
	const shimSel = shimResult.select_stmt()!;

	expect(shimSel.select_core_list().length).toBe(1);
	const rcs = shimSel.select_core_list()[0].result_column_list();
	expect(rcs.length).toBe(2);
	expect(shimSel.select_core_list()[0].FROM_()).not.toBeNull();
});

test('shim ExprContext exposes column_name + operator presence terminals', () => {
	const sql = 'select id from users where status = 1';
	const shim = wrapSqlStmt(sql, {kind: 'select', stmt: parseSelectStmt(sql)}).select_stmt()!;

	const shimWhere = shim.select_core_list()[0]._whereExpr;
	expect(shimWhere).toBeDefined();

	// ASSIGN() is truthy for `=`.
	expect(shimWhere!.ASSIGN()).not.toBeNull();

	// expr_list length.
	expect(shimWhere!.expr_list().length).toBe(2);

	// column_name on LHS.
	const shimLhs = shimWhere!.expr(0);
	expect(shimLhs.column_name()?.getText()).toBe('status');
});

test('shim IS NULL / IS NOT NULL presence checks', () => {
	const cases: Array<{sql: string; expectNot: boolean}> = [
		{sql: 'select id from users where name is null', expectNot: false},
		{sql: 'select id from users where name is not null', expectNot: false},
	];
	for (const c of cases) {
		const s = wrapSqlStmt(c.sql, {kind: 'select', stmt: parseSelectStmt(c.sql)}).select_stmt()!;
		const e = s.select_core_list()[0]._whereExpr!;
		// IS_() truthy in both the NULL and NOT NULL cases.
		expect(e.IS_()).not.toBeNull();
		// See the antlr-shim.ts note: the `IsNull` AST kind deliberately
		// leaves NOT_() null; `x IS NOT NULL` is treated like `x IS <null>`
		// to match what the analyzer reads.
		expect(!!e.NOT_()).toBe(c.expectNot);
	}
});

test('shim IN list matches the ANTLR expr_list[1].expr_list nesting shape', () => {
	// The enum-parser relies on this specific nested shape.
	const sql = "select id from users where status in ('a', 'b', 'c')";
	const shim = wrapSqlStmt(sql, {kind: 'select', stmt: parseSelectStmt(sql)}).select_stmt()!;
	const whereExpr = shim.select_core_list()[0]._whereExpr!;

	expect(whereExpr.IN_()).not.toBeNull();
	const outer = whereExpr.expr_list();
	expect(outer.length).toBe(2);
	const items = outer[1].expr_list();
	expect(items.length).toBe(3);
	for (const item of items) {
		expect(item.literal_value()?.STRING_LITERAL()).not.toBeNull();
	}
});

test('shim BETWEEN exposes BETWEEN_ terminal and three sub-exprs', () => {
	const sql = 'select id from users where age between 18 and 65';
	const shim = wrapSqlStmt(sql, {kind: 'select', stmt: parseSelectStmt(sql)}).select_stmt()!;
	const w = shim.select_core_list()[0]._whereExpr!;
	expect(w.BETWEEN_()).not.toBeNull();
	expect(w.expr_list().length).toBe(3);
});

test('shim function call exposes function_name and expr_list args', () => {
	const sql = 'select count(id) from users';
	const shim = wrapSqlStmt(sql, {kind: 'select', stmt: parseSelectStmt(sql)}).select_stmt()!;
	const rcExpr = shim.select_core_list()[0].result_column_list()[0].expr()!;
	expect(rcExpr.function_name()?.getText().toLowerCase()).toBe('count');
	expect(rcExpr.expr_list().length).toBe(1);
});

test('shim INSERT statement is a ShimParserRuleContext + exposes values_clause', () => {
	const sql = "insert into users (id, name) values (1, 'x')";
	const parsed = parseInsertStmt(sql);
	const wrapped = wrapSqlStmt(sql, {kind: 'insert', stmt: parsed});
	const insertStmt = wrapped.insert_stmt()!;
	expect(insertStmt).toBeInstanceOf(ShimParserRuleContext);
	expect(insertStmt.table_name().getText()).toBe('users');
	expect(insertStmt.column_name_list().length).toBe(2);
	const values = insertStmt.values_clause();
	expect(values).not.toBeNull();
	const rows = values!.value_row_list();
	expect(rows.length).toBe(1);
	expect(rows[0].expr_list().length).toBe(2);
});

test('shim UPDATE exposes WHERE_ terminal offset before WHERE-clause params', () => {
	// This mirrors traverse.ts's use: split params by position of WHERE.
	const sql = "update users set name = ? where id = ?";
	const parsed = parseUpdateStmt(sql);
	const wrapped = wrapSqlStmt(sql, {kind: 'update', stmt: parsed}).update_stmt()!;
	const whereTok = wrapped.WHERE_();
	expect(whereTok).not.toBeNull();
	expect(whereTok!.symbol.start).toBe(sql.indexOf('where'));
});

test('shim DELETE without WHERE has null expr (the guarded case)', () => {
	const sql = 'delete from users';
	const parsed = parseDeleteStmt(sql);
	const wrapped = wrapSqlStmt(sql, {kind: 'delete', stmt: parsed}).delete_stmt()!;
	expect(wrapped.expr()).toBeNull();
});

test('shim DELETE with WHERE exposes expr via .expr()', () => {
	const sql = 'delete from users where id = 1';
	const parsed = parseDeleteStmt(sql);
	const wrapped = wrapSqlStmt(sql, {kind: 'delete', stmt: parsed}).delete_stmt()!;
	const expr = wrapped.expr();
	expect(expr).not.toBeNull();
	expect(expr!.ASSIGN()).not.toBeNull();
});

// -----------------------------------------------------------------------------
// getChildCount / getChild — this is the tree walk `collectExpr` performs
// in `shared-analyzer/select-columns.ts`. We must still be able to recurse
// into rule-level children (ShimParserRuleContext) and collect all
// ExprContext-kind descendants.
// -----------------------------------------------------------------------------

test('shim select-core walk discovers ExprContext descendants via getChild', () => {
	const sql = 'select a, b from t where c = 1';
	const shim = wrapSqlStmt(sql, {kind: 'select', stmt: parseSelectStmt(sql)}).select_stmt()!;
	const core = shim.select_core_list()[0];
	expect(core.getChildCount()).toBeGreaterThan(0);
	const exprs: any[] = [];
	const walk = (n: any) => {
		if (n instanceof ShimExprContextBase) exprs.push(n);
		const count = typeof n.getChildCount === 'function' ? n.getChildCount() : 0;
		for (let i = 0; i < count; i++) {
			const c = n.getChild(i);
			if (c instanceof ShimParserRuleContext) walk(c);
		}
	};
	walk(core);
	// Expect at least: result_column `a`, `b`, where `c = 1`, + its LHS/RHS children.
	expect(exprs.length).toBeGreaterThanOrEqual(3);
});

// -----------------------------------------------------------------------------
// sql_stmt_list — used by the (now-deprecated) enum-parser surface. The
// shim still exposes it for symmetry with ANTLR's surface.
// -----------------------------------------------------------------------------

test('shimParseResult exposes sql_stmt_list.children', () => {
	const sql = 'select 1; select 2';
	const result = shimParseResult(sql, [
		{kind: 'select', stmt: parseSelectStmt('select 1')},
		{kind: 'select', stmt: parseSelectStmt('select 2')},
	]);
	const list = result.sql_stmt_list();
	expect(list.children).toHaveLength(2);
	for (const child of list.children) {
		expect(child).toBeInstanceOf(ShimSql_stmtContext);
		expect(child).toBeInstanceOf(ShimParserRuleContext);
	}
});
