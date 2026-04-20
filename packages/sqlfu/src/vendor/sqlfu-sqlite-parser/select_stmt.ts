// sqlfu SQLite `select_stmt` parser — phase 2 skeleton of
// tasks/drop-antlr.md.
//
// Scope for this commit:
//
// - Parses the simplest ~20% of SELECT shapes: single-core SELECT, comma-
//   separated result columns (star OR unqualified column OR qualified
//   `tbl.col` OR simple `col as alias`), single-table FROM, optional WHERE
//   with only equality + AND of comparisons against bind parameters, optional
//   LIMIT <number>.
// - Produces a *plain-data* AST (no ANTLR `*Context` shim yet). The shapes
//   here are a narrow subset of the target surface documented in `types.ts`.
// - The phase 3 migration will add an ANTLR-compatible wrapper that makes
//   these nodes quack like `Select_stmtContext`/`ExprContext` for the
//   analyzer — that's NOT this commit.
//
// Out of scope: JOIN, GROUP BY, HAVING, ORDER BY, CTEs, UNION/INTERSECT/
// EXCEPT, subqueries in any position, CASE, IN (...), BETWEEN, LIKE,
// function calls, OR. Each of those is a phase-4 addition driven by a
// failing fixture.
//
// Error philosophy: throw `SqlParseError` with the current token's offset
// on any unexpected input. The goal is a clear, caret-able error at 3 AM —
// not graceful recovery.

import {type Token, type TokenKind, tokenize} from './tokenizer.js';

// --- plain AST shapes ---

export interface ParsedSelectStmt {
	kind: 'Select_stmt';
	/** Exactly one select_core for the MVP. Compound-operator UNION/etc. is
	 *  phase 4. */
	select_core: ParsedSelectCore;
	limit: ParsedLimit | null;
	/** Source offsets for `extractOriginalSql`. */
	start: number;
	stop: number;
}

export interface ParsedSelectCore {
	kind: 'Select_core';
	result_columns: ParsedResultColumn[];
	from: ParsedTableRef | null;
	where: ParsedExpr | null;
	start: number;
	stop: number;
}

export type ParsedResultColumn =
	| {kind: 'Star'; start: number; stop: number}
	| {kind: 'TableStar'; table: string; start: number; stop: number}
	| {kind: 'Expr'; expr: ParsedExpr; alias: string | null; start: number; stop: number};

export interface ParsedTableRef {
	kind: 'Table';
	schema: string | null;
	name: string;
	alias: string | null;
	start: number;
	stop: number;
}

export type ParsedExpr =
	| {kind: 'ColumnRef'; table: string | null; column: string; start: number; stop: number}
	| {kind: 'NumericLiteral'; value: string; start: number; stop: number}
	| {kind: 'StringLiteral'; value: string; start: number; stop: number}
	| {kind: 'Null'; start: number; stop: number}
	| {kind: 'BindParameter'; marker: string; start: number; stop: number}
	| {
			kind: 'Binary';
			op: '=' | 'AND' | '<' | '<=' | '>' | '>=' | '!=' | '<>';
			left: ParsedExpr;
			right: ParsedExpr;
			start: number;
			stop: number;
	  };

export interface ParsedLimit {
	kind: 'Limit';
	expr: ParsedExpr;
	start: number;
	stop: number;
}

export class SqlParseError extends Error {
	constructor(message: string, public readonly offset: number) {
		super(message);
		this.name = 'SqlParseError';
	}
}

export function parseSelectStmt(sql: string): ParsedSelectStmt {
	const tokens = tokenize(sql);
	const p = new Parser(tokens, sql);
	const stmt = p.parseSelect();
	p.expectEnd();
	return stmt;
}

// --- parser ---

class Parser {
	private index = 0;

	constructor(private readonly tokens: Token[], private readonly sql: string) {}

	parseSelect(): ParsedSelectStmt {
		const core = this.parseSelectCore();
		let limit: ParsedLimit | null = null;
		if (this.matchKeyword('LIMIT')) {
			const limitTok = this.previous();
			const expr = this.parseSimpleExpr();
			limit = {kind: 'Limit', expr, start: limitTok.start, stop: expr.stop};
		}

		// Trailing optional SEMI — consume but don't require.
		this.matchKind('SEMI');

		return {
			kind: 'Select_stmt',
			select_core: core,
			limit,
			start: core.start,
			stop: limit ? limit.stop : core.stop,
		};
	}

