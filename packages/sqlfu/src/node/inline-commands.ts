import path from 'node:path';

import {autoAcceptConfirm, type Confirm} from '../api/core.js';
import {getMigrationPrefix} from '../api/internal.js';
import {sqliteDialect} from '../dialect.js';
import {materializeDefinitionsSchemaFor, materializeMigrationsSchemaFor} from '../materialize.js';
import {migrationNickname} from '../naming.js';
import type {SqlfuHost} from '../host.js';
import {generateInlineConfigTypes, type GenerateQueryTypesResult} from '../typegen/index.js';
import {watch} from './watcher.js';
import {
  appendInlineMigration,
  inlineMigrationsToMigrationFiles,
  readInlineConfigSources,
  type InlineConfigSource,
} from './inline-source.js';

const INLINE_WATCH_DEBOUNCE_MS = 150;

export async function generateInlineConfigModule(input: {
  modulePath: string;
  projectRoot: string;
  host: SqlfuHost;
}): Promise<GenerateQueryTypesResult> {
  return generateInlineConfigTypes(input);
}

export async function watchGenerateInlineConfigModule(
  input: {
    modulePath: string;
    projectRoot: string;
    host: SqlfuHost;
  },
  options: {
    signal?: AbortSignal;
    onReady?: () => void;
    logger?: Pick<Console, 'log' | 'error'>;
  } = {},
): Promise<void> {
  const logger = options.logger || console;
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
          await generateInlineConfigModule(input);
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

  const debounce = createDebouncer(INLINE_WATCH_DEBOUNCE_MS);
  const watcher = watch([input.modulePath], {ignoreInitial: true});

  const onEvent = (eventName: string, eventPath: string) => {
    debounce(() => {
      const relative = projectRelativePath(input.projectRoot, eventPath);
      void runGenerate(`${eventName}: ${relative}`);
    });
  };

  watcher.on('add', (eventPath) => onEvent('add', eventPath));
  watcher.on('change', (eventPath) => onEvent('change', eventPath));
  watcher.on('unlink', (eventPath) => onEvent('unlink', eventPath));
  watcher.on('error', (error) => logger.error(`sqlfu watcher error: ${formatError(error)}`));

  await new Promise<void>((resolve) => watcher.once('ready', () => resolve()));
  logger.log(`sqlfu watching for changes in:\n  ${input.modulePath}`);
  options.onReady?.();

  try {
    await new Promise<void>((resolve) => {
      if (options.signal?.aborted) {
        resolve();
        return;
      }
      options.signal?.addEventListener('abort', () => resolve(), {once: true});
    });
  } finally {
    await watcher.close();
  }
}

export async function draftInlineConfigMigration(input: {
  modulePath: string;
  projectRoot: string;
  host: SqlfuHost;
  name?: string;
  confirm?: Confirm;
}): Promise<{path: string} | null> {
  const inlines = await readInlineConfigSources(input.modulePath);
  if (inlines.length === 0) {
    throw new Error(`No inline defineConfig(...) call found in ${input.modulePath}.`);
  }

  const dialect = sqliteDialect();
  let drafted = false;
  for (const inline of inlines) {
    const didDraft = await draftInlineConfigMigrationForSource(input, inline, {
      dialect,
      includeInlineName: inlines.length > 1,
    });
    drafted ||= didDraft;
  }
  return drafted ? {path: projectRelativePath(input.projectRoot, input.modulePath)} : null;
}

async function draftInlineConfigMigrationForSource(
  input: {
    modulePath: string;
    projectRoot: string;
    host: SqlfuHost;
    name?: string;
    confirm?: Confirm;
  },
  inline: InlineConfigSource,
  options: {
    dialect: ReturnType<typeof sqliteDialect>;
    includeInlineName: boolean;
  },
): Promise<boolean> {
  const [desiredSchema, baselineSchema] = await Promise.all([
    materializeDefinitionsSchemaFor(input.host, inline.definitions.sql, {dialect: options.dialect}),
    materializeMigrationsSchemaFor(input.host, inlineMigrationsToMigrationFiles(inline), {dialect: options.dialect}),
  ]);
  const diffLines = await options.dialect.diffSchema(input.host, {
    baselineSql: baselineSchema,
    desiredSql: desiredSchema,
    allowDestructive: true,
  });

  if (diffLines.length === 0) {
    return false;
  }

  const confirm = input.confirm || autoAcceptConfirm;
  const body = await confirm({
    title: options.includeInlineName
      ? `Create inline migration entry for ${inline.name}?`
      : 'Create inline migration entry?',
    body: diffLines.join('\n').trim(),
    bodyType: 'sql',
    editable: true,
  });
  if (!body?.trim()) {
    return false;
  }

  const prefix = getMigrationPrefix({
    kind: 'iso',
    now: input.host.now(),
    existing: inline.migrations.map((migration) => `${migration.name}.sql`),
  });
  const name = `${prefix}_${slugify(input.name || migrationNickname(body))}`;
  await appendInlineMigration(input.modulePath, {
    app: inline.className ? `${inline.className}.${inline.name}` : inline.name,
    name,
    content: body,
  });
  return true;
}

function projectRelativePath(projectRoot: string, filePath: string) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
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

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .replace(/_+/gu, '_');
}
