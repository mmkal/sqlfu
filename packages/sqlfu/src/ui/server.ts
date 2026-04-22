import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {RPCHandler} from '@orpc/server/fetch';
import type {ViteDevServer} from 'vite';
import {loadProjectStateFrom, resolveProjectConfig} from '../core/config.js';
import {PortInUseError, getListeningProcesses} from '../core/port-process.js';
import {generateQueryTypesForConfig} from '../typegen/index.js';
import type {SqlfuHost} from '../core/host.js';
import {createNodeHost} from '../core/node-host.js';
import {uiRouter, type ResolvedUiProject} from './router.js';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(sourceDir, '..', '..');

type ProjectResolver = (request: {
  host: string;
  projectHeader?: string;
}) => Promise<ResolvedUiProject>;

type UiAssetOptions = {
  root: string;
  distDir?: string;
  indexHtmlPath?: string;
};

export type StartSqlfuServerOptions = {
  port?: number;
  projectRoot?: string;
  defaultProjectName?: string;
  allowUnknownHosts?: boolean;
  projectsRoot?: string;
  templateRoot?: string;
  dev?: boolean;
  ui?: UiAssetOptions;
  tls?: {
    key: string;
    cert: string;
  };
};

export type {UiRouter} from './router.js';

export async function startSqlfuServer(input: StartSqlfuServerOptions = {}) {
  const host = await createNodeHost();
  const resolveProject = input.projectRoot
    ? createFixedProjectResolver(path.resolve(input.projectRoot))
    : createSubdomainProjectResolver({
        host,
        projectsRoot: path.resolve(input.projectsRoot ?? path.join(packageRoot, 'test', 'projects')),
        templateRoot: path.resolve(input.templateRoot ?? path.join(packageRoot, 'test', 'template-project')),
        defaultProjectName: input.defaultProjectName ?? 'dev-project',
        allowUnknownHosts: input.allowUnknownHosts || false,
      });
  const rpcHandler = new RPCHandler(uiRouter);
  const httpServer = input.tls
    ? https.createServer({
        key: input.tls.key,
        cert: input.tls.cert,
      })
    : http.createServer();
  const uiAssets = input.ui ? resolveUiAssets(input.ui) : undefined;
  const vite = input.dev && uiAssets ? await createUiDevServer(uiAssets.root, httpServer) : undefined;

  httpServer.on('request', async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      const apiRequest = url.pathname.startsWith('/api/rpc');

      if (apiRequest && req.method === 'OPTIONS') {
        await sendWebResponse(res, apiPreflightResponse(req));
        return;
      }

      const project = await resolveProject({
        host: req.headers.host ?? url.host,
        projectHeader: headerValue(req.headers['x-sqlfu-project']),
      });

      if (apiRequest) {
        const request = await toWebRequest(req, url);
        const {matched, response} = await rpcHandler.handle(request, {
          prefix: '/api/rpc',
          context: {project, host},
        });
        await sendWebResponse(res, withApiCors(req, matched ? response : new Response('Not found', {status: 404})));
        return;
      }

      if (vite && uiAssets) {
        await serveViteRequest(vite, req, res, url, uiAssets.indexHtmlPath);
        return;
      }

      if (uiAssets?.distDir) {
        await serveBuiltUi(res, url, uiAssets.distDir);
        return;
      }

      await sendWebResponse(res, htmlResponse(renderServerHomePage(project), 200));
    } catch (error) {
      await sendWebResponse(res, requestErrorResponse(error, req.url ?? '/'));
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: unknown) => {
      void normalizeListenError(error, input.port ?? 56081).then(reject, reject);
    };
    httpServer.once('error', onError);
    httpServer.listen(input.port ?? 56081, () => {
      httpServer.off('error', onError);
      resolve();
    });
  });

  if (vite) {
    httpServer.on('close', () => {
      void vite.close();
    });
  }

  return {
    port: getServerPort(httpServer),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    server: httpServer,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void runCliServer();
}

async function runCliServer() {
  const projectRoot = readOption('--project-root');
  const port = readOption('--port');
  const dev = process.argv.includes('--dev');
  const tlsKeyPath = readOption('--tls-key');
  const tlsCertPath = readOption('--tls-cert');
  const server = await startSqlfuServer({
    projectRoot,
    defaultProjectName: readOption('--default-project') ?? undefined,
    projectsRoot: readOption('--projects-root') ?? undefined,
    templateRoot: readOption('--template-root') ?? undefined,
    port: port ? Number(port) : undefined,
    dev,
    tls:
      tlsKeyPath && tlsCertPath
        ? {
            key: await fs.readFile(tlsKeyPath, 'utf8'),
            cert: await fs.readFile(tlsCertPath, 'utf8'),
          }
        : undefined,
  });
  void server;
  console.log('sqlfu ready at https://sqlfu.dev/ui');
}

