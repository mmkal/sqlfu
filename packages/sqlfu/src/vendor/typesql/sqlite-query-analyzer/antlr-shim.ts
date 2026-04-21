// sqlfu SQLite parser — shim layer over the hand-rolled AST.
//
// Phase 3 of `tasks/drop-antlr.md` introduced this layer as a compat shim
// over ANTLR `*Context` subclasses. Phase 5 (night 4) severed the ANTLR
// dependency: shim classes are now stand-alone. `instanceof` discrimination
// still works — two dedicated base classes carry the identities the analyzer
// actually checks for:
//   - `ShimParserRuleContext`      — every rule-level node (the bar for
//     `collectExpr`'s tree walk in `shared-analyzer/select-columns.ts`).
//   - `ShimExprContextBase`        — stands in for `ExprContext` identity.
//   - `ShimSelect_coreContextBase` — stands in for `Select_coreContext`.
//
// The shim wraps plain-data AST nodes produced by `select_stmt.ts` /
// `dml_stmt.ts` / `ddl_stmt.ts` and exposes exactly the accessor surface that
// `sqlite-query-analyzer/` and `shared-analyzer/` read. Every presence terminal
// (`PLUS()`, `IS_()`, `LIKE_()`, …) maps to a kind check on the wrapped AST
// node; every sub-rule (`expr(i)`, `expr_list()`, `select_core_list()`, …)
// lazily constructs a child shim.
//
// Semantic contract:
//   - `start` is a duck-typed Token with `.start` (offset) and
//     `.getInputStream()` returning a stream that can slice the source.
//   - `.stop` is `{stop: number}`. These are the only token properties
//     `extractOriginalSql` and `traverse.ts`'s WHERE-offset comparison read.
//   - `getChildCount()` / `getChild(i)` walks an `_immediateChildren` array
//     built from the AST. Only other `ShimParserRuleContext` children appear —
//     the analyzer only descends into rule-level nodes.

import type {
	ParsedSelectStmt,
	ParsedSelectCore,
	ParsedResultColumn,
	ParsedFromClause,
	ParsedTableOrSubquery,
	ParsedJoinChain,
	ParsedJoinOperator,
	ParsedJoinConstraint,
	ParsedOrderBy,
	ParsedOrderingTerm,
	ParsedLimit,
	ParsedExpr,
	ParsedWithClause,
	ParsedCTE,
} from '../../sqlfu-sqlite-parser/select_stmt.js';

import type {
	ParsedInsertStmt,
	ParsedUpdateStmt,
	ParsedDeleteStmt,
	ParsedInsertSource,
	ParsedReturningClause,
	ParsedUpsertClause,
	ParsedAssignment,
} from '../../sqlfu-sqlite-parser/dml_stmt.js';

// -----------------------------------------------------------------------------
// Token / input-stream stubs
// -----------------------------------------------------------------------------

/** Duck-typed replacement for ANTLR's `InputStream`. `extractOriginalSql`
 *  calls `start.getInputStream()?.getText(startIndex, stopIndex)` to slice the
 *  original SQL text; that is the entire surface this stub needs. */
class SourceInputStream {
	constructor(private readonly sql: string) {}
	getText(start: number, stop: number): string {
		// ANTLR's `stop` is inclusive; `String.prototype.slice` uses an
		// exclusive end, so +1.
		return this.sql.slice(start, stop + 1);
	}
}

/** Duck-typed replacement for ANTLR's `Token`. Only `.start` (offset) and
 *  `.getInputStream()` / `.stop` are read by the analyzer. */
class ShimToken {
	readonly symbol = this; // `BIND_PARAMETER().symbol.start` → same offset
	constructor(readonly start: number, readonly stop: number, private readonly input: SourceInputStream) {}
	getInputStream(): SourceInputStream {
		return this.input;
	}
}

/** A presence-token used for keyword terminals (e.g. WHERE_, IN_, IS_).
 *  We only need `.symbol.start` to be readable — analyzer uses that for the
 *  update_stmt.WHERE_() offset comparison. Everything else is presence-only. */
function terminal(offset: number, input: SourceInputStream): any {
	return new ShimToken(offset, offset, input);
}

// -----------------------------------------------------------------------------
// Base wiring — applied to every shim instance after construction
// -----------------------------------------------------------------------------

interface ShimBaseFields {
	_sql: string;
	_input: SourceInputStream;
	_nodeStart: number;
	_nodeStop: number;
	_immediateChildren: any[];
	parentCtx: any;
	start: ShimToken;
	stop: ShimToken;
}

/** Install the ParserRuleContext-compatible fields on a shim instance.
 *  Returns the populated instance. We do this in one place so every shim
 *  class's constructor stays short. */
function wireBase<T extends object>(
	self: T,
	sql: string,
	input: SourceInputStream,
	nodeStart: number,
	nodeStop: number,
	parentCtx: any,
): T & ShimBaseFields {
	const s = self as T & ShimBaseFields;
	s._sql = sql;
	s._input = input;
	s._nodeStart = nodeStart;
	s._nodeStop = nodeStop;
	s._immediateChildren = [];
	s.parentCtx = parentCtx;
	s.start = new ShimToken(nodeStart, nodeStart, input);
	s.stop = new ShimToken(nodeStop, nodeStop, input);
	return s;
}

/** Shared `getText()` implementation — slices the original source. ANTLR
 *  concatenates child token text; the same byte range gives the same result
 *  with one exception: stripped whitespace/comments. The analyzer normalises
 *  via `.toLowerCase()` or `removeDoubleQuotes()` / `splitName()` on the
 *  result, which don't depend on internal whitespace canonicalisation. */
function shimGetText(this: ShimBaseFields): string {
	return this._sql.slice(this._nodeStart, this._nodeStop + 1);
}

function shimGetChildCount(this: ShimBaseFields): number {
	return this._immediateChildren.length;
}

function shimGetChild(this: ShimBaseFields, i: number): any {
	return this._immediateChildren[i];
}

// -----------------------------------------------------------------------------
// Shim base classes — carry the `instanceof` identities the analyzer reads.
// -----------------------------------------------------------------------------

/**
 * Base class for every rule-level shim node. Analyzer code in
 * `shared-analyzer/select-columns.ts:collectExpr` uses `instanceof` against
 * this base to decide whether a child is worth descending into during the
 * expression tree walk.
 */
export class ShimParserRuleContext {
	// These fields are populated by `wireBase` after super() returns.
	_sql!: string;
	_input!: SourceInputStream;
	_nodeStart!: number;
	_nodeStop!: number;
	_immediateChildren: any[] = [];
	parentCtx: any = null;
	start!: ShimToken;
	stop!: ShimToken;
}

/** Identity base for the `ExprContext` `instanceof` checks in
 *  `traverse.ts` (parent-is-expression guards). */
export class ShimExprContextBase extends ShimParserRuleContext {}

/** Identity base for the `Select_coreContext` `instanceof` check in
 *  `select-columns.ts:collectExpr` (subquery-depth flag). */
export class ShimSelect_coreContextBase extends ShimParserRuleContext {}

// -----------------------------------------------------------------------------
// Identifier-leaf shims — these are unquoted-string wrappers.
// -----------------------------------------------------------------------------

class ShimAny_nameContext extends ShimParserRuleContext {
	private _text: string;
	constructor(text: string, sql: string, input: SourceInputStream, start: number, stop: number, parent: any) {
		super();
		wireBase(this,sql, input, start, stop, parent);
		this._text = text;
	}
	getText(): string {
		// Identifier leaves return the UNQUOTED text, matching what ANTLR's
		// `any_name().getText()` produces when the source text was a quoted
		// identifier (ANTLR strips quotes at the terminal-node level here).
		return this._text;
	}
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
}

