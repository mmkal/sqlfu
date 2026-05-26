import {expect, test} from 'vitest';

import {buildRelationSubviewSql, readRelationSubviewPage, rewriteRelationSubviewPage} from './relation-subview-sql.js';

test('relation subview SQL renders boolean literals that Postgres accepts', () => {
  expect(buildRelationSubviewSql('feature_flags', 'enabled', true)).toBe(
    'select * from "feature_flags" where "enabled" = true limit 100',
  );
  expect(buildRelationSubviewSql('feature_flags', 'enabled', false)).toBe(
    'select * from "feature_flags" where "enabled" = false limit 100',
  );
});

test('relation subview pagination rewrites the trailing limit without dropping the filter', () => {
  const sql = 'select * from "order_details" where "product_id" = 1 limit 100';
  expect(rewriteRelationSubviewPage(sql, {limit: 25, offset: 0})).toBe(
    'select * from "order_details" where "product_id" = 1 limit 25',
  );
  expect(rewriteRelationSubviewPage(sql, {limit: 100, offset: 100})).toBe(
    'select * from "order_details" where "product_id" = 1 limit 100 offset 100',
  );
});

test('relation subview pagination reads missing offset as the first page', () => {
  expect(readRelationSubviewPage('select * from "products" where "product_id" = 11 limit 100')).toMatchObject({
    limit: 100,
    offset: 0,
  });
});
