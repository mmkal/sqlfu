import fs from 'node:fs/promises';
import path from 'node:path';

import {createClient} from '@libsql/client';
import {createRouterClient, os} from '@orpc/server';
import {z} from 'zod';

import {createDefaultSqlite3defConfig, diffSnapshotSqlToDesiredSql, runSqlite3def} from './core/sqlite3def.js';
import type {SqlfuProjectConfig} from './core/types.js';

const base = os.$context<Migrations2Context>();
const sqlite3defConfig = createDefaultSqlite3defConfig('migrations2');

export const migrations2Router = {
  draft: base
    .input(
      z
        .object({
          name: z.string().min(1),
        })
        .optional(),
    )
    .handler(async ({context, input}) => {
      const runtime = createRuntime(context);
      const existingMigrations = await runtime.readMigrations();
      const definitionsSql = await fs.readFile(context.projectConfig.definitionsPath, 'utf8');
      const draftMigrations = existingMigrations.filter((migration) => migration.status === 'draft');

      if (draftMigrations.length > 1) {
        throw new Error('multiple draft migrations exist');
      }

      const draft = draftMigrations[0];
      const baselineSchema = draft
        ? await materializeSchema(sqlite3defConfig, {
            projectRoot: context.projectConfig.projectRoot,
            migrationPaths: existingMigrations.map((migration) => migration.path),
          })
        : '';
      const diffLines = await diffSnapshotSqlToDesiredSql(sqlite3defConfig, {
        snapshotSql: baselineSchema,
        desiredSql: definitionsSql,
      });

      if (draft) {
        if (diffLines.length === 0) {
          return;
        }

        const nextContents = `${draft.contents.trimEnd()}\n\n${diffLines.join('\n')}\n`;
        await fs.writeFile(draft.path, nextContents);
        return;
      }

      const fileName = `${nextMigrationId(existingMigrations, runtime.now())}_${slugify(input?.name ?? 'draft')}.sql`;
      const body = diffLines.length === 0 ? definitionsSql.trim() : diffLines.join('\n');
      const contents = `-- status: draft\n${body}\n`;

      await fs.mkdir(context.projectConfig.migrationsDir, {recursive: true});
      await fs.writeFile(path.join(context.projectConfig.migrationsDir, fileName), contents);
    }),

  finalize: base.handler(async ({context}) => {
    const runtime = createRuntime(context);
    const existingMigrations = await runtime.readMigrations();
    const draftMigrations = existingMigrations.filter((migration) => migration.status === 'draft');

    if (draftMigrations.length === 0) {
      throw new Error('no draft migration exists to finalize');
    }

    if (draftMigrations.length > 1) {
      throw new Error('multiple draft migrations exist');
    }

    const draft = draftMigrations[0]!;
    const definitionsSql = await fs.readFile(context.projectConfig.definitionsPath, 'utf8');
    const [definitionsSchema, migrationsSchema] = await Promise.all([
      materializeSchema(sqlite3defConfig, {
        projectRoot: context.projectConfig.projectRoot,
        sql: definitionsSql,
      }),
      materializeSchema(sqlite3defConfig, {
        projectRoot: context.projectConfig.projectRoot,
        migrationPaths: existingMigrations.map((migration) => migration.path),
      }),
    ]);

    if (definitionsSchema !== migrationsSchema) {
      throw new Error('draft migration does not match definitions.sql');
    }

    const nextContents = draft.contents.replace(/^--\s*status:\s*draft\b/iu, '-- status: final');
    await fs.writeFile(draft.path, nextContents);
  }),
};

export function createMigrations2Caller(context: Migrations2Context) {
  return createRouterClient(migrations2Router, {context});
}

