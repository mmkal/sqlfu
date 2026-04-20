// sqlfu SQLite `select_stmt` parser — phases 2 and 2.5 of
// tasks/drop-antlr.md.
//
// This file holds the plain-data AST shapes and the recursive-descent parser
// for SELECT queries. It is additive: no analyzer file imports this yet.
// Phase 3 will wrap these AST nodes in an ANTLR-compatible shim so
// `sqlite-query-analyzer/` can consume them.
//
// ## What this covers
//
// SELECT:
// - simple / compound SELECT (UNION [ALL], INTERSECT, EXCEPT)
// - WITH [RECURSIVE] CTEs at the head of a SELECT
// - result columns: `*`, `tbl.*`, `expr [AS alias]`, bare alias
// - FROM:
//   - single table (with optional schema.table + alias)
//   - subquery `(select ...) [AS] alias`
//   - comma-joined list
//   - explicit JOIN (INNER / LEFT / RIGHT / FULL [OUTER] / CROSS / NATURAL)
//     with ON or USING constraint
// - WHERE / GROUP BY / HAVING / ORDER BY / LIMIT / OFFSET
//
// Expressions:
// - literals (numeric / string / null / true / false / blob)
// - bind parameters `?`, `?N`, `:name`, `@name`, `$name`
// - column refs: `col`, `tbl.col`, `schema.tbl.col`
// - function calls, including `DISTINCT`-arg aggregates and `*`-arg count(*)
// - unary operators: `-`, `+`, `~`, `NOT`
// - binary operators with SQLite precedence
// - `||` string concat
// - CAST(x AS type)
// - CASE (searched + simple), BETWEEN, IN (list + subquery), LIKE / GLOB /
//   REGEXP / MATCH, IS [NOT] / IS [NOT] DISTINCT FROM, IS NULL / NOT NULL /
//   ISNULL / NOTNULL, EXISTS (subquery)
// - parenthesized sub-expressions and scalar subqueries
// - COLLATE suffix
//
// ## What's out of scope for this file
//
// - INSERT / UPDATE / DELETE. Those live in `dml_stmt.ts` (next).
// - CREATE TABLE for enum detection. Lives in `ddl_stmt.ts` (later).
// - Window functions (`OVER (...)`). Exposed as `over_clause: null` on the
//   function-call AST node; the analyzer only presence-checks this.
//
// Error philosophy: throw `SqlParseError` with the current token's offset on
// any unexpected input. Prefer actionable messages over graceful recovery.

import {type Token, type TokenKind, tokenize} from './tokenizer.js';

// -----------------------------------------------------------------------------
// AST — plain data, no behavior
// -----------------------------------------------------------------------------

export interface ParsedSelectStmt {
	kind: 'Select_stmt';
	with_clause: ParsedWithClause | null;
	/** One select_core for a simple SELECT; more than one for compound. */
	select_cores: ParsedSelectCore[];
	/** One less entry than `select_cores` — the operator that joins
	 *  `select_cores[i]` to `select_cores[i+1]`. */
	compound_operators: ParsedCompoundOperator[];
	order_by: ParsedOrderBy | null;
	limit: ParsedLimit | null;
	start: number;
	stop: number;
}

export type ParsedCompoundOperator = 'UNION' | 'UNION ALL' | 'INTERSECT' | 'EXCEPT';

export interface ParsedWithClause {
	kind: 'With_clause';
	recursive: boolean;
	ctes: ParsedCTE[];
	start: number;
	stop: number;
}

export interface ParsedCTE {
	kind: 'CTE';
	name: string;
	/** Optional column aliases `(a, b, c)`. */
	columns: string[];
	select: ParsedSelectStmt;
	start: number;
	stop: number;
}

export interface ParsedSelectCore {
	kind: 'Select_core';
	distinct: boolean;
	/** Present in the ALL|DISTINCT optional slot; null when absent. Useful for
	 *  round-tripping but not semantically different from `distinct`. */
	result_columns: ParsedResultColumn[];
	from: ParsedFromClause | null;
	where: ParsedExpr | null;
	group_by: ParsedExpr[];
	having: ParsedExpr | null;
	start: number;
	stop: number;
}

export type ParsedResultColumn =
	| {kind: 'Star'; start: number; stop: number}
	| {kind: 'TableStar'; table: string; start: number; stop: number}
	| {kind: 'Expr'; expr: ParsedExpr; alias: string | null; start: number; stop: number};

// --- FROM ---

/** The FROM clause is either a single comma-separated list of items OR an
 *  explicit JOIN chain. The analyzer distinguishes these via
 *  `join_clause()` vs `table_or_subquery_list()`, so we model both shapes. */
export type ParsedFromClause =
	| {kind: 'TableList'; items: ParsedTableOrSubquery[]; start: number; stop: number}
	| {kind: 'JoinChain'; chain: ParsedJoinChain; start: number; stop: number};

export interface ParsedJoinChain {
	/** The leftmost from-target. */
	first: ParsedTableOrSubquery;
	/** Zero or more joins chained left-to-right. */
	joins: ParsedJoin[];
}

export interface ParsedJoin {
	operator: ParsedJoinOperator;
	target: ParsedTableOrSubquery;
	constraint: ParsedJoinConstraint | null;
}

export interface ParsedJoinOperator {
	/** A `,` (comma join) is modeled as a `CROSS` with `natural: false`. */
	kind: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' | 'CROSS';
	natural: boolean;
	outer: boolean;
	start: number;
	stop: number;
}

export type ParsedJoinConstraint =
	| {kind: 'On'; expr: ParsedExpr; start: number; stop: number}
	| {kind: 'Using'; columns: string[]; start: number; stop: number};

export type ParsedTableOrSubquery =
	| {
			kind: 'Table';
			schema: string | null;
			name: string;
			alias: string | null;
			as_keyword: boolean;
			start: number;
			stop: number;
	  }
	| {
			kind: 'Subquery';
			select: ParsedSelectStmt;
			alias: string | null;
			as_keyword: boolean;
			start: number;
			stop: number;
	  }
	| {
			kind: 'TableFunction';
			schema: string | null;
			name: string;
			args: ParsedExpr[];
			alias: string | null;
			as_keyword: boolean;
			start: number;
			stop: number;
	  }
	| {
			kind: 'NestedJoin';
			chain: ParsedJoinChain;
			start: number;
			stop: number;
	  };

// --- ORDER BY / LIMIT ---

export interface ParsedOrderBy {
	kind: 'Order_by';
	terms: ParsedOrderingTerm[];
	start: number;
	stop: number;
}

export interface ParsedOrderingTerm {
	expr: ParsedExpr;
	direction: 'ASC' | 'DESC' | null;
	nulls: 'FIRST' | 'LAST' | null;
	start: number;
	stop: number;
}

export interface ParsedLimit {
	kind: 'Limit';
	expr: ParsedExpr;
	/** Either via `LIMIT expr OFFSET expr` or `LIMIT expr, expr` (the second
	 *  form stores the offset in `offset` — SQLite treats `LIMIT a, b` as
	 *  `LIMIT b OFFSET a`, but we preserve the surface order for round-trip
	 *  and let the analyzer normalize). */
	offset: ParsedExpr | null;
	/** True when the surface form was `LIMIT offset, count`. Analyzer doesn't
	 *  need this; we keep it so `extractOriginalSql` stays faithful. */
	legacy_comma_form: boolean;
	start: number;
	stop: number;
}

