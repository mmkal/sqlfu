// sqlfu SQLite tokenizer — phase 2 of tasks/drop-antlr.md.
//
// Produces the token stream that the recursive-descent parser (phases 2-4)
// will consume. No parser yet wires up to this; it's additive.
//
// Design choices, in case you come back to this at 3 AM:
//
// 1. Forward-scan with a plain `pos` index. No generator, no regexes across
//    the whole string. One pass, one switch on `ch`, easy to debug by logging
//    `pos` + `ch` at the top of the loop.
// 2. Keywords are matched after an identifier is scanned (cheaper than a
//    keyword-first switch because most identifiers AREN'T keywords).
// 3. Every token carries `{ start, stop }` source offsets, inclusive at
//    `stop`. This matches ANTLR's `symbol.start` / `stop?.stop` semantics so
//    that `extractOriginalSql()` in `traverse.ts` keeps working unchanged
//    once we swap the analyzer over in phase 3.
// 4. Whitespace and comments are discarded — the analyzer never reads them
//    (they ARE used for original-source reconstruction, but that goes
//    through `start.getInputStream().getText(start, stop)`, which slices
//    the raw SQL, not the token stream).
// 5. Errors throw a `SqlTokenizerError` with a pointer caret; deferred to
//    the parser to decide how to surface. Keep error messages actionable —
//    see CLAUDE.md on error-message design.
//
// ## What this tokenizer recognizes
//
// - Whitespace: ` `, `\t`, `\n`, `\r`, `\f` (discarded).
// - Line comments: `-- ...` to end of line (discarded).
// - Block comments: `/* ... */` (discarded; non-nesting, per SQLite grammar).
// - Keywords: case-insensitive. Scanned as identifiers first, then upgraded
//   to the `KW_*` token kind if the uppercased text matches the keyword set.
// - Identifiers: `[A-Za-z_][A-Za-z0-9_]*`.
// - Quoted identifiers: `"..."`, `` `...` ``, `[...]` (SQL-server-style
//   bracketed). Inside `"..."` a doubled `""` is a literal quote; same for
//   backticks. Brackets don't have an escape: `[` starts, first `]` ends.
// - String literals: `'...'` with `''` escape.
// - Numeric literals: integers, floats (`1.5`, `.5`, `1.`, `1e10`, `1.5e-3`),
//   hex (`0x1A`, `0X1a`).
// - Parameter markers: `?`, `?NNN`, `:name`, `@name`, `$name`.
// - Punctuation: `.`, `(`, `)`, `,`, `;`, `*`, `+`, `-`, `/`, `%`, `~`.
// - Operators (multi-char): `||`, `<<`, `>>`, `<=`, `>=`, `<>`, `!=`, `==`.
// - Single-char operators: `<`, `>`, `=`, `&`, `|`.
//
// ## What it doesn't (yet)
//
// - BLOB literals (`x'0A1B'`). Only one test fixture uses BLOB; we'll add it
//   in phase 4 when we encounter it.
// - REGEXP, MATCH as separate kinds — they're just identifiers that the
//   parser checks by text, same as `IS_` / `IN_`.

/** All the SQLite keywords the analyzer (and thus the parser) cares about.
 *  Sourced from `src/vendor/typesql-parser/sqlite/SQLiteLexer.ts`. This is a
 *  superset of what the MVP parser will need in phase 2; shipping the full
 *  set is fine because the runtime cost is O(1) per identifier (Set lookup). */
