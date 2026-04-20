import {expect, test} from 'vitest';
import {parseDeleteStmt, parseInsertStmt, parseUpdateStmt} from '../../src/vendor/sqlfu-sqlite-parser/dml_stmt.js';

// INSERT / UPDATE / DELETE — including RETURNING and ON CONFLICT.

// --- INSERT ---

test('INSERT ... VALUES (...)', () => {
	const stmt = parseInsertStmt(`insert into posts (slug, title) values (:slug, :title)`);
	expect(stmt).toMatchObject({
		kind: 'Insert_stmt',
		or_action: null,
		source_is_replace: false,
		schema: null,
		table: 'posts',
		columns: ['slug', 'title'],
		source: {
			kind: 'Values',
			rows: [
				[
					{kind: 'BindParameter', marker: ':slug'},
					{kind: 'BindParameter', marker: ':title'},
				],
			],
		},
		upsert: null,
		returning: null,
	});
});

test('INSERT multi-row VALUES', () => {
	const stmt = parseInsertStmt(`insert into t (a, b) values (1, 2), (3, 4), (5, 6)`);
	expect(stmt.source).toMatchObject({
		kind: 'Values',
		rows: [
			[{value: '1'}, {value: '2'}],
			[{value: '3'}, {value: '4'}],
			[{value: '5'}, {value: '6'}],
		],
	});
});

test('INSERT ... SELECT', () => {
	const stmt = parseInsertStmt(`insert into archive (id, slug) select id, slug from posts`);
	expect(stmt.source).toMatchObject({
		kind: 'Select',
		select: {
			select_cores: [
				{
					result_columns: [{expr: {column: 'id'}}, {expr: {column: 'slug'}}],
					from: {items: [{name: 'posts'}]},
				},
			],
		},
	});
});

test('INSERT DEFAULT VALUES', () => {
	const stmt = parseInsertStmt(`insert into counters default values`);
	expect(stmt.source).toMatchObject({kind: 'DefaultValues'});
	expect(stmt.columns).toEqual([]);
});

test('INSERT OR REPLACE', () => {
	const stmt = parseInsertStmt(`insert or replace into t (a) values (1)`);
	expect(stmt.or_action).toBe('REPLACE');
	expect(stmt.source_is_replace).toBe(false);
});

test('REPLACE INTO shorthand', () => {
	const stmt = parseInsertStmt(`replace into t (a) values (1)`);
	expect(stmt.or_action).toBe('REPLACE');
	expect(stmt.source_is_replace).toBe(true);
});

test('INSERT with schema-qualified table', () => {
	const stmt = parseInsertStmt(`insert into main.posts (slug) values ('hi')`);
	expect(stmt).toMatchObject({schema: 'main', table: 'posts'});
});

test('INSERT with RETURNING *', () => {
	const stmt = parseInsertStmt(`insert into posts (slug) values ('a') returning *`);
	expect(stmt.returning).toMatchObject({
		kind: 'Returning',
		columns: [{kind: 'Star'}],
	});
});

test('INSERT with RETURNING column list and alias', () => {
	const stmt = parseInsertStmt(`insert into posts (slug) values ('a') returning id, slug as s`);
	expect(stmt.returning).toMatchObject({
		columns: [
			{kind: 'Expr', alias: null, expr: {column: 'id'}},
			{kind: 'Expr', alias: 's', expr: {column: 'slug'}},
		],
	});
});

test('INSERT with ON CONFLICT DO NOTHING', () => {
	const stmt = parseInsertStmt(`insert into t (a) values (1) on conflict (a) do nothing`);
	expect(stmt.upsert).toMatchObject({
		kind: 'Upsert',
		target_columns: ['a'],
		action: {kind: 'Nothing'},
	});
});

test('INSERT with ON CONFLICT DO UPDATE SET', () => {
	const stmt = parseInsertStmt(
		`insert into t (id, n) values (:id, :n)
		 on conflict (id) do update set n = :n where id = :id`,
	);
	expect(stmt.upsert).toMatchObject({
		target_columns: ['id'],
		action: {
			kind: 'Update',
			assignments: [{columns: ['n'], expr: {kind: 'BindParameter'}}],
			where: {op: '=', left: {column: 'id'}},
		},
	});
});

// --- UPDATE ---

test('simplest UPDATE', () => {
	const stmt = parseUpdateStmt(`update posts set title = :title where id = :id`);
	expect(stmt).toMatchObject({
		kind: 'Update_stmt',
		or_action: null,
		schema: null,
		table: 'posts',
		alias: null,
		assignments: [
			{
				columns: ['title'],
				expr: {kind: 'BindParameter', marker: ':title'},
			},
		],
		where: {op: '=', left: {column: 'id'}, right: {marker: ':id'}},
	});
});

test('UPDATE tracks where_offset for parameter partitioning', () => {
	const sql = `update posts set title = :title where id = :id`;
	const stmt = parseUpdateStmt(sql);
	expect(stmt.where_offset).toBe(sql.indexOf('where'));
});

test('UPDATE with multiple assignments', () => {
	const stmt = parseUpdateStmt(`update posts set title = :t, slug = :s where id = :id`);
	expect(stmt.assignments).toMatchObject([
		{columns: ['title']},
		{columns: ['slug']},
	]);
});

test('UPDATE OR IGNORE', () => {
	const stmt = parseUpdateStmt(`update or ignore posts set title = :t where id = :id`);
	expect(stmt.or_action).toBe('IGNORE');
});

test('UPDATE with RETURNING', () => {
	const stmt = parseUpdateStmt(`update posts set title = :t where id = :id returning id, title`);
	expect(stmt.returning).toMatchObject({
		columns: [{expr: {column: 'id'}}, {expr: {column: 'title'}}],
	});
});

test('UPDATE with alias', () => {
	const stmt = parseUpdateStmt(`update posts as p set title = :t where p.id = :id`);
	expect(stmt.alias).toBe('p');
});

test('UPDATE tuple assignment', () => {
	const stmt = parseUpdateStmt(`update t set (a, b) = (1, 2) where id = :id`);
	expect(stmt.assignments[0]).toMatchObject({
		columns: ['a', 'b'],
		expr: {kind: 'Paren', exprs: [{value: '1'}, {value: '2'}]},
	});
});

// --- DELETE ---

test('simplest DELETE', () => {
	const stmt = parseDeleteStmt(`delete from posts where id = :id`);
	expect(stmt).toMatchObject({
		kind: 'Delete_stmt',
		schema: null,
		table: 'posts',
		where: {op: '=', left: {column: 'id'}, right: {marker: ':id'}},
		returning: null,
	});
});

test('DELETE without WHERE', () => {
	const stmt = parseDeleteStmt(`delete from posts`);
	expect(stmt).toMatchObject({
		table: 'posts',
		where: null,
		where_offset: null,
	});
});

test('DELETE with RETURNING *', () => {
	const stmt = parseDeleteStmt(`delete from posts where id = :id returning *`);
	expect(stmt.returning).toMatchObject({columns: [{kind: 'Star'}]});
});

test('DELETE with schema-qualified table', () => {
	const stmt = parseDeleteStmt(`delete from main.posts`);
	expect(stmt).toMatchObject({schema: 'main', table: 'posts'});
});

test('DELETE with alias', () => {
	const stmt = parseDeleteStmt(`delete from posts p where p.id = :id`);
	expect(stmt.alias).toBe('p');
});