// --- expressions ---

export type ParsedExpr =
	| {kind: 'ColumnRef'; schema: string | null; table: string | null; column: string; start: number; stop: number}
	| {kind: 'NumericLiteral'; value: string; start: number; stop: number}
	| {kind: 'StringLiteral'; value: string; start: number; stop: number}
	| {kind: 'BlobLiteral'; value: string; start: number; stop: number}
	| {kind: 'Null'; start: number; stop: number}
	| {kind: 'BoolLiteral'; value: boolean; start: number; stop: number}
	| {kind: 'BindParameter'; marker: string; start: number; stop: number}
	| {kind: 'Unary'; op: '-' | '+' | '~' | 'NOT'; operand: ParsedExpr; start: number; stop: number}
	| {
			kind: 'Binary';
			op: ParsedBinaryOp;
			left: ParsedExpr;
			right: ParsedExpr;
			start: number;
			stop: number;
	  }
	| {
			kind: 'FunctionCall';
			/** Lower-cased by convention to ease dispatch. */
			name: string;
			distinct: boolean;
			star: boolean;
			args: ParsedExpr[];
			filter_where: ParsedExpr | null;
			/** Analyzer only presence-checks this. null means "no OVER clause". */
			over_clause: null | {kind: 'OverClause'};
			start: number;
			stop: number;
	  }
	| {
			kind: 'Cast';
			expr: ParsedExpr;
			type_name: string;
			start: number;
			stop: number;
	  }
	| {
			kind: 'Case';
			/** null for "searched CASE" (no operand). */
			operand: ParsedExpr | null;
			when_clauses: {when: ParsedExpr; then: ParsedExpr}[];
			else_clause: ParsedExpr | null;
			start: number;
			stop: number;
	  }
	| {
			kind: 'Between';
			negated: boolean;
			expr: ParsedExpr;
			low: ParsedExpr;
			high: ParsedExpr;
			start: number;
			stop: number;
	  }
	| {
			kind: 'InList';
			negated: boolean;
			expr: ParsedExpr;
			items: ParsedExpr[];
			start: number;
			stop: number;
	  }
	| {
			kind: 'InSubquery';
			negated: boolean;
			expr: ParsedExpr;
			select: ParsedSelectStmt;
			start: number;
			stop: number;
	  }
	| {
			kind: 'InTable';
			negated: boolean;
			expr: ParsedExpr;
			schema: string | null;
			table: string;
			start: number;
			stop: number;
	  }
	| {
			kind: 'Like';
			op: 'LIKE' | 'GLOB' | 'REGEXP' | 'MATCH';
			negated: boolean;
			expr: ParsedExpr;
			pattern: ParsedExpr;
			escape: ParsedExpr | null;
			start: number;
			stop: number;
	  }
	| {
			kind: 'IsNull';
			negated: boolean;
			operand: ParsedExpr;
			start: number;
			stop: number;
	  }
	| {
			kind: 'Is';
			/** IS NOT → negated = true. `IS NOT DISTINCT FROM` → distinct_from = true,
			 *  `IS DISTINCT FROM` → negated = true, distinct_from = true. */
			negated: boolean;
			distinct_from: boolean;
			left: ParsedExpr;
			right: ParsedExpr;
			start: number;
			stop: number;
	  }
	| {
			kind: 'Exists';
			negated: boolean;
			select: ParsedSelectStmt;
			start: number;
			stop: number;
	  }
	| {
			kind: 'Subquery';
			select: ParsedSelectStmt;
			start: number;
			stop: number;
	  }
	| {
			kind: 'Paren';
			exprs: ParsedExpr[];
			start: number;
			stop: number;
	  }
	| {
			kind: 'Collate';
			expr: ParsedExpr;
			collation: string;
			start: number;
			stop: number;
	  };

export type ParsedBinaryOp =
	| '||'
	| '*'
	| '/'
	| '%'
	| '+'
	| '-'
	| '<<'
	| '>>'
	| '&'
	| '|'
	| '<'
	| '<='
	| '>'
	| '>='
	| '='
	| '=='
	| '!='
	| '<>'
	| 'AND'
	| 'OR';

// -----------------------------------------------------------------------------
// Entry point + error type
// -----------------------------------------------------------------------------

export class SqlParseError extends Error {
	constructor(message: string, public readonly offset: number) {
		super(message);
		this.name = 'SqlParseError';
	}
}

export function parseSelectStmt(sql: string): ParsedSelectStmt {
	const tokens = tokenize(sql);
	const p = new Parser(tokens, sql);
	const stmt = p.parseFullSelect();
	p.expectEnd();
	return stmt;
}

/** Exposed for the DML parser (coming next) — it needs to invoke a select
 *  parser without consuming a trailing SEMI or asserting end-of-input. */
export function parseSelectFrom(tokens: Token[], sql: string, startIndex: number): {stmt: ParsedSelectStmt; nextIndex: number} {
	const p = new Parser(tokens, sql);
	p.seek(startIndex);
	const stmt = p.parseSelect();
	return {stmt, nextIndex: p.position()};
}

/** Exposed for the DML parser — parse a single expression (at full precedence)
 *  starting at `startIndex` in the shared token stream, returning the
 *  resulting expression and the new cursor position. */
export function parseExprFromCursor(tokens: Token[], sql: string, startIndex: number): {expr: ParsedExpr; nextIndex: number} {
	const p = new Parser(tokens, sql);
	p.seek(startIndex);
	const expr = p.parseExpr();
	return {expr, nextIndex: p.position()};
}

// -----------------------------------------------------------------------------
// Parser
// -----------------------------------------------------------------------------

class Parser {
	private index = 0;

	constructor(private readonly tokens: Token[], private readonly sql: string) {}

	// --- public driver ---

	parseFullSelect(): ParsedSelectStmt {
		const stmt = this.parseSelect();
		// Trailing optional SEMI — consume but don't require.
		this.matchKind('SEMI');
		return stmt;
	}

	/** Full SELECT: optional WITH, one or more cores, optional ORDER BY / LIMIT. */
	parseSelect(): ParsedSelectStmt {
		let with_clause: ParsedWithClause | null = null;
		if (this.checkKeyword('WITH')) {
			with_clause = this.parseWithClause();
		}

		const first_core = this.parseSelectCore();
		const cores: ParsedSelectCore[] = [first_core];
		const ops: ParsedCompoundOperator[] = [];
		while (this.peekCompoundOp()) {
			ops.push(this.consumeCompoundOp());
			cores.push(this.parseSelectCore());
		}

		let order_by: ParsedOrderBy | null = null;
		if (this.checkKeyword('ORDER')) {
			order_by = this.parseOrderBy();
		}

		let limit: ParsedLimit | null = null;
		if (this.checkKeyword('LIMIT')) {
			limit = this.parseLimit();
		}

		const start = with_clause ? with_clause.start : cores[0].start;
		const stop = limit
			? limit.stop
			: order_by
			? order_by.stop
			: cores[cores.length - 1].stop;
		return {
			kind: 'Select_stmt',
			with_clause,
			select_cores: cores,
			compound_operators: ops,
			order_by,
			limit,
			start,
			stop,
		};
	}

