// sqlfu SQLite DDL parser — CREATE TABLE only, narrowly scoped.
//
// Consumed by `vendor/typesql/sqlite-query-analyzer/enum-parser.ts`, which
// needs to walk column definitions and their CHECK constraints to detect
// `CHECK (col IN ('a', 'b', 'c'))` enum patterns.
//
// Scope discipline: we parse only what enum-parser needs — column names,
// column-level CHECK constraints, and the CHECK expression. Everything else
// (types, defaults, references, table-level constraints, INDEX / VIEW / etc.)
// is either skipped with a brace-matcher or not parsed at all. If a future
// caller needs more, expand here rather than adding a separate DDL module.
//
// Top-level parseCreateTableStmts() accepts a multi-statement SQL string
// (the driver concatenates CREATE TABLE statements with `;` — see
// `query-executor.ts:308` `loadCreateTableStmtWithCheckConstraint`), walks
// it statement-by-statement, and returns only the CREATE TABLE statements.
// Non-CREATE-TABLE statements in the input are skipped to the next `;`.

import {type Token, tokenize} from './tokenizer.js';
import {parseExprFromCursor, type ParsedExpr, SqlParseError} from './select_stmt.js';

export interface ParsedCreateTableStmt {
	kind: 'Create_table_stmt';
	schema: string | null;
	table: string;
	columns: ParsedColumnDef[];
	start: number;
	stop: number;
}

export interface ParsedColumnDef {
	name: string;
	/** Column-level constraints in source order. We surface only CHECK here —
	 *  other constraints are not exposed because no consumer reads them. */
	constraints: ParsedColumnConstraint[];
	start: number;
	stop: number;
}

export interface ParsedColumnConstraint {
	check: boolean;
	expr: ParsedExpr | null;
	start: number;
	stop: number;
}

/** Parse a multi-statement SQL string and return the CREATE TABLE statements
 *  it contains. Other top-level statements (VIEW, INDEX, PRAGMA, etc.) are
 *  tolerated and skipped. */
export function parseCreateTableStmts(sql: string): ParsedCreateTableStmt[] {
	const tokens = tokenize(sql);
	const p = new DdlParser(tokens, sql);
	const result: ParsedCreateTableStmt[] = [];
	while (!p.atEnd()) {
		// Tolerate trailing whitespace/SEMI between statements.
		if (p.matchKind('SEMI')) continue;
		const stmt = p.tryParseCreateTable();
		if (stmt) result.push(stmt);
		else p.skipToNextStmt();
	}
	return result;
}

class DdlParser {
	private index = 0;
	constructor(private readonly tokens: Token[], private readonly sql: string) {}

	atEnd(): boolean {
		return this.index >= this.tokens.length;
	}

	peek(): Token | undefined {
		return this.tokens[this.index];
	}

	advance(): Token {
		const t = this.tokens[this.index];
		if (!t) throw new SqlParseError('unexpected end of input', this.sql.length);
		this.index++;
		return t;
	}

	matchKind(kind: Token['kind']): boolean {
		const t = this.peek();
		if (t && t.kind === kind) {
			this.advance();
			return true;
		}
		return false;
	}

	checkKeyword(kw: string): boolean {
		const t = this.peek();
		return !!(t && t.kind === 'KEYWORD' && t.value === kw);
	}

	matchKeyword(kw: string): boolean {
		if (this.checkKeyword(kw)) {
			this.advance();
			return true;
		}
		return false;
	}

	expectKeyword(kw: string): Token {
		const t = this.peek();
		if (!t || t.kind !== 'KEYWORD' || t.value !== kw) {
			throw new SqlParseError(`expected keyword ${kw}`, t ? t.start : this.sql.length);
		}
		return this.advance();
	}

	expectIdent(label: string): Token {
		const t = this.peek();
		if (!t || t.kind !== 'IDENTIFIER') {
			throw new SqlParseError(`expected ${label}`, t ? t.start : this.sql.length);
		}
		return this.advance();
	}

	expectKind(kind: Token['kind'], label: string): Token {
		const t = this.peek();
		if (!t || t.kind !== kind) {
			throw new SqlParseError(`expected ${label}`, t ? t.start : this.sql.length);
		}
		return this.advance();
	}

	/** Advance past the current statement up to (and including) the next top-level `;`. */
	skipToNextStmt(): void {
		let depth = 0;
		while (!this.atEnd()) {
			const t = this.tokens[this.index];
			if (t.kind === 'OPEN_PAR') depth++;
			else if (t.kind === 'CLOSE_PAR') depth--;
			else if (t.kind === 'SEMI' && depth === 0) {
				this.index++;
				return;
			}
			this.index++;
		}
	}

