import {expect, test} from 'vitest';
import {tokenize, type Token} from '../../src/vendor/sqlfu-sqlite-parser/tokenizer.js';

// These fixtures are drawn from `packages/sqlfu/test/generate.test.ts` —
// they're the shapes that the typegen test suite exercises end-to-end today.
// Keeping them here as a lightweight readable snapshot lets us catch any
// token-stream regression the moment it happens, without needing to run the
// whole generate pipeline.
//
// If you change a fixture, update the snapshot. If a snapshot surprises you,
// the tokenizer changed shape — read the diff before updating.

test('tokenizes a trivial SELECT', () => {
	expect(simplify(tokenize(`select id, slug from posts;`))).toMatchInlineSnapshot(`
		[
		  "KEYWORD SELECT",
		  "IDENTIFIER id",
		  "COMMA ,",
		  "IDENTIFIER slug",
		  "KEYWORD FROM",
		  "IDENTIFIER posts",
		  "SEMI ;",
		]
	`);
});

test('tokenizes a SELECT with a named parameter', () => {
	expect(simplify(tokenize(`select id, slug, title from posts where slug = :slug limit 1;`))).toMatchInlineSnapshot(`
		[
		  "KEYWORD SELECT",
		  "IDENTIFIER id",
		  "COMMA ,",
		  "IDENTIFIER slug",
		  "COMMA ,",
		  "IDENTIFIER title",
		  "KEYWORD FROM",
		  "IDENTIFIER posts",
		  "KEYWORD WHERE",
		  "IDENTIFIER slug",
		  "ASSIGN =",
		  "BIND_PARAMETER :slug",
		  "KEYWORD LIMIT",
		  "NUMERIC_LITERAL 1",
		  "SEMI ;",
		]
	`);
});

test('tokenizes an INSERT with named parameters', () => {
	expect(simplify(tokenize(`insert into posts (slug, title) values (:slug, :title);`))).toMatchInlineSnapshot(`
		[
		  "KEYWORD INSERT",
		  "KEYWORD INTO",
		  "IDENTIFIER posts",
		  "OPEN_PAR (",
		  "IDENTIFIER slug",
		  "COMMA ,",
		  "IDENTIFIER title",
		  "CLOSE_PAR )",
		  "KEYWORD VALUES",
		  "OPEN_PAR (",
		  "BIND_PARAMETER :slug",
		  "COMMA ,",
		  "BIND_PARAMETER :title",
		  "CLOSE_PAR )",
		  "SEMI ;",
		]
	`);
});

test('tokenizes a CREATE TABLE with an inline CHECK enum', () => {
	const sql = `create table posts (id integer primary key, slug text not null, status text check (status in ('draft', 'published')));`;
	expect(simplify(tokenize(sql))).toMatchInlineSnapshot(`
		[
		  "KEYWORD CREATE",
		  "KEYWORD TABLE",
		  "IDENTIFIER posts",
		  "OPEN_PAR (",
		  "IDENTIFIER id",
		  "IDENTIFIER integer",
		  "KEYWORD PRIMARY",
		  "KEYWORD KEY",
		  "COMMA ,",
		  "IDENTIFIER slug",
		  "IDENTIFIER text",
		  "KEYWORD NOT",
		  "KEYWORD NULL",
		  "COMMA ,",
		  "IDENTIFIER status",
		  "IDENTIFIER text",
		  "KEYWORD CHECK",
		  "OPEN_PAR (",
		  "IDENTIFIER status",
		  "KEYWORD IN",
		  "OPEN_PAR (",
		  "STRING_LITERAL 'draft'",
		  "COMMA ,",
		  "STRING_LITERAL 'published'",
		  "CLOSE_PAR )",
		  "CLOSE_PAR )",
		  "CLOSE_PAR )",
		  "SEMI ;",
		]
	`);
});