	parseWithClause(): ParsedWithClause {
		const withTok = this.expectKeyword('WITH');
		const recursive = this.matchKeyword('RECURSIVE');
		const ctes: ParsedCTE[] = [this.parseCTE()];
		while (this.matchKind('COMMA')) {
			ctes.push(this.parseCTE());
		}
		return {
			kind: 'With_clause',
			recursive,
			ctes,
			start: withTok.start,
			stop: ctes[ctes.length - 1].stop,
		};
	}

	parseCTE(): ParsedCTE {
		const nameTok = this.expectKind('IDENTIFIER', 'CTE name');
		const name = unquoteIdent(nameTok.value);
		const columns: string[] = [];
		if (this.matchKind('OPEN_PAR')) {
			columns.push(unquoteIdent(this.expectKind('IDENTIFIER', 'CTE column name').value));
			while (this.matchKind('COMMA')) {
				columns.push(unquoteIdent(this.expectKind('IDENTIFIER', 'CTE column name').value));
			}
			this.expectKind('CLOSE_PAR', `')' closing CTE column list`);
		}
		this.expectKeyword('AS');
		this.expectKind('OPEN_PAR', `'(' before CTE SELECT`);
		const select = this.parseSelect();
		const closePar = this.expectKind('CLOSE_PAR', `')' after CTE SELECT`);
		return {
			kind: 'CTE',
			name,
			columns,
			select,
			start: nameTok.start,
			stop: closePar.stop,
		};
	}

	peekCompoundOp(): boolean {
		if (this.checkKeyword('UNION') || this.checkKeyword('INTERSECT') || this.checkKeyword('EXCEPT')) return true;
		return false;
	}

	consumeCompoundOp(): ParsedCompoundOperator {
		if (this.matchKeyword('UNION')) {
			if (this.matchKeyword('ALL')) return 'UNION ALL';
			return 'UNION';
		}
		if (this.matchKeyword('INTERSECT')) return 'INTERSECT';
		if (this.matchKeyword('EXCEPT')) return 'EXCEPT';
		const tok = this.peek();
		throw new SqlParseError(
			`expected compound operator (UNION / INTERSECT / EXCEPT) but got ${describeToken(tok)}`,
			tok ? tok.start : this.sql.length
		);
	}

	parseSelectCore(): ParsedSelectCore {
		// SELECT can be bracketed by a VALUES form too, but we don't support that
		// yet (no fixture uses it at the analyzer level).
		const selectTok = this.expectKeyword('SELECT');
		let distinct = false;
		if (this.matchKeyword('DISTINCT')) {
			distinct = true;
		} else {
			this.matchKeyword('ALL'); // the explicit "ALL" is semantically a no-op
		}
		const result_columns: ParsedResultColumn[] = [this.parseResultColumn()];
		while (this.matchKind('COMMA')) {
			result_columns.push(this.parseResultColumn());
		}

		let from: ParsedFromClause | null = null;
		let where: ParsedExpr | null = null;
		let group_by: ParsedExpr[] = [];
		let having: ParsedExpr | null = null;
		let endOffset = result_columns[result_columns.length - 1].stop;

		if (this.matchKeyword('FROM')) {
			from = this.parseFromClause();
			endOffset = from.stop;
		}
		if (this.matchKeyword('WHERE')) {
			where = this.parseExpr();
			endOffset = where.stop;
		}
		if (this.matchKeyword('GROUP')) {
			this.expectKeyword('BY');
			group_by.push(this.parseExpr());
			while (this.matchKind('COMMA')) {
				group_by.push(this.parseExpr());
			}
			endOffset = group_by[group_by.length - 1].stop;
			if (this.matchKeyword('HAVING')) {
				having = this.parseExpr();
				endOffset = having.stop;
			}
		}

		return {
			kind: 'Select_core',
			distinct,
			result_columns,
			from,
			where,
			group_by,
			having,
			start: selectTok.start,
			stop: endOffset,
		};
	}

	parseResultColumn(): ParsedResultColumn {
		// bare `*`
		if (this.checkKind('STAR')) {
			const tok = this.advance();
			return {kind: 'Star', start: tok.start, stop: tok.stop};
		}

		// `table.*` — needs IDENTIFIER . STAR lookahead (may also be schema.tbl.*
		// but the analyzer doesn't distinguish; we accept and stash the final
		// identifier as `table`).
		if (this.checkKind('IDENTIFIER') && this.checkKindAt(1, 'DOT') && this.checkKindAt(2, 'STAR')) {
			const ident = this.advance();
			this.advance(); // DOT
			const star = this.advance();
			return {kind: 'TableStar', table: unquoteIdent(ident.value), start: ident.start, stop: star.stop};
		}

		const expr = this.parseExpr();
		let alias: string | null = null;
		let stop = expr.stop;
		if (this.matchKeyword('AS')) {
			const aliasTok = this.expectAlias('column alias');
			alias = unquoteStringyAlias(aliasTok);
			stop = aliasTok.stop;
		} else if (this.checkKind('IDENTIFIER') && this.identIsResultAlias()) {
			const aliasTok = this.advance();
			alias = unquoteIdent(aliasTok.value);
			stop = aliasTok.stop;
		}
		return {kind: 'Expr', expr, alias, start: expr.start, stop};
	}

	/** Accept an alias after AS, which SQLite grammar allows to be either an
	 *  identifier or a string literal (`AS 'label'`). */
	expectAlias(label: string): Token {
		const tok = this.peek();
		if (tok && (tok.kind === 'IDENTIFIER' || tok.kind === 'STRING_LITERAL')) {
			return this.advance();
		}
		throw new SqlParseError(
			`expected ${label} but got ${describeToken(tok)}`,
			tok ? tok.start : this.sql.length
		);
	}

	/** Decide whether a bare IDENTIFIER after an expression in a result-column
	 *  slot is an alias (as opposed to the start of the next clause, which
	 *  can't happen for identifier tokens, or the start of a FROM-item, which
	 *  does matter).
	 *
	 *  Rule: it's an alias if the token *after* it is COMMA, SEMI, end-of-
	 *  input, CLOSE_PAR, or a top-level select continuation keyword. */
	identIsResultAlias(): boolean {
		const after = this.peekAt(1);
		if (!after) return true;
		if (after.kind === 'COMMA' || after.kind === 'SEMI' || after.kind === 'CLOSE_PAR') return true;
		if (after.kind === 'KEYWORD') {
			return SELECT_TAIL_KEYWORDS.has(after.value);
		}
		return false;
	}

	// --- FROM / JOINS ---

	parseFromClause(): ParsedFromClause {
		const first = this.parseTableOrSubquery();

		// Explicit JOIN path?
		if (this.peekJoinOperator()) {
			const chain: ParsedJoinChain = {first, joins: []};
			while (this.peekJoinOperator()) {
				const op = this.consumeJoinOperator();
				const target = this.parseTableOrSubquery();
				const constraint = this.parseJoinConstraint(op);
				chain.joins.push({operator: op, target, constraint});
			}
			const last = chain.joins[chain.joins.length - 1];
			const stop = last.constraint ? last.constraint.stop : last.target.stop;
			return {kind: 'JoinChain', chain, start: first.start, stop};
		}

		// Comma-joined list path. A single table is just a one-element list.
		const items: ParsedTableOrSubquery[] = [first];
		while (this.matchKind('COMMA')) {
			items.push(this.parseTableOrSubquery());
		}
		return {
			kind: 'TableList',
			items,
			start: first.start,
			stop: items[items.length - 1].stop,
		};
	}

