import {afterEach, expect, test, vi} from 'vitest';

import {resolveApiOrigin, resolveApiRpcUrl} from './runtime.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('hosted sqlfu.dev defaults to the local backend port', () => {
  vi.stubGlobal('window', {
    location: new URL('https://sqlfu.dev/ui/'),
  });

  expect(resolveApiOrigin()).toBe('http://localhost:56081');
  expect(resolveApiRpcUrl()).toBe('http://localhost:56081/api/rpc');
});

test('query string apiOrigin overrides the hosted default', () => {
  vi.stubGlobal('window', {
    location: new URL('https://sqlfu.dev/ui/?apiOrigin=http://127.0.0.1:9'),
  });

  expect(resolveApiOrigin()).toBe('http://127.0.0.1:9');
});

test('runtime-config global overrides the hosted default', () => {
  vi.stubGlobal('window', {
    location: new URL('https://sqlfu.dev/ui/'),
    SQLFU_API_ORIGIN: 'http://127.0.0.1:56081',
  });

  expect(resolveApiOrigin()).toBe('http://127.0.0.1:56081');
});
