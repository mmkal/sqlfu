import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {ensureLocalhostCertificates} from 'sqlfu/ui';
import {ensureNgrokTunnel, stopNgrokTunnel} from './ngrok.ts';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.join(currentDir, '..');
const repoRoot = path.resolve(uiRoot, '..', '..');
const defaultProjectRoot = path.join(currentDir, 'projects', 'dev-project');

const projectRoot = path.resolve(readOption('--project-root') || defaultProjectRoot);
const apiPort = Number(readOption('--api-port') || '56081');
const uiPort = Number(readOption('--ui-port') || '3218');
const ngrokDomain = readOption('--ngrok-domain') || process.env.SQLFU_NGROK_DOMAIN || '';
const ngrokUrl = readOption('--ngrok-url') || process.env.SQLFU_NGROK_URL || '';
const useNgrok = !process.argv.includes('--no-ngrok');
const skipBuild = process.argv.includes('--skip-build');

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

  const backend = spawnProcess(
    'backend',
    [
      'pnpm',
      'exec',
      'tsx',
      'src/ui/server.ts',
      '--project-root',
      projectRoot,
      '--port',
      String(apiPort),
      ...(certs ? ['--tls-key', certs.keyPath, '--tls-cert', certs.certPath] : []),
    ],
    {
      cwd: path.join(repoRoot, 'packages', 'sqlfu'),
    },
  );

  try {
    await waitForHttpServerOrExit(backend, apiOrigin, certs ? true : false);

    if (!skipBuild) {
      await runProcess('ui-build', ['pnpm', 'build'], {
        cwd: uiRoot,
      });
    }

    await writeRuntimeConfig(uiRoot, apiOrigin);

    const ui = spawnProcess('ui', ['pnpx', 'serve', '-l', `tcp://127.0.0.1:${uiPort}`, '-s', '-n', 'dist'], {
      cwd: uiRoot,
    });

    let ngrokProcess: childProcess.ChildProcess | undefined;

    try {
      await waitForHttpServerOrExit(ui, uiOrigin, false);

      console.log(`project root: ${projectRoot}`);
      if (!certs) {
        console.log('mkcert not found; backend is using plain HTTP');
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
      await stopNgrokTunnel(ngrokProcess);
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

async function runProcess(
  label: string,
  command: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
) {
  const child = spawnProcess(label, command, options);
  const [exitCode, signal] = await onceExit(child);
  if (exitCode === 0) {
    return;
  }
  throw new Error(`${label} failed with code ${exitCode} signal ${signal}`);
}

async function writeRuntimeConfig(root: string, apiOrigin: string) {
  const fs = await import('node:fs/promises');
  const distDir = path.join(root, 'dist');
  const filePath = path.join(distDir, 'runtime-config.js');
  const contents = `window.SQLFU_API_ORIGIN = ${JSON.stringify(apiOrigin)};\n`;
  await fs.writeFile(filePath, contents, 'utf8');
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

async function waitForHttpServerOrExit(child: childProcess.ChildProcess, origin: string, insecureTls: boolean) {
  await Promise.race([waitForHttpServer(origin, insecureTls), waitForUnexpectedExit(child)]);
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
    const request = (url.protocol === 'https:' ? https : http).request(
      {
        hostname: url.hostname,
        port: Number(url.port),
        path: url.pathname || '/',
        method: 'GET',
        rejectUnauthorized: !insecureTls,
        timeout: 1_000,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode || 0);
      },
    );

    request.once('error', reject);
    request.once('timeout', () => {
      request.destroy(new Error(`Timed out waiting for ${origin}`));
    });
    request.end();
  });
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

function onceExit(child: childProcess.ChildProcess) {
  return new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
    if (child.exitCode != null) {
      resolve([child.exitCode, null]);
      return;
    }
    child.once('exit', (code, signal) => resolve([code, signal]));
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