// Non-reserved / contextual keywords are NOT in this set: `RANK`, `ROW_NUMBER`,
// `DENSE_RANK`, `CUME_DIST`, `FIRST_VALUE`, `LAST_VALUE`, `NTH_VALUE`, `NTILE`,
// `PERCENT_RANK`, `LEAD`, `LAG` (window-function identifiers — legal as
// regular function names or column names); `FILTER` stays a keyword so that
// aggregate `count(*) FILTER (WHERE ...)` parses; the window framing words
// (`PARTITION`, `RANGE`, `ROWS`, `GROUPS`, `UNBOUNDED`, `PRECEDING`,
// `FOLLOWING`, `CURRENT`, `TIES`, `OTHERS`, `EXCLUDE`, `NO`, `WINDOW`, `OVER`)
// appear only inside OVER (...) where the parser currently brace-matches, so
// their reserved-status doesn't affect expression parsing.
const KEYWORDS = new Set([
	'ABORT', 'ACTION', 'ADD', 'AFTER', 'ALL', 'ALTER', 'ALWAYS', 'ANALYZE', 'AND', 'AS', 'ASC',
	'ATTACH', 'AUTOINCREMENT', 'BEFORE', 'BEGIN', 'BETWEEN', 'BY', 'CASCADE', 'CASE', 'CAST',
	'CHECK', 'COLLATE', 'COLUMN', 'COMMIT', 'CONFLICT', 'CONSTRAINT', 'CREATE', 'CROSS',
	'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'DATABASE', 'DEFAULT',
	'DEFERRABLE', 'DEFERRED', 'DELETE', 'DESC', 'DETACH', 'DISTINCT', 'DO', 'DROP', 'EACH',
	'ELSE', 'END', 'ESCAPE', 'EXCEPT', 'EXCLUSIVE', 'EXISTS', 'EXPLAIN', 'FAIL',
	'FALSE', 'FILTER', 'FIRST', 'FOR', 'FOREIGN', 'FROM', 'FULL',
	'GENERATED', 'GLOB', 'GROUP', 'HAVING', 'IF', 'IGNORE', 'IMMEDIATE', 'IN',
	'INDEX', 'INDEXED', 'INITIALLY', 'INNER', 'INSERT', 'INSTEAD', 'INTERSECT', 'INTO', 'IS',
	'ISNULL', 'JOIN', 'KEY', 'LAST', 'LEFT', 'LIKE', 'LIMIT',
	'MATCH', 'NATURAL', 'NOT', 'NOTHING', 'NOTNULL', 'NULL', 'NULLS', 'OF', 'OFFSET',
	'ON', 'OR', 'ORDER', 'OUTER', 'OVER', 'PLAN', 'PRAGMA',
	'PRIMARY', 'QUERY', 'RAISE', 'RECURSIVE', 'REFERENCES', 'REGEXP',
	'REINDEX', 'RELEASE', 'RENAME', 'REPLACE', 'RESTRICT', 'RETURNING', 'RIGHT', 'ROLLBACK',
	'ROW', 'SAVEPOINT', 'SELECT', 'SET', 'STORED', 'TABLE', 'TEMP',
	'TEMPORARY', 'THEN', 'TO', 'TRANSACTION', 'TRIGGER', 'TRUE',
	'UNION', 'UNIQUE', 'UPDATE', 'USING', 'VACUUM', 'VALUES', 'VIEW', 'VIRTUAL', 'WHEN',
	'WHERE', 'WITH', 'WITHOUT',
]);

export type TokenKind =
	// literals
	| 'NUMERIC_LITERAL'
	| 'STRING_LITERAL'
	| 'BLOB_LITERAL'
	// identifiers
	| 'IDENTIFIER' // bare, quoted, or backticked/bracketed
	| 'BIND_PARAMETER'
	| 'KEYWORD' // uppercased text in `value`; one token kind for all 130+
	// punctuation
	| 'DOT' | 'COMMA' | 'SEMI' | 'OPEN_PAR' | 'CLOSE_PAR'
	// arithmetic
	| 'PLUS' | 'MINUS' | 'STAR' | 'DIV' | 'MOD' | 'TILDE'
	// bitwise
	| 'AMP' | 'PIPE' | 'LT2' | 'GT2'
	// comparison
	| 'LT' | 'GT' | 'LT_EQ' | 'GT_EQ' | 'ASSIGN' | 'EQ'
	| 'NOT_EQ1' // !=
	| 'NOT_EQ2' // <>
	// string concat
	| 'PIPE2';

export interface Token {
	kind: TokenKind;
	/** The source text of the token, verbatim. For KEYWORD tokens this is
	 *  uppercase-normalized (e.g. `SELECT`) so parser dispatches can use
	 *  `===`. For STRING_LITERAL / IDENTIFIER this includes surrounding quotes
	 *  — the parser is responsible for unquoting, matching ANTLR's shape. */
	value: string;
	/** Byte offset of the first character, inclusive. */
	start: number;
	/** Byte offset of the last character, inclusive. Matches ANTLR's
	 *  `Token.stop` semantic (not an exclusive `end`). */
	stop: number;
}

export class SqlTokenizerError extends Error {
	constructor(message: string, public readonly offset: number) {
		super(message);
		this.name = 'SqlTokenizerError';
	}
}

