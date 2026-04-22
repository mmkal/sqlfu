import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {execa} from 'execa';
import {chromium, type Page} from 'playwright';

import {ensureBuilt, packageRoot} from './ensure-built.js';

export type ExecaProcess = ReturnType<typeof execa>;

export interface RenderHostContext {
  root: string;
  port: number;
  url: string;
  classDefString: string;
  className: string;
  methodNames: string[];
}

export interface RenderedHost {
  serverLogs: () => string;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface BrowserRpcFixtureOptions<TInstance extends object> {
  classDef: new (...args: any[]) => TInstance;
  renderHost(context: RenderHostContext): Promise<RenderedHost>;
  bootTimeoutMs?: number;
  rpcTimeoutMs?: number;
}

export interface BrowserRpcFixture<TInstance extends object> {
  stub: TInstance;
  [Symbol.asyncDispose](): Promise<void>;
}

export async function createBrowserRpcFixture<TInstance extends object>(
  options: BrowserRpcFixtureOptions<TInstance>,
): Promise<BrowserRpcFixture<TInstance>> {
  await ensureBuilt();
  await ensurePlaywrightBrowserInstalled();

  const classDefString = options.classDef.toString().trim();
  const className = classDefString.match(/^class (\w+) \{/)?.[1];
  if (!className) {
    throw new Error(`Failed to extract class name from class definition: ${classDefString}`);
  }

  const methodNames = Object.getOwnPropertyNames(options.classDef.prototype).filter((name) => name !== 'constructor');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlfu-browser-rpc-'));
  const port = await getAvailablePort();
  const url = `http://127.0.0.1:${port}`;

  let host: RenderedHost | undefined;
  try {
    host = await options.renderHost({root, port, url, classDefString, className, methodNames});
  } catch (error) {
    await fs.rm(root, {recursive: true, force: true});
    throw error;
  }

  const serverLogs = host.serverLogs;
  const bootTimeoutMs = options.bootTimeoutMs ?? 30_000;
  const rpcTimeoutMs = options.rpcTimeoutMs ?? 30_000;

  try {
    await waitForHttp(url, bootTimeoutMs);
    const browser = await chromium.launch({headless: true});
    const page = await browser.newPage();
    const browserLogs = capturePageOutput(page);
    await page.goto(url, {waitUntil: 'networkidle'});
    await waitForFixtureBoot(page, serverLogs, browserLogs, bootTimeoutMs);

    return {
      stub: createBrowserRpcStub<TInstance>(page, serverLogs, browserLogs, rpcTimeoutMs),
      async [Symbol.asyncDispose]() {
        await Promise.allSettled([
          browser.close(),
          host![Symbol.asyncDispose](),
          fs.rm(root, {recursive: true, force: true}),
        ]);
      },
    };
  } catch (error) {
    await Promise.allSettled([host[Symbol.asyncDispose](), fs.rm(root, {recursive: true, force: true})]);
    throw new Error(formatFixtureFailure(String(error), serverLogs(), []));
  }
}

function createBrowserRpcStub<TInstance extends object>(
  page: Page,
  serverLogs: () => string,
  browserLogs: () => string[],
  rpcTimeoutMs: number,
) {
  let nextRequestId = 1;

  return new Proxy({} as TInstance, {
    get(_target, propertyKey) {
      if (typeof propertyKey !== 'string') {
        return undefined;
      }

      return async (...args: unknown[]) => {
        const requestId = nextRequestId++;

        try {
          await page.getByTestId(`rpc-input-${propertyKey}`).fill(JSON.stringify(args));
          await page.getByTestId(`rpc-${propertyKey}`).click();

          await page.waitForFunction(
            ({requestId}) => {
              const browserGlobal = globalThis as typeof globalThis & {document?: any};
              const renderedRequestId = browserGlobal.document?.querySelector(
                '[data-testid="rpc-request-id"]',
              )?.textContent;
              const renderedStatus = browserGlobal.document?.querySelector('[data-testid="rpc-status"]')?.textContent;
              return renderedRequestId === String(requestId) && renderedStatus !== 'running';
            },
            {requestId},
            {timeout: rpcTimeoutMs},
          );

          const status = await page.getByTestId('rpc-status').textContent();
          const resultText = await page.getByTestId('rpc-result').textContent();
          const errorText = await page.getByTestId('rpc-error').textContent();

          if (status === 'error') {
            const payload = errorText ? (JSON.parse(errorText) as {requestId: number; message: string}) : undefined;
            throw new Error(payload?.message ?? 'Fixture RPC failed');
          }

          const payload = resultText ? (JSON.parse(resultText) as {requestId: number; value: unknown}) : undefined;
          if (!payload || payload.requestId !== requestId) {
            throw new Error(`Fixture returned an unexpected RPC result for ${propertyKey}`);
          }

          return payload.value;
        } catch (error) {
          throw new Error(
            formatFixtureFailure(String(error), serverLogs(), browserLogs()),
          );
        }
      };
    },
  });
}

async function waitForFixtureBoot(
  page: Page,
  serverLogs: () => string,
  browserLogs: () => string[],
  timeoutMs: number,
): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const browserGlobal = globalThis as typeof globalThis & {document?: any};
        const status = browserGlobal.document?.querySelector('[data-testid="boot-status"]')?.textContent;
        return status === 'ready' || status === 'error';
      },
      undefined,
      {timeout: timeoutMs},
    );

    const bootStatus = await page.getByTestId('boot-status').textContent();
    if (bootStatus === 'error') {
      const bootError = await page.getByTestId('boot-error').textContent();
      throw new Error(bootError || 'Fixture boot failed');
    }
  } catch (error) {
    throw new Error(
      formatFixtureFailure(String(error), serverLogs(), browserLogs()),
    );
  }
}

