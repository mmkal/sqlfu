import {describe, test, expect} from 'vitest';
import {buildRelationQuery, DEFAULT_LIMIT, defaultRelationQueryState, isDefaultRelationQueryState} from './relation-query-builder.js';

const allColumns = ['id', 'slug', 'title', 'body'];

test('default state produces a plain select-star with default limit', () => {
  const state = defaultRelationQueryState({tableName: 'posts', allColumns});
  expect(buildRelationQuery(state)).toBe(`select *\nfrom "posts"\nlimit ${DEFAULT_LIMIT}`);
});

test('hidden trailing column gets commented out without a trailing comma', () => {
  const state = {...defaultRelationQueryState({tableName: 'posts', allColumns}), hiddenColumns: ['body']};
  expect(buildRelationQuery(state)).toBe(
    `select "id", "slug", "title", /* "body" */\nfrom "posts"\nlimit ${DEFAULT_LIMIT}`,
  );
});

test('hidden middle column tucks its comma inside the comment so the SQL stays valid', () => {
  const state = {...defaultRelationQueryState({tableName: 'posts', allColumns}), hiddenColumns: ['title']};
  expect(buildRelationQuery(state)).toBe(
    `select "id", "slug", /* "title", */ "body"\nfrom "posts"\nlimit ${DEFAULT_LIMIT}`,
  );
});

test('hidden leading column still produces valid SQL', () => {
  const state = {...defaultRelationQueryState({tableName: 'posts', allColumns}), hiddenColumns: ['id']};
  expect(buildRelationQuery(state)).toBe(
    `select /* "id", */ "slug", "title", "body"\nfrom "posts"\nlimit ${DEFAULT_LIMIT}`,
  );
});

test('multiple adjacent hidden columns keep commas tucked inside their comments', () => {
  const state = {
    ...defaultRelationQueryState({tableName: 'posts', allColumns}),
    hiddenColumns: ['slug', 'title'],
  };
  expect(buildRelationQuery(state)).toBe(
    `select "id", /* "slug", */ /* "title", */ "body"\nfrom "posts"\nlimit ${DEFAULT_LIMIT}`,
  );
});

test('single sort clause renders asc/desc with quoted column name', () => {
  const state = {
    ...defaultRelationQueryState({tableName: 'posts', allColumns}),
    sorts: [{column: 'title', direction: 'desc' as const}],
  };
  expect(buildRelationQuery(state)).toBe(`select *\nfrom "posts"\norder by "title" desc\nlimit ${DEFAULT_LIMIT}`);
});

test('multiple sort clauses render in order, comma-separated', () => {
  const state = {
    ...defaultRelationQueryState({tableName: 'posts', allColumns}),
    sorts: [
      {column: 'published', direction: 'desc' as const},
      {column: 'title', direction: 'asc' as const},
    ],
  };
  expect(buildRelationQuery(state)).toBe(
    `select *\nfrom "posts"\norder by "published" desc, "title" asc\nlimit ${DEFAULT_LIMIT}`,
  );
});

describe('filter operator shapes', () => {
  test('equals with a string value is single-quoted', () => {
    const state = {
      ...defaultRelationQueryState({tableName: 'posts', allColumns}),
      filters: [{column: 'slug', operator: '=' as const, value: 'hello-world'}],
    };
    expect(buildRelationQuery(state)).toBe(
      `select *\nfrom "posts"\nwhere "slug" = 'hello-world'\nlimit ${DEFAULT_LIMIT}`,
    );
  });

  test('like wraps value verbatim (user supplies the wildcards)', () => {
    const state = {
      ...defaultRelationQueryState({tableName: 'posts', allColumns}),
      filters: [{column: 'title', operator: 'like' as const, value: '%foo%'}],
    };
    expect(buildRelationQuery(state)).toBe(
      `select *\nfrom "posts"\nwhere "title" like '%foo%'\nlimit ${DEFAULT_LIMIT}`,
    );
  });

  test('is null renders without a value', () => {
    const state = {
      ...defaultRelationQueryState({tableName: 'posts', allColumns}),
      filters: [{column: 'body', operator: 'is null' as const}],
    };
    expect(buildRelationQuery(state)).toBe(`select *\nfrom "posts"\nwhere "body" is null\nlimit ${DEFAULT_LIMIT}`);
  });

  test('is not null renders without a value', () => {
    const state = {
      ...defaultRelationQueryState({tableName: 'posts', allColumns}),
      filters: [{column: 'body', operator: 'is not null' as const}],
    };
    expect(buildRelationQuery(state)).toBe(
      `select *\nfrom "posts"\nwhere "body" is not null\nlimit ${DEFAULT_LIMIT}`,
    );
  });

  test('in passes the value verbatim inside parentheses', () => {
    const state = {
      ...defaultRelationQueryState({tableName: 'posts', allColumns}),
      filters: [{column: 'id', operator: 'in' as const, value: '1, 2, 3'}],
    };
    expect(buildRelationQuery(state)).toBe(`select *\nfrom "posts"\nwhere "id" in (1, 2, 3)\nlimit ${DEFAULT_LIMIT}`);
  });

  test('multiple filters are joined with and', () => {
    const state = {
      ...defaultRelationQueryState({tableName: 'posts', allColumns}),
      filters: [
        {column: 'slug', operator: '=' as const, value: 'hello-world'},
        {column: 'body', operator: 'is not null' as const},
      ],
    };
    expect(buildRelationQuery(state)).toBe(
      `select *\nfrom "posts"\nwhere "slug" = 'hello-world' and "body" is not null\nlimit ${DEFAULT_LIMIT}`,
    );
  });

  test("single quotes in a string value are escaped by doubling", () => {
    const state = {
      ...defaultRelationQueryState({tableName: 'posts', allColumns}),
      filters: [{column: 'title', operator: '=' as const, value: "don't stop"}],
    };
    expect(buildRelationQuery(state)).toBe(
      `select *\nfrom "posts"\nwhere "title" = 'don''t stop'\nlimit ${DEFAULT_LIMIT}`,
    );
  });

  test('numeric comparison still quotes the value — sqlite casts strings to numbers for compare', () => {
    const state = {
      ...defaultRelationQueryState({tableName: 'posts', allColumns}),
      filters: [{column: 'id', operator: '>' as const, value: '10'}],
    };
    expect(buildRelationQuery(state)).toBe(`select *\nfrom "posts"\nwhere "id" > '10'\nlimit ${DEFAULT_LIMIT}`);
  });
});

