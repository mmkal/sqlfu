import {expect, test} from 'vitest';
import {parseSelectStmt} from '../../src/vendor/sqlfu-sqlite-parser/select_stmt.js';

// Joins — each variant tested with the smallest possible query.

test('comma-joined tables', () => {
	expect(parseSelectStmt(`select a.id, b.id from a, b`).select_cores[0].from).toMatchObject({
		kind: 'TableList',
		items: [
			{kind: 'Table', name: 'a'},
			{kind: 'Table', name: 'b'},
		],
	});
});

test('INNER JOIN with ON constraint', () => {
	const from = parseSelectStmt(`select p.id from posts p inner join authors a on p.author_id = a.id`).select_cores[0].from;
	expect(from).toMatchObject({
		kind: 'JoinChain',
		chain: {
			first: {kind: 'Table', name: 'posts', alias: 'p'},
			joins: [
				{
					operator: {kind: 'INNER', natural: false, outer: false},
					target: {kind: 'Table', name: 'authors', alias: 'a'},
					constraint: {
						kind: 'On',
						expr: {
							kind: 'Binary',
							op: '=',
							left: {kind: 'ColumnRef', table: 'p', column: 'author_id'},
							right: {kind: 'ColumnRef', table: 'a', column: 'id'},
						},
					},
				},
			],
		},
	});
});

test('plain JOIN defaults to INNER', () => {
	const from = parseSelectStmt(`select 1 from a join b on a.x = b.x`).select_cores[0].from;
	expect(from).toMatchObject({
		kind: 'JoinChain',
		chain: {
			joins: [{operator: {kind: 'INNER', natural: false, outer: false}}],
		},
	});
});

test('LEFT JOIN sets kind LEFT', () => {
	const from = parseSelectStmt(`select 1 from a left join b on a.x = b.x`).select_cores[0].from;
	expect(from).toMatchObject({
		kind: 'JoinChain',
		chain: {joins: [{operator: {kind: 'LEFT', outer: false}}]},
	});
});

test('LEFT OUTER JOIN sets outer flag', () => {
	const from = parseSelectStmt(`select 1 from a left outer join b on a.x = b.x`).select_cores[0].from;
	expect(from).toMatchObject({
		kind: 'JoinChain',
		chain: {joins: [{operator: {kind: 'LEFT', outer: true}}]},
	});
});

test('RIGHT JOIN sets kind RIGHT', () => {
	const from = parseSelectStmt(`select 1 from a right join b on a.x = b.x`).select_cores[0].from;
	expect(from).toMatchObject({
		kind: 'JoinChain',
		chain: {joins: [{operator: {kind: 'RIGHT'}}]},
	});
});

test('FULL OUTER JOIN', () => {
	const from = parseSelectStmt(`select 1 from a full outer join b on a.x = b.x`).select_cores[0].from;
	expect(from).toMatchObject({
		kind: 'JoinChain',
		chain: {joins: [{operator: {kind: 'FULL', outer: true}}]},
	});
});

test('CROSS JOIN has no constraint', () => {
	const from = parseSelectStmt(`select 1 from a cross join b`).select_cores[0].from;
	expect(from).toMatchObject({
		kind: 'JoinChain',
		chain: {joins: [{operator: {kind: 'CROSS'}, constraint: null}]},
	});
});

test('NATURAL JOIN marks operator natural and has no constraint', () => {
	const from = parseSelectStmt(`select 1 from a natural join b`).select_cores[0].from;
	expect(from).toMatchObject({
		kind: 'JoinChain',
		chain: {joins: [{operator: {kind: 'INNER', natural: true}, constraint: null}]},
	});
});

test('USING (col) constraint', () => {
	const from = parseSelectStmt(`select 1 from a inner join b using (author_id)`).select_cores[0].from;
	expect(from).toMatchObject({
		kind: 'JoinChain',
		chain: {
			joins: [
				{
					constraint: {kind: 'Using', columns: ['author_id']},
				},
			],
		},
	});
});

test('USING multi-column constraint', () => {
	const from = parseSelectStmt(`select 1 from a join b using (x, y, z)`).select_cores[0].from;
	expect(from).toMatchObject({
		kind: 'JoinChain',
		chain: {
			joins: [{constraint: {kind: 'Using', columns: ['x', 'y', 'z']}}],
		},
	});
});

test('three-way join chain', () => {
	const from = parseSelectStmt(
		`select 1 from a inner join b on a.x = b.x left join c on b.y = c.y`,
	).select_cores[0].from;
	expect(from).toMatchObject({
		kind: 'JoinChain',
		chain: {
			first: {name: 'a'},
			joins: [
				{operator: {kind: 'INNER'}, target: {name: 'b'}},
				{operator: {kind: 'LEFT'}, target: {name: 'c'}},
			],
		},
	});
});

test('subquery in FROM with alias', () => {
	const from = parseSelectStmt(`select t.x from (select id as x from posts) t`).select_cores[0].from;
	expect(from).toMatchObject({
		kind: 'TableList',
		items: [
			{
				kind: 'Subquery',
				alias: 't',
				select: {
					select_cores: [{result_columns: [{kind: 'Expr', alias: 'x', expr: {column: 'id'}}]}],
				},
			},
		],
	});
});

test('table-valued function in FROM', () => {
	const from = parseSelectStmt(`select x from json_each('[1,2,3]')`).select_cores[0].from;
	expect(from).toMatchObject({
		kind: 'TableList',
		items: [
			{
				kind: 'TableFunction',
				name: 'json_each',
				args: [{kind: 'StringLiteral'}],
			},
		],
	});
});
