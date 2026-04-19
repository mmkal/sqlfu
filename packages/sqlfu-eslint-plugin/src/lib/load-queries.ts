import fs from 'node:fs';
import path from 'node:path';

import {normalizeSqlForMatch} from './normalize.js';

export interface LoadedQuery {
  /** Absolute path to the .sql file. */
  absolutePath: string;
  /** Relative path from the queries base (e.g. `users/list.sql`). */
  relativePath: string;
  /** Exported function name the typegen produces. */
  functionName: string;
  /** Normalized SQL for equality comparison. */
  normalized: string;
}

export interface LoadQueriesOptions {
  /**
   * Optional explicit queries dir (absolute or relative to the nearest
   * `sqlfu.config.*`). If omitted, we try to parse the config file or
   * fall back to `./sql/`.
   */
  queriesDir?: string;
}

interface Cache {
  projectRoot: string;
  queriesDir: string;
  queries: LoadedQuery[];
  /** mtime of the queries dir, to invalidate naively across lint runs. */
  mtimeMs: number;
}

const caches = new Map<string, Cache>();

/**
 * Locate the sqlfu project for a given source file and load its queries.
 * Returns null if no sqlfu.config.* is found upward from `fromFile`.
 */
export function loadQueriesForFile(fromFile: string, options: LoadQueriesOptions = {}): LoadedQuery[] | null {
  const projectRoot = findProjectRoot(fromFile);
  if (!projectRoot) return null;

  const queriesDir = options.queriesDir
    ? path.resolve(projectRoot, options.queriesDir)
    : resolveQueriesDir(projectRoot);

  if (!queriesDir || !fs.existsSync(queriesDir)) return null;

  const cacheKey = `${projectRoot}::${queriesDir}`;
  const mtimeMs = directoryMtime(queriesDir);
  const cached = caches.get(cacheKey);
  if (cached && cached.mtimeMs === mtimeMs) return cached.queries;

  const queries = walkSqlFiles(queriesDir).map((absolutePath): LoadedQuery => {
    const relative = path.relative(queriesDir, absolutePath).replace(/\\/g, '/');
    const name = relative.replace(/\.sql$/, '');
    return {
      absolutePath,
      relativePath: relative,
      functionName: toCamelCase(name),
      normalized: normalizeSqlForMatch(fs.readFileSync(absolutePath, 'utf8')),
    };
  });

  caches.set(cacheKey, {projectRoot, queriesDir, queries, mtimeMs});
  return queries;
}

function findProjectRoot(fromFile: string): string | null {
  let dir = path.dirname(path.resolve(fromFile));
  const root = path.parse(dir).root;
  while (true) {
    for (const name of ['sqlfu.config.ts', 'sqlfu.config.mjs', 'sqlfu.config.js', 'sqlfu.config.cjs']) {
      if (fs.existsSync(path.join(dir, name))) return dir;
    }
    if (dir === root) return null;
    dir = path.dirname(dir);
  }
}

function resolveQueriesDir(projectRoot: string): string | null {
  for (const name of ['sqlfu.config.ts', 'sqlfu.config.mjs', 'sqlfu.config.js', 'sqlfu.config.cjs']) {
    const configPath = path.join(projectRoot, name);
    if (!fs.existsSync(configPath)) continue;
    // Cheap text parse. We can't execute the config synchronously here
    // (would need a bundler/worker), and the typical shape is a plain
    // literal `queries: './sql'` anyway.
    const text = fs.readFileSync(configPath, 'utf8');
    const match = text.match(/queries\s*:\s*['"]([^'"]+)['"]/);
    if (match) {
      const value = match[1];
      // Strip glob suffixes — we want the base dir.
      const base = value.replace(/\/\*\*?.*$/, '').replace(/\/[^/]*\*[^/]*$/, '');
      return path.resolve(projectRoot, base || '.');
    }
  }
  const fallback = path.join(projectRoot, 'sql');
  return fs.existsSync(fallback) ? fallback : null;
}

function walkSqlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkSqlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.sql')) {
      out.push(full);
    }
  }
  return out;
}

function directoryMtime(dir: string): number {
  let latest = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    try {
      const stat = fs.statSync(current);
      if (stat.mtimeMs > latest) latest = stat.mtimeMs;
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry));
      }
    } catch {
      // ignore — dir might have been removed mid-walk
    }
  }
  return latest;
}

function toCamelCase(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part.toLowerCase() : part[0].toUpperCase() + part.slice(1).toLowerCase()))
    .join('');
}

/**
 * Clear the in-process cache. Exposed for tests.
 */
export function resetQueryCache(): void {
  caches.clear();
}