class ShimTable_nameContext extends ShimParserRuleContext {
	private _text: string;
	private _rawText: string;
	constructor(rawText: string, unquotedText: string, sql: string, input: SourceInputStream, start: number, stop: number, parent: any) {
		super();
		wireBase(this,sql, input, start, stop, parent);
		this._text = unquotedText;
		this._rawText = rawText;
	}
	getText(): string {
		// `traverse.ts:2100` does `splitName(qualified_table_name.getText())`
		// where `qualified_table_name.getText()` returns the source form.
		// `traverse.ts:1770` does `splitName(column_name.getText())`. Both
		// `splitName` and the call at `traverse.ts:410` `any_name().getText()`
		// assume unquoted shape. Since analyzer calls do `removeDoubleQuotes`
		// afterwards in most places, either form works; we return the raw
		// source form to match ANTLR behaviour closely.
		return this._rawText;
	}
	any_name(): any {
		// analyzer only calls `.getText()` on the returned any_name.
		// See `traverse.ts:410`.
		return new ShimAny_nameContext(this._text, this._sql, this._input, this._nodeStart, this._nodeStop, this);
	}
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
}

class ShimSchema_nameContext extends ShimParserRuleContext {
	private _text: string;
	constructor(text: string, sql: string, input: SourceInputStream, start: number, stop: number, parent: any) {
		super();
		wireBase(this,sql, input, start, stop, parent);
		this._text = text;
	}
	getText(): string { return this._text; }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
}

class ShimTable_aliasContext extends ShimParserRuleContext {
	private _text: string;
	constructor(text: string, sql: string, input: SourceInputStream, start: number, stop: number, parent: any) {
		super();
		wireBase(this,sql, input, start, stop, parent);
		this._text = text;
	}
	getText(): string { return this._text; }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
}

class ShimColumn_aliasContext extends ShimParserRuleContext {
	private _text: string;
	constructor(text: string, sql: string, input: SourceInputStream, start: number, stop: number, parent: any) {
		super();
		wireBase(this,sql, input, start, stop, parent);
		this._text = text;
	}
	getText(): string { return this._text; }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
}

class ShimColumn_nameContext extends ShimParserRuleContext {
	private _text: string;
	constructor(text: string, sql: string, input: SourceInputStream, start: number, stop: number, parent: any) {
		super();
		wireBase(this,sql, input, start, stop, parent);
		this._text = text;
	}
	getText(): string { return this._text; }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
}

class ShimFunction_nameContext extends ShimParserRuleContext {
	private _text: string;
	constructor(text: string, sql: string, input: SourceInputStream, start: number, stop: number, parent: any) {
		super();
		wireBase(this,sql, input, start, stop, parent);
		this._text = text;
	}
	getText(): string { return this._text; }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
}

class ShimTable_function_nameContext extends ShimParserRuleContext {
	private _text: string;
	constructor(text: string, sql: string, input: SourceInputStream, start: number, stop: number, parent: any) {
		super();
		wireBase(this,sql, input, start, stop, parent);
		this._text = text;
	}
	getText(): string { return this._text; }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
}

class ShimQualified_table_nameContext extends ShimParserRuleContext {
	constructor(sql: string, input: SourceInputStream, start: number, stop: number, parent: any) {
		super();
		wireBase(this,sql, input, start, stop, parent);
	}
	getText(): string {
		return shimGetText.call(this as any);
	}
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
}

// -----------------------------------------------------------------------------
// Literal_value / Unary_operator — leaf-ish nodes with presence terminals
// -----------------------------------------------------------------------------

type LiteralKind = 'STRING' | 'NUMERIC' | 'BLOB' | 'NULL' | 'TRUE' | 'FALSE';

class ShimLiteral_valueContext extends ShimParserRuleContext {
	private _kind: LiteralKind;
	private _offset: number;
	constructor(kind: LiteralKind, sql: string, input: SourceInputStream, start: number, stop: number, parent: any) {
		super();
		wireBase(this,sql, input, start, stop, parent);
		this._kind = kind;
		this._offset = start;
	}
	getText(): string {
		return shimGetText.call(this as any);
	}
	STRING_LITERAL(): any { return this._kind === 'STRING' ? terminal(this._offset, this._input) : null; }
	NUMERIC_LITERAL(): any { return this._kind === 'NUMERIC' ? terminal(this._offset, this._input) : null; }
	NULL_(): any { return this._kind === 'NULL' ? terminal(this._offset, this._input) : null; }
	TRUE_(): any { return this._kind === 'TRUE' ? terminal(this._offset, this._input) : null; }
	FALSE_(): any { return this._kind === 'FALSE' ? terminal(this._offset, this._input) : null; }
	// BLOB is NOT exposed via an accessor the analyzer reads — if the test
	// suite ever lands a BLOB literal, extend here.
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
}

class ShimUnary_operatorContext extends ShimParserRuleContext {
	constructor(sql: string, input: SourceInputStream, start: number, stop: number, parent: any) {
		super();
		wireBase(this,sql, input, start, stop, parent);
	}
	getText(): string {
		return shimGetText.call(this as any);
	}
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
}

// -----------------------------------------------------------------------------
// Helper factories — build sub-shims from AST nodes
// -----------------------------------------------------------------------------

function buildColumnName(name: string, sql: string, input: SourceInputStream, start: number, stop: number, parent: any): ShimColumn_nameContext {
	return new ShimColumn_nameContext(name, sql, input, start, stop, parent);
}

function buildTableName(name: string, sql: string, input: SourceInputStream, start: number, stop: number, parent: any): ShimTable_nameContext {
	return new ShimTable_nameContext(name, name, sql, input, start, stop, parent);
}

function buildSchemaName(name: string, sql: string, input: SourceInputStream, start: number, stop: number, parent: any): ShimSchema_nameContext {
	return new ShimSchema_nameContext(name, sql, input, start, stop, parent);
}

// -----------------------------------------------------------------------------
// Expression shim — the big one
// -----------------------------------------------------------------------------

/**
 * ExprContext shim. Every ANTLR accessor the analyzer calls is overridden.
 * Accessors that identify the expression's shape return a truthy terminal or
 * child node; all others return null.
 *
 * The `_parsed` field is the plain-data ParsedExpr — we keep it so that
 * sub-expressions (`expr(0)`, `expr_list()`) can be lazily wrapped on demand.
 */
