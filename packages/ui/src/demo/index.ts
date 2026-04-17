import type {RouterClient} from '@orpc/server';
import type {UiRouter} from 'sqlfu/ui/browser';

import {createWasmSqliteClient} from './sqlite-wasm-client.js';
import {createDemoRouterClient} from './router.js';

export const DEMO_HOST = 'demo.local.sqlfu.dev';
export const DEMO_URL = `https://${DEMO_HOST}/`;
export const LOCAL_URL = 'https://local.sqlfu.dev/';

export function isDemoMode() {
  if (typeof window === 'undefined') {
    return false;
  }
  if (window.location.hostname === DEMO_HOST) {
    return true;
  }
  return new URLSearchParams(window.location.search).get('demo') === '1';
}

export function createDemoClient(input: {
  onSchemaChange: () => void;
}): RouterClient<UiRouter> {
  const clientPromise = createWasmSqliteClient().then((client) =>
    createDemoRouterClient({
      client,
      onSchemaChange: input.onSchemaChange,
    }),
  );
  return lazyRouterClientProxy<RouterClient<UiRouter>>(clientPromise, []);
}

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
