import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function ensureLocalhostCertificates() {
  if (!hasMkcert()) {
    return null;
  }

  const certDir = path.join(os.homedir(), '.sqlfu', 'certs');
  const keyPath = path.join(certDir, 'localhost-key.pem');
  const certPath = path.join(certDir, 'localhost.pem');

  await fs.mkdir(certDir, {recursive: true});

  try {
    await Promise.all([fs.access(keyPath), fs.access(certPath)]);
  } catch {
    await runCommand(
      'mkcert',
      ['-cert-file', certPath, '-key-file', keyPath, 'localhost', '127.0.0.1', '::1'],
      certDir,
    );
  }

  return {
    keyPath,
    certPath,
  };
}

function hasMkcert() {
  const result = childProcess.spawnSync('mkcert', ['--help'], {
    stdio: 'ignore',
  });
  return result.status === 0;
}

function runCommand(command: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = childProcess.spawn(command, args, {
      cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}
