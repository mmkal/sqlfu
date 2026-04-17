import {expect, test} from 'vitest';

import {rawSqlWithSqlSplittingSync} from '../src/core/sqlite.js';

test('rawSqlWithSqlSplittingSync ignores comment-only sql', () => {
  let calls = 0;

  const result = rawSqlWithSqlSplittingSync(() => {
    calls += 1;
    return {};
  }, '-- write your schema here\n');

  expect(result).toMatchObject({});
  expect(calls).toBe(0);
});
