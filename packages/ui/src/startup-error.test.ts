import {expect, test} from 'vitest';

import {
  SUPPORTED_SERVER_RANGE,
  ServerVersionMismatchError,
  checkServerVersion,
  classifyStartupError,
} from './startup-error.ts';

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

test('classifies ServerVersionMismatchError as version-mismatch with both versions', () => {
  const error = new ServerVersionMismatchError({
    serverVersion: '0.0.1',
    supportedRange: '>=0.0.2-3',
  });
  expect(classifyStartupError(error)).toMatchObject({
    kind: 'version-mismatch',
    status: null,
    serverVersion: '0.0.1',
    supportedRange: '>=0.0.2-3',
  });
});

test('checkServerVersion returns null when the server is at the floor', () => {
  expect(checkServerVersion({serverVersion: '0.0.2-3'})).toBeNull();
});

test('checkServerVersion returns null when the server is a newer stable release than the floor', () => {
  expect(checkServerVersion({serverVersion: '999.0.0'})).toBeNull();
});

test('checkServerVersion returns null for prereleases of versions above the floor (includePrerelease)', () => {
  expect(checkServerVersion({serverVersion: '0.1.0-0'})).toBeNull();
  expect(checkServerVersion({serverVersion: '1.0.0-beta.2'})).toBeNull();
});

test('checkServerVersion returns a mismatch error when the server is below the floor', () => {
  const result = checkServerVersion({serverVersion: '0.0.1'});
  expect(result).toBeInstanceOf(ServerVersionMismatchError);
  expect(result).toMatchObject({
    serverVersion: '0.0.1',
    supportedRange: SUPPORTED_SERVER_RANGE,
  });
});

test('checkServerVersion returns a mismatch error for an earlier prerelease of the floor version', () => {
  const result = checkServerVersion({serverVersion: '0.0.2-2'});
  expect(result).toBeInstanceOf(ServerVersionMismatchError);
  expect(result).toMatchObject({
    serverVersion: '0.0.2-2',
    supportedRange: SUPPORTED_SERVER_RANGE,
  });
});

test('checkServerVersion treats missing serverVersion as mismatch (old server)', () => {
  const result = checkServerVersion({serverVersion: undefined});
  expect(result).toBeInstanceOf(ServerVersionMismatchError);
  expect(result).toMatchObject({
    serverVersion: null,
    supportedRange: SUPPORTED_SERVER_RANGE,
  });
});