test('handles the full SQLite operator set', () => {
	expect(simplify(tokenize(`a || b <> c != d <= e >= f == g < h > i << j >> k & l | m`))).toMatchInlineSnapshot(`
		[
		  "IDENTIFIER a",
		  "PIPE2 ||",
		  "IDENTIFIER b",
		  "NOT_EQ2 <>",
		  "IDENTIFIER c",
		  "NOT_EQ1 !=",
		  "IDENTIFIER d",
		  "LT_EQ <=",
		  "IDENTIFIER e",
		  "GT_EQ >=",
		  "IDENTIFIER f",
		  "EQ ==",
		  "IDENTIFIER g",
		  "LT <",
		  "IDENTIFIER h",
		  "GT >",
		  "IDENTIFIER i",
		  "LT2 <<",
		  "IDENTIFIER j",
		  "GT2 >>",
		  "IDENTIFIER k",
		  "AMP &",
		  "IDENTIFIER l",
		  "PIPE |",
		  "IDENTIFIER m",
		]
	`);
});

test('handles all parameter marker flavors', () => {
	// ?  ?N  :name  @name  $name — SQLite supports all five.
	expect(simplify(tokenize(`select ?, ?2, :name, @other, $third`))).toMatchInlineSnapshot(`
		[
		  "KEYWORD SELECT",
		  "BIND_PARAMETER ?",
		  "COMMA ,",
		  "BIND_PARAMETER ?2",
		  "COMMA ,",
		  "BIND_PARAMETER :name",
		  "COMMA ,",
		  "BIND_PARAMETER @other",
		  "COMMA ,",
		  "BIND_PARAMETER $third",
		]
	`);
});

test('handles string literals with doubled-quote escape', () => {
	// The value includes the opening/closing quotes verbatim — the parser is
	// responsible for stripping/unescaping later, matching ANTLR behavior.
	expect(simplify(tokenize(`select 'it''s' as kind`))).toMatchInlineSnapshot(`
		[
		  "KEYWORD SELECT",
		  "STRING_LITERAL 'it''s'",
		  "KEYWORD AS",
		  "IDENTIFIER kind",
		]
	`);
});

test('handles quoted, backticked, and bracketed identifiers', () => {
	expect(simplify(tokenize('select "a", `b`, [c] from "my table"'))).toMatchInlineSnapshot(`
		[
		  "KEYWORD SELECT",
		  "IDENTIFIER "a"",
		  "COMMA ,",
		  "IDENTIFIER \`b\`",
		  "COMMA ,",
		  "IDENTIFIER [c]",
		  "KEYWORD FROM",
		  "IDENTIFIER "my table"",
		]
	`);
});

test('handles numeric literal flavors', () => {
	expect(simplify(tokenize(`select 1, 1.5, .5, 1., 1e10, 1.5e-3, 0xDEADBEEF`))).toMatchInlineSnapshot(`
		[
		  "KEYWORD SELECT",
		  "NUMERIC_LITERAL 1",
		  "COMMA ,",
		  "NUMERIC_LITERAL 1.5",
		  "COMMA ,",
		  "NUMERIC_LITERAL .5",
		  "COMMA ,",
		  "NUMERIC_LITERAL 1.",
		  "COMMA ,",
		  "NUMERIC_LITERAL 1e10",
		  "COMMA ,",
		  "NUMERIC_LITERAL 1.5e-3",
		  "COMMA ,",
		  "NUMERIC_LITERAL 0xDEADBEEF",
		]
	`);
});

test('discards line and block comments', () => {
	const sql = `select /* inline */ id -- trailing\nfrom posts;`;
	expect(simplify(tokenize(sql))).toMatchInlineSnapshot(`
		[
		  "KEYWORD SELECT",
		  "IDENTIFIER id",
		  "KEYWORD FROM",
		  "IDENTIFIER posts",
		  "SEMI ;",
		]
	`);
});

