import {expect, test} from 'vitest';
import {parseSelectStmt} from '../../src/vendor/sqlfu-sqlite-parser/select_stmt.js';

// Expression forms — driven through a minimal `select <expr>` wrapper so each
// test shows the expression shape straightforwardly.

function parseExpr(sql: string) {
	const stmt = parseSelectStmt(`select ${sql}`);
	const col = stmt.select_cores[0].result_columns[0];
	if (col.kind !== 'Expr') throw new Error(`expected Expr result column, got ${col.kind}`);
	return col.expr;
}

// --- literals, columns, bind params ---

test('literal flavors', () => {
	expect(parseExpr(`1`)).toMatchObject({kind: 'NumericLiteral', value: '1'});
	expect(parseExpr(`'hi'`)).toMatchObject({kind: 'StringLiteral'});
	expect(parseExpr(`null`)).toMatchObject({kind: 'Null'});
	expect(parseExpr(`true`)).toMatchObject({kind: 'BoolLiteral', value: true});
	expect(parseExpr(`false`)).toMatchObject({kind: 'BoolLiteral', value: false});
	expect(parseExpr(`x'deadbeef'`)).toMatchObject({kind: 'BlobLiteral'});
});

test('bind parameters', () => {
	expect(parseExpr(`?`)).toMatchObject({kind: 'BindParameter', marker: '?'});
	expect(parseExpr(`:name`)).toMatchObject({kind: 'BindParameter', marker: ':name'});
	expect(parseExpr(`@name`)).toMatchObject({kind: 'BindParameter', marker: '@name'});
	expect(parseExpr(`$name`)).toMatchObject({kind: 'BindParameter', marker: '$name'});
});

// --- unary / binary operators, precedence ---

test('unary minus', () => {
	expect(parseExpr(`-5`)).toMatchObject({kind: 'Unary', op: '-', operand: {value: '5'}});
});

test('unary NOT in expression position', () => {
	expect(parseExpr(`not 1`)).toMatchObject({kind: 'Unary', op: 'NOT', operand: {value: '1'}});
});

test('arithmetic precedence: + vs *', () => {
	// 1 + 2 * 3 → Binary(+, 1, Binary(*, 2, 3))
	expect(parseExpr(`1 + 2 * 3`)).toMatchObject({
		kind: 'Binary',
		op: '+',
		left: {value: '1'},
		right: {kind: 'Binary', op: '*', left: {value: '2'}, right: {value: '3'}},
	});
});

test('parens override precedence', () => {
	expect(parseExpr(`(1 + 2) * 3`)).toMatchObject({
		kind: 'Binary',
		op: '*',
		left: {kind: 'Paren', exprs: [{kind: 'Binary', op: '+'}]},
		right: {value: '3'},
	});
});

test('string concat ||', () => {
	expect(parseExpr(`'a' || 'b'`)).toMatchObject({kind: 'Binary', op: '||'});
});

test('comparison chain: AND/OR precedence', () => {
	// a = 1 or b = 2 and c = 3 → OR(a=1, AND(b=2, c=3))
	expect(parseExpr(`a = 1 or b = 2 and c = 3`)).toMatchObject({
		kind: 'Binary',
		op: 'OR',
		left: {op: '='},
		right: {op: 'AND', left: {op: '='}, right: {op: '='}},
	});
});

test('bitwise and shift', () => {
	expect(parseExpr(`a & b | c`)).toMatchObject({
		kind: 'Binary',
		op: '|',
		left: {op: '&'},
	});
	expect(parseExpr(`a << 2`)).toMatchObject({op: '<<'});
});

// --- function calls ---

test('plain function call', () => {
	expect(parseExpr(`coalesce(a, 'x')`)).toMatchObject({
		kind: 'FunctionCall',
		name: 'coalesce',
		distinct: false,
		star: false,
		args: [{column: 'a'}, {kind: 'StringLiteral'}],
	});
});

test('aggregate count(*)', () => {
	expect(parseExpr(`count(*)`)).toMatchObject({
		kind: 'FunctionCall',
		name: 'count',
		star: true,
		args: [],
	});
});

test('aggregate count(distinct col)', () => {
	expect(parseExpr(`count(distinct slug)`)).toMatchObject({
		kind: 'FunctionCall',
		name: 'count',
		distinct: true,
		args: [{column: 'slug'}],
	});
});

test('aggregate with ORDER BY arg (accepted, dropped)', () => {
	expect(parseExpr(`group_concat(slug, ',' order by slug desc)`)).toMatchObject({
		kind: 'FunctionCall',
		name: 'group_concat',
		args: [{column: 'slug'}, {kind: 'StringLiteral'}],
	});
});

test('window function with OVER clause is presence-tracked', () => {
	const expr = parseExpr(`row_number() over (partition by author_id order by published_at)`);
	expect(expr).toMatchObject({kind: 'FunctionCall', name: 'row_number', over_clause: {kind: 'OverClause'}});
});

test('function FILTER (WHERE ...)', () => {
	expect(parseExpr(`count(*) filter (where published)`)).toMatchObject({
		kind: 'FunctionCall',
		name: 'count',
		star: true,
		filter_where: {kind: 'ColumnRef', column: 'published'},
	});
});

// --- IN / BETWEEN / LIKE / IS ---

test('IN (list)', () => {
	expect(parseExpr(`status in ('draft', 'published')`)).toMatchObject({
		kind: 'InList',
		negated: false,
		expr: {column: 'status'},
		items: [{kind: 'StringLiteral'}, {kind: 'StringLiteral'}],
	});
});

