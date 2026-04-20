import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {expect, test} from '@playwright/test';

// Run this spec via `playwright.website-e2e.config.ts`. The default config
// excludes it (see `testIgnore` there) because it manages its own three-server
// topology and does not need the shared port 3218 UI dev server.
//
// End-to-end spec for the first shipped user journey:
//   1. open the website (simulates www.sqlfu.dev)
//   2. click the CTA to the local studio (simulates local.sqlfu.dev)
//   3. the studio loads and talks to a live sqlfu backend (simulates npx sqlfu)
//
// The topology is reproduced entirely on localhost:
//   - website: astro build of `website/`, served as static files
//   - UI:      vite build of `packages/ui/`, served as static files + SPA fallback
//   - backend: `packages/sqlfu/src/cli.ts` spawned with `tsx`, cwd = a seeded copy
//              of the `template-project` under `packages/ui/test/projects/`
//
// The landing page reads PUBLIC_LOCAL_STUDIO_URL at Astro build time and uses it
// for the "Demo" / "Try the demo" CTAs, so we can point those at the local UI
// origin without touching production hostnames.

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(currentDir, '..');
const repoRoot = path.resolve(uiRoot, '..', '..');
const websiteRoot = path.join(repoRoot, 'website');
const sqlfuRoot = path.join(repoRoot, 'packages', 'sqlfu');
const projectsRoot = path.join(currentDir, 'projects');
const templateRoot = path.join(currentDir, 'template-project');

test.describe.configure({mode: 'serial'});