async function normalizeListenError(error: unknown, port: number) {
  if (isErrnoException(error) && error.code === 'EADDRINUSE') {
    return new PortInUseError(port, await getListeningProcesses(port));
  }

  return error;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

export async function generateCatalogForProject(projectRoot: string) {
  const config = await loadProjectConfigFrom(projectRoot);
  await generateQueryTypesForConfig(config);
}

function createFixedProjectResolver(projectRoot: string): ProjectResolver {
  return async () => await loadProjectStateFrom(projectRoot);
}

function createSubdomainProjectResolver(input: {
  host: SqlfuHost;
  projectsRoot: string;
  templateRoot: string;
  defaultProjectName: string;
  allowUnknownHosts: boolean;
}): ProjectResolver {
  return async ({host: requestHost, projectHeader}) => {
    const projectName = projectNameFromRequest({
      host: requestHost,
      projectHeader,
      defaultProjectName: input.defaultProjectName,
      allowUnknownHosts: input.allowUnknownHosts,
    });
    return await ensureProjectConfig({
      host: input.host,
      projectName,
      projectsRoot: input.projectsRoot,
      templateRoot: input.templateRoot,
    });
  };
}

async function ensureProjectConfig(input: {
  host: SqlfuHost;
  projectName: string;
  projectsRoot: string;
  templateRoot: string;
}) {
  const projectRoot = path.join(input.projectsRoot, input.projectName);
  // Concurrent first-request callers for the same project must share a single
  // initialization or they race the template copy and the seed insert —
  // a second caller that arrives between `fs.cp` starting and the seed
  // finishing otherwise sees a half-populated project.
  await dedupeInit(projectRoot, async () => {
    await ensureProjectFiles({
      projectRoot,
      projectsRoot: input.projectsRoot,
      templateRoot: input.templateRoot,
    });
    await ensureDatabase(input.host, projectRoot);
  });
  return await loadProjectStateFrom(projectRoot);
}

const projectInitLocks = new Map<string, Promise<void>>();

function dedupeInit(key: string, fn: () => Promise<void>) {
  const existing = projectInitLocks.get(key);
  if (existing) return existing;
  const pending = fn().finally(() => projectInitLocks.delete(key));
  projectInitLocks.set(key, pending);
  return pending;
}

async function ensureProjectFiles(input: {projectRoot: string; projectsRoot: string; templateRoot: string}) {
  await fs.mkdir(input.projectsRoot, {recursive: true});
  try {
    await fs.access(input.projectRoot);
    return;
  } catch {}
  await fs.cp(input.templateRoot, input.projectRoot, {recursive: true});
}

async function ensureDatabase(host: SqlfuHost, projectRoot: string) {
  const dbPath = path.join(projectRoot, 'app.db');
  try {
    await fs.access(dbPath);
    return;
  } catch {}

  await using database = await host.openDb({
    projectRoot,
    db: dbPath,
    definitions: path.join(projectRoot, 'definitions.sql'),
    migrations: path.join(projectRoot, 'migrations'),
    queries: path.join(projectRoot, 'sql'),
    generate: {validator: null, prettyErrors: true, sync: false, importExtension: '.js'},
  });
  try {
    const definitionsSql = await fs.readFile(path.join(projectRoot, 'definitions.sql'), 'utf8');
    await database.client.raw(definitionsSql);
    await database.client.raw(`
      insert into posts (slug, title, body, published) values
        ('hello-world', 'Hello World', 'First post body', 1),
        ('draft-notes', 'Draft Notes', 'Unpublished notes', 0);
    `);
  } catch (error) {
    console.warn(
      `sqlfu/ui could not initialize ${path.basename(projectRoot)} from definitions.sql: ${String(error)}`,
    );
  }
}

async function loadProjectConfigFrom(projectRoot: string) {
  const configPath = path.join(projectRoot, 'sqlfu.config.ts');
  const configModule = await importConfigFile(configPath);
  return resolveProjectConfig(configModule, configPath);
}

async function importConfigFile(configPath: string) {
  const moduleUrl = new URL(pathToFileURL(configPath).href);
  moduleUrl.searchParams.set('t', String(Date.now()));
  const loaded = await import(moduleUrl.href);
  const config = loaded.default ?? loaded.config ?? loaded;

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`Invalid sqlfu config at ${configPath}: expected a default-exported object.`);
  }

  return config as {
    db: string;
    migrations: string;
    definitions: string;
    queries: string;
  };
}

