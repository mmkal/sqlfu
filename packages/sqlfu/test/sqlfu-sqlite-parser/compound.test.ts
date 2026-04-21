import {expect, test} from 'vitest';
import {parseSelectStmt} from '../../src/vendor/sqlfu-sqlite-parser/select_stmt.js';

// Compound SELECT operators.

test('UNION of two SELECTs', () => {
	const stmt = parseSelectStmt(`select id from a union select id from b`);
	expect(stmt.select_cores).toHaveLength(2);
	expect(stmt.compound_operators).toEqual(['UNION']);
});

test('UNION ALL', () => {
	const stmt = parseSelectStmt(`select id from a union all select id from b`);
	expect(stmt.compound_operators).toEqual(['UNION ALL']);
});

test('INTERSECT', () => {
	const stmt = parseSelectStmt(`select id from a intersect select id from b`);
	expect(stmt.compound_operators).toEqual(['INTERSECT']);
});

test('EXCEPT', () => {
	const stmt = parseSelectStmt(`select id from a except select id from b`);
	expect(stmt.compound_operators).toEqual(['EXCEPT']);
});

test('chained UNION ALL + UNION', () => {
	const stmt = parseSelectStmt(`select 1 union all select 2 union select 3`);
	expect(stmt.select_cores).toHaveLength(3);
	expect(stmt.compound_operators).toEqual(['UNION ALL', 'UNION']);
});

test('ORDER BY / LIMIT bind to the top-level compound statement', () => {
	const stmt = parseSelectStmt(
		`select id from a union all select id from b order by id desc limit 10`,
	);
	expect(stmt.order_by).toMatchObject({terms: [{direction: 'DESC'}]});
	expect(stmt.limit).toMatchObject({expr: {value: '10'}});
	expect(stmt.select_cores).toHaveLength(2);
});