	peekJoinOperator(): boolean {
		const t = this.peek();
		if (!t || t.kind !== 'KEYWORD') return false;
		return (
			t.value === 'JOIN' ||
			t.value === 'INNER' ||
			t.value === 'CROSS' ||
			t.value === 'LEFT' ||
			t.value === 'RIGHT' ||
			t.value === 'FULL' ||
			t.value === 'NATURAL'
		);
	}

	consumeJoinOperator(): ParsedJoinOperator {
		const startTok = this.peek()!;
		let natural = false;
		let kind: ParsedJoinOperator['kind'] = 'INNER';
		let outer = false;

		if (this.matchKeyword('NATURAL')) {
			natural = true;
		}

		if (this.matchKeyword('LEFT')) {
			kind = 'LEFT';
			if (this.matchKeyword('OUTER')) outer = true;
		} else if (this.matchKeyword('RIGHT')) {
			kind = 'RIGHT';
			if (this.matchKeyword('OUTER')) outer = true;
		} else if (this.matchKeyword('FULL')) {
			kind = 'FULL';
			if (this.matchKeyword('OUTER')) outer = true;
		} else if (this.matchKeyword('INNER')) {
			kind = 'INNER';
		} else if (this.matchKeyword('CROSS')) {
			kind = 'CROSS';
		}

		const joinTok = this.expectKeyword('JOIN');
		return {kind, natural, outer, start: startTok.start, stop: joinTok.stop};
	}

	parseJoinConstraint(op: ParsedJoinOperator): ParsedJoinConstraint | null {
		// NATURAL joins forbid ON/USING.
		if (op.natural) return null;
		// CROSS joins also don't take a constraint.
		if (op.kind === 'CROSS') return null;

		if (this.matchKeyword('ON')) {
			const tok = this.previous();
			const expr = this.parseExpr();
			return {kind: 'On', expr, start: tok.start, stop: expr.stop};
		}
		if (this.matchKeyword('USING')) {
			const tok = this.previous();
			this.expectKind('OPEN_PAR', `'(' after USING`);
			const columns: string[] = [unquoteIdent(this.expectKind('IDENTIFIER', 'column name').value)];
			while (this.matchKind('COMMA')) {
				columns.push(unquoteIdent(this.expectKind('IDENTIFIER', 'column name').value));
			}
			const closePar = this.expectKind('CLOSE_PAR', `')' closing USING list`);
			return {kind: 'Using', columns, start: tok.start, stop: closePar.stop};
		}
		return null;
	}

	parseTableOrSubquery(): ParsedTableOrSubquery {
		const first = this.peek();
		// (select ...) or (nested join).
		if (first && first.kind === 'OPEN_PAR') {
			return this.parseParenFromItem();
		}

		// schema.table / table [args?] [alias].
		const nameTok = this.expectKind('IDENTIFIER', 'table or schema name');
		let schema: string | null = null;
		let name = unquoteIdent(nameTok.value);
		let start = nameTok.start;
		let stop = nameTok.stop;

		if (this.matchKind('DOT')) {
			const second = this.expectKind('IDENTIFIER', 'table name after schema.');
			schema = name;
			name = unquoteIdent(second.value);
			stop = second.stop;
		}

		// Table-valued function: `name(arg, arg)`.
		if (this.checkKind('OPEN_PAR')) {
			this.advance(); // consume (
			const args: ParsedExpr[] = [];
			if (!this.checkKind('CLOSE_PAR')) {
				args.push(this.parseExpr());
				while (this.matchKind('COMMA')) args.push(this.parseExpr());
			}
			const close = this.expectKind('CLOSE_PAR', `')' closing table-function arguments`);
			stop = close.stop;
			const alias = this.parseOptionalTableAlias();
			return {
				kind: 'TableFunction',
				schema,
				name,
				args,
				alias: alias ? alias.name : null,
				as_keyword: alias ? alias.as_keyword : false,
				start,
				stop: alias ? alias.stop : stop,
			};
		}

		const alias = this.parseOptionalTableAlias();
		return {
			kind: 'Table',
			schema,
			name,
			alias: alias ? alias.name : null,
			as_keyword: alias ? alias.as_keyword : false,
			start,
			stop: alias ? alias.stop : stop,
		};
	}

	parseParenFromItem(): ParsedTableOrSubquery {
		const openTok = this.expectKind('OPEN_PAR', `'('`);
		// Disambiguate: if the next token is SELECT or WITH, it's a subquery.
		// Otherwise it's a parenthesized join chain.
		if (this.checkKeyword('SELECT') || this.checkKeyword('WITH')) {
			const select = this.parseSelect();
			const close = this.expectKind('CLOSE_PAR', `')' closing subquery`);
			const alias = this.parseOptionalTableAlias();
			return {
				kind: 'Subquery',
				select,
				alias: alias ? alias.name : null,
				as_keyword: alias ? alias.as_keyword : false,
				start: openTok.start,
				stop: alias ? alias.stop : close.stop,
			};
		}
		// Nested join form.
		const first = this.parseTableOrSubquery();
		const chain: ParsedJoinChain = {first, joins: []};
		while (this.peekJoinOperator()) {
			const op = this.consumeJoinOperator();
			const target = this.parseTableOrSubquery();
			const constraint = this.parseJoinConstraint(op);
			chain.joins.push({operator: op, target, constraint});
		}
		const close = this.expectKind('CLOSE_PAR', `')' closing nested join`);
		return {
			kind: 'NestedJoin',
			chain,
			start: openTok.start,
			stop: close.stop,
		};
	}

	parseOptionalTableAlias(): {name: string; as_keyword: boolean; stop: number} | null {
		if (this.matchKeyword('AS')) {
			const tok = this.expectKind('IDENTIFIER', 'table alias');
			return {name: unquoteIdent(tok.value), as_keyword: true, stop: tok.stop};
		}
		// Bare alias without AS; careful not to eat a join keyword or another
		// clause starter.
		if (this.checkKind('IDENTIFIER')) {
			// Don't mistake the next table in a comma-separated FROM list's
			// identifier for an alias — that's disambiguated by context elsewhere
			// (comma eating happens in the caller).
			const tok = this.advance();
			return {name: unquoteIdent(tok.value), as_keyword: false, stop: tok.stop};
		}
		return null;
	}

	// --- ORDER BY / LIMIT ---

	parseOrderBy(): ParsedOrderBy {
		const orderTok = this.expectKeyword('ORDER');
		this.expectKeyword('BY');
		const terms: ParsedOrderingTerm[] = [this.parseOrderingTerm()];
		while (this.matchKind('COMMA')) {
			terms.push(this.parseOrderingTerm());
		}
		return {
			kind: 'Order_by',
			terms,
			start: orderTok.start,
			stop: terms[terms.length - 1].stop,
		};
	}

	parseOrderingTerm(): ParsedOrderingTerm {
		const expr = this.parseExpr();
		let direction: ParsedOrderingTerm['direction'] = null;
		let nulls: ParsedOrderingTerm['nulls'] = null;
		let stop = expr.stop;
		if (this.matchKeyword('ASC')) {
			direction = 'ASC';
			stop = this.previous().stop;
		} else if (this.matchKeyword('DESC')) {
			direction = 'DESC';
			stop = this.previous().stop;
		}
		if (this.matchKeyword('NULLS')) {
			if (this.matchKeyword('FIRST')) nulls = 'FIRST';
			else if (this.matchKeyword('LAST')) nulls = 'LAST';
			else {
				const tok = this.peek();
				throw new SqlParseError(
					`expected FIRST or LAST after NULLS but got ${describeToken(tok)}`,
					tok ? tok.start : this.sql.length
				);
			}
			stop = this.previous().stop;
		}
		return {expr, direction, nulls, start: expr.start, stop};
	}