function projectNameFromRequest(input: {
  host: string;
  projectHeader?: string;
  defaultProjectName: string;
  allowUnknownHosts: boolean;
}) {
  const projectName = input.projectHeader?.trim();
  if (projectName) {
    if (!/^[a-z0-9-]+$/.test(projectName)) {
      throw new Error(`Invalid project name in x-sqlfu-project header: ${projectName}`);
    }
    return projectName;
  }

  return projectNameFromHost(input.host, input.defaultProjectName, input.allowUnknownHosts);
}

function projectNameFromHost(host: string, defaultProjectName: string, allowUnknownHosts: boolean) {
  const hostname = host.split(':')[0] ?? host;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return defaultProjectName;
  }
  if (!hostname.endsWith('.localhost')) {
    if (allowUnknownHosts) {
      return defaultProjectName;
    }
    throw new Error(`Unsupported host: ${host}`);
  }

  const projectName = hostname.slice(0, -'.localhost'.length);
  if (!/^[a-z0-9-]+$/.test(projectName)) {
    throw new Error(`Invalid project name in host: ${host}`);
  }
  return projectName;
}

async function toWebRequest(req: http.IncomingMessage, url: URL) {
  const method = req.method ?? 'GET';
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
      continue;
    }
    if (value != null) {
      headers.set(name, value);
    }
  }

  const body = method === 'GET' || method === 'HEAD' ? undefined : await readIncomingMessage(req);

  return new Request(url, {
    method,
    headers,
    body,
  } satisfies RequestInit);
}

async function sendWebResponse(res: http.ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) {
        break;
      }
      res.write(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
    res.end();
  }
}

