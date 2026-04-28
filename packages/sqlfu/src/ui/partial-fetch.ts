import {RPCHandler} from '@orpc/server/fetch';

import {createDurableObjectClient, type DurableObjectClientInput} from '../adapters/durable-object.js';
import type {AdHocSqlParams, AdHocSqlResult, HostCatalog, HostFs, HostLogger, SqlfuHost} from '../host.js';
import {basename, joinPath} from '../paths.js';
import {sqlReturnsRows} from '../sqlite-text.js';
import type {AsyncClient, Client, ResultRow, RunResult, SqlfuProjectConfig} from '../types.js';
import type {MigrationBundle} from '../migrations/index.js';
import {sha256} from '../vendor/sha256.js';
import type {QueryCatalog} from '../typegen/query-catalog.js';
import {uiRouter, type ResolvedUiProject} from './router.js';

export type SqlfuUiAssetBody = string | Uint8Array | ArrayBuffer | Blob | Response;
export type SqlfuUiAsset = SqlfuUiAssetBody | (() => SqlfuUiAssetBody | Promise<SqlfuUiAssetBody>);
export type SqlfuUiAssets = Record<string, SqlfuUiAsset>;

export type SqlfuUiPartialFetch = (request: Request) => Promise<Response | undefined>;

export type CreateSqlfuUiPartialFetchInput = {
  assets: SqlfuUiAssets;
  host: SqlfuHost;
  project: ResolvedUiProject;
};

export type CreateDurableObjectSqlfuUiFetchInput = {
  storage: DurableObjectClientInput;
  assets: SqlfuUiAssets;
  projectName?: string;
  definitionsSql?: string;
  migrations?: MigrationBundle;
  queries?: Record<string, string>;
  catalog?: QueryCatalog;
  logger?: HostLogger;
};