class ShimExprContext extends ShimExprContextBase {
	_parsed: ParsedExpr;
	constructor(parsed: ParsedExpr, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, parsed.start, parsed.stop, parent);
		this._parsed = parsed;
	}

	getText(): string {
		return shimGetText.call(this as any);
	}
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;

	// --- atomic forms ---

	literal_value(): any {
		const p = this._parsed;
		let kind: LiteralKind | null = null;
		if (p.kind === 'StringLiteral') kind = 'STRING';
		else if (p.kind === 'NumericLiteral') kind = 'NUMERIC';
		else if (p.kind === 'BlobLiteral') kind = 'BLOB';
		else if (p.kind === 'Null') kind = 'NULL';
		else if (p.kind === 'BoolLiteral') kind = p.value ? 'TRUE' : 'FALSE';
		if (!kind) return null;
		return new ShimLiteral_valueContext(kind, this._sql, this._input, p.start, p.stop, this);
	}

	BIND_PARAMETER(): any {
		const p = this._parsed;
		if (p.kind !== 'BindParameter') return null;
		return terminal(p.start, this._input);
	}

	column_name(): any {
		const p = this._parsed;
		if (p.kind !== 'ColumnRef') return null;
		// The column_name spans just the column part. Reconstruct its offset by
		// slicing from the end of the expression — the last identifier in the
		// source range IS the column.
		// For simplicity we use the full expr range since analyzer only calls
		// getText() on the result and `removeDoubleQuotes`+`splitName` handles
		// either shape.
		const colName = p.column;
		// Find the column's actual offset: scan from p.stop backwards through
		// the source to find where the column identifier begins. This is
		// needed because the analyzer's callers rely on `column_name.getText()`
		// returning JUST the column, not `schema.table.col`.
		const nameStart = this._sql.lastIndexOf(colName, p.stop + 1);
		const start = nameStart >= p.start ? nameStart : p.start;
		return new ShimColumn_nameContext(colName, this._sql, this._input, start, p.stop, this);
	}

	table_name(): any {
		const p = this._parsed;
		if (p.kind !== 'ColumnRef' || !p.table) return null;
		// Best-effort offset — used only to locate the name in source for
		// getText. The analyzer only calls getText() on this.
		return new ShimTable_nameContext(p.table, p.table, this._sql, this._input, p.start, p.stop, this);
	}

	function_name(): any {
		const p = this._parsed;
		if (p.kind !== 'FunctionCall') return null;
		// Function name is at the head of the expr range.
		return new ShimFunction_nameContext(p.name, this._sql, this._input, p.start, p.start + p.name.length - 1, this);
	}

	unary_operator(): any {
		const p = this._parsed;
		if (p.kind !== 'Unary') return null;
		// Presence-only; analyzer never reads the text.
		return new ShimUnary_operatorContext(this._sql, this._input, p.start, p.start, this);
	}

	// --- sub-expressions ---

	expr(i: number): any {
		const list = this._collectExprList();
		return list[i];
	}

	expr_list(): any[] {
		return this._collectExprList();
	}

	/**
	 * Produce the ANTLR-shaped `expr_list()` for this expression. In ANTLR's
	 * grammar, `expr_list()` returns ALL direct ExprContext children of this
	 * Expr, in source order. We emulate that on top of our typed AST:
	 *
	 * - Unary: [operand]
	 * - Binary: [left, right]
	 * - FunctionCall: args
	 * - Cast: [expr]
	 * - Case: flatten [operand?, when1, then1, when2, then2, ..., else?]
	 * - Between: [expr, low, high]
	 * - InList: [expr, synthetic-paren-expr]  (matches ANTLR's shape)
	 * - InSubquery: [expr]  (the select isn't a child ExprContext)
	 * - Like: [expr, pattern] or [expr, pattern, escape] if ESCAPE clause used
	 * - IsNull: [operand]
	 * - Is: [left, right]
	 * - Paren: [inner_exprs]
	 * - Subquery / Exists: []
	 * - Collate: [inner]
	 * - atoms: []
	 */
	private _collectExprList(): ShimExprContext[] {
		if (this._exprListCache) return this._exprListCache;
		const p = this._parsed;
		const wrap = (e: ParsedExpr) => new ShimExprContext(e, this._sql, this._input, this);
		let result: ShimExprContext[] = [];
		switch (p.kind) {
			case 'Unary':
				result = [wrap(p.operand)];
				break;
			case 'Binary':
				result = [wrap(p.left), wrap(p.right)];
				break;
			case 'FunctionCall':
				result = p.args.map(wrap);
				break;
			case 'Cast':
				result = [wrap(p.expr)];
				break;
			case 'Case': {
				const list: ShimExprContext[] = [];
				if (p.operand) list.push(wrap(p.operand));
				for (const w of p.when_clauses) {
					list.push(wrap(w.when));
					list.push(wrap(w.then));
				}
				if (p.else_clause) list.push(wrap(p.else_clause));
				result = list;
				break;
			}
			case 'Between':
				result = [wrap(p.expr), wrap(p.low), wrap(p.high)];
				break;
			case 'InList': {
				// ANTLR shape: the IN list (a, b, c) is itself a parenthesised
				// expression. So expr_list() returns [value_expr, synthetic_paren].
				const paren: ParsedExpr = {
					kind: 'Paren',
					exprs: p.items,
					start: p.items[0]?.start ?? p.expr.stop + 1,
					stop: p.items[p.items.length - 1]?.stop ?? p.expr.stop + 1,
				};
				result = [wrap(p.expr), wrap(paren)];
				break;
			}
			case 'InSubquery':
				result = [wrap(p.expr)];
				break;
			case 'InTable':
				result = [wrap(p.expr)];
				break;
			case 'Like':
				result = [wrap(p.expr), wrap(p.pattern)];
				if (p.escape) result.push(wrap(p.escape));
				break;
			case 'IsNull': {
				// Expose as IS <null-literal> to match ANTLR's shape: traverse.ts:724
				// reads expr.IS_() + expr(0)/expr(1) for all `x IS <rhs>` cases.
				// Synthetic NULL literal at the position just past the operand.
				const nullLit: ParsedExpr = {
					kind: 'Null',
					start: p.operand.stop + 1,
					stop: p.stop,
				};
				result = [wrap(p.operand), wrap(nullLit)];
				break;
			}
			case 'Is':
				result = [wrap(p.left), wrap(p.right)];
				break;
			case 'Paren':
				result = p.exprs.map(wrap);
				break;
			case 'Collate':
				result = [wrap(p.expr)];
				break;
			default:
				result = [];
		}
		// Populate `_immediateChildren` so getChildCount/getChild walks work.
		(this as any)._immediateChildren = result;
		this._exprListCache = result;
		return result;
	}
	private _exprListCache: ShimExprContext[] | undefined;

	select_stmt(): any {
		const p = this._parsed;
		if (p.kind === 'Subquery') return new ShimSelect_stmtContext(p.select, this._sql, this._input, this);
		if (p.kind === 'Exists') return new ShimSelect_stmtContext(p.select, this._sql, this._input, this);
		if (p.kind === 'InSubquery') return new ShimSelect_stmtContext(p.select, this._sql, this._input, this);
		return null;
	}

	// --- keyword / operator presence checks ---
	// Every one of these returns a truthy terminal when the expr matches that
	// shape, null otherwise. The analyzer only uses these for boolean checks
	// (`if (expr.IS_()) ...`), so a minimal terminal is sufficient.

	OPEN_PAR(): any {
		// Present for Paren, FunctionCall, Cast (CAST( ... AS ...)), and the
		// wrapped paren under InList's second expr_list entry.
		const p = this._parsed;
		if (p.kind === 'Paren' || p.kind === 'FunctionCall' || p.kind === 'Cast') return terminal(p.start, this._input);
		return null;
	}
	CLOSE_PAR(): any {
		const p = this._parsed;
		if (p.kind === 'Paren' || p.kind === 'FunctionCall' || p.kind === 'Cast') return terminal(p.stop, this._input);
		return null;
	}

	STAR(): any {
		const p = this._parsed;
		if (p.kind === 'Binary' && p.op === '*') return terminal(p.start, this._input);
		if (p.kind === 'FunctionCall' && p.star) return terminal(p.start, this._input);
		return null;
	}
	DIV(): any { return this._binaryOp('/'); }
	MOD(): any { return this._binaryOp('%'); }
	PLUS(): any { return this._binaryOp('+'); }
	MINUS(): any { return this._binaryOp('-'); }
	LT2(): any { return this._binaryOp('<<'); }
	GT2(): any { return this._binaryOp('>>'); }
	AMP(): any { return this._binaryOp('&'); }
	PIPE(): any { return this._binaryOp('|'); }
	PIPE2(): any { return this._binaryOp('||'); }
	LT(): any { return this._binaryOp('<'); }
	LT_EQ(): any { return this._binaryOp('<='); }
	GT(): any { return this._binaryOp('>'); }
	GT_EQ(): any { return this._binaryOp('>='); }
	ASSIGN(): any { return this._binaryOp('='); }
	EQ(): any { return this._binaryOp('=='); }
	NOT_EQ1(): any { return this._binaryOp('!='); }
	NOT_EQ2(): any { return this._binaryOp('<>'); }
	AND_(): any { return this._binaryOp('AND'); }
	OR_(): any { return this._binaryOp('OR'); }

	private _binaryOp(op: string): any {
		const p = this._parsed;
		if (p.kind === 'Binary' && p.op === op) return terminal(p.start, this._input);
		return null;
	}

	IS_(): any {
		const p = this._parsed;
		if (p.kind === 'Is' || p.kind === 'IsNull') return terminal(p.start, this._input);
		return null;
	}
	IN_(): any {
		const p = this._parsed;
		if (p.kind === 'InList' || p.kind === 'InSubquery' || p.kind === 'InTable') return terminal(p.start, this._input);
		return null;
	}
	NOT_(): any {
		const p = this._parsed;
		// Negated IN / LIKE / BETWEEN / IS (NOT DISTINCT FROM); also standalone
		// `NOT expr` (Unary with op 'NOT').
		if (p.kind === 'InList' && p.negated) return terminal(p.start, this._input);
		if (p.kind === 'InSubquery' && p.negated) return terminal(p.start, this._input);
		if (p.kind === 'InTable' && p.negated) return terminal(p.start, this._input);
		if (p.kind === 'Like' && p.negated) return terminal(p.start, this._input);
		if (p.kind === 'Between' && p.negated) return terminal(p.start, this._input);
		// NOTE: `IsNull` does NOT expose NOT_() even when negated. ANTLR treats
		// `x IS NOT NULL` with `IS_()` truthy and a synthetic NULL on RHS —
		// the `NOT` is consumed by the IS-branch, not the outer NOT_() slot.
		if (p.kind === 'Is' && p.negated) return terminal(p.start, this._input);
		if (p.kind === 'Unary' && p.op === 'NOT') return terminal(p.start, this._input);
		if (p.kind === 'Exists' && p.negated) return terminal(p.start, this._input);
		return null;
	}
	LIKE_(): any {
		const p = this._parsed;
		if (p.kind === 'Like' && p.op === 'LIKE') return terminal(p.start, this._input);
		return null;
	}
	GLOB_(): any {
		const p = this._parsed;
		if (p.kind === 'Like' && p.op === 'GLOB') return terminal(p.start, this._input);
		return null;
	}
	MATCH_(): any {
		const p = this._parsed;
		if (p.kind === 'Like' && p.op === 'MATCH') return terminal(p.start, this._input);
		return null;
	}
	BETWEEN_(): any {
		const p = this._parsed;
		if (p.kind === 'Between') return terminal(p.start, this._input);
		return null;
	}
	EXISTS_(): any {
		const p = this._parsed;
		if (p.kind === 'Exists') return terminal(p.start, this._input);
		return null;
	}
	CASE_(): any {
		const p = this._parsed;
		if (p.kind === 'Case') return terminal(p.start, this._input);
		return null;
	}
	ELSE_(): any {
		const p = this._parsed;
		if (p.kind === 'Case' && p.else_clause) return terminal(p.start, this._input);
		return null;
	}

	over_clause(): any {
		const p = this._parsed;
		if (p.kind === 'FunctionCall' && p.over_clause) {
			// Analyzer only presence-checks; return a sentinel object.
			return { _isShimOverClause: true };
		}
		return null;
	}
}

