import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {ensureLocalhostCertificates} from '../packages/sqlfu/src/ui/certs.ts';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const uiRoot = path.join(repoRoot, 'packages', 'ui');
const defaultProjectRoot = path.join(uiRoot, 'test', 'projects', 'dev-project');

const projectRoot = path.resolve(readOption('--project-root') || defaultProjectRoot);
const apiPort = Number(readOption('--api-port') || '3217');
const uiPort = Number(readOption('--ui-port') || '3218');
const ngrokDomain = readOption('--ngrok-domain') || process.env.SQLFU_NGROK_DOMAIN || '';
const ngrokUrl = readOption('--ngrok-url') || process.env.SQLFU_NGROK_URL || 'https://sqlfu-local.ngrok.app';
const useNgrok = !process.argv.includes('--no-ngrok');

assertPort(apiPort, '--api-port');
assertPort(uiPort, '--ui-port');

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const certs = await ensureLocalhostCertificates();
  const apiOrigin = certs ? `https://localhost:${apiPort}` : `http://127.0.0.1:${apiPort}`;
  const uiOrigin = `http://127.0.0.1:${uiPort}`;

  const backend = spawnProcess('backend', [
    'pnpm',
    'exec',
    'tsx',
    'packages/sqlfu/src/ui/server.ts',
    '--project-root',
    projectRoot,
    '--port',
    String(apiPort),
    ...(certs ? ['--tls-key', certs.keyPath, '--tls-cert', certs.certPath] : []),
  ], {
    cwd: repoRoot,
  });

  try {
    await waitForHttpServerOrExit(backend, apiOrigin, certs ? true : false);

    const ui = spawnProcess('ui', [
      'pnpm',
      'exec',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      String(uiPort),
    ], {
      cwd: uiRoot,
      env: {
        ...process.env,
        VITE_SQLFU_API_ORIGIN: apiOrigin,
      },
    });

    let ngrokProcess: childProcess.ChildProcess | undefined;

    try {
      await waitForHttpServerOrExit(ui, uiOrigin, false);

      console.log(`sqlfu backend origin: ${apiOrigin}`);
      console.log(`sqlfu ui origin: ${uiOrigin}`);
      console.log(`project root: ${projectRoot}`);
      if (!certs) {
        console.log('mkcert not found; backend is using plain HTTP, which is less realistic than the intended localhost HTTPS flow');
      }

      const tunnel = useNgrok
        ? await ensureNgrokTunnel({
            port: uiPort,
            domain: ngrokDomain,
            url: ngrokUrl,
          })
        : null;

      if (tunnel) {
        ngrokProcess = tunnel.process;
        console.log(`${tunnel.reused ? 'reusing' : 'started'} ngrok tunnel: ${tunnel.public_url}`);
      } else if (useNgrok) {
        console.log('ngrok tunnel unavailable; continuing with the local UI and backend only');
      }

      console.log('press Ctrl+C to stop');
      await waitForShutdown();
    } finally {
      ngrokProcess?.kill('SIGTERM');
      ui.kill('SIGTERM');
      await waitForExit(ui);
    }
  } finally {
    backend.kill('SIGTERM');
    await waitForExit(backend);
  }
}

function spawnProcess(
  label: string,
  command: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
) {
  const [bin, ...args] = command;
  if (!bin) {
    throw new Error(`Missing command for ${label}`);
  }

  const child = childProcess.spawn(bin, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[${label}] ${chunk.toString()}`);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${label}] ${chunk.toString()}`);
  });

  child.once('exit', (code, signal) => {
    if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
      return;
    }
    console.error(`[${label}] exited unexpectedly with code ${code} signal ${signal}`);
  });

  return child;
}

async function waitForHttpServer(origin: string, insecureTls: boolean) {
  const timeout = Date.now() + 20_000;

  while (Date.now() < timeout) {
    try {
      const status = await requestStatus(origin, insecureTls);
      if (status < 500) {
        return;
      }
    } catch {}

    await sleep(250);
  }

  throw new Error(`Timed out waiting for ${origin}`);
}

async function waitForHttpServerOrExit(
  child: childProcess.ChildProcess,
  origin: string,
  insecureTls: boolean,
) {
  await Promise.race([
    waitForHttpServer(origin, insecureTls),
    waitForUnexpectedExit(child),
  ]);
}

function waitForUnexpectedExit(child: childProcess.ChildProcess) {
  return new Promise<never>((_, reject) => {
    child.once('exit', (code, signal) => {
      reject(new Error(`Process exited before becoming ready with code ${code} signal ${signal}`));
    });
  });
}