	parseLimit(): ParsedLimit {
		const limitTok = this.expectKeyword('LIMIT');
		const expr = this.parseExpr();
		let offset: ParsedExpr | null = null;
		let legacy_comma_form = false;
		let stop = expr.stop;
		if (this.matchKeyword('OFFSET')) {
			offset = this.parseExpr();
			stop = offset.stop;
		} else if (this.matchKind('COMMA')) {
			offset = this.parseExpr();
			legacy_comma_form = true;
			stop = offset.stop;
		}
		return {kind: 'Limit', expr, offset, legacy_comma_form, start: limitTok.start, stop};
	}

	// -------------------------------------------------------------------------
	// Expressions — precedence-climbing recursive descent.
	//
	// SQLite precedence (low to high), per https://sqlite.org/lang_expr.html:
	//   OR
	//   AND
	//   NOT (unary)
	//   = == != <> IS IS-NOT IS-DISTINCT-FROM IN NOT-IN LIKE GLOB MATCH
	//       REGEXP ISNULL NOTNULL IS-NULL NOT-NULL BETWEEN EXISTS
	//   < <= > >=
	//   & | << >>
	//   + -
	//   * / %
	//   ||
	//   unary +/- ~
	//   COLLATE
	//
	// We merge some adjacent levels where that doesn't affect the resulting
	// tree for any input we need to parse (e.g. `||` is at the highest binary
	// level but it's effectively left-associative same as `*`; we group them
	// for clarity).
	// -------------------------------------------------------------------------

	parseExpr(): ParsedExpr {
		return this.parseOr();
	}

	parseOr(): ParsedExpr {
		let left = this.parseAnd();
		while (this.matchKeyword('OR')) {
			const right = this.parseAnd();
			left = {kind: 'Binary', op: 'OR', left, right, start: left.start, stop: right.stop};
		}
		return left;
	}

	parseAnd(): ParsedExpr {
		let left = this.parseNot();
		while (this.matchKeyword('AND')) {
			const right = this.parseNot();
			left = {kind: 'Binary', op: 'AND', left, right, start: left.start, stop: right.stop};
		}
		return left;
	}

	parseNot(): ParsedExpr {
		if (this.checkKeyword('NOT')) {
			// Special-case `NOT EXISTS (...)` so it lands as a single Exists node
			// with negated=true rather than Unary(NOT, Exists(negated=false)).
			const after = this.peekAt(1);
			if (after && after.kind === 'KEYWORD' && after.value === 'EXISTS') {
				const notTok = this.advance();
				const exists = this.parseExists(true);
				return {...exists, start: notTok.start};
			}
			const tok = this.advance();
			const operand = this.parseNot();
			return {kind: 'Unary', op: 'NOT', operand, start: tok.start, stop: operand.stop};
		}
		return this.parseEquality();
	}

	parseEquality(): ParsedExpr {
		let left = this.parseComparison();
		// Equality-level ops AND the many keyword-prefixed trailing constructs
		// (IS, IN, NOT IN, LIKE, GLOB, MATCH, REGEXP, BETWEEN, ISNULL, NOTNULL).
		while (true) {
			const tok = this.peek();
			if (!tok) break;

			const op = EQUALITY_OPS[tok.kind];
			if (op) {
				this.advance();
				const right = this.parseComparison();
				left = {kind: 'Binary', op, left, right, start: left.start, stop: right.stop};
				continue;
			}

			if (tok.kind === 'KEYWORD') {
				if (tok.value === 'IS') {
					left = this.parseIsTail(left);
					continue;
				}
				if (tok.value === 'NOT') {
					// NOT IN / NOT LIKE / NOT GLOB / NOT MATCH / NOT REGEXP / NOT BETWEEN
					const next = this.peekAt(1);
					if (next && next.kind === 'KEYWORD') {
						if (next.value === 'IN') {
							this.advance();
							this.advance();
							left = this.parseInTail(left, true);
							continue;
						}
						if (next.value === 'LIKE' || next.value === 'GLOB' || next.value === 'MATCH' || next.value === 'REGEXP') {
							this.advance();
							this.advance();
							left = this.parseLikeTail(left, next.value, true);
							continue;
						}
						if (next.value === 'BETWEEN') {
							this.advance();
							this.advance();
							left = this.parseBetweenTail(left, true);
							continue;
						}
					}
					break;
				}
				if (tok.value === 'IN') {
					this.advance();
					left = this.parseInTail(left, false);
					continue;
				}
				if (tok.value === 'LIKE' || tok.value === 'GLOB' || tok.value === 'MATCH' || tok.value === 'REGEXP') {
					this.advance();
					left = this.parseLikeTail(left, tok.value, false);
					continue;
				}
				if (tok.value === 'BETWEEN') {
					this.advance();
					left = this.parseBetweenTail(left, false);
					continue;
				}
				if (tok.value === 'ISNULL') {
					this.advance();
					left = {kind: 'IsNull', negated: false, operand: left, start: left.start, stop: tok.stop};
					continue;
				}
				if (tok.value === 'NOTNULL') {
					this.advance();
					left = {kind: 'IsNull', negated: true, operand: left, start: left.start, stop: tok.stop};
					continue;
				}
			}
			break;
		}
		return left;
	}

	parseIsTail(left: ParsedExpr): ParsedExpr {
		const isTok = this.advance(); // IS
		let negated = false;
		if (this.matchKeyword('NOT')) negated = true;
		// IS [NOT] DISTINCT FROM
		if (this.matchKeyword('DISTINCT')) {
			this.expectKeyword('FROM');
			const right = this.parseComparison();
			return {
				kind: 'Is',
				negated,
				distinct_from: true,
				left,
				right,
				start: left.start,
				stop: right.stop,
			};
		}
		// IS [NOT] NULL → IsNull
		if (this.checkKeyword('NULL')) {
			const nullTok = this.advance();
			return {kind: 'IsNull', negated, operand: left, start: left.start, stop: nullTok.stop};
		}
		// General IS [NOT] <expr> (e.g. `IS TRUE`, `IS 0`). Treat as equality.
		const right = this.parseComparison();
		return {
			kind: 'Is',
			negated,
			distinct_from: false,
			left,
			right,
			start: left.start,
			stop: right.stop,
		};
	}