// -----------------------------------------------------------------------------
// Literal-list shim for InList's synthetic paren expression
// (Already handled in _collectExprList via a synthetic Paren AST.)
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// SELECT_CORE shim
// -----------------------------------------------------------------------------

class ShimSelect_coreContext extends ShimSelect_coreContextBase {
	_parsed: ParsedSelectCore;
	_whereExpr?: ShimExprContext;
	_groupByExpr?: ShimExprContext[];
	_havingExpr?: ShimExprContext;
	private _rcCache?: ShimResult_columnContext[];
	private _fromListCache?: ShimTable_or_subqueryContext[];
	private _joinClauseCache: ShimJoin_clauseContext | null | undefined;

	constructor(parsed: ParsedSelectCore, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, parsed.start, parsed.stop, parent);
		this._parsed = parsed;
		if (parsed.where) this._whereExpr = new ShimExprContext(parsed.where, sql, input, this);
		if (parsed.group_by.length > 0) this._groupByExpr = parsed.group_by.map(e => new ShimExprContext(e, sql, input, this));
		if (parsed.having) this._havingExpr = new ShimExprContext(parsed.having, sql, input, this);
		// Seed _immediateChildren: result_columns + from-items + where + groupby + having exprs, for
		// `getExpressions()` walks. Join clause is nested inside; use the flat
		// list version for correct tree-walk semantics.
		const kids: any[] = [];
		for (const rc of this.result_column_list()) kids.push(rc);
		const from = this.table_or_subquery_list();
		for (const t of from) kids.push(t);
		const joinClause = this.join_clause();
		if (joinClause) kids.push(joinClause);
		if (this._whereExpr) kids.push(this._whereExpr);
		if (this._groupByExpr) for (const g of this._groupByExpr) kids.push(g);
		if (this._havingExpr) kids.push(this._havingExpr);
		(this as any)._immediateChildren = kids;
	}

	getText(): string {
		return shimGetText.call(this as any);
	}
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;

	result_column_list(): any[] {
		if (!this._rcCache) {
			this._rcCache = this._parsed.result_columns.map(rc => new ShimResult_columnContext(rc, this._sql, this._input, this));
		}
		return this._rcCache;
	}

	table_or_subquery_list(): any[] {
		if (this._fromListCache) return this._fromListCache;
		const from = this._parsed.from;
		let list: ShimTable_or_subqueryContext[] = [];
		if (!from) {
			list = [];
		} else if (from.kind === 'TableList') {
			list = from.items.map(it => new ShimTable_or_subqueryContext(it, this._sql, this._input, this));
		} else if (from.kind === 'JoinChain') {
			// When the FROM uses explicit JOIN syntax, ANTLR puts the ordered
			// `table_or_subquery` list under both the Select_core AND the
			// Join_clause. Provide them in walk order here so the analyzer can
			// iterate over them in parallel with `join_operator_list` /
			// `join_constraint_list`.
			const items = [from.chain.first, ...from.chain.joins.map(j => j.target)];
			list = items.map(it => new ShimTable_or_subqueryContext(it, this._sql, this._input, this));
		}
		this._fromListCache = list;
		return list;
	}

	join_clause(): any {
		if (this._joinClauseCache !== undefined) return this._joinClauseCache;
		const from = this._parsed.from;
		if (!from || from.kind !== 'JoinChain') {
			this._joinClauseCache = null;
			return null;
		}
		const clause = new ShimJoin_clauseContext(from.chain, from.start, from.stop, this._sql, this._input, this);
		this._joinClauseCache = clause;
		return clause;
	}

	FROM_(): any {
		if (this._parsed.from) return terminal(this._parsed.start, this._input);
		return null;
	}

	GROUP_(): any {
		if (this._parsed.group_by.length > 0) return terminal(this._parsed.start, this._input);
		return null;
	}
}

// -----------------------------------------------------------------------------
// Result column
// -----------------------------------------------------------------------------

