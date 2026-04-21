// sqlfu SQLite DML parser — INSERT / UPDATE / DELETE, including RETURNING
// clauses and ON CONFLICT upserts.
//
// This file is additive: no analyzer code imports it yet. It shares its AST
// surface with `select_stmt.ts` (a DML statement can embed a SELECT, a VALUES
// row list, or an expression — all of which live in that module).
//
// ## What this covers
//
// INSERT:
//   INSERT INTO [schema.]table [(col_list)]
//     [{VALUES (expr_list), ...} | {SELECT ...} | {DEFAULT VALUES}]
//     [ON CONFLICT [(cols)] DO {NOTHING | UPDATE SET col = expr, ...
//       [WHERE expr]}]
//     [RETURNING result_column_list]
//
// UPDATE:
//   UPDATE [OR {REPLACE|ROLLBACK|ABORT|FAIL|IGNORE}] [schema.]table [AS alias]
//     SET col = expr, ... [WHERE expr]
//     [RETURNING result_column_list]
//
// DELETE:
//   DELETE FROM [schema.]table [AS alias] [WHERE expr]
//     [RETURNING result_column_list]
//
// REPLACE is parsed as INSERT with a synthetic conflict action of REPLACE.
//
// Out of scope here: INSERT with WITH-clause preamble (that's a SELECT-level
// concern and the shared parser already handles a WITH inside embedded
// selects — but a top-level `WITH ... INSERT` is a future addition).

import {
	type Token,
	type TokenKind,
	tokenize,
} from './tokenizer.js';

import {
	type ParsedExpr,
	type ParsedResultColumn,
	type ParsedSelectStmt,
	SqlParseError,
} from './select_stmt.js';

// -----------------------------------------------------------------------------
// AST
// -----------------------------------------------------------------------------

export interface ParsedInsertStmt {
	kind: 'Insert_stmt';
	/** OR-action: `INSERT OR REPLACE INTO ...`. `null` for plain INSERT or
	 *  `'REPLACE'` when the source form was `REPLACE INTO ...`. */
	or_action: null | 'ABORT' | 'FAIL' | 'IGNORE' | 'REPLACE' | 'ROLLBACK';
	/** True when the source form was `REPLACE INTO ...` (a SQLite-specific
	 *  alias for `INSERT OR REPLACE INTO`). */
	source_is_replace: boolean;
	schema: string | null;
	table: string;
	alias: string | null;
	columns: string[];
	source: ParsedInsertSource;
	upsert: ParsedUpsertClause | null;
	returning: ParsedReturningClause | null;
	start: number;
	stop: number;
}

export type ParsedInsertSource =
	| {kind: 'Values'; rows: ParsedExpr[][]; start: number; stop: number}
	| {kind: 'Select'; select: ParsedSelectStmt; start: number; stop: number}
	| {kind: 'DefaultValues'; start: number; stop: number};

export interface ParsedUpsertClause {
	kind: 'Upsert';
	target_columns: string[];
	where: ParsedExpr | null;
	action: ParsedUpsertAction;
	start: number;
	stop: number;
}

export type ParsedUpsertAction =
	| {kind: 'Nothing'; start: number; stop: number}
	| {
			kind: 'Update';
			assignments: ParsedAssignment[];
			where: ParsedExpr | null;
			start: number;
			stop: number;
	  };

export interface ParsedAssignment {
	/** Either one column (`col = expr`) or a tuple (`(a, b) = (1, 2)`). */
	columns: string[];
	expr: ParsedExpr;
	/** Byte offset of the `=` token — analyzer uses this to partition parameter
	 *  markers between SET and WHERE. */
	assign_offset: number;
	start: number;
	stop: number;
}

export interface ParsedUpdateStmt {
	kind: 'Update_stmt';
	or_action: null | 'ABORT' | 'FAIL' | 'IGNORE' | 'REPLACE' | 'ROLLBACK';
	schema: string | null;
	table: string;
	alias: string | null;
	assignments: ParsedAssignment[];
	where: ParsedExpr | null;
	/** Byte offset of the `WHERE` keyword if present; null otherwise. Used by
	 *  the analyzer to split parameter markers by position. */
	where_offset: number | null;
	returning: ParsedReturningClause | null;
	start: number;
	stop: number;
}