test('offset is emitted only when non-zero', () => {
  const state = {...defaultRelationQueryState({tableName: 'posts', allColumns}), offset: 200, limit: 50};
  expect(buildRelationQuery(state)).toBe(`select *\nfrom "posts"\nlimit 50 offset 200`);
});

test('combined clauses render in canonical order: select / from / where / order by / limit / offset', () => {
  const state = {
    tableName: 'posts',
    allColumns,
    hiddenColumns: ['body'],
    filters: [{column: 'slug', operator: 'like' as const, value: 'hello%'}],
    sorts: [{column: 'title', direction: 'asc' as const}],
    limit: 25,
    offset: 50,
  };
  expect(buildRelationQuery(state)).toBe(
    `select "id", "slug", "title", /* "body" */\nfrom "posts"\nwhere "slug" like 'hello%'\norder by "title" asc\nlimit 25 offset 50`,
  );
});

test('table names with special characters are quoted safely', () => {
  const state = defaultRelationQueryState({tableName: 'user"data', allColumns: ['x']});
  expect(buildRelationQuery(state)).toBe(`select *\nfrom "user""data"\nlimit ${DEFAULT_LIMIT}`);
});

test('column names with special characters are quoted safely in select and filter positions', () => {
  const state = {
    ...defaultRelationQueryState({tableName: 't', allColumns: ['weird"col', 'ok']}),
    hiddenColumns: ['ok'],
    filters: [{column: 'weird"col', operator: '=' as const, value: 'v'}],
  };
  expect(buildRelationQuery(state)).toBe(
    `select "weird""col", /* "ok" */\nfrom "t"\nwhere "weird""col" = 'v'\nlimit ${DEFAULT_LIMIT}`,
  );
});

test('combined clauses with a hidden middle column stays syntactically valid', () => {
  const state = {
    tableName: 'posts',
    allColumns,
    hiddenColumns: ['title'],
    filters: [{column: 'slug', operator: 'like' as const, value: 'hello%'}],
    sorts: [{column: 'id', direction: 'desc' as const}],
    limit: 25,
    offset: 0,
  };
  expect(buildRelationQuery(state)).toBe(
    `select "id", "slug", /* "title", */ "body"\nfrom "posts"\nwhere "slug" like 'hello%'\norder by "id" desc\nlimit 25`,
  );
});

describe('isDefaultRelationQueryState', () => {
  test('fresh default state is default', () => {
    expect(isDefaultRelationQueryState(defaultRelationQueryState({tableName: 'posts', allColumns}))).toBe(true);
  });

  test('any filter makes it non-default', () => {
    const state = {
      ...defaultRelationQueryState({tableName: 'posts', allColumns}),
      filters: [{column: 'id', operator: '=' as const, value: '1'}],
    };
    expect(isDefaultRelationQueryState(state)).toBe(false);
  });

  test('any sort makes it non-default', () => {
    const state = {
      ...defaultRelationQueryState({tableName: 'posts', allColumns}),
      sorts: [{column: 'id', direction: 'asc' as const}],
    };
    expect(isDefaultRelationQueryState(state)).toBe(false);
  });

  test('hiding a column makes it non-default', () => {
    const state = {...defaultRelationQueryState({tableName: 'posts', allColumns}), hiddenColumns: ['body']};
    expect(isDefaultRelationQueryState(state)).toBe(false);
  });

  test('non-zero offset makes it non-default', () => {
    const state = {...defaultRelationQueryState({tableName: 'posts', allColumns}), offset: 100};
    expect(isDefaultRelationQueryState(state)).toBe(false);
  });

  test('changing limit away from default makes it non-default', () => {
    const state = {...defaultRelationQueryState({tableName: 'posts', allColumns}), limit: 500};
    expect(isDefaultRelationQueryState(state)).toBe(false);
  });
});