class ShimResult_columnContext extends ShimParserRuleContext {
	_parsed: ParsedResultColumn;
	private _exprCache: ShimExprContext | null | undefined;
	constructor(parsed: ParsedResultColumn, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, parsed.start, parsed.stop, parent);
		this._parsed = parsed;
		const kids: any[] = [];
		if (parsed.kind === 'Expr') {
			this._exprCache = new ShimExprContext(parsed.expr, sql, input, this);
			kids.push(this._exprCache);
		}
		(this as any)._immediateChildren = kids;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;

	STAR(): any {
		if (this._parsed.kind === 'Star' || this._parsed.kind === 'TableStar') return terminal(this._parsed.start, this._input);
		return null;
	}
	table_name(): any {
		if (this._parsed.kind !== 'TableStar') return null;
		return new ShimTable_nameContext(this._parsed.table, this._parsed.table, this._sql, this._input, this._parsed.start, this._parsed.start + this._parsed.table.length - 1, this);
	}
	expr(): any {
		if (this._exprCache !== undefined) return this._exprCache;
		if (this._parsed.kind !== 'Expr') return null;
		this._exprCache = new ShimExprContext(this._parsed.expr, this._sql, this._input, this);
		return this._exprCache;
	}
	column_alias(): any {
		if (this._parsed.kind !== 'Expr' || this._parsed.alias == null) return null;
		// Best-effort offset — analyzer only reads getText().
		return new ShimColumn_aliasContext(this._parsed.alias, this._sql, this._input, this._parsed.stop, this._parsed.stop, this);
	}
}

// -----------------------------------------------------------------------------
// Table_or_subquery
// -----------------------------------------------------------------------------

class ShimTable_or_subqueryContext extends ShimParserRuleContext {
	_parsed: ParsedTableOrSubquery;
	constructor(parsed: ParsedTableOrSubquery, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, parsed.start, parsed.stop, parent);
		this._parsed = parsed;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;

	table_name(): any {
		const p = this._parsed;
		if (p.kind === 'Table' || p.kind === 'TableFunction') return new ShimTable_nameContext(p.name, p.name, this._sql, this._input, p.start, p.stop, this);
		return null;
	}
	schema_name(): any {
		const p = this._parsed;
		if ((p.kind === 'Table' || p.kind === 'TableFunction') && p.schema) return new ShimSchema_nameContext(p.schema, this._sql, this._input, p.start, p.start + p.schema.length - 1, this);
		return null;
	}
	table_function_name(): any {
		const p = this._parsed;
		if (p.kind !== 'TableFunction') return null;
		return new ShimTable_function_nameContext(p.name, this._sql, this._input, p.start, p.start + p.name.length - 1, this);
	}
	AS_(): any {
		const p = this._parsed;
		if ('as_keyword' in p && p.as_keyword) return terminal(p.start, this._input);
		return null;
	}
	table_alias(): any {
		const p = this._parsed;
		if ('alias' in p && p.alias) return new ShimTable_aliasContext(p.alias, this._sql, this._input, p.stop - p.alias.length + 1, p.stop, this);
		return null;
	}
	expr(i: number): any {
		const p = this._parsed;
		if (p.kind !== 'TableFunction') return null;
		const arg = p.args[i];
		if (!arg) return null;
		return new ShimExprContext(arg, this._sql, this._input, this);
	}
	select_stmt(): any {
		const p = this._parsed;
		if (p.kind !== 'Subquery') return null;
		return new ShimSelect_stmtContext(p.select, this._sql, this._input, this);
	}
	table_or_subquery_list(): any[] {
		const p = this._parsed;
		if (p.kind !== 'NestedJoin') return [];
		const items = [p.chain.first, ...p.chain.joins.map(j => j.target)];
		return items.map(it => new ShimTable_or_subqueryContext(it, this._sql, this._input, this));
	}
}

// -----------------------------------------------------------------------------
// Join clause / operator / constraint
// -----------------------------------------------------------------------------

class ShimJoin_clauseContext extends ShimParserRuleContext {
	_chain: ParsedJoinChain;
	constructor(chain: ParsedJoinChain, start: number, stop: number, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, start, stop, parent);
		this._chain = chain;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;

	table_or_subquery_list(): any[] {
		const items = [this._chain.first, ...this._chain.joins.map(j => j.target)];
		return items.map(it => new ShimTable_or_subqueryContext(it, this._sql, this._input, this));
	}
	join_operator_list(): any[] {
		return this._chain.joins.map(j => new ShimJoin_operatorContext(j.operator, this._sql, this._input, this));
	}
	join_constraint_list(): any[] {
		// ANTLR emits join_constraint_list with one entry per join that HAS a
		// constraint. Traverse.ts uses index alignment with join_operator_list
		// assuming the lists have the same length — we must preserve that.
		// Emit a null-ish placeholder for constraint-less joins? No: analyzer
		// code reads `join_constraint_list[index - 1]` and checks `!= null`.
		// So we emit a sparse array — entries where the join has no constraint
		// become undefined. This matches ANTLR behaviour (actually ANTLR emits
		// only non-null constraints, indexed parallel to joins that have them,
		// but sqlfu's code assumes parallel-to-joins). Inspect traverse.ts:407:
		//   join_constraint_list[index - 1]
		// It compares to undefined; sparse matches.
		const out: any[] = [];
		for (const j of this._chain.joins) {
			if (j.constraint) out.push(new ShimJoin_constraintContext(j.constraint, this._sql, this._input, this));
			else out.push(undefined as any);
		}
		return out;
	}
}

class ShimJoin_operatorContext extends ShimParserRuleContext {
	_op: ParsedJoinOperator;
	constructor(op: ParsedJoinOperator, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, op.start, op.stop, parent);
		this._op = op;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
	LEFT_(): any { return this._op.kind === 'LEFT' ? terminal(this._op.start, this._input) : null; }
}

class ShimJoin_constraintContext extends ShimParserRuleContext {
	_c: ParsedJoinConstraint;
	constructor(c: ParsedJoinConstraint, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, c.start, c.stop, parent);
		this._c = c;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;

	USING_(): any { return this._c.kind === 'Using' ? terminal(this._c.start, this._input) : null; }
	column_name_list(): any[] {
		if (this._c.kind !== 'Using') return [];
		return this._c.columns.map(col => new ShimColumn_nameContext(col, this._sql, this._input, this._c.start, this._c.stop, this));
	}
	expr(): any {
		if (this._c.kind !== 'On') return null;
		return new ShimExprContext(this._c.expr, this._sql, this._input, this);
	}
}

// -----------------------------------------------------------------------------
// Order by / Limit / Common table
// -----------------------------------------------------------------------------

class ShimOrder_by_stmtContext extends ShimParserRuleContext {
	_o: ParsedOrderBy;
	constructor(o: ParsedOrderBy, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, o.start, o.stop, parent);
		this._o = o;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
	ordering_term_list(): any[] {
		return this._o.terms.map(t => new ShimOrdering_termContext(t, this._sql, this._input, this));
	}
}

class ShimOrdering_termContext extends ShimParserRuleContext {
	_t: ParsedOrderingTerm;
	constructor(t: ParsedOrderingTerm, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, t.start, t.stop, parent);
		this._t = t;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
	expr(): any { return new ShimExprContext(this._t.expr, this._sql, this._input, this); }
}

class ShimLimit_stmtContext extends ShimParserRuleContext {
	_l: ParsedLimit;
	constructor(l: ParsedLimit, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, l.start, l.stop, parent);
		this._l = l;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
	expr_list(): any[] {
		const list: ShimExprContext[] = [new ShimExprContext(this._l.expr, this._sql, this._input, this)];
		if (this._l.offset) list.push(new ShimExprContext(this._l.offset, this._sql, this._input, this));
		return list;
	}
	expr(i: number): any { return this.expr_list()[i]; }
}