function requestStatus(origin: string, insecureTls: boolean) {
  return new Promise<number>((resolve, reject) => {
    const url = new URL(origin);
    const request = (url.protocol === 'https:' ? https : http).request({
      hostname: url.hostname,
      port: Number(url.port),
      path: url.pathname || '/',
      method: 'GET',
      rejectUnauthorized: !insecureTls,
      timeout: 1_000,
    }, (response) => {
      response.resume();
      resolve(response.statusCode || 0);
    });

    request.once('error', reject);
    request.once('timeout', () => {
      request.destroy(new Error(`Timed out waiting for ${origin}`));
    });
    request.end();
  });
}

async function ensureNgrokTunnel(input: {
  port: number;
  domain: string;
  url: string;
}) {
  if (!hasCommand('ngrok')) {
    return null;
  }

  const existing = await findExistingNgrokTunnel(input);
  if (existing) {
    return {
      ...existing,
      process: undefined,
      reused: true,
    };
  }

  const args = ['http', String(input.port), '--log=stdout', '--log-format=json', '--log-level=debug'];
  if (input.url) {
    args.push('--url', input.url);
  }
  if (input.domain) {
    args.push('--domain', input.domain);
  }

  const process = childProcess.spawn('ngrok', args, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  let stdout = '';
  process.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  process.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const tunnel = await waitForNgrokTunnel(input, process);
  if (!tunnel) {
    process.kill('SIGTERM');
    throw new Error(stderr.trim() || stdout.trim() || `ngrok did not expose localhost:${input.port} in time`);
  }

  return {
    ...tunnel,
    process,
    reused: false,
  };
}

async function findExistingNgrokTunnel(input: {
  port: number;
  domain: string;
  url: string;
}) {
  const tunnels = await readNgrokTunnels();
  return tunnels.find((tunnel) => {
    if (!tunnel.config?.addr?.endsWith(`:${input.port}`)) {
      return false;
    }
    if (input.url && tunnel.public_url !== input.url) {
      return false;
    }
    if (input.domain && !tunnel.public_url.includes(input.domain)) {
      return false;
    }
    return true;
  }) || null;
}

async function waitForNgrokTunnel(input: {
  port: number;
  domain: string;
  url: string;
}, process: childProcess.ChildProcess) {
  return await new Promise<{public_url: string; config?: {addr?: string}} | null>((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 15_000);

    const cleanup = () => {
      clearTimeout(timeout);
      process.stdout?.off('data', onStdout);
      process.off('exit', onExit);
      process.off('error', onError);
    };

    const onStdout = (chunk: Buffer | string) => {
      output += chunk.toString();
      const lines = output.split('\n');
      output = lines.pop() || '';

      for (const line of lines) {
        const tunnel = parseNgrokTunnelLine(line, input);
        if (tunnel) {
          cleanup();
          resolve(tunnel);
          return;
        }
      }
    };

    const onExit = (code: number | null) => {
      cleanup();
      if (code === 0) {
        resolve(null);
        return;
      }
      reject(new Error(`ngrok exited with code ${code}`));
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    process.stdout?.on('data', onStdout);
    process.once('exit', onExit);
    process.once('error', onError);
  });
}

async function readNgrokTunnels() {
  try {
    const response = await fetch('http://127.0.0.1:4040/api/tunnels', {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) {
      return [];
    }
    const body = await response.json() as {
      tunnels?: Array<{
        public_url: string;
        config?: {
          addr?: string;
        };
      }>;
    };
    return body.tunnels || [];
  } catch {
    return [];
  }
}

function parseNgrokTunnelLine(
  line: string,
  input: {
    port: number;
    domain: string;
    url: string;
  },
) {
  try {
    const parsed = JSON.parse(line) as {
      msg?: string;
      url?: string;
      addr?: string;
    };
    if (parsed.msg !== 'started tunnel' || typeof parsed.url !== 'string') {
      return null;
    }
    if (input.url && parsed.url !== input.url) {
      return null;
    }
    if (input.domain && !parsed.url.includes(input.domain)) {
      return null;
    }
    return {
      public_url: parsed.url,
      config: {
        addr: typeof parsed.addr === 'string' ? parsed.addr : `http://localhost:${input.port}`,
      },
    };
  } catch {
    return null;
  }
}

function hasCommand(command: string) {
  const result = childProcess.spawnSync(command, ['version'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  return result.status === 0;
}

function readOption(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function waitForShutdown() {
  return new Promise<void>((resolve) => {
    const onSignal = () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      resolve();
    };

    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
  });
}

function waitForExit(child: childProcess.ChildProcess) {
  return new Promise<void>((resolve) => {
    if (child.exitCode != null || child.killed) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
  });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function assertPort(value: number, flag: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${flag} value: ${value}`);
  }
}
