import {expect, test} from 'vitest';
import {parseSelectStmt} from '../../src/vendor/sqlfu-sqlite-parser/select_stmt.js';

// Simple SELECT shapes — the baseline the parser supported before we expanded
// it. Each feature (joins, GROUP BY, CTE, compound, DML) has its own file.

test('simplest single-column select', () => {
	expect(parseSelectStmt(`select id from posts`)).toMatchObject({
		kind: 'Select_stmt',
		with_clause: null,
		compound_operators: [],
		order_by: null,
		limit: null,
		select_cores: [
			{
				kind: 'Select_core',
				distinct: false,
				result_columns: [
					{
						kind: 'Expr',
						alias: null,
						expr: {kind: 'ColumnRef', table: null, column: 'id'},
					},
				],
				from: {
					kind: 'TableList',
					items: [{kind: 'Table', schema: null, name: 'posts', alias: null}],
				},
				where: null,
				group_by: [],
				having: null,
			},
		],
	});
});

test('multiple columns with trailing semi', () => {
	const result = parseSelectStmt(`select id, slug, title from posts;`);
	expect(result.select_cores[0].result_columns).toMatchObject([
		{kind: 'Expr', expr: {column: 'id'}},
		{kind: 'Expr', expr: {column: 'slug'}},
		{kind: 'Expr', expr: {column: 'title'}},
	]);
});

test('star column', () => {
	expect(parseSelectStmt(`select * from posts`).select_cores[0].result_columns).toMatchObject([{kind: 'Star'}]);
});

test('table-qualified star', () => {
	expect(parseSelectStmt(`select p.* from posts p`).select_cores[0].result_columns).toMatchObject([
		{kind: 'TableStar', table: 'p'},
	]);
});

test('column with AS alias', () => {
	expect(parseSelectStmt(`select slug as handle from posts`).select_cores[0].result_columns).toMatchObject([
		{kind: 'Expr', alias: 'handle', expr: {column: 'slug'}},
	]);
});

test('column with bare alias (no AS keyword)', () => {
	expect(parseSelectStmt(`select slug handle from posts`).select_cores[0].result_columns).toMatchObject([
		{kind: 'Expr', alias: 'handle', expr: {column: 'slug'}},
	]);
});

test('qualified column reference table.column', () => {
	expect(parseSelectStmt(`select p.slug from posts p`).select_cores[0].result_columns).toMatchObject([
		{
			kind: 'Expr',
			alias: null,
			expr: {kind: 'ColumnRef', schema: null, table: 'p', column: 'slug'},
		},
	]);
});

test('schema-qualified column reference schema.table.column', () => {
	expect(parseSelectStmt(`select main.p.slug from main.posts p`).select_cores[0].result_columns).toMatchObject([
		{
			kind: 'Expr',
			expr: {kind: 'ColumnRef', schema: 'main', table: 'p', column: 'slug'},
		},
	]);
});

test('schema-qualified table', () => {
	const from = parseSelectStmt(`select * from main.posts`).select_cores[0].from;
	expect(from).toMatchObject({
		kind: 'TableList',
		items: [{kind: 'Table', schema: 'main', name: 'posts'}],
	});
});

test('where with equality and named parameter', () => {
	expect(parseSelectStmt(`select id from posts where slug = :slug`).select_cores[0].where).toMatchObject({
		kind: 'Binary',
		op: '=',
		left: {kind: 'ColumnRef', column: 'slug'},
		right: {kind: 'BindParameter', marker: ':slug'},
	});
});

test('where with AND of two comparisons', () => {
	expect(
		parseSelectStmt(`select id from posts where slug = :slug and published_at < :cutoff`).select_cores[0].where,
	).toMatchObject({
		kind: 'Binary',
		op: 'AND',
		left: {op: '=', left: {column: 'slug'}, right: {marker: ':slug'}},
		right: {op: '<', left: {column: 'published_at'}, right: {marker: ':cutoff'}},
	});
});

test('LIMIT with numeric literal', () => {
	expect(parseSelectStmt(`select id from posts limit 10`).limit).toMatchObject({
		kind: 'Limit',
		expr: {kind: 'NumericLiteral', value: '10'},
		offset: null,
	});
});

test('source offsets span the whole statement', () => {
	const sql = `select id from posts`;
	const result = parseSelectStmt(sql);
	expect(sql.slice(result.start, result.stop + 1)).toBe(sql);
});

test('rejects unfinished SELECT with missing column', () => {
	expect(() => parseSelectStmt(`select from posts`)).toThrowErrorMatchingInlineSnapshot(
		`[SqlParseError: unexpected keyword 'FROM' where an expression was expected (offset 7)]`,
	);
});

test('rejects unknown keyword where an expression was expected', () => {
	expect(() => parseSelectStmt(`select null, primary from posts`)).toThrowErrorMatchingInlineSnapshot(
		`[SqlParseError: unexpected keyword 'PRIMARY' where an expression was expected (offset 13)]`,
	);
});

test('rejects trailing garbage after statement', () => {
	expect(() => parseSelectStmt(`select id from posts )`)).toThrowErrorMatchingInlineSnapshot(
		`[SqlParseError: unexpected trailing token CLOSE_PAR ')' after statement (offset 21)]`,
	);
});

test('SELECT DISTINCT flag', () => {
	expect(parseSelectStmt(`select distinct slug from posts`).select_cores[0]).toMatchObject({
		distinct: true,
		result_columns: [{expr: {column: 'slug'}}],
	});
});

test('SELECT ALL is parsed as non-distinct (no-op)', () => {
	expect(parseSelectStmt(`select all slug from posts`).select_cores[0]).toMatchObject({
		distinct: false,
		result_columns: [{expr: {column: 'slug'}}],
	});
});