	tryParseCreateTable(): ParsedCreateTableStmt | null {
		const save = this.index;
		if (!this.matchKeyword('CREATE')) return null;
		// Consume optional TEMP / TEMPORARY.
		this.matchKeyword('TEMP');
		this.matchKeyword('TEMPORARY');
		if (!this.matchKeyword('TABLE')) {
			this.index = save;
			return null;
		}
		// Now committed — failures past this point throw, but higher-level
		// callers will swallow the error and move on.
		return this.parseCreateTableBody(this.tokens[save].start);
	}

	parseCreateTableBody(startOffset: number): ParsedCreateTableStmt {
		// [IF NOT EXISTS]
		if (this.matchKeyword('IF')) {
			this.expectKeyword('NOT');
			this.expectKeyword('EXISTS');
		}

		// [schema.]table_name
		let schema: string | null = null;
		const firstIdentTok = this.expectIdent('table name');
		let table = unquoteIdent(firstIdentTok.value);
		if (this.matchKind('DOT')) {
			schema = table;
			const nameTok = this.expectIdent('table name');
			table = unquoteIdent(nameTok.value);
		}

		// Body: (col_def [, col_def | table_constraint]*)
		// OR: AS select_stmt — not enum-relevant; return empty column list.
		if (this.matchKeyword('AS')) {
			// CREATE TABLE foo AS SELECT ... — skip to end of stmt.
			this.skipToNextStmt();
			return {
				kind: 'Create_table_stmt',
				schema,
				table,
				columns: [],
				start: startOffset,
				stop: this.previousTokenStop(),
			};
		}

		this.expectKind('OPEN_PAR', `'(' before column definitions`);
		const columns: ParsedColumnDef[] = [];
		while (!this.checkKind('CLOSE_PAR')) {
			if (this.isTableConstraintStart()) {
				this.skipTableConstraint();
			} else {
				columns.push(this.parseColumnDef());
			}
			if (!this.matchKind('COMMA')) break;
		}
		const closePar = this.expectKind('CLOSE_PAR', `')' closing table body`);
		// Optional trailing table options: WITHOUT ROWID, STRICT.
		while (this.matchKeyword('WITHOUT') || this.matchKeyword('STRICT')) {
			if (this.matchKeyword('ROWID')) continue;
		}
		return {
			kind: 'Create_table_stmt',
			schema,
			table,
			columns,
			start: startOffset,
			stop: closePar.stop,
		};
	}

	checkKind(kind: Token['kind']): boolean {
		const t = this.peek();
		return !!(t && t.kind === kind);
	}

	private isTableConstraintStart(): boolean {
		// Table-level constraints start with one of: PRIMARY, UNIQUE, CHECK,
		// FOREIGN, CONSTRAINT. Column defs start with an identifier — unless the
		// identifier is actually one of these keywords.
		return (
			this.checkKeyword('PRIMARY') ||
			this.checkKeyword('UNIQUE') ||
			this.checkKeyword('CHECK') ||
			this.checkKeyword('FOREIGN') ||
			this.checkKeyword('CONSTRAINT')
		);
	}

	private skipTableConstraint(): void {
		// Skip past the constraint definition. Track paren depth so an embedded
		// check(x IN ('a',',')) doesn't confuse us.
		let depth = 0;
		while (!this.atEnd()) {
			const t = this.tokens[this.index];
			if (t.kind === 'OPEN_PAR') depth++;
			else if (t.kind === 'CLOSE_PAR') {
				if (depth === 0) return; // closing the table body
				depth--;
			} else if (t.kind === 'COMMA' && depth === 0) {
				return; // next column/constraint
			}
			this.index++;
		}
	}

	private previousTokenStop(): number {
		const prev = this.tokens[this.index - 1];
		return prev ? prev.stop : 0;
	}

	parseColumnDef(): ParsedColumnDef {
		const nameTok = this.expectIdent('column name');
		const name = unquoteIdent(nameTok.value);
		const start = nameTok.start;

		// Skip type name (0 or more words that aren't keywords signaling a
		// constraint, optionally with parenthesised size: VARCHAR(255),
		// NUMERIC(10, 2)).
		while (this.peek() && this.isTypeNameToken()) {
			this.advance();
			if (this.checkKind('OPEN_PAR')) {
				// eat a balanced paren group for type size.
				this.consumeBalancedParens();
			}
		}

		// Column constraints.
		const constraints: ParsedColumnConstraint[] = [];
		let stop = nameTok.stop;
		while (this.peek() && !this.checkKind('COMMA') && !this.checkKind('CLOSE_PAR')) {
			const c = this.parseColumnConstraint();
			constraints.push(c);
			stop = c.stop;
		}
		return {name, constraints, start, stop};
	}