test('NOT IN (list)', () => {
	expect(parseExpr(`status not in ('draft')`)).toMatchObject({
		kind: 'InList',
		negated: true,
	});
});

test('IN (subquery)', () => {
	expect(parseExpr(`id in (select post_id from published)`)).toMatchObject({
		kind: 'InSubquery',
		negated: false,
	});
});

test('IN table (bare identifier)', () => {
	expect(parseExpr(`id in published_ids`)).toMatchObject({
		kind: 'InTable',
		table: 'published_ids',
	});
});

test('BETWEEN', () => {
	expect(parseExpr(`rank between 1 and 10`)).toMatchObject({
		kind: 'Between',
		negated: false,
		expr: {column: 'rank'},
		low: {value: '1'},
		high: {value: '10'},
	});
});

test('NOT BETWEEN', () => {
	expect(parseExpr(`rank not between 1 and 10`)).toMatchObject({kind: 'Between', negated: true});
});

test('LIKE with ESCAPE', () => {
	expect(parseExpr(`slug like 'foo%' escape '\\'`)).toMatchObject({
		kind: 'Like',
		op: 'LIKE',
		negated: false,
		pattern: {kind: 'StringLiteral'},
		escape: {kind: 'StringLiteral'},
	});
});

test('NOT LIKE / GLOB / REGEXP / MATCH', () => {
	expect(parseExpr(`slug not like 'a%'`)).toMatchObject({kind: 'Like', op: 'LIKE', negated: true});
	expect(parseExpr(`slug glob 'a*'`)).toMatchObject({kind: 'Like', op: 'GLOB'});
	expect(parseExpr(`slug regexp 'a.*b'`)).toMatchObject({kind: 'Like', op: 'REGEXP'});
	expect(parseExpr(`t match 'x'`)).toMatchObject({kind: 'Like', op: 'MATCH'});
});

test('IS NULL / IS NOT NULL', () => {
	expect(parseExpr(`x is null`)).toMatchObject({kind: 'IsNull', negated: false});
	expect(parseExpr(`x is not null`)).toMatchObject({kind: 'IsNull', negated: true});
});

test('ISNULL / NOTNULL shorthand', () => {
	expect(parseExpr(`x isnull`)).toMatchObject({kind: 'IsNull', negated: false});
	expect(parseExpr(`x notnull`)).toMatchObject({kind: 'IsNull', negated: true});
});

test('IS DISTINCT FROM', () => {
	expect(parseExpr(`a is distinct from b`)).toMatchObject({
		kind: 'Is',
		negated: false,
		distinct_from: true,
		left: {column: 'a'},
		right: {column: 'b'},
	});
});

test('IS NOT DISTINCT FROM', () => {
	expect(parseExpr(`a is not distinct from b`)).toMatchObject({
		kind: 'Is',
		negated: true,
		distinct_from: true,
	});
});

test('IS <value>', () => {
	expect(parseExpr(`a is 1`)).toMatchObject({
		kind: 'Is',
		distinct_from: false,
		left: {column: 'a'},
		right: {value: '1'},
	});
});

// --- CASE / CAST / EXISTS / subquery / COLLATE ---

test('simple CASE', () => {
	expect(parseExpr(`case status when 'draft' then 1 when 'published' then 2 else 0 end`)).toMatchObject({
		kind: 'Case',
		operand: {column: 'status'},
		when_clauses: [
			{when: {kind: 'StringLiteral'}, then: {value: '1'}},
			{when: {kind: 'StringLiteral'}, then: {value: '2'}},
		],
		else_clause: {value: '0'},
	});
});

test('searched CASE (no operand)', () => {
	expect(parseExpr(`case when a > 0 then 'pos' when a < 0 then 'neg' else 'zero' end`)).toMatchObject({
		kind: 'Case',
		operand: null,
		when_clauses: [
			{when: {op: '>'}},
			{when: {op: '<'}},
		],
		else_clause: {kind: 'StringLiteral'},
	});
});

test('CASE without ELSE', () => {
	expect(parseExpr(`case when x then y end`)).toMatchObject({
		kind: 'Case',
		else_clause: null,
	});
});

test('CAST', () => {
	expect(parseExpr(`cast(x as integer)`)).toMatchObject({
		kind: 'Cast',
		expr: {column: 'x'},
		type_name: 'integer',
	});
});

test('CAST with parameterised type', () => {
	expect(parseExpr(`cast(x as varchar(255))`)).toMatchObject({
		kind: 'Cast',
		type_name: 'varchar (255)',
	});
});

test('EXISTS (subquery)', () => {
	expect(parseExpr(`exists (select 1 from posts)`)).toMatchObject({
		kind: 'Exists',
		negated: false,
	});
});

test('NOT EXISTS', () => {
	expect(parseExpr(`not exists (select 1 from posts)`)).toMatchObject({
		kind: 'Exists',
		negated: true,
	});
});

test('scalar subquery in expression', () => {
	expect(parseExpr(`(select count(*) from posts)`)).toMatchObject({kind: 'Subquery'});
});

test('COLLATE suffix', () => {
	expect(parseExpr(`slug collate nocase`)).toMatchObject({
		kind: 'Collate',
		expr: {column: 'slug'},
		collation: 'nocase',
	});
});

// --- special zero-arg builtins ---

test('CURRENT_TIMESTAMP as zero-arg function call', () => {
	expect(parseExpr(`current_timestamp`)).toMatchObject({
		kind: 'FunctionCall',
		name: 'current_timestamp',
		args: [],
	});
});