export interface ParsedDeleteStmt {
	kind: 'Delete_stmt';
	schema: string | null;
	table: string;
	alias: string | null;
	where: ParsedExpr | null;
	where_offset: number | null;
	returning: ParsedReturningClause | null;
	start: number;
	stop: number;
}

export interface ParsedReturningClause {
	kind: 'Returning';
	columns: ParsedResultColumn[];
	start: number;
	stop: number;
}

// -----------------------------------------------------------------------------
// Entry points
// -----------------------------------------------------------------------------

export function parseInsertStmt(sql: string): ParsedInsertStmt {
	const {parser} = openParser(sql);
	const stmt = parser.parseInsert();
	parser.matchSemi();
	parser.expectEnd();
	return stmt;
}

export function parseUpdateStmt(sql: string): ParsedUpdateStmt {
	const {parser} = openParser(sql);
	const stmt = parser.parseUpdate();
	parser.matchSemi();
	parser.expectEnd();
	return stmt;
}

export function parseDeleteStmt(sql: string): ParsedDeleteStmt {
	const {parser} = openParser(sql);
	const stmt = parser.parseDelete();
	parser.matchSemi();
	parser.expectEnd();
	return stmt;
}

function openParser(sql: string) {
	const tokens = tokenize(sql);
	return {parser: new DmlParser(tokens, sql)};
}

// -----------------------------------------------------------------------------
// Parser implementation — reuses the SELECT parser's expression grammar by
// instantiating it on demand and letting it share the token stream.
// -----------------------------------------------------------------------------

// We import the Parser class indirectly by way of parseSelectFrom, which
// takes a token array + sql + start index and returns a parsed select plus the
// new cursor position. That lets us compose without duplicating expression
// grammar code.
import {parseSelectFrom} from './select_stmt.js';

class DmlParser {
	private index = 0;

	constructor(private readonly tokens: Token[], private readonly sql: string) {}

	// --- INSERT / REPLACE ---

	parseInsert(): ParsedInsertStmt {
		const startTok = this.peek();
		if (!startTok) throw new SqlParseError('empty input', 0);
		let or_action: ParsedInsertStmt['or_action'] = null;
		let source_is_replace = false;

		if (this.matchKeyword('REPLACE')) {
			or_action = 'REPLACE';
			source_is_replace = true;
		} else {
			this.expectKeyword('INSERT');
			if (this.matchKeyword('OR')) {
				or_action = this.readConflictAction();
			}
		}
		this.expectKeyword('INTO');

		const {schema, table, stop: nameStop} = this.parseSchemaQualifiedName();
		let tableStop = nameStop;
		let alias: string | null = null;
		if (this.matchKeyword('AS')) {
			const aliasTok = this.expectKind('IDENTIFIER', 'table alias');
			alias = unquoteIdent(aliasTok.value);
			tableStop = aliasTok.stop;
		}

		const columns: string[] = [];
		if (this.matchKind('OPEN_PAR')) {
			columns.push(unquoteIdent(this.expectKind('IDENTIFIER', 'column name').value));
			while (this.matchKind('COMMA')) {
				columns.push(unquoteIdent(this.expectKind('IDENTIFIER', 'column name').value));
			}
			const close = this.expectKind('CLOSE_PAR', `')' closing column list`);
			tableStop = close.stop;
		}

		const source = this.parseInsertSource();
		let stop = source.stop;

		let upsert: ParsedUpsertClause | null = null;
		if (this.checkKeyword('ON')) {
			upsert = this.parseUpsertClause();
			stop = upsert.stop;
		}

		let returning: ParsedReturningClause | null = null;
		if (this.checkKeyword('RETURNING')) {
			returning = this.parseReturning();
			stop = returning.stop;
		}

		return {
			kind: 'Insert_stmt',
			or_action,
			source_is_replace,
			schema,
			table,
			alias,
			columns,
			source,
			upsert,
			returning,
			start: startTok.start,
			stop,
		};
	}

	readConflictAction(): ParsedInsertStmt['or_action'] {
		if (this.matchKeyword('ABORT')) return 'ABORT';
		if (this.matchKeyword('FAIL')) return 'FAIL';
		if (this.matchKeyword('IGNORE')) return 'IGNORE';
		if (this.matchKeyword('REPLACE')) return 'REPLACE';
		if (this.matchKeyword('ROLLBACK')) return 'ROLLBACK';
		const tok = this.peek();
		throw new SqlParseError(
			`expected ABORT / FAIL / IGNORE / REPLACE / ROLLBACK after OR but got ${describeToken(tok)}`,
			tok ? tok.start : this.sql.length,
		);
	}