class ShimCommon_table_stmtContext extends ShimParserRuleContext {
	_w: ParsedWithClause;
	constructor(w: ParsedWithClause, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, w.start, w.stop, parent);
		this._w = w;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
	RECURSIVE_(): any { return this._w.recursive ? terminal(this._w.start, this._input) : null; }
	common_table_expression_list(): any[] {
		return this._w.ctes.map(c => new ShimCommon_table_expressionContext(c, this._sql, this._input, this));
	}
}

class ShimCommon_table_expressionContext extends ShimParserRuleContext {
	_c: ParsedCTE;
	constructor(c: ParsedCTE, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, c.start, c.stop, parent);
		this._c = c;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
	table_name(): any {
		return new ShimTable_nameContext(this._c.name, this._c.name, this._sql, this._input, this._c.start, this._c.start + this._c.name.length - 1, this);
	}
	column_name_list(): any[] {
		return this._c.columns.map(col => new ShimColumn_nameContext(col, this._sql, this._input, this._c.start, this._c.stop, this));
	}
	select_stmt(): any { return new ShimSelect_stmtContext(this._c.select, this._sql, this._input, this); }
}

// -----------------------------------------------------------------------------
// SELECT_STMT
// -----------------------------------------------------------------------------

class ShimSelect_stmtContext extends ShimParserRuleContext {
	_parsed: ParsedSelectStmt;
	private _coresCache?: ShimSelect_coreContext[];
	constructor(parsed: ParsedSelectStmt, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, parsed.start, parsed.stop, parent);
		this._parsed = parsed;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;

	common_table_stmt(): any {
		if (!this._parsed.with_clause) return null;
		return new ShimCommon_table_stmtContext(this._parsed.with_clause, this._sql, this._input, this);
	}
	select_core_list(): any[] {
		if (!this._coresCache) {
			this._coresCache = this._parsed.select_cores.map(c => new ShimSelect_coreContext(c, this._sql, this._input, this));
		}
		return this._coresCache;
	}
	select_core(i: number): any {
		return this.select_core_list()[i];
	}
	order_by_stmt(): any {
		if (!this._parsed.order_by) return null;
		return new ShimOrder_by_stmtContext(this._parsed.order_by, this._sql, this._input, this);
	}
	limit_stmt(): any {
		if (!this._parsed.limit) return null;
		return new ShimLimit_stmtContext(this._parsed.limit, this._sql, this._input, this);
	}
}

// -----------------------------------------------------------------------------
// Returning / Values / Insert / Update / Delete
// -----------------------------------------------------------------------------

class ShimReturning_clauseContext extends ShimParserRuleContext {
	_r: ParsedReturningClause;
	constructor(r: ParsedReturningClause, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, r.start, r.stop, parent);
		this._r = r;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
	result_column_list(): any[] {
		return this._r.columns.map(c => new ShimResult_columnContext(c, this._sql, this._input, this));
	}
}

class ShimValues_clauseContext extends ShimParserRuleContext {
	_rows: ParsedExpr[][];
	_rowStarts: number[];
	_rowStops: number[];
	constructor(rows: ParsedExpr[][], rowStarts: number[], rowStops: number[], start: number, stop: number, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, start, stop, parent);
		this._rows = rows;
		this._rowStarts = rowStarts;
		this._rowStops = rowStops;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
	value_row_list(): any[] {
		return this._rows.map((r, i) => new ShimValue_rowContext(r, this._rowStarts[i], this._rowStops[i], this._sql, this._input, this));
	}
}

class ShimValue_rowContext extends ShimParserRuleContext {
	_row: ParsedExpr[];
	constructor(row: ParsedExpr[], start: number, stop: number, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, start, stop, parent);
		this._row = row;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
	expr_list(): any[] { return this._row.map(e => new ShimExprContext(e, this._sql, this._input, this)); }
}

class ShimUpsert_clauseContext extends ShimParserRuleContext {
	_u: ParsedUpsertClause;
	constructor(u: ParsedUpsertClause, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, u.start, u.stop, parent);
		this._u = u;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
	ASSIGN_list(): any[] {
		if (this._u.action.kind !== 'Update') return [];
		return this._u.action.assignments.map(a => terminal(a.assign_offset, this._input));
	}
	column_name(i: number): any {
		if (this._u.action.kind !== 'Update') return null;
		const a = this._u.action.assignments[i];
		if (!a) return null;
		// Multi-column assignments `(a, b) = (x, y)` — analyzer reads the
		// first column via the positional API. Upstream sqlfu's existing
		// tests don't exercise tuple assignments on upsert; take the first
		// column and warn if we see multiple.
		return new ShimColumn_nameContext(a.columns[0], this._sql, this._input, a.start, a.start + a.columns[0].length - 1, this);
	}
	expr(i: number): any {
		if (this._u.action.kind !== 'Update') return null;
		const a = this._u.action.assignments[i];
		if (!a) return null;
		return new ShimExprContext(a.expr, this._sql, this._input, this);
	}
}

class ShimInsert_stmtContext extends ShimParserRuleContext {
	_parsed: ParsedInsertStmt;
	constructor(parsed: ParsedInsertStmt, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, parsed.start, parsed.stop, parent);
		this._parsed = parsed;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;

	table_name(): any {
		const p = this._parsed;
		return new ShimTable_nameContext(p.table, p.table, this._sql, this._input, p.start, p.start + p.table.length - 1, this);
	}
	column_name_list(): any[] {
		return this._parsed.columns.map(c => new ShimColumn_nameContext(c, this._sql, this._input, this._parsed.start, this._parsed.stop, this));
	}
	values_clause(): any {
		const src = this._parsed.source;
		if (src.kind !== 'Values') return null;
		const starts = src.rows.map(r => r[0]?.start ?? src.start);
		const stops = src.rows.map(r => r[r.length - 1]?.stop ?? src.stop);
		return new ShimValues_clauseContext(src.rows, starts, stops, src.start, src.stop, this._sql, this._input, this);
	}
	select_stmt(): any {
		const src = this._parsed.source;
		if (src.kind !== 'Select') return null;
		return new ShimSelect_stmtContext(src.select, this._sql, this._input, this);
	}
	upsert_clause(): any {
		if (!this._parsed.upsert) return null;
		return new ShimUpsert_clauseContext(this._parsed.upsert, this._sql, this._input, this);
	}
	returning_clause(): any {
		if (!this._parsed.returning) return null;
		return new ShimReturning_clauseContext(this._parsed.returning, this._sql, this._input, this);
	}
}

class ShimUpdate_stmtContext extends ShimParserRuleContext {
	_parsed: ParsedUpdateStmt;
	constructor(parsed: ParsedUpdateStmt, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, parsed.start, parsed.stop, parent);
		this._parsed = parsed;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;

	qualified_table_name(): any {
		const p = this._parsed;
		// Reconstruct the qualified-table-name source range. Covers
		// [schema.]table[ AS alias].
		let start = p.start;
		// Skip UPDATE + OR action + keyword. Use table-position heuristic:
		// find the table name offset in source.
		const idx = this._sql.indexOf(p.table, p.start);
		if (idx > p.start) start = (p.schema ? this._sql.indexOf(p.schema, p.start) : idx);
		let stop = start + p.table.length - 1;
		if (p.alias) stop = this._sql.indexOf(p.alias, stop) + p.alias.length - 1;
		const q = new ShimQualified_table_nameContext(this._sql, this._input, start, stop, this);
		return q;
	}
	ASSIGN_list(): any[] {
		return this._parsed.assignments.map(a => terminal(a.assign_offset, this._input));
	}
	column_name(i: number): any {
		const a = this._parsed.assignments[i];
		if (!a) return null;
		return new ShimColumn_nameContext(a.columns[0], this._sql, this._input, a.start, a.start + a.columns[0].length - 1, this);
	}
	expr_list(): any[] {
		// ANTLR's update_stmt.expr_list() contains BOTH the SET-clause RHS
		// exprs AND the WHERE expr. The analyzer uses the WHERE_() token
		// offset to split them. Match that shape.
		const out: any[] = [];
		for (const a of this._parsed.assignments) out.push(new ShimExprContext(a.expr, this._sql, this._input, this));
		if (this._parsed.where) out.push(new ShimExprContext(this._parsed.where, this._sql, this._input, this));
		return out;
	}
	WHERE_(): any {
		if (this._parsed.where_offset == null) return null;
		return terminal(this._parsed.where_offset, this._input);
	}
	returning_clause(): any {
		if (!this._parsed.returning) return null;
		return new ShimReturning_clauseContext(this._parsed.returning, this._sql, this._input, this);
	}
}

