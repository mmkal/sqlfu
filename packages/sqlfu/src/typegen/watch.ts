import chokidar from 'chokidar';
import path from 'node:path';

import {generateQueryTypesForConfig} from './index.js';
import {loadProjectConfig} from '../node/config.js';
import {createNodeHost} from '../node/host.js';
import type {SqlfuHost} from '../host.js';
import type {SqlfuProjectConfig} from '../types.js';

const DEBOUNCE_MS = 150;

export async function watchGenerateQueryTypes(): Promise<void> {
  const config = await loadProjectConfig();
  const host = await createNodeHost();

  const abortController = new AbortController();
  const shutdown = () => abortController.abort();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  try {
    await watchGenerateQueryTypesForConfig(config, host, {signal: abortController.signal});
  } finally {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
  }
}

export async function watchGenerateQueryTypesForConfig(
  config: SqlfuProjectConfig,
  host: SqlfuHost,
  options: {
    signal?: AbortSignal;
    onReady?: () => void;
    logger?: Pick<Console, 'log' | 'error'>;
  } = {},
): Promise<void> {
  if (config.generate.authority === 'live_schema') {
    throw new Error(
      "sqlfu generate --watch does not support `generate.authority: 'live_schema'`. " +
        "Database changes can't be observed as file events. " +
        "Switch to 'desired_schema' (default), 'migrations', or 'migration_history' for watch mode.",
    );
  }

  const logger = options.logger ?? console;
  const watchPaths = collectWatchPaths(config);
  const generatedDir = path.join(config.queries, '.generated');

  let running = false;
  let pending = false;
  let pendingReason = '';

  const runGenerate = async (reason: string) => {
    if (running) {
      pending = true;
      pendingReason = reason;
      return;
    }
    running = true;
    let nextReason = reason;
    try {
      do {
        pending = false;
        logger.log(`sqlfu generate (${nextReason})`);
        try {
          await generateQueryTypesForConfig(config, host);
        } catch (error) {
          logger.error(`sqlfu generate failed: ${formatError(error)}`);
        }
        nextReason = pendingReason;
      } while (pending);
    } finally {
      running = false;
    }
  };

  await runGenerate('initial run');

  const debounce = createDebouncer(DEBOUNCE_MS);

  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    ignored: (watchedPath) => isInsideGenerated(watchedPath, generatedDir),
  });

  const onEvent = (eventName: string, eventPath: string) => {
    debounce(() => {
      const relative = path.relative(config.projectRoot, eventPath) || eventPath;
      void runGenerate(`${eventName}: ${relative}`);
    });
  };

  watcher.on('add', (eventPath) => onEvent('add', eventPath));
  watcher.on('change', (eventPath) => onEvent('change', eventPath));
  watcher.on('unlink', (eventPath) => onEvent('unlink', eventPath));
  watcher.on('error', (error) => logger.error(`sqlfu watcher error: ${formatError(error)}`));

  await new Promise<void>((resolve) => watcher.once('ready', () => resolve()));
  logger.log(`sqlfu watching for changes in:\n${watchPaths.map((value) => `  ${value}`).join('\n')}`);
  options.onReady?.();

  await new Promise<void>((resolve) => {
    if (options.signal?.aborted) {
      resolve();
      return;
    }
    options.signal?.addEventListener('abort', () => resolve(), {once: true});
  });

  await watcher.close();
}

function collectWatchPaths(config: SqlfuProjectConfig): string[] {
  const paths = new Set<string>();
  paths.add(config.queries);
  if (config.generate.authority === 'desired_schema') {
    paths.add(config.definitions);
  }
  if (
    (config.generate.authority === 'migrations' || config.generate.authority === 'migration_history') &&
    config.migrations
  ) {
    paths.add(config.migrations.path);
  }
  return [...paths];
}

function isInsideGenerated(candidate: string, generatedDir: string): boolean {
  const relative = path.relative(generatedDir, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function createDebouncer(ms: number) {
  let timer: NodeJS.Timeout | undefined;
  return (fn: () => void) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}