	parseInsertSource(): ParsedInsertSource {
		if (this.matchKeyword('DEFAULT')) {
			const valuesTok = this.expectKeyword('VALUES');
			return {kind: 'DefaultValues', start: this.previous(2).start, stop: valuesTok.stop};
		}
		if (this.checkKeyword('VALUES')) {
			const valuesTok = this.advance();
			const rows: ParsedExpr[][] = [this.parseValueRow()];
			while (this.matchKind('COMMA')) {
				rows.push(this.parseValueRow());
			}
			const lastRow = rows[rows.length - 1];
			const stop = this.previous().stop;
			void lastRow;
			return {kind: 'Values', rows, start: valuesTok.start, stop};
		}
		if (this.checkKeyword('SELECT') || this.checkKeyword('WITH')) {
			const {stmt, nextIndex} = this.runEmbeddedSelect();
			this.index = nextIndex;
			return {kind: 'Select', select: stmt, start: stmt.start, stop: stmt.stop};
		}
		const tok = this.peek();
		throw new SqlParseError(
			`expected VALUES / SELECT / DEFAULT VALUES but got ${describeToken(tok)}`,
			tok ? tok.start : this.sql.length,
		);
	}

	parseValueRow(): ParsedExpr[] {
		this.expectKind('OPEN_PAR', `'(' to start VALUES row`);
		const row: ParsedExpr[] = [this.parseExpr()];
		while (this.matchKind('COMMA')) row.push(this.parseExpr());
		this.expectKind('CLOSE_PAR', `')' closing VALUES row`);
		return row;
	}

	parseUpsertClause(): ParsedUpsertClause {
		const onTok = this.expectKeyword('ON');
		this.expectKeyword('CONFLICT');
		const target_columns: string[] = [];
		if (this.matchKind('OPEN_PAR')) {
			target_columns.push(unquoteIdent(this.expectKind('IDENTIFIER', 'target column').value));
			while (this.matchKind('COMMA')) {
				target_columns.push(unquoteIdent(this.expectKind('IDENTIFIER', 'target column').value));
			}
			this.expectKind('CLOSE_PAR', `')' closing conflict target`);
		}
		let where: ParsedExpr | null = null;
		if (this.matchKeyword('WHERE')) {
			where = this.parseExpr();
		}
		this.expectKeyword('DO');
		let action: ParsedUpsertAction;
		if (this.matchKeyword('NOTHING')) {
			const tok = this.previous();
			action = {kind: 'Nothing', start: tok.start, stop: tok.stop};
		} else {
			const updateTok = this.expectKeyword('UPDATE');
			this.expectKeyword('SET');
			const assignments = this.parseAssignmentList();
			let w2: ParsedExpr | null = null;
			if (this.matchKeyword('WHERE')) {
				w2 = this.parseExpr();
			}
			action = {
				kind: 'Update',
				assignments,
				where: w2,
				start: updateTok.start,
				stop: w2 ? w2.stop : assignments[assignments.length - 1].stop,
			};
		}
		return {
			kind: 'Upsert',
			target_columns,
			where,
			action,
			start: onTok.start,
			stop: action.stop,
		};
	}

	// --- UPDATE ---

	parseUpdate(): ParsedUpdateStmt {
		const updateTok = this.expectKeyword('UPDATE');
		let or_action: ParsedUpdateStmt['or_action'] = null;
		if (this.matchKeyword('OR')) {
			or_action = this.readConflictAction();
		}
		const {schema, table, stop: nameStop} = this.parseSchemaQualifiedName();
		let stop = nameStop;
		let alias: string | null = null;
		if (this.matchKeyword('AS')) {
			const aliasTok = this.expectKind('IDENTIFIER', 'table alias');
			alias = unquoteIdent(aliasTok.value);
			stop = aliasTok.stop;
		} else if (this.checkKind('IDENTIFIER')) {
			const aliasTok = this.advance();
			alias = unquoteIdent(aliasTok.value);
			stop = aliasTok.stop;
		}

		this.expectKeyword('SET');
		const assignments = this.parseAssignmentList();
		stop = assignments[assignments.length - 1].stop;

		let where: ParsedExpr | null = null;
		let where_offset: number | null = null;
		if (this.checkKeyword('WHERE')) {
			const whereTok = this.advance();
			where_offset = whereTok.start;
			where = this.parseExpr();
			stop = where.stop;
		}

		let returning: ParsedReturningClause | null = null;
		if (this.checkKeyword('RETURNING')) {
			returning = this.parseReturning();
			stop = returning.stop;
		}

		return {
			kind: 'Update_stmt',
			or_action,
			schema,
			table,
			alias,
			assignments,
			where,
			where_offset,
			returning,
			start: updateTok.start,
			stop,
		};
	}