export type CreateDurableObjectSqlfuUiHostInput = {
  storage: DurableObjectClientInput;
  files?: Record<string, string>;
  catalog?: QueryCatalog;
  logger?: HostLogger;
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

export function createDurableObjectSqlfuUiFetch(input: CreateDurableObjectSqlfuUiFetchInput): SqlfuUiPartialFetch {
  const project = createDurableObjectProject(input);
  const files = createDurableObjectProjectFiles(project.config, input);
  const host = createDurableObjectSqlfuUiHost({
    storage: input.storage,
    files,
    catalog: input.catalog,
    logger: input.logger,
  });
  return createSqlfuUiPartialFetch({
    assets: input.assets,
    host,
    project,
  });
}

export function createDurableObjectSqlfuUiHost(input: CreateDurableObjectSqlfuUiHostInput): SqlfuHost {
  const fs = createMemoryFs(input.files || {});
  const catalog = createStaticCatalog(input.catalog);
  const logger = input.logger || console;

  return {
    fs,
    async openDb() {
      const client = createDurableObjectClient(input.storage);
      return {
        client: client as unknown as AsyncClient,
        async [Symbol.asyncDispose]() {},
      };
    },
    async openScratchDb() {
      throw new Error('sqlfu/ui Durable Object host does not provide scratch databases.');
    },
    execAdHocSql,
    async initializeProject(projectInput) {
      await fs.writeFile(joinPath(projectInput.projectRoot, 'sqlfu.config.ts'), projectInput.configContents);
    },
    async digest(content) {
      return digest(content);
    },
    now: () => new Date(),
    uuid: () => globalThis.crypto.randomUUID(),
    logger,
    catalog,
  };
}

function createDurableObjectProject(input: {projectName?: string}): ResolvedUiProject & {initialized: true} {
  const projectName = sanitizeProjectName(input.projectName || 'durable-object');
  const projectRoot = `/${projectName}`;
  const config: SqlfuProjectConfig = {
    projectRoot,
    db: ':durable-object:',
    definitions: joinPath(projectRoot, 'definitions.sql'),
    migrations: {
      path: joinPath(projectRoot, 'migrations'),
      prefix: 'iso',
      preset: 'sqlfu',
    },
    queries: joinPath(projectRoot, 'sql'),
    generate: {
      validator: null,
      prettyErrors: true,
      sync: true,
      importExtension: '.js',
      authority: 'live_schema',
    },
  };

  return {
    initialized: true,
    projectRoot,
    config,
  };
}

function createDurableObjectProjectFiles(
  config: SqlfuProjectConfig,
  input: {
    definitionsSql?: string;
    migrations?: MigrationBundle;
    queries?: Record<string, string>;
  },
) {
  const files: Record<string, string> = {
    [config.definitions]: input.definitionsSql || '',
  };

  const migrations = input.migrations || {};
  for (const [filePath, content] of Object.entries(migrations)) {
    files[joinPath(config.migrations!.path, basename(filePath))] = content;
  }

  const queries = input.queries || {};
  for (const [filePath, content] of Object.entries(queries)) {
    const relativePath = filePath.startsWith('sql/') ? filePath.slice('sql/'.length) : filePath;
    files[joinPath(config.queries, relativePath)] = content;
  }

  return files;
}

async function execAdHocSql(client: AsyncClient, sql: string, params: AdHocSqlParams): Promise<AdHocSqlResult> {
  const runtimeClient = client as unknown as Client;
  const stmt = runtimeClient.prepare(sql);
  try {
    if (sqlReturnsRows(sql)) {
      return {
        mode: 'rows',
        rows: (await stmt.all(params)) as ResultRow[],
      };
    }

    return {
      mode: 'metadata',
      metadata: (await stmt.run(params)) as RunResult,
    };
  } finally {
    await disposeStatement(stmt);
  }
}

async function disposeStatement(stmt: {[Symbol.dispose]?: () => void; [Symbol.asyncDispose]?: () => Promise<void>}) {
  const asyncDispose = stmt[Symbol.asyncDispose];
  if (asyncDispose) {
    await asyncDispose();
    return;
  }
  stmt[Symbol.dispose]?.();
}

function createStaticCatalog(catalog: QueryCatalog | undefined): HostCatalog {
  return {
    async load() {
      return catalog || {generatedAt: new Date(0).toISOString(), queries: []};
    },
    async refresh() {},
    async analyzeSql() {
      return {};
    },
  };
}

function createMemoryFs(initialFiles: Record<string, string>): HostFs {
  const files = new Map(
    Object.entries(initialFiles).map(([filePath, content]) => [normalizeFsPath(filePath), content]),
  );

  return {
    async readFile(filePath) {
      const normalized = normalizeFsPath(filePath);
      if (!files.has(normalized)) {
        throw enoent(normalized);
      }
      return files.get(normalized)!;
    },
    async writeFile(filePath, contents) {
      files.set(normalizeFsPath(filePath), contents);
    },
    async readdir(dirPath) {
      const prefix = normalizeDirectoryPath(dirPath);
      const entries = new Set<string>();
      for (const filePath of files.keys()) {
        if (!filePath.startsWith(prefix)) {
          continue;
        }
        const rest = filePath.slice(prefix.length);
        const [entry] = rest.split('/');
        if (entry) {
          entries.add(entry);
        }
      }
      return [...entries].sort();
    },
    async mkdir() {},
    async rm(filePath) {
      files.delete(normalizeFsPath(filePath));
    },
    async rename(from, to) {
      const normalizedFrom = normalizeFsPath(from);
      if (!files.has(normalizedFrom)) {
        throw enoent(normalizedFrom);
      }
      const content = files.get(normalizedFrom)!;
      files.delete(normalizedFrom);
      files.set(normalizeFsPath(to), content);
    },
    async exists(filePath) {
      const normalized = normalizeFsPath(filePath);
      if (files.has(normalized)) {
        return true;
      }
      const prefix = normalizeDirectoryPath(normalized);
      return [...files.keys()].some((candidate) => candidate.startsWith(prefix));
    },
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

function normalizeFsPath(filePath: string) {
  return normalizeAssetPath(filePath);
}

function normalizeDirectoryPath(dirPath: string) {
  const normalized = normalizeFsPath(dirPath);
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function sanitizeProjectName(projectName: string) {
  const sanitized = projectName.trim().replace(/^\/+|\/+$/g, '');
  if (!sanitized || !/^[a-z0-9-]+$/u.test(sanitized)) {
    throw new Error(`Invalid sqlfu Durable Object UI project name: ${projectName}`);
  }
  return sanitized;
}

function enoent(filePath: string) {
  const error = new Error(`${filePath} not found`) as Error & {code: string};
  error.code = 'ENOENT';
  return error;
}

function digest(content: string) {
  const bytes = sha256(new TextEncoder().encode(content));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