export function tokenize(sql: string): Token[] {
	const tokens: Token[] = [];
	const len = sql.length;
	let pos = 0;

	while (pos < len) {
		const start = pos;
		const ch = sql.charCodeAt(pos);

		// --- whitespace ---
		if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d || ch === 0x0c) {
			pos++;
			continue;
		}

		// --- line comment ---
		if (ch === 0x2d /* - */ && sql.charCodeAt(pos + 1) === 0x2d) {
			pos += 2;
			while (pos < len && sql.charCodeAt(pos) !== 0x0a) pos++;
			continue;
		}

		// --- block comment ---
		if (ch === 0x2f /* / */ && sql.charCodeAt(pos + 1) === 0x2a) {
			pos += 2;
			while (pos < len) {
				if (sql.charCodeAt(pos) === 0x2a && sql.charCodeAt(pos + 1) === 0x2f) {
					pos += 2;
					break;
				}
				pos++;
			}
			continue;
		}

		// --- x'deadbeef' BLOB literal — checked BEFORE the identifier branch
		// because `x` is an identifier start character but `x'...'` is a blob. ---
		if (
			(ch === 0x78 /* x */ || ch === 0x58 /* X */) &&
			sql.charCodeAt(pos + 1) === 0x27 /* ' */
		) {
			pos += 2;
			while (pos < len && sql.charCodeAt(pos) !== 0x27) pos++;
			if (pos >= len) {
				throw new SqlTokenizerError(`unterminated BLOB literal starting at offset ${start}`, start);
			}
			pos++; // consume closing '
			tokens.push({ kind: 'BLOB_LITERAL', value: sql.slice(start, pos), start, stop: pos - 1 });
			continue;
		}

		// --- identifier / keyword ---
		if (isIdentStart(ch)) {
			pos++;
			while (pos < len && isIdentCont(sql.charCodeAt(pos))) pos++;
			const text = sql.slice(start, pos);
			const upper = text.toUpperCase();
			if (KEYWORDS.has(upper)) {
				tokens.push({ kind: 'KEYWORD', value: upper, start, stop: pos - 1 });
			} else {
				tokens.push({ kind: 'IDENTIFIER', value: text, start, stop: pos - 1 });
			}
			continue;
		}

		// --- quoted identifier: "..." ---
		if (ch === 0x22 /* " */) {
			pos = scanQuoted(sql, pos, 0x22);
			tokens.push({ kind: 'IDENTIFIER', value: sql.slice(start, pos), start, stop: pos - 1 });
			continue;
		}

		// --- backtick identifier ---
		if (ch === 0x60 /* ` */) {
			pos = scanQuoted(sql, pos, 0x60);
			tokens.push({ kind: 'IDENTIFIER', value: sql.slice(start, pos), start, stop: pos - 1 });
			continue;
		}

		// --- bracketed identifier [foo] ---
		if (ch === 0x5b /* [ */) {
			pos++;
			while (pos < len && sql.charCodeAt(pos) !== 0x5d /* ] */) pos++;
			if (pos >= len) {
				throw new SqlTokenizerError(`unterminated bracketed identifier starting at offset ${start}`, start);
			}
			pos++; // consume ]
			tokens.push({ kind: 'IDENTIFIER', value: sql.slice(start, pos), start, stop: pos - 1 });
			continue;
		}

		// --- string literal ---
		if (ch === 0x27 /* ' */) {
			pos = scanQuoted(sql, pos, 0x27);
			tokens.push({ kind: 'STRING_LITERAL', value: sql.slice(start, pos), start, stop: pos - 1 });
			continue;
		}

		// --- numeric literal ---
		// Leading digit OR leading dot-digit.
		if (isDigit(ch) || (ch === 0x2e /* . */ && isDigit(sql.charCodeAt(pos + 1)))) {
			pos = scanNumber(sql, pos);
			tokens.push({ kind: 'NUMERIC_LITERAL', value: sql.slice(start, pos), start, stop: pos - 1 });
			continue;
		}

		// --- parameter markers ---
		if (ch === 0x3f /* ? */) {
			pos++;
			// optional ?NNN digit suffix
			while (pos < len && isDigit(sql.charCodeAt(pos))) pos++;
			tokens.push({ kind: 'BIND_PARAMETER', value: sql.slice(start, pos), start, stop: pos - 1 });
			continue;
		}
		if (ch === 0x3a /* : */ || ch === 0x40 /* @ */ || ch === 0x24 /* $ */) {
			// :name, @name, $name — at least one ident char must follow.
			if (!isIdentStart(sql.charCodeAt(pos + 1))) {
				throw new SqlTokenizerError(
					`parameter marker '${String.fromCharCode(ch)}' must be followed by an identifier (offset ${start})`,
					start
				);
			}
			pos += 2;
			while (pos < len && isIdentCont(sql.charCodeAt(pos))) pos++;
			tokens.push({ kind: 'BIND_PARAMETER', value: sql.slice(start, pos), start, stop: pos - 1 });
			continue;
		}

		// --- punctuation + operators ---
		const next = sql.charCodeAt(pos + 1);
		switch (ch) {
			case 0x2e /* . */: pushSingle('DOT'); break;
			case 0x2c /* , */: pushSingle('COMMA'); break;
			case 0x3b /* ; */: pushSingle('SEMI'); break;
			case 0x28 /* ( */: pushSingle('OPEN_PAR'); break;
			case 0x29 /* ) */: pushSingle('CLOSE_PAR'); break;
			case 0x2b /* + */: pushSingle('PLUS'); break;
			case 0x2d /* - */: pushSingle('MINUS'); break;
			case 0x2a /* * */: pushSingle('STAR'); break;
			case 0x2f /* / */: pushSingle('DIV'); break;
			case 0x25 /* % */: pushSingle('MOD'); break;
			case 0x7e /* ~ */: pushSingle('TILDE'); break;
			case 0x26 /* & */: pushSingle('AMP'); break;
			case 0x7c /* | */:
				if (next === 0x7c) { pushPair('PIPE2'); } else { pushSingle('PIPE'); }
				break;
			case 0x3c /* < */:
				if (next === 0x3c) pushPair('LT2');
				else if (next === 0x3d) pushPair('LT_EQ');
				else if (next === 0x3e) pushPair('NOT_EQ2');
				else pushSingle('LT');
				break;
			case 0x3e /* > */:
				if (next === 0x3e) pushPair('GT2');
				else if (next === 0x3d) pushPair('GT_EQ');
				else pushSingle('GT');
				break;
			case 0x3d /* = */:
				if (next === 0x3d) pushPair('EQ');
				else pushSingle('ASSIGN');
				break;
			case 0x21 /* ! */:
				if (next === 0x3d) pushPair('NOT_EQ1');
				else throw new SqlTokenizerError(`unexpected '!' at offset ${start} (did you mean '!='?)`, start);
				break;
			default:
				throw new SqlTokenizerError(
					`unexpected character ${JSON.stringify(String.fromCharCode(ch))} at offset ${start}`,
					start
				);
		}

		function pushSingle(kind: TokenKind) {
			tokens.push({ kind, value: sql[start], start, stop: start });
			pos = start + 1;
		}
		function pushPair(kind: TokenKind) {
			tokens.push({ kind, value: sql.slice(start, start + 2), start, stop: start + 1 });
			pos = start + 2;
		}
	}

	return tokens;
}