	parseAssignmentList(): ParsedAssignment[] {
		const list: ParsedAssignment[] = [this.parseAssignment()];
		while (this.matchKind('COMMA')) list.push(this.parseAssignment());
		return list;
	}

	parseAssignment(): ParsedAssignment {
		const columns: string[] = [];
		let start: number;
		if (this.matchKind('OPEN_PAR')) {
			start = this.previous().start;
			columns.push(unquoteIdent(this.expectKind('IDENTIFIER', 'column name').value));
			while (this.matchKind('COMMA')) {
				columns.push(unquoteIdent(this.expectKind('IDENTIFIER', 'column name').value));
			}
			this.expectKind('CLOSE_PAR', `')' closing column tuple`);
		} else {
			const colTok = this.expectKind('IDENTIFIER', 'column name');
			start = colTok.start;
			columns.push(unquoteIdent(colTok.value));
		}
		const assignTok = this.expectKind('ASSIGN', `'=' after column name in assignment`);
		const expr = this.parseExpr();
		return {
			columns,
			expr,
			assign_offset: assignTok.start,
			start,
			stop: expr.stop,
		};
	}

	// --- DELETE ---

	parseDelete(): ParsedDeleteStmt {
		const deleteTok = this.expectKeyword('DELETE');
		this.expectKeyword('FROM');
		const {schema, table, stop: nameStop} = this.parseSchemaQualifiedName();
		let stop = nameStop;
		let alias: string | null = null;
		if (this.matchKeyword('AS')) {
			const aliasTok = this.expectKind('IDENTIFIER', 'table alias');
			alias = unquoteIdent(aliasTok.value);
			stop = aliasTok.stop;
		} else if (this.checkKind('IDENTIFIER')) {
			const aliasTok = this.advance();
			alias = unquoteIdent(aliasTok.value);
			stop = aliasTok.stop;
		}

		let where: ParsedExpr | null = null;
		let where_offset: number | null = null;
		if (this.checkKeyword('WHERE')) {
			const whereTok = this.advance();
			where_offset = whereTok.start;
			where = this.parseExpr();
			stop = where.stop;
		}

		let returning: ParsedReturningClause | null = null;
		if (this.checkKeyword('RETURNING')) {
			returning = this.parseReturning();
			stop = returning.stop;
		}

		return {
			kind: 'Delete_stmt',
			schema,
			table,
			alias,
			where,
			where_offset,
			returning,
			start: deleteTok.start,
			stop,
		};
	}

	// --- RETURNING ---

	parseReturning(): ParsedReturningClause {
		// RETURNING shares syntax with SELECT's result_column_list. We reuse the
		// SELECT parser's `parseSelect` entry by synthesizing a tiny `SELECT
		// <cols>` over a slice of the original SQL — but that's awkward. Instead
		// we inline a result-column mini-parser that accepts `*`, `tbl.*`, or
		// `expr [AS? alias]`. Any expression inside one of those columns still
		// goes through the shared parseExpr path, so feature coverage is
		// identical to SELECT.
		const returningTok = this.expectKeyword('RETURNING');
		const columns: ParsedResultColumn[] = [this.parseResultColumn()];
		while (this.matchKind('COMMA')) columns.push(this.parseResultColumn());
		const stop = columns[columns.length - 1].stop;
		return {kind: 'Returning', columns, start: returningTok.start, stop};
	}

