import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);

export async function runPackageBinary(
  packageName: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as {
    readonly bin?: string | Record<string, string>;
  };

  const binRelativePath =
    typeof packageJson.bin === 'string'
      ? packageJson.bin
      : packageJson.bin
        ? Object.values(packageJson.bin)[0]
        : undefined;

  if (!binRelativePath) {
    throw new Error(`Package ${packageName} does not expose a runnable binary.`);
  }

  const binPath = path.resolve(path.dirname(packageJsonPath), binRelativePath);

  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd,
      env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(
        new Error(
          [stdout, stderr].filter(Boolean).join('\n').trim() || `${packageName} exited with code ${code ?? 'unknown'}`,
        ),
      );
    });

    child.on('error', reject);
  });
}
