import {expect, test} from 'vitest';

import {splitSqlStatements, sqlReturnsRows} from '../src/sqlite-text.js';

test('sql statement splitter uses the same quote and comment scan rules', () => {
  expect(
    splitSqlStatements(
      [
        `select ':literal;' as single, ";double" as double, \`tick;name\` as tick, [bracket;name] as bracketed;`,
        `-- comment;`,
        `/* block; */`,
        `select 2;`,
      ].join('\n'),
    ),
  ).toMatchObject([
    `select ':literal;' as single, ";double" as double, \`tick;name\` as tick, [bracket;name] as bracketed;`,
    [`-- comment;`, `/* block; */`, `select 2;`].join('\n'),
  ]);
});

test('sql row-return classification ignores comments, strings, and quoted identifiers', () => {
  expect(sqlReturnsRows(`-- insert into posts values (1)\nselect 'returning' as note`)).toBe(true);
  expect(sqlReturnsRows(`insert into posts (note) values ('returning')`)).toBe(false);
  expect(sqlReturnsRows(`update "returning" set note = 'returning'`)).toBe(false);
  expect(sqlReturnsRows(`insert into posts (note) values ('saved') returning id`)).toBe(true);
  expect(sqlReturnsRows(`select value::json from events`)).toBe(true);
  expect(sqlReturnsRows(`show timezone`)).toBe(true);
  expect(sqlReturnsRows(`fetch all from cursor_name`)).toBe(true);
});