// --- helpers ---

function scanQuoted(sql: string, startPos: number, quoteChar: number): number {
	// startPos points at the opening quote; caller already consumed it
	// conceptually via the outer match. We still re-read it here for clarity.
	let pos = startPos + 1;
	const len = sql.length;
	while (pos < len) {
		const c = sql.charCodeAt(pos);
		if (c === quoteChar) {
			// doubled quote → literal, continue scanning
			if (sql.charCodeAt(pos + 1) === quoteChar) {
				pos += 2;
				continue;
			}
			return pos + 1; // past the closing quote
		}
		pos++;
	}
	throw new SqlTokenizerError(
		`unterminated ${String.fromCharCode(quoteChar)}-quoted string starting at offset ${startPos}`,
		startPos
	);
}

function scanNumber(sql: string, startPos: number): number {
	let pos = startPos;
	const len = sql.length;

	// hex: 0x... (only if starts exactly with 0x)
	if (
		sql.charCodeAt(pos) === 0x30 /* 0 */ &&
		(sql.charCodeAt(pos + 1) === 0x78 || sql.charCodeAt(pos + 1) === 0x58)
	) {
		pos += 2;
		while (pos < len && isHexDigit(sql.charCodeAt(pos))) pos++;
		return pos;
	}

	// integer part
	while (pos < len && isDigit(sql.charCodeAt(pos))) pos++;

	// fractional
	if (sql.charCodeAt(pos) === 0x2e /* . */) {
		pos++;
		while (pos < len && isDigit(sql.charCodeAt(pos))) pos++;
	}

	// exponent
	const eCh = sql.charCodeAt(pos);
	if (eCh === 0x65 /* e */ || eCh === 0x45 /* E */) {
		pos++;
		const sign = sql.charCodeAt(pos);
		if (sign === 0x2b /* + */ || sign === 0x2d /* - */) pos++;
		if (!isDigit(sql.charCodeAt(pos))) {
			throw new SqlTokenizerError(`missing exponent digits at offset ${pos}`, pos);
		}
		while (pos < len && isDigit(sql.charCodeAt(pos))) pos++;
	}

	return pos;
}

function isIdentStart(ch: number): boolean {
	return (ch >= 0x41 && ch <= 0x5a) /* A-Z */ ||
		(ch >= 0x61 && ch <= 0x7a) /* a-z */ ||
		ch === 0x5f /* _ */;
}

function isIdentCont(ch: number): boolean {
	return isIdentStart(ch) || isDigit(ch);
}

function isDigit(ch: number): boolean {
	return ch >= 0x30 && ch <= 0x39;
}

function isHexDigit(ch: number): boolean {
	return isDigit(ch) ||
		(ch >= 0x41 && ch <= 0x46) /* A-F */ ||
		(ch >= 0x61 && ch <= 0x66) /* a-f */;
}