	parseInTail(left: ParsedExpr, negated: boolean): ParsedExpr {
		// Forms: IN (expr, ...), IN (select ...), IN table, IN schema.table
		if (this.matchKind('OPEN_PAR')) {
			// Empty list? IN () is technically valid SQLite syntax.
			if (this.checkKind('CLOSE_PAR')) {
				const close = this.advance();
				return {kind: 'InList', negated, expr: left, items: [], start: left.start, stop: close.stop};
			}
			if (this.checkKeyword('SELECT') || this.checkKeyword('WITH')) {
				const select = this.parseSelect();
				const close = this.expectKind('CLOSE_PAR', `')' closing IN (subquery)`);
				return {kind: 'InSubquery', negated, expr: left, select, start: left.start, stop: close.stop};
			}
			const items: ParsedExpr[] = [this.parseExpr()];
			while (this.matchKind('COMMA')) items.push(this.parseExpr());
			const close = this.expectKind('CLOSE_PAR', `')' closing IN (list)`);
			return {kind: 'InList', negated, expr: left, items, start: left.start, stop: close.stop};
		}
		// IN table or IN schema.table — bare identifier.
		const first = this.expectKind('IDENTIFIER', 'table name or `(` after IN');
		let schema: string | null = null;
		let name = unquoteIdent(first.value);
		let stop = first.stop;
		if (this.matchKind('DOT')) {
			const second = this.expectKind('IDENTIFIER', 'table name after schema.');
			schema = name;
			name = unquoteIdent(second.value);
			stop = second.stop;
		}
		return {kind: 'InTable', negated, expr: left, schema, table: name, start: left.start, stop};
	}

	parseLikeTail(left: ParsedExpr, kw: 'LIKE' | 'GLOB' | 'MATCH' | 'REGEXP', negated: boolean): ParsedExpr {
		const pattern = this.parseComparison();
		let escape: ParsedExpr | null = null;
		let stop = pattern.stop;
		if (this.matchKeyword('ESCAPE')) {
			escape = this.parseComparison();
			stop = escape.stop;
		}
		return {kind: 'Like', op: kw, negated, expr: left, pattern, escape, start: left.start, stop};
	}

	parseBetweenTail(left: ParsedExpr, negated: boolean): ParsedExpr {
		// Parse the low bound at the bit-op level so `BETWEEN a AND b` doesn't
		// eat the AND as a boolean.
		const low = this.parseBitOr();
		this.expectKeyword('AND');
		const high = this.parseBitOr();
		return {kind: 'Between', negated, expr: left, low, high, start: left.start, stop: high.stop};
	}

	parseComparison(): ParsedExpr {
		let left = this.parseBitOr();
		while (true) {
			const tok = this.peek();
			if (!tok) break;
			const op = COMPARISON_OPS[tok.kind];
			if (!op) break;
			this.advance();
			const right = this.parseBitOr();
			left = {kind: 'Binary', op, left, right, start: left.start, stop: right.stop};
		}
		return left;
	}

	parseBitOr(): ParsedExpr {
		let left = this.parseBitShift();
		while (true) {
			const tok = this.peek();
			if (!tok) break;
			if (tok.kind === 'AMP' || tok.kind === 'PIPE') {
				this.advance();
				const right = this.parseBitShift();
				left = {
					kind: 'Binary',
					op: tok.kind === 'AMP' ? '&' : '|',
					left,
					right,
					start: left.start,
					stop: right.stop,
				};
				continue;
			}
			break;
		}
		return left;
	}

	parseBitShift(): ParsedExpr {
		let left = this.parseAdditive();
		while (true) {
			const tok = this.peek();
			if (!tok) break;
			if (tok.kind === 'LT2' || tok.kind === 'GT2') {
				this.advance();
				const right = this.parseAdditive();
				left = {
					kind: 'Binary',
					op: tok.kind === 'LT2' ? '<<' : '>>',
					left,
					right,
					start: left.start,
					stop: right.stop,
				};
				continue;
			}
			break;
		}
		return left;
	}

	parseAdditive(): ParsedExpr {
		let left = this.parseMultiplicative();
		while (true) {
			const tok = this.peek();
			if (!tok) break;
			if (tok.kind === 'PLUS' || tok.kind === 'MINUS') {
				this.advance();
				const right = this.parseMultiplicative();
				left = {
					kind: 'Binary',
					op: tok.kind === 'PLUS' ? '+' : '-',
					left,
					right,
					start: left.start,
					stop: right.stop,
				};
				continue;
			}
			break;
		}
		return left;
	}

	parseMultiplicative(): ParsedExpr {
		let left = this.parseConcat();
		while (true) {
			const tok = this.peek();
			if (!tok) break;
			if (tok.kind === 'STAR' || tok.kind === 'DIV' || tok.kind === 'MOD') {
				this.advance();
				const right = this.parseConcat();
				left = {
					kind: 'Binary',
					op: tok.kind === 'STAR' ? '*' : tok.kind === 'DIV' ? '/' : '%',
					left,
					right,
					start: left.start,
					stop: right.stop,
				};
				continue;
			}
			break;
		}
		return left;
	}

	parseConcat(): ParsedExpr {
		let left = this.parseUnary();
		while (this.checkKind('PIPE2')) {
			this.advance();
			const right = this.parseUnary();
			left = {kind: 'Binary', op: '||', left, right, start: left.start, stop: right.stop};
		}
		return left;
	}

	parseUnary(): ParsedExpr {
		const tok = this.peek();
		if (tok) {
			if (tok.kind === 'MINUS' || tok.kind === 'PLUS' || tok.kind === 'TILDE') {
				this.advance();
				const operand = this.parseUnary();
				const op = tok.kind === 'MINUS' ? '-' : tok.kind === 'PLUS' ? '+' : '~';
				return {kind: 'Unary', op, operand, start: tok.start, stop: operand.stop};
			}
		}
		return this.parseCollate();
	}

	parseCollate(): ParsedExpr {
		let expr = this.parsePrimary();
		while (this.matchKeyword('COLLATE')) {
			const nameTok = this.expectOneOf(['IDENTIFIER', 'STRING_LITERAL'], 'collation name');
			const collation = nameTok.kind === 'STRING_LITERAL' ? unquoteString(nameTok.value) : unquoteIdent(nameTok.value);
			expr = {kind: 'Collate', expr, collation, start: expr.start, stop: nameTok.stop};
		}
		return expr;
	}

	parsePrimary(): ParsedExpr {
		const tok = this.peek();
		if (!tok) {
			throw new SqlParseError('unexpected end of input, expected expression', this.sql.length);
		}

		switch (tok.kind) {
			case 'NUMERIC_LITERAL':
				this.advance();
				return {kind: 'NumericLiteral', value: tok.value, start: tok.start, stop: tok.stop};
			case 'STRING_LITERAL':
				this.advance();
				return {kind: 'StringLiteral', value: tok.value, start: tok.start, stop: tok.stop};
			case 'BLOB_LITERAL':
				this.advance();
				return {kind: 'BlobLiteral', value: tok.value, start: tok.start, stop: tok.stop};
			case 'BIND_PARAMETER':
				this.advance();
				return {kind: 'BindParameter', marker: tok.value, start: tok.start, stop: tok.stop};
			case 'OPEN_PAR':
				return this.parseParenExpr();
			case 'KEYWORD':
				return this.parseKeywordPrimary(tok);
			case 'IDENTIFIER':
				return this.parseIdentifierPrimary();
			default:
				throw new SqlParseError(
					`unexpected token ${tok.kind} '${tok.value}' where an expression was expected (offset ${tok.start})`,
					tok.start
				);
		}
	}

