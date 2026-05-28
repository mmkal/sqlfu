import path from 'node:path';

import {autoAcceptConfirm, type Confirm} from '../api/core.js';
import {getMigrationPrefix} from '../api/internal.js';
import {sqliteDialect} from '../dialect.js';
import {materializeDefinitionsSchemaFor, materializeMigrationsSchemaFor} from '../materialize.js';
import {migrationNickname} from '../naming.js';
import type {SqlfuHost} from '../host.js';
import {generateInlineConfigTypes, type GenerateQueryTypesResult} from '../typegen/index.js';
import {
  appendInlineMigration,
  inlineMigrationsToMigrationFiles,
  readInlineConfigSources,
  type InlineConfigSource,
} from './inline-source.js';

export async function generateInlineConfigModule(input: {
  modulePath: string;
  projectRoot: string;
  host: SqlfuHost;
}): Promise<GenerateQueryTypesResult> {
  return generateInlineConfigTypes(input);
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

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .replace(/_+/gu, '_');
}
