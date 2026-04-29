import {RPCHandler} from '@orpc/server/fetch';

import type {SqlfuUiHost} from '../host.js';
import {uiRouter, type SqlfuUiProject} from './router.js';

export type SqlfuUiAssetBody = string | Uint8Array | ArrayBuffer | Blob | Response;
export type SqlfuUiAsset = SqlfuUiAssetBody | (() => SqlfuUiAssetBody | Promise<SqlfuUiAssetBody>);
export type SqlfuUiAssets = Record<string, SqlfuUiAsset>;

export type SqlfuUiPartialFetch = (request: Request) => Promise<Response | undefined>;

export type CreateSqlfuUiPartialFetchInput = {
  assets: SqlfuUiAssets;
  host: SqlfuUiHost;
  project: SqlfuUiProject;
};

export function createSqlfuUiPartialFetch(input: CreateSqlfuUiPartialFetchInput): SqlfuUiPartialFetch {
  const rpcHandler = new RPCHandler(uiRouter);

  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/rpc')) {
      if (request.method === 'OPTIONS') {
        return apiPreflightResponse(request);
      }

      const {matched, response} = await rpcHandler.handle(request, {
        prefix: '/api/rpc',
        context: {
          host: input.host,
          project: input.project,
        },
      });
      return withApiCors(request, matched ? response : new Response('Not found', {status: 404}));
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return undefined;
    }

    const assetPath = normalizeAssetPath(url.pathname === '/' ? '/index.html' : url.pathname);
    const asset = getAsset(input.assets, assetPath);
    if (!asset) {
      return undefined;
    }

    return assetResponse(assetPath, await loadAsset(asset), request.method === 'HEAD');
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
      headers.set('content-type', contentTypeForPath(assetPath));
    }
    return new Response(head ? null : response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  return new Response(head ? null : responseBody(body), {
    headers: {
      'content-type': contentTypeForPath(assetPath),
    },
  });
}

function responseBody(body: Exclude<SqlfuUiAssetBody, Response>) {
  if (body instanceof Uint8Array) {
    return new Uint8Array(body).buffer;
  }
  return body;
}

function contentTypeForPath(filePath: string) {
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
    return 'text/javascript; charset=utf-8';
  }
  if (filePath.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  if (filePath.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }
  if (filePath.endsWith('.json')) {
    return 'application/json; charset=utf-8';
  }
  if (filePath.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  if (filePath.endsWith('.png')) {
    return 'image/png';
  }
  if (filePath.endsWith('.ico')) {
    return 'image/x-icon';
  }
  if (filePath.endsWith('.wasm')) {
    return 'application/wasm';
  }
  return 'application/octet-stream';
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