class ShimDelete_stmtContext extends ShimParserRuleContext {
	_parsed: ParsedDeleteStmt;
	constructor(parsed: ParsedDeleteStmt, sql: string, input: SourceInputStream, parent: any) {
		super();
		wireBase(this,sql, input, parsed.start, parsed.stop, parent);
		this._parsed = parsed;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;

	qualified_table_name(): any {
		const p = this._parsed;
		let start = p.start;
		const idx = this._sql.indexOf(p.table, p.start);
		if (idx > p.start) start = (p.schema ? this._sql.indexOf(p.schema, p.start) : idx);
		let stop = start + p.table.length - 1;
		if (p.alias) stop = this._sql.indexOf(p.alias, stop) + p.alias.length - 1;
		return new ShimQualified_table_nameContext(this._sql, this._input, start, stop, this);
	}
	expr(): any {
		if (!this._parsed.where) return null;
		return new ShimExprContext(this._parsed.where, this._sql, this._input, this);
	}
	returning_clause(): any {
		if (!this._parsed.returning) return null;
		return new ShimReturning_clauseContext(this._parsed.returning, this._sql, this._input, this);
	}
}

// -----------------------------------------------------------------------------
// SQL_STMT envelope — discriminates select / insert / update / delete / ddl
// -----------------------------------------------------------------------------

/**
 * The specific DDL / connection-control statement kinds the analyzer checks
 * for. We only classify to the granularity `traverse.ts` reads — any further
 * structure (table name, column list, etc.) is unused at the analyzer layer
 * because DDL descriptors carry no params and no result columns.
 */
export type DdlKind =
	| 'create_table_stmt'
	| 'create_index_stmt'
	| 'create_view_stmt'
	| 'create_trigger_stmt'
	| 'create_virtual_table_stmt'
	| 'alter_table_stmt'
	| 'drop_stmt'
	| 'pragma_stmt'
	| 'vacuum_stmt'
	| 'reindex_stmt'
	| 'analyze_stmt'
	| 'attach_stmt'
	| 'detach_stmt'
	| 'begin_stmt'
	| 'commit_stmt'
	| 'rollback_stmt'
	| 'savepoint_stmt'
	| 'release_stmt';

export type ParsedTopStmt =
	| { kind: 'select'; stmt: ParsedSelectStmt }
	| { kind: 'insert'; stmt: ParsedInsertStmt }
	| { kind: 'update'; stmt: ParsedUpdateStmt }
	| { kind: 'delete'; stmt: ParsedDeleteStmt }
	| { kind: 'ddl'; ddl_kind: DdlKind; sql: string; start: number; stop: number };

class ShimSql_stmtContext extends ShimParserRuleContext {
	_parsed: ParsedTopStmt;
	constructor(parsed: ParsedTopStmt, sql: string, input: SourceInputStream, parent: any) {
		super();
		const range = getStmtRange(parsed);
		wireBase(this, sql, input, range.start, range.stop, parent);
		this._parsed = parsed;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount = shimGetChildCount;
	getChild = shimGetChild;
	select_stmt(): any {
		if (this._parsed.kind !== 'select') return null;
		return new ShimSelect_stmtContext(this._parsed.stmt, this._sql, this._input, this);
	}
	insert_stmt(): any {
		if (this._parsed.kind !== 'insert') return null;
		return new ShimInsert_stmtContext(this._parsed.stmt, this._sql, this._input, this);
	}
	update_stmt(): any {
		if (this._parsed.kind !== 'update') return null;
		return new ShimUpdate_stmtContext(this._parsed.stmt, this._sql, this._input, this);
	}
	delete_stmt(): any {
		if (this._parsed.kind !== 'delete') return null;
		return new ShimDelete_stmtContext(this._parsed.stmt, this._sql, this._input, this);
	}
	// DDL / connection-control accessors. Each returns an opaque truthy
	// marker (ANTLR's accessors return a ParserRuleContext; the analyzer
	// only reads presence for DDL — it never walks the structure), or null
	// if the statement isn't that kind. The marker carries the parent ref
	// so `getText()` / range-based helpers continue to work.
	create_table_stmt(): any { return this._ddlMarker('create_table_stmt'); }
	create_index_stmt(): any { return this._ddlMarker('create_index_stmt'); }
	create_view_stmt(): any { return this._ddlMarker('create_view_stmt'); }
	create_trigger_stmt(): any { return this._ddlMarker('create_trigger_stmt'); }
	create_virtual_table_stmt(): any { return this._ddlMarker('create_virtual_table_stmt'); }
	alter_table_stmt(): any { return this._ddlMarker('alter_table_stmt'); }
	drop_stmt(): any { return this._ddlMarker('drop_stmt'); }
	pragma_stmt(): any { return this._ddlMarker('pragma_stmt'); }
	vacuum_stmt(): any { return this._ddlMarker('vacuum_stmt'); }
	reindex_stmt(): any { return this._ddlMarker('reindex_stmt'); }
	analyze_stmt(): any { return this._ddlMarker('analyze_stmt'); }
	attach_stmt(): any { return this._ddlMarker('attach_stmt'); }
	detach_stmt(): any { return this._ddlMarker('detach_stmt'); }
	begin_stmt(): any { return this._ddlMarker('begin_stmt'); }
	commit_stmt(): any { return this._ddlMarker('commit_stmt'); }
	rollback_stmt(): any { return this._ddlMarker('rollback_stmt'); }
	savepoint_stmt(): any { return this._ddlMarker('savepoint_stmt'); }
	release_stmt(): any { return this._ddlMarker('release_stmt'); }
	private _ddlMarker(kind: DdlKind): any {
		if (this._parsed.kind !== 'ddl' || this._parsed.ddl_kind !== kind) return null;
		const marker = new ShimParserRuleContext();
		wireBase(marker, this._sql, this._input, this._parsed.start, this._parsed.stop, this);
		return marker;
	}
}

class ShimSql_stmt_listContext extends ShimParserRuleContext {
	children: any[];
	constructor(sql: string, input: SourceInputStream, children: any[]) {
		super();
		const last = children[children.length - 1];
		const first = children[0];
		const start = first ? first._nodeStart : 0;
		const stop = last ? last._nodeStop : 0;
		wireBase(this, sql, input, start, stop, null);
		this.children = children;
	}
	getText(): string { return shimGetText.call(this as any); }
	getChildCount(): number { return this.children.length; }
	getChild(i: number): any { return this.children[i]; }
}

function getStmtRange(p: ParsedTopStmt): { start: number; stop: number } {
	if (p.kind === 'ddl') return { start: p.start, stop: p.stop };
	return { start: p.stmt.start, stop: p.stmt.stop };
}

// -----------------------------------------------------------------------------
// Public API — parse entrypoint + wrapper around parseSqlite(sql)
// -----------------------------------------------------------------------------

/**
 * Shim counterpart of `parseSqlite(sql)` from the ANTLR surface. Returns an
 * object with `.sql_stmt()` and `.sql_stmt_list()` methods that produce
 * ANTLR-compatible shim contexts. The analyzer consumes this object
 * interchangeably with the real ANTLR parser.
 *
 * This entrypoint expects the caller to pass in a `ParsedTopStmt[]` array
 * containing the statements they want exposed. Most callers will use the
 * specific `wrap*Stmt()` helpers below — this API matches the ANTLR shape
 * specifically for `sqlite-query-analyzer/parser.ts`'s `parser.sql_stmt()`
 * pattern and for `enum-parser.ts`'s `parser.sql_stmt_list().children` walk.
 */
export function shimParseResult(sql: string, stmts: ParsedTopStmt[]): {
	sql_stmt(): any;
	sql_stmt_list(): any;
} {
	const input = new SourceInputStream(sql);
	const sqlStmtShims = stmts.map(s => new ShimSql_stmtContext(s, sql, input, null));
	return {
		sql_stmt(): any {
			return sqlStmtShims[0];
		},
		sql_stmt_list(): any {
			return new ShimSql_stmt_listContext(sql, input, sqlStmtShims);
		},
	};
}

/** Wrap a single statement for use by the analyzer. Used by
 *  `sqlite-query-analyzer/parser.ts` when it expects a `Sql_stmtContext`. */
export function wrapSqlStmt(sql: string, stmt: ParsedTopStmt): any {
	const input = new SourceInputStream(sql);
	return new ShimSql_stmtContext(stmt, sql, input, null);
}

/**
 * Shim-parser entrypoint the analyzer uses in place of
 * `parseSqlite(sql).sql_stmt()`. Dispatches on the first meaningful
 * keyword and delegates to the appropriate sub-parser in
 * `sqlfu-sqlite-parser/`. Returns a Sql_stmtContext-compatible shim.
 *
 * The implementation lives in a `.js` file indirection to avoid pulling
 * the plain-data AST types into strict typechecking from consumers that
 * want to stay loose. Call sites in `parser.ts` just see the opaque
 * ANTLR-shaped shim.
 */
export function parseSqlToShim(sql: string): any {
	// Dispatch on the first keyword (after optional whitespace/comments).
	// `tokenize` is the canonical source of "first non-trivia token".
	const tokens = tokenizeForDispatch(sql);
	const firstIdx = tokens.findIndex(t => t.kind === 'KEYWORD');
	if (firstIdx < 0) {
		throw new Error(`parseSqlToShim: no keyword found in SQL: ${JSON.stringify(sql.slice(0, 80))}`);
	}
	const first = tokens[firstIdx];
	const kw = first.value;
	// Recognise top-level statements the analyzer can handle. WITH is
	// prefix to SELECT / INSERT / UPDATE / DELETE — only SELECT is
	// supported at the top level by parseSelectStmt; WITH on DML is out
	// of scope for now (matches the scope note in dml_stmt.ts).
	if (kw === 'SELECT' || kw === 'WITH') {
		const stmt = _parseSelectStmt(sql);
		return wrapSqlStmt(sql, {kind: 'select', stmt});
	}
	if (kw === 'INSERT' || kw === 'REPLACE') {
		const stmt = _parseInsertStmt(sql);
		return wrapSqlStmt(sql, {kind: 'insert', stmt});
	}
	if (kw === 'UPDATE') {
		const stmt = _parseUpdateStmt(sql);
		return wrapSqlStmt(sql, {kind: 'update', stmt});
	}
	if (kw === 'DELETE') {
		const stmt = _parseDeleteStmt(sql);
		return wrapSqlStmt(sql, {kind: 'delete', stmt});
	}
	// DDL / connection-control statements. The analyzer returns an empty
	// descriptor for any of these; we classify just finely enough that
	// `sql_stmt.<specific>_stmt()` accessors in traverse.ts read non-null
	// for the matching kind (equivalent to the ANTLR parse tree shape).
	const ddlKind = classifyDdlKeyword(tokens, firstIdx);
	if (ddlKind) {
		return wrapSqlStmt(sql, {kind: 'ddl', ddl_kind: ddlKind, sql, start: first.start, stop: tokens[tokens.length - 1]?.stop ?? first.stop});
	}
	throw new Error(`parseSqlToShim: unsupported top-level keyword '${kw}'`);
}

/**
 * Classify a DDL / connection-control keyword to the specific kind traverse.ts
 * looks for. Returns null if the keyword isn't a DDL kind we recognise — the
 * caller then produces the "unsupported" error.
 *
 * For CREATE we peek past optional modifiers (UNIQUE / TEMP / TEMPORARY /
 * VIRTUAL) to find the noun (TABLE / INDEX / VIEW / TRIGGER) so DROP vs
 * CREATE INDEX etc. classify correctly.
 */
function classifyDdlKeyword(tokens: {kind: string; value: string}[], firstIdx: number): DdlKind | null {
	const kw = tokens[firstIdx].value;
	const peek = (offset: number) => tokens[firstIdx + offset]?.value;
	if (kw === 'CREATE') {
		let i = 1;
		while (['UNIQUE', 'TEMP', 'TEMPORARY'].includes(peek(i) || '')) i++;
		const noun = peek(i);
		if (noun === 'VIRTUAL') return 'create_virtual_table_stmt';
		if (noun === 'TABLE') return 'create_table_stmt';
		if (noun === 'INDEX') return 'create_index_stmt';
		if (noun === 'VIEW') return 'create_view_stmt';
		if (noun === 'TRIGGER') return 'create_trigger_stmt';
		return 'create_table_stmt'; // unreachable in valid SQL; fall back to table
	}
	if (kw === 'DROP') return 'drop_stmt';
	if (kw === 'ALTER') return 'alter_table_stmt';
	if (kw === 'PRAGMA') return 'pragma_stmt';
	if (kw === 'VACUUM') return 'vacuum_stmt';
	if (kw === 'REINDEX') return 'reindex_stmt';
	if (kw === 'ANALYZE') return 'analyze_stmt';
	if (kw === 'ATTACH') return 'attach_stmt';
	if (kw === 'DETACH') return 'detach_stmt';
	if (kw === 'BEGIN') return 'begin_stmt';
	if (kw === 'COMMIT' || kw === 'END') return 'commit_stmt';
	if (kw === 'ROLLBACK') return 'rollback_stmt';
	if (kw === 'SAVEPOINT') return 'savepoint_stmt';
	if (kw === 'RELEASE') return 'release_stmt';
	return null;
}

// -----------------------------------------------------------------------------
// Lazy re-imports of the sub-parsers. These sit at the bottom of the file
// because the dispatcher is the only caller; callers of the shim classes
// above don't need to pull the parser in.
// -----------------------------------------------------------------------------

import {tokenize as tokenizeForDispatch} from '../../sqlfu-sqlite-parser/tokenizer.js';
import {parseSelectStmt as _parseSelectStmt} from '../../sqlfu-sqlite-parser/select_stmt.js';
import {parseInsertStmt as _parseInsertStmt, parseUpdateStmt as _parseUpdateStmt, parseDeleteStmt as _parseDeleteStmt} from '../../sqlfu-sqlite-parser/dml_stmt.js';

/** Exposed for enum-parser, traverse.ts's `getExpressions(expr, ClassCtor)`
 *  calls, and tests. */
export {
	ShimExprContext,
	ShimSql_stmtContext,
	ShimSelect_stmtContext,
	ShimSelect_coreContext,
	ShimColumn_nameContext,
};
