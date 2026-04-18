import {createRouterClient, type RouterClient} from '@orpc/server';
import type {UiRouter} from 'sqlfu/ui/browser';
import {uiRouter} from 'sqlfu/ui/browser';

import {buildDemoConfig, createBrowserHost, DEMO_PROJECT_ROOT} from './browser-host.js';

export const DEMO_URL = '?demo=1';
export const LOCAL_URL = 'https://local.sqlfu.dev/';

export function isDemoMode() {
  if (typeof window === 'undefined') {
    return false;
  }
  if (new URLSearchParams(window.location.search).get('demo') === '1') {
    return true;
  }
  // Fallback: some environments expose a URL in window.location.href but leave
  // window.location.search empty (observed on iOS Chrome via remote control).
  // Parse the full href with the URL constructor as a belt-and-suspenders check.
  try {
    return new URL(window.location.href).searchParams.get('demo') === '1';
  } catch {
    return false;
  }
}

export function createDemoClient(input: {
  onSchemaChange: () => void;
}): RouterClient<UiRouter> {
  const clientPromise = createBrowserHost({onSchemaChange: input.onSchemaChange}).then(({host, config}) =>
    createRouterClient(uiRouter, {
      context: {
        host,
        project: {initialized: true as const, projectRoot: DEMO_PROJECT_ROOT, config},
      },
    }),
  );
  return lazyRouterClientProxy<RouterClient<UiRouter>>(clientPromise, []);
}

export {buildDemoConfig};

function lazyRouterClientProxy<T>(target: Promise<unknown>, segments: readonly string[]): T {
  const fn = () => {};
  return new Proxy(fn, {
    get(_, prop) {
      if (typeof prop !== 'string' || prop === 'then') {
        return undefined;
      }
      return lazyRouterClientProxy<unknown>(target, [...segments, prop]);
    },
    apply: async (_self, _thisArg, args: unknown[]) => {
      const resolved = await target;
      let cursor: unknown = resolved;
      for (const segment of segments) {
        cursor = (cursor as Record<string, unknown>)[segment];
      }
      if (typeof cursor !== 'function') {
        throw new Error(`Demo client has no procedure at ${segments.join('.')}`);
      }
      return (cursor as (...callArgs: unknown[]) => unknown)(...args);
    },
  }) as T;
}