async function serveViteRequest(
  vite: ViteDevServer,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  indexHtmlPath: string,
) {
  await new Promise<void>((resolve, reject) => {
    vite.middlewares(req, res, (error: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  if (res.writableEnded) {
    return;
  }

  const template = await fs.readFile(indexHtmlPath, 'utf8');
  const html = await vite.transformIndexHtml(url.pathname, template);
  await sendWebResponse(res, htmlResponse(html, 200));
}

async function serveBuiltUi(res: http.ServerResponse, url: URL, distDir: string) {
  const relativePath = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const candidatePath = path.join(distDir, relativePath);

  if (isInsideDist(candidatePath, distDir)) {
    try {
      const file = await fs.readFile(candidatePath);
      await sendWebResponse(
        res,
        new Response(file, {
          headers: {
            'content-type': contentTypeForPath(candidatePath),
          },
        }),
      );
      return;
    } catch {}
  }

  const indexHtml = await fs.readFile(path.join(distDir, 'index.html'), 'utf8');
  await sendWebResponse(res, htmlResponse(indexHtml, 200));
}

function isInsideDist(candidatePath: string, distDir: string) {
  const relative = path.relative(distDir, candidatePath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function contentTypeForPath(filePath: string) {
  if (filePath.endsWith('.js')) {
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
  return 'application/octet-stream';
}

function resolveUiAssets(input: UiAssetOptions) {
  const root = path.resolve(input.root);
  return {
    root,
    distDir: input.distDir ? path.resolve(input.distDir) : path.join(root, 'dist'),
    indexHtmlPath: path.resolve(input.indexHtmlPath ?? path.join(root, 'index.html')),
  };
}

async function createUiDevServer(root: string, httpServer: http.Server) {
  const {createServer} = await import('vite');
  return createServer({
    root,
    appType: 'custom',
    server: {
      allowedHosts: ['sqlfu.dev', 'www.sqlfu.dev', '.ngrok.app', '.ngrok.dev'],
      middlewareMode: true,
      hmr: {
        server: httpServer,
      },
    },
  });
}

function requestErrorResponse(error: unknown, requestPath: string) {
  if (requestPath.startsWith('/api/rpc')) {
    return apiError(error);
  }
  return htmlResponse(renderErrorPage(error), 400);
}

function htmlResponse(html: string, status: number) {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
    },
  });
}

function renderServerHomePage(project: ResolvedUiProject) {
  if (!project.initialized) {
    return [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="utf-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
      '  <title>sqlfu local server</title>',
      '  <style>',
      '    :root { color-scheme: light; font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif; }',
      '    body { margin: 0; background: linear-gradient(180deg, #f8f0df 0%, #fffdf8 100%); color: #1f1a14; }',
      '    main { max-width: 48rem; margin: 0 auto; padding: 4rem 1.5rem 5rem; }',
      '    .eyebrow { letter-spacing: 0.12em; text-transform: uppercase; font: 600 0.72rem/1.4 ui-monospace, SFMono-Regular, monospace; color: #8a5a22; }',
      '    h1 { font-size: clamp(2.6rem, 8vw, 4.8rem); line-height: 0.95; margin: 0.5rem 0 1rem; }',
      '    p { font-size: 1.08rem; line-height: 1.7; margin: 0.75rem 0; }',
      '    code { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.95em; }',
      '  </style>',
      '</head>',
      '<body>',
      '  <main>',
      '    <div class="eyebrow">sqlfu local backend</div>',
      '    <h1>This directory is not initialized yet.</h1>',
      `    <p>Run <code>sqlfu init</code> or open <code>sqlfu.dev/ui</code> to initialize <code>${escapeHtml(project.projectRoot)}</code>.</p>`,
      '  </main>',
      '</body>',
      '</html>',
    ].join('\n');
  }

  const config = project.config;
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '  <title>sqlfu local server</title>',
    '  <style>',
    '    :root { color-scheme: light; font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif; }',
    '    body { margin: 0; background: linear-gradient(180deg, #f8f0df 0%, #fffdf8 100%); color: #1f1a14; }',
    '    main { max-width: 48rem; margin: 0 auto; padding: 4rem 1.5rem 5rem; }',
    '    .eyebrow { letter-spacing: 0.12em; text-transform: uppercase; font: 600 0.72rem/1.4 ui-monospace, SFMono-Regular, monospace; color: #8a5a22; }',
    '    h1 { font-size: clamp(2.6rem, 8vw, 4.8rem); line-height: 0.95; margin: 0.5rem 0 1rem; }',
    '    p { font-size: 1.08rem; line-height: 1.7; margin: 0.75rem 0; }',
    '    code { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.95em; }',
    '    .card { margin-top: 2rem; padding: 1.1rem 1.2rem; border: 1px solid #d9c7aa; border-radius: 1rem; background: rgba(255,255,255,0.72); }',
    '    a { color: #7a3e00; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <main>',
    '    <div class="eyebrow">sqlfu local backend</div>',
    '    <h1>Local project server is running.</h1>',
    `    <p>This backend is serving the sqlfu project at <code>${escapeHtml(config.projectRoot)}</code>.</p>`,
    '    <p>Use the UI against this origin via <code>sqlfu.dev/ui</code>, or point a client at <code>/api/rpc</code>.</p>',
    '    <div class="card">',
    '      <p><strong>API base:</strong> <code>/api/rpc</code></p>',
    '      <p><strong>Configured database:</strong> <code>' + escapeHtml(config.db) + '</code></p>',
    '      <p><a href="https://sqlfu.dev">Open docs on sqlfu.dev</a></p>',
    '    </div>',
    '  </main>',
    '</body>',
    '</html>',
  ].join('\n');
}

function renderErrorPage(error: unknown) {
  const message = escapeHtml(String(error));
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '  <title>sqlfu local server error</title>',
    '  <style>',
    '    body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #fcf7f1; color: #23170f; }',
    '    main { max-width: 42rem; margin: 0 auto; padding: 3rem 1.5rem 4rem; }',
    '    h1 { font-size: 2rem; margin-bottom: 0.75rem; }',
    '    pre { white-space: pre-wrap; padding: 1rem; border-radius: 0.75rem; background: #fff; border: 1px solid #e2d6c9; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <main>',
    '    <h1>sqlfu could not serve this request.</h1>',
    '    <p>The local backend is running, but this request could not be handled.</p>',
    `    <pre>${message}</pre>`,
    '  </main>',
    '</body>',
    '</html>',
  ].join('\n');
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function getServerPort(server: http.Server) {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected server to listen on a TCP port');
  }
  return address.port;
}

async function readIncomingMessage(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function headerValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function apiError(error: unknown) {
  const message = String(error);
  return new Response(message, {
    status: 400,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
  });
}

function apiPreflightResponse(req: http.IncomingMessage) {
  return withApiCors(req, new Response(null, {status: 204}));
}

function withApiCors(req: http.IncomingMessage, response: Response) {
  const headers = new Headers(response.headers);
  const origin = headerValue(req.headers.origin);
  const requestedHeaders = headerValue(req.headers['access-control-request-headers']);
  const privateNetwork = headerValue(req.headers['access-control-request-private-network']);

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

function readOption(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}
