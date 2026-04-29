import {RPCHandler} from '@orpc/server/fetch';

import type {SqlfuUiHost} from '../host.js';
import {uiRouter, type SqlfuUiProject} from './router.js';
import {contentTypeForUiAssetPath} from './asset-content-type.js';

export type SqlfuUiAssetBody = string | Uint8Array | ArrayBuffer | Blob | Response;
export type SqlfuUiAsset = SqlfuUiAssetBody | (() => SqlfuUiAssetBody | Promise<SqlfuUiAssetBody>);
export type SqlfuUiAssets = Record<string, SqlfuUiAsset>;

export type SqlfuUiPartialFetch = (request: Request) => Promise<Response | undefined>;

export type CreateSqlfuUiPartialFetchInput = {
  assets: SqlfuUiAssets;
  host: SqlfuUiHost;
  prefixPath?: string;
  project: SqlfuUiProject;
};

/**
 * A partial server-side `fetch` implementation. Gives you a function that maps a `Request` to:
 * - a `Response` if the `@sqlfu/ui` can handle the request.
 * - `undefined` if the `@sqlfu/ui` cannot handle the request - you can pass through to your own `fetch` implementation in this case.
 */
export function createSqlfuUiPartialFetch(input: CreateSqlfuUiPartialFetchInput): SqlfuUiPartialFetch {
  const rpcHandler = new RPCHandler(uiRouter);
  const prefixPath = normalizePrefixPath(input.prefixPath);
  const apiPrefix = `${prefixPath}/api/rpc` as `/${string}`;

  return async (request) => {
    const url = new URL(request.url);
    const requestPath = stripPrefixPath(url.pathname, prefixPath);
    if (requestPath === undefined) {
      return undefined;
    }

    if (requestPath.startsWith('/api/rpc')) {
      if (request.method === 'OPTIONS') {
        return apiPreflightResponse(request);
      }

      const {matched, response} = await rpcHandler.handle(request, {
        prefix: apiPrefix,
        context: { host: input.host, project: input.project },
      });
      return withApiCors(request, matched ? response : new Response('Not found', {status: 404}));
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return undefined;
    }

    const assetPath = normalizeAssetPath(requestPath === '' || requestPath === '/' ? '/index.html' : requestPath);
    const asset = getAsset(input.assets, assetPath);
    if (!asset) {
      return undefined;
    }

    return assetResponse(
      assetPath,
      assetBodyForRequest(assetPath, await loadAsset(asset), prefixPath, url.origin),
      request.method === 'HEAD',
    );
  };
}

function getAsset(assets: SqlfuUiAssets, assetPath: string) {
  return assets[assetPath] || assets[assetPath.slice(1)];
}

async function loadAsset(asset: SqlfuUiAsset) {
  return typeof asset === 'function' ? await asset() : asset;
}

function assetResponse(assetPath: string, body: SqlfuUiAssetBody, head: boolean) {
  if (body instanceof Response) {
    const response = body.clone();
    const headers = new Headers(response.headers);
    if (!headers.has('content-type')) {
      headers.set('content-type', contentTypeForUiAssetPath(assetPath));
    }
    return new Response(head ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  return new Response(head ? null : responseBody(body), {
    headers: {
      'content-type': contentTypeForUiAssetPath(assetPath),
    },
  });
}

function assetBodyForRequest(
  assetPath: string,
  body: SqlfuUiAssetBody,
  prefixPath: string,
  origin: string,
): SqlfuUiAssetBody {
  if (!prefixPath) {
    return body;
  }

  if (assetPath === '/runtime-config.js') {
    return `window.SQLFU_API_ORIGIN = window.SQLFU_API_ORIGIN || ${JSON.stringify(new URL(`${prefixPath}/`, origin).toString())};\n`;
  }

  if (assetPath === '/index.html' && typeof body === 'string') {
    return body.replace('<head>', `<head>\n    <base href="${htmlAttribute(`${prefixPath}/`)}" />`);
  }

  return body;
}

function responseBody(body: Exclude<SqlfuUiAssetBody, Response>) {
  if (body instanceof Uint8Array) {
    return new Uint8Array(body).buffer;
  }
  return body;
}

function apiPreflightResponse(request: Request) {
  return withApiCors(request, new Response(null, {status: 204}));
}

function withApiCors(request: Request, response: Response) {
  const headers = new Headers(response.headers);
  const origin = request.headers.get('origin');
  const requestedHeaders = request.headers.get('access-control-request-headers');
  const privateNetwork = request.headers.get('access-control-request-private-network');

  if (origin) {
    headers.set('access-control-allow-origin', origin);
    headers.set('vary', 'origin');
  }

  headers.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  headers.set('access-control-allow-headers', requestedHeaders || 'content-type,x-sqlfu-project');

  if (privateNetwork === 'true') {
    headers.set('access-control-allow-private-network', 'true');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function normalizeAssetPath(assetPath: string) {
  const withSlash = assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
  return withSlash.replace(/\/+/g, '/');
}

function normalizePrefixPath(prefixPath: string | undefined) {
  const normalized = normalizeAssetPath(prefixPath || '/').replace(/\/+$/u, '');
  return normalized === '' ? '' : normalized;
}

function stripPrefixPath(pathname: string, prefixPath: string) {
  if (!prefixPath) {
    return pathname;
  }
  if (pathname === prefixPath) {
    return '';
  }
  if (pathname.startsWith(`${prefixPath}/`)) {
    return pathname.slice(prefixPath.length);
  }
  return undefined;
}

function htmlAttribute(value: string) {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;');
}
