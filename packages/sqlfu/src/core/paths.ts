// Minimal POSIX-style path helpers for code that runs in both node and the
// browser. Works for the `/`-delimited paths we store in SqlfuProjectConfig
// and migration/query records — does not attempt to handle Windows separators
// or `..` normalization.

export function joinPath(...parts: string[]): string {
  const joined = parts.filter((part) => part !== '').join('/');
  return joined.replace(/\/+/g, '/');
}

export function basename(value: string, extension?: string): string {
  const last = value.split('/').pop() ?? '';
  if (extension && last.endsWith(extension)) {
    return last.slice(0, -extension.length);
  }
  return last;
}

export function dirname(value: string): string {
  const idx = value.lastIndexOf('/');
  if (idx === -1) return '.';
  if (idx === 0) return '/';
  return value.slice(0, idx);
}
