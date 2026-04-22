import {expect, test} from 'vitest';

import {migrationNickname, queryNickname, spanNameFor} from '../src/core/naming.js';
import type {SqlQuery} from '../src/core/types.js';
import {dedent, normalizeSqlForHash, shortHash} from '../src/core/util.js';

test.for<{label: string; sql: string; expected: string}>([
  {label: 'select from table', sql: 'select * from profiles', expected: 'list-profiles'},
  {label: 'select with where', sql: 'select id, name from profiles where x > ?', expected: 'list-profiles'},
  {label: 'select with join', sql: 'select u.id from users u join posts p on p.user_id = u.id', expected: 'list-users'},
  {label: 'insert', sql: 'insert into orders (id, total) values (?, ?)', expected: 'insert-orders'},
  {label: 'update', sql: 'update users set name = ? where id = ?', expected: 'update-users'},
  {label: 'delete from', sql: 'delete from sessions where expires_at < ?', expected: 'delete-sessions'},
  {label: 'leading comment', sql: '-- comment\nselect * from profiles', expected: 'list-profiles'},
  {label: 'block comment', sql: '/* comment */ select * from profiles', expected: 'list-profiles'},
  {label: 'double-quoted identifier', sql: 'select * from "Profiles"', expected: 'list-profiles'},
  {label: 'empty sql', sql: '', expected: 'query'},
  {label: 'unrecognized statement', sql: 'pragma journal_mode', expected: 'query'},
])('queryNickname $label', ({sql, expected}) => {
  expect(queryNickname(sql)).toBe(expected);
});

test.for<{label: string; sql: string; expected: string}>([
  {label: 'create table', sql: 'create table users (id integer primary key)', expected: 'create_table_users'},
  {
    label: 'create index',
    sql: 'create index idx_users_email on users(email)',
    expected: 'create_index_idx_users_email',
  },
  {label: 'drop table', sql: 'drop table users', expected: 'drop_table_users'},
  {
    label: 'alter add column',
    sql: 'alter table users add column bio text',
    expected: 'alter_table_users_add_column_bio',
  },
  {label: 'rename to', sql: 'alter table users rename to people', expected: 'alter_table_users_rename_to_people'},
  {label: 'insert into', sql: 'insert into users (id) values (1)', expected: 'into_users'},
  {label: 'fallback', sql: '', expected: 'migration'},
])('migrationNickname $label', ({sql, expected}) => {
  expect(migrationNickname(sql)).toBe(expected);
});

test('spanNameFor: named query returns the author-given name verbatim', () => {
  const query: SqlQuery = {sql: 'select * from profiles', args: [], name: 'listProfiles'};
  expect(spanNameFor(query)).toBe('listProfiles');
});

test('spanNameFor: ad-hoc query combines readable nickname with stable 7-char hash', () => {
  const query: SqlQuery = {sql: 'select * from profiles where id = ?', args: []};
  const name = spanNameFor(query);
  expect(name).toMatch(/^sql-list-profiles-[0-9a-f]{7}$/);
});

test('spanNameFor: hash is stable across whitespace edits (normalization)', () => {
  const a = spanNameFor({sql: 'select * from profiles where id = ?', args: []});
  const b = spanNameFor({
    sql: '  select *\n  from profiles\n  where id = ?',
    args: [],
  });
  expect(a).toBe(b);
});

test('spanNameFor: hash differs across semantically different SQL', () => {
  const a = spanNameFor({sql: 'select * from profiles', args: []});
  const b = spanNameFor({sql: 'select * from users', args: []});
  expect(a).not.toBe(b);
});

test('dedent tag: strips common leading whitespace', () => {
  const result = dedent`
    select id, name
    from profiles
    where id = ?
  `;
  expect(result).toBe('\nselect id, name\nfrom profiles\nwhere id = ?\n');
});

test('normalizeSqlForHash: collapses internal whitespace', () => {
  const input = '  select id,\n    name\n  from profiles  ';
  expect(normalizeSqlForHash(input)).toBe('select id, name from profiles');
});

test('shortHash: 7 hex chars and stable', () => {
  const h = shortHash('select * from profiles');
  expect(h).toMatch(/^[0-9a-f]{7}$/);
  expect(h).toBe(shortHash('select * from profiles'));
});
