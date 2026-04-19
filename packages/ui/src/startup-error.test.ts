import {expect, test} from 'vitest';

import {classifyStartupError} from './startup-error.ts';

test('classifies missing HTTP status as unreachable', () => {
  expect(classifyStartupError(new TypeError('Failed to fetch'))).toMatchObject({
    kind: 'unreachable',
    status: null,
  });
});

test('classifies 4xx responses as client errors', () => {
  expect(
    classifyStartupError({
      status: 404,
      message: 'Not found',
    }),
  ).toMatchObject({
    kind: 'client-error',
    status: 404,
  });
});

test('classifies nested 5xx responses as server errors', () => {
  expect(
    classifyStartupError({
      response: {
        status: 500,
      },
      message: 'Internal server error',
    }),
  ).toMatchObject({
    kind: 'server-error',
    status: 500,
  });
});