test('tokenizes a join with USING', () => {
	const sql = `select p.id from posts p inner join authors a using (author_id) where a.name is not null;`;
	expect(simplify(tokenize(sql))).toMatchInlineSnapshot(`
		[
		  "KEYWORD SELECT",
		  "IDENTIFIER p",
		  "DOT .",
		  "IDENTIFIER id",
		  "KEYWORD FROM",
		  "IDENTIFIER posts",
		  "IDENTIFIER p",
		  "KEYWORD INNER",
		  "KEYWORD JOIN",
		  "IDENTIFIER authors",
		  "IDENTIFIER a",
		  "KEYWORD USING",
		  "OPEN_PAR (",
		  "IDENTIFIER author_id",
		  "CLOSE_PAR )",
		  "KEYWORD WHERE",
		  "IDENTIFIER a",
		  "DOT .",
		  "IDENTIFIER name",
		  "KEYWORD IS",
		  "KEYWORD NOT",
		  "KEYWORD NULL",
		  "SEMI ;",
		]
	`);
});

test('tokenizes an UPDATE with a RETURNING clause', () => {
	const sql = `update posts set title = :title where id = :id returning id, title;`;
	expect(simplify(tokenize(sql))).toMatchInlineSnapshot(`
		[
		  "KEYWORD UPDATE",
		  "IDENTIFIER posts",
		  "KEYWORD SET",
		  "IDENTIFIER title",
		  "ASSIGN =",
		  "BIND_PARAMETER :title",
		  "KEYWORD WHERE",
		  "IDENTIFIER id",
		  "ASSIGN =",
		  "BIND_PARAMETER :id",
		  "KEYWORD RETURNING",
		  "IDENTIFIER id",
		  "COMMA ,",
		  "IDENTIFIER title",
		  "SEMI ;",
		]
	`);
});

test('preserves source offsets for every token', () => {
	const sql = `select id from t`;
	const tokens = tokenize(sql);
	// Each token's value equals the source slice at [start, stop+1) — except
	// KEYWORD tokens, whose value is uppercase-normalized so parser dispatches
	// can use `===`. The offsets must still slice back to the raw source text.
	for (const t of tokens) {
		const slice = sql.slice(t.start, t.stop + 1);
		if (t.kind === 'KEYWORD') {
			expect(slice.toUpperCase()).toBe(t.value);
		} else {
			expect(t.value).toBe(slice);
		}
	}
});

test('tokenizes a CTE with recursive', () => {
	const sql = `with recursive parts as (select 1 union all select n + 1 from parts where n < 5) select * from parts;`;
	expect(simplify(tokenize(sql))).toMatchInlineSnapshot(`
		[
		  "KEYWORD WITH",
		  "KEYWORD RECURSIVE",
		  "IDENTIFIER parts",
		  "KEYWORD AS",
		  "OPEN_PAR (",
		  "KEYWORD SELECT",
		  "NUMERIC_LITERAL 1",
		  "KEYWORD UNION",
		  "KEYWORD ALL",
		  "KEYWORD SELECT",
		  "IDENTIFIER n",
		  "PLUS +",
		  "NUMERIC_LITERAL 1",
		  "KEYWORD FROM",
		  "IDENTIFIER parts",
		  "KEYWORD WHERE",
		  "IDENTIFIER n",
		  "LT <",
		  "NUMERIC_LITERAL 5",
		  "CLOSE_PAR )",
		  "KEYWORD SELECT",
		  "STAR *",
		  "KEYWORD FROM",
		  "IDENTIFIER parts",
		  "SEMI ;",
		]
	`);
});

test('throws on unterminated string literal', () => {
	expect(() => tokenize(`select 'oops`)).toThrowErrorMatchingInlineSnapshot(
		`[SqlTokenizerError: unterminated '-quoted string starting at offset 7]`
	);
});

test('throws on bare ! not followed by =', () => {
	expect(() => tokenize(`select !foo`)).toThrowErrorMatchingInlineSnapshot(
		`[SqlTokenizerError: unexpected '!' at offset 7 (did you mean '!='?)]`
	);
});

// --- helpers ---

// Render as "KIND value" so snapshots stay compact and readable. Offsets are
// covered by the dedicated `preserves source offsets` test above.
function simplify(tokens: Token[]): string[] {
	return tokens.map(t => `${t.kind} ${t.value}`);
}