	parseSelectCore(): ParsedSelectCore {
		const selectTok = this.expectKeyword('SELECT');
		const result_columns: ParsedResultColumn[] = [];
		result_columns.push(this.parseResultColumn());
		while (this.matchKind('COMMA')) {
			result_columns.push(this.parseResultColumn());
		}

		let from: ParsedTableRef | null = null;
		let where: ParsedExpr | null = null;
		let endOffset = result_columns[result_columns.length - 1].stop;

		if (this.matchKeyword('FROM')) {
			from = this.parseSimpleTableRef();
			endOffset = from.stop;
		}
		if (this.matchKeyword('WHERE')) {
			where = this.parseWhereExpr();
			endOffset = where.stop;
		}

		return {
			kind: 'Select_core',
			result_columns,
			from,
			where,
			start: selectTok.start,
			stop: endOffset,
		};
	}

	parseResultColumn(): ParsedResultColumn {
		// `*` by itself
		if (this.checkKind('STAR')) {
			const tok = this.advance();
			return {kind: 'Star', start: tok.start, stop: tok.stop};
		}

		// `table.*`: IDENTIFIER . STAR (peek two tokens ahead)
		if (this.checkKind('IDENTIFIER') && this.checkKindAt(1, 'DOT') && this.checkKindAt(2, 'STAR')) {
			const ident = this.advance();
			this.advance(); // DOT
			const star = this.advance();
			return {kind: 'TableStar', table: unquoteIdent(ident.value), start: ident.start, stop: star.stop};
		}

		// `expr [AS alias]` or `expr alias`
		const expr = this.parseSimpleExpr();
		let alias: string | null = null;
		let stop = expr.stop;
		if (this.matchKeyword('AS')) {
			const aliasTok = this.expectOneOf(['IDENTIFIER'], 'column alias');
			alias = unquoteIdent(aliasTok.value);
			stop = aliasTok.stop;
		} else if (this.checkKind('IDENTIFIER')) {
			// bare alias without AS; accept only when the next-next token is a
			// comma, FROM, WHERE, LIMIT, or end-of-input (otherwise we'd eat a
			// table name in unrelated contexts).
			const after = this.peekKind(1);
			if (
				after === null ||
				after === 'COMMA' ||
				after === 'SEMI' ||
				(after === 'KEYWORD' &&
					['FROM', 'WHERE', 'LIMIT'].includes(this.peekAt(1)!.value))
			) {
				const aliasTok = this.advance();
				alias = unquoteIdent(aliasTok.value);
				stop = aliasTok.stop;
			}
		}
		return {kind: 'Expr', expr, alias, start: expr.start, stop};
	}

	parseSimpleTableRef(): ParsedTableRef {
		// IDENTIFIER [. IDENTIFIER] [AS? IDENTIFIER]
		const first = this.expectKind('IDENTIFIER', 'table name');
		let schema: string | null = null;
		let name = unquoteIdent(first.value);
		let stop = first.stop;

		if (this.matchKind('DOT')) {
			const second = this.expectKind('IDENTIFIER', 'table name after schema.');
			schema = name;
			name = unquoteIdent(second.value);
			stop = second.stop;
		}

		let alias: string | null = null;
		if (this.matchKeyword('AS')) {
			const aliasTok = this.expectKind('IDENTIFIER', 'table alias');
			alias = unquoteIdent(aliasTok.value);
			stop = aliasTok.stop;
		} else if (this.checkKind('IDENTIFIER')) {
			// Bare alias; accept only if the next token is not starting a
			// JOIN-word. Since JOIN isn't supported in the MVP we play it safe
			// and consume the bare alias.
			const aliasTok = this.advance();
			alias = unquoteIdent(aliasTok.value);
			stop = aliasTok.stop;
		}
		return {kind: 'Table', schema, name, alias, start: first.start, stop};
	}

	/** WHERE supports: simple comparisons chained by AND only. */
	parseWhereExpr(): ParsedExpr {
		let left = this.parseComparison();
		while (this.matchKeyword('AND')) {
			const right = this.parseComparison();
			left = {kind: 'Binary', op: 'AND', left, right, start: left.start, stop: right.stop};
		}
		return left;
	}