	/** Heuristic: a token is a "type name" token if it's an identifier OR one
	 *  of the very-common type-name-position keywords that are legal in SQLite
	 *  column types. This errs on the side of consuming — if we encounter
	 *  something that actually starts a constraint, we stop. */
	private isTypeNameToken(): boolean {
		const t = this.peek();
		if (!t) return false;
		if (t.kind === 'IDENTIFIER') return true;
		// Constraint-introducing keywords terminate type consumption.
		if (t.kind !== 'KEYWORD') return false;
		const constraintStart = new Set([
			'CONSTRAINT', 'PRIMARY', 'NOT', 'NULL', 'UNIQUE', 'CHECK', 'DEFAULT',
			'COLLATE', 'REFERENCES', 'GENERATED', 'AS',
		]);
		return !constraintStart.has(t.value);
	}

	private consumeBalancedParens(): void {
		this.expectKind('OPEN_PAR', `'('`);
		let depth = 1;
		while (!this.atEnd() && depth > 0) {
			const t = this.advance();
			if (t.kind === 'OPEN_PAR') depth++;
			else if (t.kind === 'CLOSE_PAR') depth--;
		}
	}

	parseColumnConstraint(): ParsedColumnConstraint {
		const start = this.peek()!.start;
		// Optional: CONSTRAINT name
		if (this.matchKeyword('CONSTRAINT')) {
			// skip the constraint-name identifier.
			this.advance();
		}
		// CHECK (expr) — the one we care about.
		if (this.matchKeyword('CHECK')) {
			this.expectKind('OPEN_PAR', `'(' after CHECK`);
			const exprStart = this.index;
			const {expr, nextIndex} = parseExprFromCursor(this.tokens, this.sql, exprStart);
			this.index = nextIndex;
			const closePar = this.expectKind('CLOSE_PAR', `')' after CHECK expr`);
			return {check: true, expr, start, stop: closePar.stop};
		}
		// Anything else — skip. PRIMARY KEY [(direction)], NOT NULL, UNIQUE,
		// DEFAULT expr, COLLATE name, REFERENCES ..., GENERATED ALWAYS AS,
		// etc. Use a brace-matching skip that terminates at `,` or `)` at
		// paren depth 0.
		const constraintStart = this.index;
		this.skipConstraintBody();
		const stop = this.tokens[this.index - 1]?.stop ?? start;
		void constraintStart;
		return {check: false, expr: null, start, stop};
	}

	private skipConstraintBody(): void {
		// We're positioned at the first token of a non-CHECK column constraint.
		// Consume tokens until we hit `,` or `)` at paren depth 0 — but advance
		// at least one token first so the outer loop makes progress.
		let depth = 0;
		let advanced = false;
		while (!this.atEnd()) {
			const t = this.tokens[this.index];
			if (t.kind === 'OPEN_PAR') {
				depth++;
				this.index++;
				advanced = true;
				continue;
			}
			if (t.kind === 'CLOSE_PAR') {
				if (depth === 0) return;
				depth--;
				this.index++;
				advanced = true;
				continue;
			}
			if ((t.kind === 'COMMA' || t.kind === 'SEMI') && depth === 0) return;
			// Stop if a new column-constraint keyword starts at depth 0 — so
			// `name text primary key not null` treats PRIMARY KEY and NOT NULL
			// as separate constraints. But only after we've advanced at least
			// one token (otherwise we'd never consume the current token).
			if (advanced && depth === 0 && t.kind === 'KEYWORD' && isColumnConstraintKeyword(t.value)) return;
			this.index++;
			advanced = true;
		}
	}
}

function isColumnConstraintKeyword(kw: string): boolean {
	return (
		kw === 'CONSTRAINT' ||
		kw === 'PRIMARY' ||
		kw === 'NOT' ||
		kw === 'UNIQUE' ||
		kw === 'CHECK' ||
		kw === 'DEFAULT' ||
		kw === 'COLLATE' ||
		kw === 'REFERENCES' ||
		kw === 'GENERATED' ||
		kw === 'AS'
	);
}

function unquoteIdent(text: string): string {
	if (text.length >= 2) {
		const first = text[0];
		const last = text[text.length - 1];
		if (first === '"' && last === '"') return text.slice(1, -1).replace(/""/g, '"');
		if (first === '`' && last === '`') return text.slice(1, -1).replace(/``/g, '`');
		if (first === '[' && last === ']') return text.slice(1, -1);
	}
	return text;
}
