import {expect, test} from 'vitest';
import {parseSelectStmt} from '../../src/vendor/sqlfu-sqlite-parser/select_stmt.js';

// GROUP BY / HAVING / ORDER BY / LIMIT / OFFSET.

test('GROUP BY single column', () => {
	const core = parseSelectStmt(`select author_id from posts group by author_id`).select_cores[0];
	expect(core.group_by).toMatchObject([{kind: 'ColumnRef', column: 'author_id'}]);
	expect(core.having).toBeNull();
});

test('GROUP BY multiple expressions', () => {
	const core = parseSelectStmt(`select a, b, count(*) from t group by a, b`).select_cores[0];
	expect(core.group_by).toMatchObject([{column: 'a'}, {column: 'b'}]);
});

test('GROUP BY + HAVING', () => {
	const core = parseSelectStmt(
		`select author_id, count(*) from posts group by author_id having count(*) > 5`,
	).select_cores[0];
	expect(core.group_by).toMatchObject([{column: 'author_id'}]);
	expect(core.having).toMatchObject({
		kind: 'Binary',
		op: '>',
		left: {kind: 'FunctionCall', name: 'count', star: true},
		right: {kind: 'NumericLiteral', value: '5'},
	});
});

test('ORDER BY single column, default direction', () => {
	const stmt = parseSelectStmt(`select * from posts order by published_at`);
	expect(stmt.order_by).toMatchObject({
		kind: 'Order_by',
		terms: [{expr: {column: 'published_at'}, direction: null, nulls: null}],
	});
});

test('ORDER BY DESC with NULLS LAST', () => {
	const stmt = parseSelectStmt(`select * from posts order by published_at desc nulls last`);
	expect(stmt.order_by).toMatchObject({
		terms: [{expr: {column: 'published_at'}, direction: 'DESC', nulls: 'LAST'}],
	});
});

test('ORDER BY multiple terms', () => {
	const stmt = parseSelectStmt(`select * from posts order by rank desc, id asc`);
	expect(stmt.order_by).toMatchObject({
		terms: [
			{expr: {column: 'rank'}, direction: 'DESC'},
			{expr: {column: 'id'}, direction: 'ASC'},
		],
	});
});

test('LIMIT with OFFSET', () => {
	const stmt = parseSelectStmt(`select id from posts limit 10 offset 20`);
	expect(stmt.limit).toMatchObject({
		expr: {value: '10'},
		offset: {value: '20'},
		legacy_comma_form: false,
	});
});

test('LIMIT comma form stores both and flags legacy', () => {
	const stmt = parseSelectStmt(`select id from posts limit 20, 10`);
	expect(stmt.limit).toMatchObject({
		expr: {value: '20'},
		offset: {value: '10'},
		legacy_comma_form: true,
	});
});

test('LIMIT with bind parameter', () => {
	const stmt = parseSelectStmt(`select id from posts limit :page_size`);
	expect(stmt.limit).toMatchObject({
		expr: {kind: 'BindParameter', marker: ':page_size'},
		offset: null,
	});
});

test('full clause ordering: WHERE, GROUP BY, HAVING, ORDER BY, LIMIT', () => {
	const stmt = parseSelectStmt(
		`select author_id, count(*) as n from posts
		 where published_at is not null
		 group by author_id
		 having n > 3
		 order by n desc
		 limit 5 offset 10`,
	);
	expect(stmt).toMatchObject({
		select_cores: [
			{
				where: {kind: 'IsNull', negated: true, operand: {column: 'published_at'}},
				group_by: [{column: 'author_id'}],
				having: {kind: 'Binary', op: '>'},
			},
		],
		order_by: {terms: [{direction: 'DESC'}]},
		limit: {expr: {value: '5'}, offset: {value: '10'}},
	});
});