	parseResultColumn(): ParsedResultColumn {
		if (this.checkKind('STAR')) {
			const tok = this.advance();
			return {kind: 'Star', start: tok.start, stop: tok.stop};
		}
		if (this.checkKind('IDENTIFIER') && this.checkKindAt(1, 'DOT') && this.checkKindAt(2, 'STAR')) {
			const ident = this.advance();
			this.advance();
			const star = this.advance();
			return {kind: 'TableStar', table: unquoteIdent(ident.value), start: ident.start, stop: star.stop};
		}
		const expr = this.parseExpr();
		let alias: string | null = null;
		let stop = expr.stop;
		if (this.matchKeyword('AS')) {
			const aliasTok = this.expectOneOf(['IDENTIFIER', 'STRING_LITERAL'], 'column alias');
			alias = unquoteIdentOrString(aliasTok);
			stop = aliasTok.stop;
		} else if (this.checkKind('IDENTIFIER')) {
			const aliasTok = this.advance();
			alias = unquoteIdent(aliasTok.value);
			stop = aliasTok.stop;
		}
		return {kind: 'Expr', expr, alias, start: expr.start, stop};
	}

	// --- shared name / expr helpers ---

	parseSchemaQualifiedName(): {schema: string | null; table: string; start: number; stop: number} {
		const first = this.expectKind('IDENTIFIER', 'table or schema name');
		let schema: string | null = null;
		let name = unquoteIdent(first.value);
		let stop = first.stop;
		if (this.matchKind('DOT')) {
			const second = this.expectKind('IDENTIFIER', 'table name after schema.');
			schema = name;
			name = unquoteIdent(second.value);
			stop = second.stop;
		}
		return {schema, table: name, start: first.start, stop};
	}

	/** Run the SELECT parser on the current token stream from our current
	 *  position. It shares the tokens and SQL source; we advance our cursor
	 *  to wherever it stopped. */
	runEmbeddedSelect(): {stmt: ParsedSelectStmt; nextIndex: number} {
		return parseSelectFrom(this.tokens, this.sql, this.index);
	}

	/** Parse one expression using the SELECT parser's grammar. Since the
	 *  SELECT parser has no public expression entry point but treats
	 *  `SELECT <expr>` as a valid parse, we'd have to do a lot of glue to
	 *  expose `parseExpr`. Much simpler: we exposed `parseSelectFrom` as a
	 *  cursor-based re-entry, but we don't have `parseExprFrom`. To keep DML
	 *  compatible with the same grammar we just run a minimal expression
	 *  parser inline here that delegates to a synthesized SELECT when it
	 *  needs to. That works because the tail of an INSERT VALUES row cannot
	 *  contain top-level AND/OR/etc. that would confuse the outer DML
	 *  grammar. */
	parseExpr(): ParsedExpr {
		// We use a small trick: synthesize "select <REST>" by re-entering the
		// select parser with our cursor index and consuming ONE expression. To
		// avoid having to expose a new entry point, we instead do a direct
		// call: build a tiny helper using parseSelectFrom on a prefixed source
		// is over-engineered. Simpler approach: re-expose the select parser's
		// expression entry. Done in select_stmt.ts via `parseExprFrom`.
		const {expr, nextIndex} = parseExprFromCursor(this.tokens, this.sql, this.index);
		this.index = nextIndex;
		return expr;
	}

	// --- consume primitives ---

	peek(): Token | null {
		return this.tokens[this.index] || null;
	}
	peekAt(offset: number): Token | null {
		return this.tokens[this.index + offset] || null;
	}
	previous(back = 1): Token {
		return this.tokens[this.index - back];
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
	matchSemi(): void {
		this.matchKind('SEMI');
	}
	expectKind(kind: TokenKind, label: string): Token {
		const tok = this.tokens[this.index];
		if (!tok || tok.kind !== kind) {
			throw new SqlParseError(
				`expected ${label} (${kind}) but got ${describeToken(tok)}`,
				tok ? tok.start : this.sql.length,
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
				tok ? tok.start : this.sql.length,
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
				tok ? tok.start : this.sql.length,
			);
		}
		this.index++;
		return tok;
	}
	expectEnd(): void {
		const tok = this.peek();
		if (tok) {
			throw new SqlParseError(
				`unexpected trailing token ${tok.kind} '${tok.value}' after statement (offset ${tok.start})`,
				tok.start,
			);
		}
	}
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

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

function unquoteIdentOrString(tok: Token): string {
	if (tok.kind === 'STRING_LITERAL') {
		const v = tok.value;
		if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") {
			return v.slice(1, -1).replace(/''/g, "'");
		}
		return v;
	}
	return unquoteIdent(tok.value);
}

function describeToken(tok: Token | null): string {
	return tok ? `${tok.kind} '${tok.value}'` : 'end of input';
}

// Import from select_stmt at bottom to avoid a circular type-import pattern.
import {parseExprFromCursor} from './select_stmt.js';