	parseParenExpr(): ParsedExpr {
		const openTok = this.advance(); // OPEN_PAR
		// Scalar subquery: `(SELECT ...)` — the outer `EXISTS`/`IN` forms are
		// handled elsewhere; here we're in value context.
		if (this.checkKeyword('SELECT') || this.checkKeyword('WITH')) {
			const select = this.parseSelect();
			const close = this.expectKind('CLOSE_PAR', `')' closing subquery`);
			return {kind: 'Subquery', select, start: openTok.start, stop: close.stop};
		}
		// Parenthesised expression list. Most of the time this is one expr, but
		// SQLite allows `(a, b) IN (values)` — so model it as a list.
		const exprs: ParsedExpr[] = [this.parseExpr()];
		while (this.matchKind('COMMA')) {
			exprs.push(this.parseExpr());
		}
		const close = this.expectKind('CLOSE_PAR', `')' closing parenthesised expression`);
		return {kind: 'Paren', exprs, start: openTok.start, stop: close.stop};
	}

	parseKeywordPrimary(tok: Token): ParsedExpr {
		switch (tok.value) {
			case 'NULL':
				this.advance();
				return {kind: 'Null', start: tok.start, stop: tok.stop};
			case 'TRUE':
				this.advance();
				return {kind: 'BoolLiteral', value: true, start: tok.start, stop: tok.stop};
			case 'FALSE':
				this.advance();
				return {kind: 'BoolLiteral', value: false, start: tok.start, stop: tok.stop};
			case 'CAST':
				return this.parseCast();
			case 'CASE':
				return this.parseCase();
			case 'EXISTS':
				return this.parseExists(false);
			case 'NOT': {
				// NOT EXISTS in expression position.
				const next = this.peekAt(1);
				if (next && next.kind === 'KEYWORD' && next.value === 'EXISTS') {
					this.advance();
					return this.parseExists(true);
				}
				// Otherwise: general unary NOT (hand back to `parseNot`'s territory).
				this.advance();
				const operand = this.parseComparison();
				return {kind: 'Unary', op: 'NOT', operand, start: tok.start, stop: operand.stop};
			}
			case 'CURRENT_DATE':
			case 'CURRENT_TIME':
			case 'CURRENT_TIMESTAMP': {
				// These look like keywords but the analyzer treats them as
				// `function_name()`-style nullary calls when detecting type.
				// Model as zero-arg function.
				this.advance();
				return {
					kind: 'FunctionCall',
					name: tok.value.toLowerCase(),
					distinct: false,
					star: false,
					args: [],
					filter_where: null,
					over_clause: null,
					start: tok.start,
					stop: tok.stop,
				};
			}
			default:
				throw new SqlParseError(
					`unexpected keyword '${tok.value}' where an expression was expected (offset ${tok.start})`,
					tok.start
				);
		}
	}

	parseCast(): ParsedExpr {
		const castTok = this.expectKeyword('CAST');
		this.expectKind('OPEN_PAR', `'(' after CAST`);
		const expr = this.parseExpr();
		this.expectKeyword('AS');
		const type_name = this.parseTypeName();
		const close = this.expectKind('CLOSE_PAR', `')' closing CAST`);
		return {kind: 'Cast', expr, type_name, start: castTok.start, stop: close.stop};
	}

	/** Type names in SQLite are "whatever identifier-ish tokens you like"; the
	 *  analyzer reads the whole thing as text and runs its affinity rules. */
	parseTypeName(): string {
		const parts: string[] = [];
		while (true) {
			const tok = this.peek();
			if (!tok) break;
			// Accept identifier-like tokens. Numeric literals appear inside e.g.
			// `VARCHAR(255)` between parens — those are parsed separately below.
			if (tok.kind === 'IDENTIFIER' || tok.kind === 'KEYWORD') {
				this.advance();
				parts.push(tok.value);
				continue;
			}
			// VARCHAR(255) / DECIMAL(10, 2)
			if (tok.kind === 'OPEN_PAR') {
				this.advance();
				const inner: string[] = [];
				while (!this.checkKind('CLOSE_PAR')) {
					const t = this.advance();
					inner.push(t.value);
					if (this.checkKind('COMMA')) {
						inner.push(',');
						this.advance();
					}
				}
				this.advance(); // CLOSE_PAR
				parts.push(`(${inner.join('')})`);
				break;
			}
			break;
		}
		if (parts.length === 0) {
			const tok = this.peek();
			throw new SqlParseError(
				`expected type name but got ${describeToken(tok)}`,
				tok ? tok.start : this.sql.length
			);
		}
		return parts.join(' ');
	}

	parseCase(): ParsedExpr {
		const caseTok = this.expectKeyword('CASE');
		let operand: ParsedExpr | null = null;
		// Simple CASE has an operand before the first WHEN.
		if (!this.checkKeyword('WHEN')) {
			operand = this.parseExpr();
		}
		const when_clauses: {when: ParsedExpr; then: ParsedExpr}[] = [];
		while (this.matchKeyword('WHEN')) {
			const when = this.parseExpr();
			this.expectKeyword('THEN');
			const then = this.parseExpr();
			when_clauses.push({when, then});
		}
		if (when_clauses.length === 0) {
			const tok = this.peek();
			throw new SqlParseError(
				`expected at least one WHEN in CASE expression but got ${describeToken(tok)}`,
				tok ? tok.start : this.sql.length
			);
		}
		let else_clause: ParsedExpr | null = null;
		if (this.matchKeyword('ELSE')) {
			else_clause = this.parseExpr();
		}
		const endTok = this.expectKeyword('END');
		return {
			kind: 'Case',
			operand,
			when_clauses,
			else_clause,
			start: caseTok.start,
			stop: endTok.stop,
		};
	}

	parseExists(negated: boolean): ParsedExpr {
		const existsTok = this.expectKeyword('EXISTS');
		this.expectKind('OPEN_PAR', `'(' after EXISTS`);
		const select = this.parseSelect();
		const close = this.expectKind('CLOSE_PAR', `')' closing EXISTS subquery`);
		return {kind: 'Exists', negated, select, start: existsTok.start, stop: close.stop};
	}

	/** Identifier-led primary: column ref, qualified column ref, or function
	 *  call (`name(...)`). */
	parseIdentifierPrimary(): ParsedExpr {
		const first = this.advance();
		// Function call? `name ( ... )`.
		if (this.checkKind('OPEN_PAR') && !looksLikeFunctionSchemaDot(first, this.peekAt(1))) {
			return this.parseFunctionCall(first, null);
		}

		// Qualified refs: schema.table.col / table.col.
		if (this.checkKind('DOT')) {
			this.advance(); // consume .
			const second = this.expectKind('IDENTIFIER', 'column name or table name after `.`');
			// Could be `schema.table.column` → another DOT.
			if (this.checkKind('DOT')) {
				this.advance();
				const third = this.expectKind('IDENTIFIER', 'column name after `schema.table.`');
				return {
					kind: 'ColumnRef',
					schema: unquoteIdent(first.value),
					table: unquoteIdent(second.value),
					column: unquoteIdent(third.value),
					start: first.start,
					stop: third.stop,
				};
			}
			// Could be `schema.function(...)`. If next is `(`, it's a function.
			if (this.checkKind('OPEN_PAR')) {
				return this.parseFunctionCall(second, first);
			}
			return {
				kind: 'ColumnRef',
				schema: null,
				table: unquoteIdent(first.value),
				column: unquoteIdent(second.value),
				start: first.start,
				stop: second.stop,
			};
		}

		return {
			kind: 'ColumnRef',
			schema: null,
			table: null,
			column: unquoteIdent(first.value),
			start: first.start,
			stop: first.stop,
		};
	}