test('clicking the landing-page demo CTA lands on a studio backed by a live sqlfu backend', async ({page}) => {
  await using fixture = await startWebsiteStudioTopology();

  await page.goto(fixture.websiteOrigin);

  await expect(page.getByRole('heading', {name: 'all you need is sql.'})).toBeVisible();

  const demoCta = page.getByRole('link', {name: 'Try the demo'});
  await expect(demoCta).toBeVisible();
  await expect(demoCta).toHaveAttribute('href', fixture.studioUrl);

  await demoCta.click();

  // Landed on the local studio, which proves www.sqlfu.dev -> local.sqlfu.dev
  // navigation works. The sidebar header only renders once the initial schema
  // fetch against /api/rpc on the sqlfu backend has succeeded, so seeing
  // "sqlfu/ui" plus a populated Relations list proves the full topology is
  // connected: website -> studio -> npx sqlfu.
  await expect(page).toHaveURL(new RegExp(`^${escapeForRegExp(fixture.studioOrigin)}`));
  await expect(page.getByRole('heading', {name: 'sqlfu/ui'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Schema', exact: true})).toBeVisible();

  const postsRelationLink = page.locator('.sidebar-block a.nav-link').filter({hasText: 'posts'}).first();
  await expect(postsRelationLink).toBeVisible();

  // Click through to a concrete table to prove schema data really came from the
  // backend rather than being a shell skeleton.
  await postsRelationLink.click();
  await expect(page.getByRole('heading', {name: 'posts'})).toBeVisible();
  await expect(page.getByText('hello-world')).toBeVisible();
});

async function startWebsiteStudioTopology() {
  const apiPort = await pickFreePort();
  const uiPort = await pickFreePort([apiPort]);
  const websitePort = await pickFreePort([apiPort, uiPort]);

  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const studioOrigin = `http://127.0.0.1:${uiPort}`;
  const websiteOrigin = `http://127.0.0.1:${websitePort}`;
  const studioUrl = `${studioOrigin}/?demo=1`;

  const projectRoot = await seedProjectFromTemplate({
    slug: `website-landing-to-studio-${process.pid}-${Date.now()}`,
  });

  await buildUi();
  await writeUiRuntimeConfig(apiOrigin);
  await buildWebsiteWithStudioUrl(studioUrl);

  const backend = await spawnSqlfuBackend({apiPort, projectRoot});
  const studio = await serveStaticFiles({port: uiPort, root: path.join(uiRoot, 'dist'), spaFallback: true});
  const website = await serveStaticFiles({
    port: websitePort,
    root: path.join(websiteRoot, 'dist'),
    spaFallback: false,
  });

  await waitForHttp(apiOrigin);
  await waitForHttp(studioOrigin);
  await waitForHttp(websiteOrigin);

  return {
    apiOrigin,
    studioOrigin,
    studioUrl,
    websiteOrigin,
    async [Symbol.asyncDispose]() {
      await Promise.allSettled([stopServer(website), stopServer(studio), stopChild(backend)]);
      await fs.rm(projectRoot, {recursive: true, force: true, maxRetries: 5, retryDelay: 50});
    },
  };
}

async function seedProjectFromTemplate(input: {slug: string}) {
  const projectRoot = path.join(projectsRoot, input.slug);
  await fs.rm(projectRoot, {recursive: true, force: true, maxRetries: 5, retryDelay: 50});
  await fs.mkdir(projectsRoot, {recursive: true});
  await fs.cp(templateRoot, projectRoot, {recursive: true});
  return projectRoot;
}

async function spawnSqlfuBackend(input: {apiPort: number; projectRoot: string}) {
  // `sqlfu` reads process.cwd() to find sqlfu.config.ts, so cwd = projectRoot
  // mirrors how a real `npx sqlfu` invocation would pick up the project.
  // `tsx` runs the CLI from source; the workspace root has it installed.
  const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
  const cliEntry = path.join(sqlfuRoot, 'src', 'cli.ts');
  const child = childProcess.spawn(tsxBin, [cliEntry, '--port', String(input.apiPort)], {
    cwd: input.projectRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[backend] ${chunk.toString()}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[backend] ${chunk.toString()}`));
  return child;
}

async function buildUi() {
  await runNodeCommand('ui-build', ['pnpm', 'build'], {cwd: uiRoot});
}

async function writeUiRuntimeConfig(apiOrigin: string) {
  const runtimeConfigPath = path.join(uiRoot, 'dist', 'runtime-config.js');
  await fs.writeFile(runtimeConfigPath, `window.SQLFU_API_ORIGIN = ${JSON.stringify(apiOrigin)};\n`, 'utf8');
}

async function buildWebsiteWithStudioUrl(studioUrl: string) {
  await runNodeCommand('website-build', ['pnpm', 'build'], {
    cwd: websiteRoot,
    env: {
      ...process.env,
      PUBLIC_LOCAL_STUDIO_URL: studioUrl,
    },
  });
}

async function serveStaticFiles(input: {port: number; root: string; spaFallback: boolean}) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${input.port}`);
      const relativePath = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
      const candidate = path.join(input.root, relativePath);
      const indexCandidate = path.join(input.root, relativePath, 'index.html');

      const served =
        (await tryServeFile(res, candidate)) ||
        (await tryServeFile(res, indexCandidate)) ||
        (input.spaFallback && (await tryServeFile(res, path.join(input.root, 'index.html'))));

      if (!served) {
        res.statusCode = 404;
        res.end(`not found: ${url.pathname}`);
      }
    } catch (error) {
      res.statusCode = 500;
      res.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(input.port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  return server;
}

async function tryServeFile(res: http.ServerResponse, filePath: string) {
  try {
    const body = await fs.readFile(filePath);
    res.statusCode = 200;
    res.setHeader('content-type', contentTypeFor(filePath));
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

function contentTypeFor(filePath: string) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.webp')) return 'image/webp';
  if (filePath.endsWith('.gif')) return 'image/gif';
  if (filePath.endsWith('.woff2')) return 'font/woff2';
  if (filePath.endsWith('.ico')) return 'image/x-icon';
  return 'application/octet-stream';
}

async function waitForHttp(origin: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin, {signal: AbortSignal.timeout(1_500)});
      if (response.status < 500) {
        return;
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${origin}`);
}

function stopServer(server: http.Server) {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

function stopChild(child: childProcess.ChildProcess) {
  if (child.exitCode != null || child.killed) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
  });
}

async function runNodeCommand(label: string, argv: string[], options: {cwd: string; env?: NodeJS.ProcessEnv}) {
  const [bin, ...args] = argv;
  if (!bin) {
    throw new Error(`empty command for ${label}`);
  }
  await new Promise<void>((resolve, reject) => {
    const child = childProcess.spawn(bin, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stdout.on('data', (chunk) => process.stdout.write(`[${label}] ${chunk.toString()}`));
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(`[${label}] ${chunk.toString()}`);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with code ${code}: ${stderr.trim()}`));
    });
  });
}

async function pickFreePort(exclude: number[] = []): Promise<number> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('failed to read server address'));
          return;
        }
        const assigned = address.port;
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(assigned);
        });
      });
    });
    if (!exclude.includes(port)) {
      return port;
    }
  }
  throw new Error('could not find a free port');
}

function escapeForRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