function createRuntime(context: Migrations2Context) {
  return {
    now: () => context.now?.() ?? new Date(),
    async readMigrations() {
      try {
        const names = (await fs.readdir(context.projectConfig.migrationsDir))
          .filter((name) => name.endsWith('.sql'))
          .sort();
        const migrations = [];
        for (const name of names) {
          const filePath = path.join(context.projectConfig.migrationsDir, name);
          const contents = await fs.readFile(filePath, 'utf8');
          migrations.push({
            fileName: name,
            path: filePath,
            contents,
            status: parseStatus(contents),
          });
        }
        return migrations;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return [];
        }
        throw error;
      }
    },
  };
}

function parseStatus(contents: string): 'draft' | 'final' {
  const metadata = parseMetadata(contents);
  if (metadata.status === 'draft' || metadata.status === 'final') {
    return metadata.status;
  }
  throw new Error('migration metadata must include status: draft|final on the first line');
}

function parseMetadata(contents: string) {
  const firstLine = contents.split('\n', 1)[0];
  const match = firstLine.match(/^--\s*(.*)$/);
  if (!match) {
    throw new Error('migration metadata must be on the first line');
  }

  return Object.fromEntries(
    match[1]
      .split(/,\s*/u)
      .filter(Boolean)
      .map((segment) => {
        const [key, value] = segment.split(/:\s*/u, 2);
        return [key, value];
      }),
  );
}

function nextMigrationId(existingMigrations: ReadonlyArray<{fileName: string}>, now: Date) {
  const nowId = formatMigrationTimestamp(now);
  const lastExistingId = existingMigrations.at(-1)?.fileName.match(/^(\d{14})_/u)?.[1];
  if (!lastExistingId || lastExistingId < nowId) {
    return nowId;
  }
  return String(Number(lastExistingId) + 1).padStart(14, '0');
}

function formatMigrationTimestamp(value: Date) {
  const year = String(value.getUTCFullYear());
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');
  const seconds = String(value.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .replace(/_+/gu, '_');
}

async function materializeSchema(
  config: {projectRoot: string; tempDir: string},
  input:
    | {
        projectRoot: string;
        sql: string;
      }
    | {
        projectRoot: string;
        migrationPaths: readonly string[];
      },
) {
  await fs.mkdir(config.tempDir, {recursive: true});
  const workDir = await fs.mkdtemp(path.join(config.tempDir, 'materialize-'));
  const dbPath = path.join(workDir, 'schema.db');

  try {
    if ('sql' in input) {
      const sqlPath = path.join(workDir, 'definitions.sql');
      await fs.writeFile(sqlPath, input.sql);
      if (input.sql.trim()) {
        await runSqlite3def({...config, projectRoot: input.projectRoot}, ['--apply', '--file', sqlPath, dbPath]);
      }
    } else {
      await ensureDatabaseExists(dbPath);
      for (const migrationPath of input.migrationPaths) {
        await executeSqlScript(dbPath, await fs.readFile(migrationPath, 'utf8'));
      }
    }

    return exportSchema(dbPath);
  } finally {
    await fs.rm(workDir, {recursive: true, force: true});
  }
}

async function exportSchema(dbPath: string) {
  const client = createClient({url: `file:${dbPath}`});

  try {
    const result = await client.execute(`
      select sql
      from sqlite_schema
      where sql is not null
        and name not like 'sqlite_%'
      order by type, name
    `);

    return result.rows.map((row) => `${String(row.sql).toLowerCase()};`).join('\n');
  } finally {
    client.close();
  }
}

async function ensureDatabaseExists(dbPath: string) {
  const client = createClient({url: `file:${dbPath}`});
  client.close();
}

async function executeSqlScript(dbPath: string, sql: string) {
  const client = createClient({url: `file:${dbPath}`});

  try {
    for (const statement of splitSqlStatements(sql)) {
      await client.execute(statement);
    }
  } finally {
    client.close();
  }
}

function splitSqlStatements(sql: string) {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => `${statement};`);
}

export interface Migrations2Context {
  readonly projectConfig: SqlfuProjectConfig;
  readonly now?: () => Date;
}
