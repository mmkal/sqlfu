import {expect, test} from 'vitest';
import {parseSelectStmt} from '../../src/vendor/sqlfu-sqlite-parser/select_stmt.js';

// WITH / CTE at the head of a SELECT.

test('non-recursive single CTE', () => {
	const stmt = parseSelectStmt(`with active as (select id from posts where published = 1) select id from active`);
	expect(stmt.with_clause).toMatchObject({
		kind: 'With_clause',
		recursive: false,
		ctes: [
			{
				kind: 'CTE',
				name: 'active',
				columns: [],
				select: {
					select_cores: [
						{
							from: {items: [{name: 'posts'}]},
							where: {op: '='},
						},
					],
				},
			},
		],
	});
	expect(stmt.select_cores[0]).toMatchObject({
		from: {items: [{kind: 'Table', name: 'active'}]},
	});
});

test('CTE with column alias list', () => {
	const stmt = parseSelectStmt(
		`with t(a, b) as (select id, slug from posts) select a, b from t`,
	);
	expect(stmt.with_clause).toMatchObject({
		ctes: [{name: 't', columns: ['a', 'b']}],
	});
});

test('multiple CTEs', () => {
	const stmt = parseSelectStmt(
		`with a as (select 1), b as (select 2) select * from a union all select * from b`,
	);
	expect(stmt.with_clause).toMatchObject({
		recursive: false,
		ctes: [{name: 'a'}, {name: 'b'}],
	});
});

test('WITH RECURSIVE flag', () => {
	const stmt = parseSelectStmt(
		`with recursive nums(n) as (select 1 union all select n + 1 from nums where n < 5) select n from nums`,
	);
	expect(stmt.with_clause).toMatchObject({
		recursive: true,
		ctes: [{name: 'nums', columns: ['n']}],
	});
	// The recursive CTE body is itself a compound select.
	expect(stmt.with_clause?.ctes[0].select.compound_operators).toEqual(['UNION ALL']);
});
