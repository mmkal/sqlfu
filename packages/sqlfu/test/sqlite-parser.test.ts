import {expect, test} from 'vitest';

import {
  classifySqliteCreateStatement,
  containsSqliteKeyword,
  firstSqliteKeyword,
  replaceSqliteIdentifierSpan,
} from '../src/sqlite-parser.js';

test('sqlite parser facade classifies create statements through comments', () => {
  expect(
    classifySqliteCreateStatement(`
      -- before the statement
      create /* between keywords */ temporary /* before kind */ table "select" (id integer);
    `),
  ).toMatchObject({kind: 'table', temporary: true, unique: false, name: {name: 'select'}});

  expect(
    classifySqliteCreateStatement(`
      create /* before unique */ unique /* before kind */ index posts_slug on "posts" (slug);
    `),
  ).toMatchObject({
    kind: 'index',
    temporary: false,
    unique: true,
    name: {name: 'posts_slug'},
    onName: {name: 'posts'},
  });

  expect(
    classifySqliteCreateStatement(`
      create /* before kind */ trigger posts_ai after insert on [posts] begin select 1; end;
    `),
  ).toMatchObject({
    kind: 'trigger',
    name: {name: 'posts_ai'},
    onName: {name: 'posts'},
  });

  expect(classifySqliteCreateStatement(`create virtual table docs using fts5(body);`)).toMatchObject({
    kind: 'virtual-table',
    name: {name: 'docs'},
  });
});

test('sqlite parser facade does not treat strings or quoted identifiers as keywords', () => {
  expect(firstSqliteKeyword(`/* select */ -- insert\nwith cte as (select 1) select * from cte`)).toBe('with');
  expect(firstSqliteKeyword(`"select" from somewhere`)).toBeNull();

  expect(
    containsSqliteKeyword(
      `
        insert into posts ("returning", note)
        values (1, 'returning')
        -- returning
        /* returning */
      `,
      'returning',
    ),
  ).toBe(false);

  expect(
    containsSqliteKeyword(
      `
        insert into posts ("returning", note)
        values (1, 'returning')
        returning id
      `,
      'returning',
    ),
  ).toBe(true);
});

test('sqlite parser facade spans the full qualified identifier when naming the final segment', () => {
  const sql = `create table main.posts (id integer);`;
  const createStatement = classifySqliteCreateStatement(sql);

  expect(createStatement).toMatchObject({
    kind: 'table',
    name: {name: 'posts', start: 13, end: 23},
  });
  expect(replaceSqliteIdentifierSpan(sql, createStatement!.name!, `"scratch"."posts"`)).toBe(
    `create table "scratch"."posts" (id integer);`,
  );
});
