import path from 'node:path';

export function resolveCliConfigPath(configPath: string, cwd: string): string {
  return path.isAbsolute(configPath) ? path.normalize(configPath) : path.resolve(cwd, configPath);
}