	parseComparison(): ParsedExpr {
		const left = this.parseSimpleExpr();
		const opTok = this.peek();
		const op = opTok && COMPARISON_OPS[opTok.kind];
		if (!op) return left;
		this.advance();
		const right = this.parseSimpleExpr();
		return {kind: 'Binary', op, left, right, start: left.start, stop: right.stop};
	}

	/** Atomic expressions only: literals, bind params, column refs. */
	parseSimpleExpr(): ParsedExpr {
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
			case 'BIND_PARAMETER':
				this.advance();
				return {kind: 'BindParameter', marker: tok.value, start: tok.start, stop: tok.stop};
			case 'KEYWORD':
				if (tok.value === 'NULL') {
					this.advance();
					return {kind: 'Null', start: tok.start, stop: tok.stop};
				}
				throw new SqlParseError(
					`unexpected keyword '${tok.value}' where an expression was expected (offset ${tok.start})`,
					tok.start
				);
			case 'IDENTIFIER': {
				this.advance();
				// column or table.column
				if (this.matchKind('DOT')) {
					const col = this.expectKind('IDENTIFIER', 'column name after `.`');
					return {
						kind: 'ColumnRef',
						table: unquoteIdent(tok.value),
						column: unquoteIdent(col.value),
						start: tok.start,
						stop: col.stop,
					};
				}
				return {
					kind: 'ColumnRef',
					table: null,
					column: unquoteIdent(tok.value),
					start: tok.start,
					stop: tok.stop,
				};
			}
			default:
				throw new SqlParseError(
					`unexpected token ${tok.kind} '${tok.value}' where an expression was expected (offset ${tok.start})`,
					tok.start
				);
		}
	}

	expectEnd() {
		const tok = this.peek();
		if (tok) {
			throw new SqlParseError(
				`unexpected trailing token ${tok.kind} '${tok.value}' after statement (offset ${tok.start})`,
				tok.start
			);
		}
	}

	// --- lookahead / consume primitives ---

	peek(): Token | null {
		return this.tokens[this.index] || null;
	}
	peekAt(offset: number): Token | null {
		return this.tokens[this.index + offset] || null;
	}
	peekKind(offset: number): TokenKind | null {
		return this.tokens[this.index + offset]?.kind || null;
	}
	previous(): Token {
		return this.tokens[this.index - 1];
	}
	advance(): Token {
		return this.tokens[this.index++];
	}

	checkKind(kind: TokenKind): boolean {
		return this.tokens[this.index]?.kind === kind;
	}
	checkKindAt(offset: number, kind: TokenKind): boolean {
		return this.tokens[this.index + offset]?.kind === kind;
	}
	matchKind(kind: TokenKind): boolean {
		if (this.checkKind(kind)) {
			this.index++;
			return true;
		}
		return false;
	}
	matchKeyword(kw: string): boolean {
		const tok = this.tokens[this.index];
		if (tok && tok.kind === 'KEYWORD' && tok.value === kw) {
			this.index++;
			return true;
		}
		return false;
	}

	expectKind(kind: TokenKind, label: string): Token {
		const tok = this.tokens[this.index];
		if (!tok || tok.kind !== kind) {
			throw new SqlParseError(
				`expected ${label} (${kind}) but got ${tok ? `${tok.kind} '${tok.value}'` : 'end of input'}`,
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
				`expected keyword ${kw} but got ${tok ? `${tok.kind} '${tok.value}'` : 'end of input'}`,
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
				`expected ${label} (${kinds.join(' or ')}) but got ${
					tok ? `${tok.kind} '${tok.value}'` : 'end of input'
				}`,
				tok ? tok.start : this.sql.length
			);
		}
		this.index++;
		return tok;
	}
}

const COMPARISON_OPS: Partial<Record<TokenKind, '=' | '<' | '<=' | '>' | '>=' | '!=' | '<>'>> = {
	ASSIGN: '=',
	LT: '<',
	LT_EQ: '<=',
	GT: '>',
	GT_EQ: '>=',
	NOT_EQ1: '!=',
	NOT_EQ2: '<>',
};

function unquoteIdent(value: string): string {
	if (value.startsWith('"') && value.endsWith('"')) {
		return value.slice(1, -1).replace(/""/g, '"');
	}
	if (value.startsWith('`') && value.endsWith('`')) {
		return value.slice(1, -1).replace(/``/g, '`');
	}
	if (value.startsWith('[') && value.endsWith(']')) {
		return value.slice(1, -1);
	}
	return value;
}