async function ensurePlaywrightBrowserInstalled(): Promise<void> {
  try {
    const browser = await chromium.launch();
    await browser.close();
    return;
  } catch (error) {
    const message = String(error);
    if (!/executable doesn't exist|please run the following command/i.test(message)) {
      throw error;
    }
  }

  await runCommand('pnpm', ['exec', 'playwright', 'install', 'chromium'], packageRoot);
}

export async function getAvailablePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error(`Failed to allocate a local port: ${String(address)}`));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
    server.on('error', reject);
  });
}

export async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}

    await delay(250);
  }

  throw new Error(`Timed out waiting for host to respond at ${url}`);
}

export function captureOutput(child: ExecaProcess) {
  const chunks: string[] = [];
  child.all?.on('data', (chunk: string | Buffer) => {
    chunks.push(String(chunk));
    if (chunks.length > 200) {
      chunks.shift();
    }
  });

  return () => chunks.join('');
}

function capturePageOutput(page: Page) {
  const entries: string[] = [];
  const push = (line: string) => {
    entries.push(line);
    if (entries.length > 100) {
      entries.shift();
    }
  };

  page.on('console', (message) => {
    push(`[console:${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    push(`[pageerror] ${error.message}`);
  });

  return () => entries;
}

function formatFixtureFailure(message: string, serverLogs: string, browserLogs: string[]): string {
  return [
    message,
    '',
    'Server logs:',
    serverLogs.trim() || '(none)',
    '',
    'Browser logs:',
    browserLogs.length > 0 ? browserLogs.join('\n') : '(none)',
  ].join('\n');
}

export async function stopProcess(child: ExecaProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  child.kill('SIGINT');
  const exited = await Promise.race([
    child.then(
      () => true,
      () => true,
    ),
    delay(5_000).then(() => false),
  ]);

  if (!exited && child.exitCode === null && !child.killed) {
    child.kill('SIGKILL');
    await child.catch(() => undefined);
  }
}

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<void> {
  const result = await execa(command, args, {
    cwd,
    env: extraEnv,
    all: true,
    reject: false,
  });

  if (result.exitCode === 0) {
    return;
  }

  throw new Error(result.all?.trim() || `${command} exited with code ${result.exitCode ?? 'unknown'}`);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