	parseFunctionCall(nameTok: Token, schemaTok: Token | null): ParsedExpr {
		this.expectKind('OPEN_PAR', `'(' after function name`);
		let distinct = false;
		let star = false;
		const args: ParsedExpr[] = [];

		if (this.checkKind('STAR')) {
			// count(*)
			this.advance();
			star = true;
		} else if (!this.checkKind('CLOSE_PAR')) {
			if (this.matchKeyword('DISTINCT')) distinct = true;
			args.push(this.parseExpr());
			while (this.matchKind('COMMA')) args.push(this.parseExpr());
			// Aggregate with ORDER BY inside call — accepted, ignored by analyzer.
			if (this.matchKeyword('ORDER')) {
				this.expectKeyword('BY');
				this.parseOrderingTerm();
				while (this.matchKind('COMMA')) this.parseOrderingTerm();
			}
		}
		const close = this.expectKind('CLOSE_PAR', `')' closing function call`);

		let filter_where: ParsedExpr | null = null;
		let stop = close.stop;
		if (this.matchKeyword('FILTER')) {
			this.expectKind('OPEN_PAR', `'(' after FILTER`);
			this.expectKeyword('WHERE');
			filter_where = this.parseExpr();
			const filterClose = this.expectKind('CLOSE_PAR', `')' closing FILTER (WHERE ...)`);
			stop = filterClose.stop;
		}

		// OVER (...) — we don't need the contents, just presence.
		let over_clause: null | {kind: 'OverClause'} = null;
		if (this.matchKeyword('OVER')) {
			if (this.matchKind('OPEN_PAR')) {
				// Skip until matching CLOSE_PAR (naive brace-matching).
				let depth = 1;
				while (depth > 0) {
					const t = this.peek();
					if (!t) {
						throw new SqlParseError('unterminated OVER (...)', this.sql.length);
					}
					this.advance();
					if (t.kind === 'OPEN_PAR') depth++;
					else if (t.kind === 'CLOSE_PAR') depth--;
					stop = t.stop;
				}
			} else {
				// OVER window_name — consume the identifier.
				const idTok = this.expectKind('IDENTIFIER', 'window name or `(` after OVER');
				stop = idTok.stop;
			}
			over_clause = {kind: 'OverClause'};
		}

		const name = unquoteIdent(nameTok.value).toLowerCase();
		void schemaTok; // schema-qualified function names aren't tracked separately.
		return {
			kind: 'FunctionCall',
			name,
			distinct,
			star,
			args,
			filter_where,
			over_clause,
			start: schemaTok ? schemaTok.start : nameTok.start,
			stop,
		};
	}

	// -------------------------------------------------------------------------
	// Utility: token consume / peek primitives
	// -------------------------------------------------------------------------

	expectEnd() {
		const tok = this.peek();
		if (tok) {
			throw new SqlParseError(
				`unexpected trailing token ${tok.kind} '${tok.value}' after statement (offset ${tok.start})`,
				tok.start
			);
		}
	}

	peek(): Token | null {
		return this.tokens[this.index] || null;
	}
	peekAt(offset: number): Token | null {
		return this.tokens[this.index + offset] || null;
	}
	previous(): Token {
		return this.tokens[this.index - 1];
	}
	advance(): Token {
		return this.tokens[this.index++];
	}
	seek(i: number): void {
		this.index = i;
	}
	position(): number {
		return this.index;
	}

	checkKind(kind: TokenKind): boolean {
		return this.tokens[this.index]?.kind === kind;
	}
	checkKindAt(offset: number, kind: TokenKind): boolean {
		return this.tokens[this.index + offset]?.kind === kind;
	}
	checkKeyword(kw: string): boolean {
		const t = this.tokens[this.index];
		return !!t && t.kind === 'KEYWORD' && t.value === kw;
	}
	matchKind(kind: TokenKind): boolean {
		if (this.checkKind(kind)) {
			this.index++;
			return true;
		}
		return false;
	}
	matchKeyword(kw: string): boolean {
		if (this.checkKeyword(kw)) {
			this.index++;
			return true;
		}
		return false;
	}

	expectKind(kind: TokenKind, label: string): Token {
		const tok = this.tokens[this.index];
		if (!tok || tok.kind !== kind) {
			throw new SqlParseError(
				`expected ${label} (${kind}) but got ${describeToken(tok)}`,
				tok ? tok.start : this.sql.length
			);
		}
		this.index++;
		return tok;
	}
	expectKeyword(kw: string): Token {
		const tok = this.tokens[this.index];
		if (!tok || tok.kind !== 'KEYWORD' || tok.value !== kw) {
			throw new SqlParseError(
				`expected keyword ${kw} but got ${describeToken(tok)}`,
				tok ? tok.start : this.sql.length
			);
		}
		this.index++;
		return tok;
	}
	expectOneOf(kinds: TokenKind[], label: string): Token {
		const tok = this.tokens[this.index];
		if (!tok || !kinds.includes(tok.kind)) {
			throw new SqlParseError(
				`expected ${label} (${kinds.join(' or ')}) but got ${describeToken(tok)}`,
				tok ? tok.start : this.sql.length
			);
		}
		this.index++;
		return tok;
	}
}

// -----------------------------------------------------------------------------
// Helpers / lookup tables
// -----------------------------------------------------------------------------

const COMPARISON_OPS: Partial<Record<TokenKind, ParsedBinaryOp>> = {
	LT: '<',
	LT_EQ: '<=',
	GT: '>',
	GT_EQ: '>=',
};

const EQUALITY_OPS: Partial<Record<TokenKind, ParsedBinaryOp>> = {
	ASSIGN: '=',
	EQ: '==',
	NOT_EQ1: '!=',
	NOT_EQ2: '<>',
};

/** Keywords that terminate a result-column expression — used to disambiguate
 *  bare aliases (`SELECT col alias FROM ...`). */
const SELECT_TAIL_KEYWORDS = new Set([
	'FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'OFFSET',
	'UNION', 'INTERSECT', 'EXCEPT', 'WINDOW', 'RETURNING',
]);

function unquoteIdent(value: string): string {
	if (value.length >= 2) {
		const first = value[0];
		const last = value[value.length - 1];
		if (first === '"' && last === '"') return value.slice(1, -1).replace(/""/g, '"');
		if (first === '`' && last === '`') return value.slice(1, -1).replace(/``/g, '`');
		if (first === '[' && last === ']') return value.slice(1, -1);
	}
	return value;
}

function unquoteString(value: string): string {
	if (value.length >= 2 && value[0] === "'" && value[value.length - 1] === "'") {
		return value.slice(1, -1).replace(/''/g, "'");
	}
	return value;
}

/** Accept a STRING_LITERAL as an alias target (SQLite allows `AS 'x'`). */
function unquoteStringyAlias(tok: Token): string {
	if (tok.kind === 'STRING_LITERAL') return unquoteString(tok.value);
	return unquoteIdent(tok.value);
}

function describeToken(tok: Token | null): string {
	return tok ? `${tok.kind} '${tok.value}'` : 'end of input';
}

/** If `schema.function(...)` is called, we want `parseIdentifierPrimary` to
 *  fall into the function-call branch when it sees the DOT; the check here
 *  prevents it from treating `name(` as a call when there's a schema dot
 *  ahead. Always false today — reserved for future use. */
function looksLikeFunctionSchemaDot(first: Token, afterOpenPar: Token | null): boolean {
	void first;
	void afterOpenPar;
	return false;
}
