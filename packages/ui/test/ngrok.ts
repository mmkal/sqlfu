import childProcess from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..', '..', '..');

export async function ensureNgrokTunnel(input: {port: number; domain: string; url: string}) {
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

export async function stopNgrokTunnel(process: childProcess.ChildProcess | undefined) {
  process?.kill('SIGTERM');
  await waitForExit(process);
}

async function findExistingNgrokTunnel(input: {port: number; domain: string; url: string}) {
  const tunnels = await readNgrokTunnels();
  return (
    tunnels.find((tunnel) => {
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
    }) || null
  );
}

async function waitForNgrokTunnel(
  input: {
    port: number;
    domain: string;
    url: string;
  },
  process: childProcess.ChildProcess,
) {
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
    const body = (await response.json()) as {
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

function waitForExit(process: childProcess.ChildProcess | undefined) {
  return new Promise<void>((resolve) => {
    if (!process || process.exitCode != null || process.killed) {
      resolve();
      return;
    }
    process.once('exit', () => resolve());
  });
}
