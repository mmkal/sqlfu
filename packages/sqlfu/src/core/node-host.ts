import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';

import type {AsyncClient, ResultRow, SqlfuProjectConfig, SqlQuery} from './types.js';
import {bindAsyncSql} from './sql.js';
import {rawSqlWithSqlSplittingAsync, surroundWithBeginCommitRollbackAsync} from './sqlite.js';
import type {QueryCatalog} from '../typegen/query-catalog.js';
import {initializeProject} from './config.js';
import {analyzeAdHocSqlForConfig, generateQueryTypesForConfig} from '../typegen/index.js';
import type {SqlAnalysisResponse, SqlEditorDiagnostic} from '../ui/shared.js';
import type {AdHocSqlParams, AdHocSqlResult, DisposableAsyncClient, HostCatalog, HostFs, SqlfuHost} from './host.js';

type NodeSqliteModule = {DatabaseSync: typeof DatabaseSync};

let cachedNodeSqliteModule: Promise<NodeSqliteModule> | undefined;

async function loadNodeSqliteModule(): Promise<NodeSqliteModule> {
  if (cachedNodeSqliteModule) return cachedNodeSqliteModule;

  cachedNodeSqliteModule = (async () => {
    const originalEmitWarning = process.emitWarning.bind(process);
    process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
      if (isNodeSqliteExperimentalWarning(warning, args)) return;
      return Reflect.apply(originalEmitWarning, process, [warning, ...args]);
    }) as typeof process.emitWarning;

    try {
      return await import('node:sqlite');
    } finally {
      process.emitWarning = originalEmitWarning;
    }
  })();

  return cachedNodeSqliteModule;
}

function isNodeSqliteExperimentalWarning(warning: string | Error, args: unknown[]) {
  const message = typeof warning === 'string' ? warning : warning.message;
  const type = typeof warning === 'string' ? (typeof args[0] === 'string' ? args[0] : '') : warning.name;
  return type === 'ExperimentalWarning' && message.includes('SQLite is an experimental feature');
}

export async function createNodeHost(): Promise<SqlfuHost> {
  const {DatabaseSync} = await loadNodeSqliteModule();
  const scratchRoot = path.join(os.tmpdir(), 'sqlfu-scratch');

  const openNodeDb = async (dbPath: string): Promise<DisposableAsyncClient> => {
    await fs.mkdir(path.dirname(dbPath), {recursive: true});
    const database = new DatabaseSync(dbPath);
    return {
      client: createAsyncNodeSqliteClient(database),
      async [Symbol.asyncDispose]() {
        database.close();
      },
    };
  };

  return {
    fs: nodeFs,
    openDb: (config) => openNodeDb(config.db),
    execAdHocSql: async (client, sql, params): Promise<AdHocSqlResult> => {
      const database = client.driver as InstanceType<typeof DatabaseSync>;
      const statement = database.prepare(sql);
      try {
        const rows = runPreparedAll(statement, params);
        return {mode: 'rows', rows};
      } catch {}
      const result = runPreparedRun(statement, params);
      return {
        mode: 'metadata',
        metadata: {
          rowsAffected: result.changes == null ? undefined : Number(result.changes),
          lastInsertRowid: result.lastInsertRowid as string | number | bigint | null,
        },
      };
    },
    openScratchDb: async (slug) => {
      await fs.mkdir(scratchRoot, {recursive: true});
      const dbPath = path.join(scratchRoot, `${slug}-${randomUUID()}.db`);
      const database = new DatabaseSync(dbPath);
      return {
        client: createAsyncNodeSqliteClient(database),
        async [Symbol.asyncDispose]() {
          database.close();
          await Promise.allSettled([
            fs.rm(dbPath, {force: true}),
            fs.rm(`${dbPath}-shm`, {force: true}),
            fs.rm(`${dbPath}-wal`, {force: true}),
          ]);
        },
      };
    },
    initializeProject: (input) => initializeProject(input),
    digest: async (content) => createHash('sha256').update(content).digest('hex'),
    now: () => new Date(),
    uuid: () => randomUUID(),
    logger: console,
    catalog: nodeCatalog,
  };
}

const nodeFs: HostFs = {
  async readFile(filePath) {
    return fs.readFile(filePath, 'utf8');
  },
  async writeFile(filePath, contents) {
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, contents);
  },
  async readdir(dirPath) {
    return fs.readdir(dirPath);
  },
  async mkdir(dirPath) {
    await fs.mkdir(dirPath, {recursive: true});
  },
  async rm(filePath, options) {
    await fs.rm(filePath, {force: options?.force ?? false});
  },
  async rename(from, to) {
    await fs.rename(from, to);
  },
  async exists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  },
};

const nodeCatalog: HostCatalog = {
  async load(config): Promise<QueryCatalog> {
    await generateQueryTypesForConfig(config);
    const catalogPath = path.join(config.projectRoot, '.sqlfu', 'query-catalog.json');
    return JSON.parse(await fs.readFile(catalogPath, 'utf8')) as QueryCatalog;
  },
  async refresh(config) {
    await generateQueryTypesForConfig(config);
  },
  async analyzeSql(config, sql) {
    if (!sql.trim()) return {};
    try {
      const analysis = await analyzeAdHocSqlForConfig(config, sql);
      return {
        paramsSchema: analysis.paramsSchema,
        diagnostics: [],
      };
    } catch (error) {
      if (isInternalUnsupportedSqlAnalysisError(error)) return {};
      return {
        diagnostics: [toSqlEditorDiagnostic(sql, error)],
      };
    }
  },
};

function isInternalUnsupportedSqlAnalysisError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return ['traverse_Sql_stmtContext', 'Not supported!'].includes(message);
}

function toSqlEditorDiagnostic(sql: string, error: unknown): SqlEditorDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const explicitLocation = locateExplicitPosition(sql, message);
  if (explicitLocation) return {...explicitLocation, message};

  const nearToken =
    message.match(/near ['"`]([^'"`]+)['"`]/i)?.[1] ??
    message.match(/no such (?:table|column):\s*([A-Za-z0-9_."]+)/i)?.[1] ??
    message.match(/Must select the join column:\s*([A-Za-z0-9_."]+)/i)?.[1];
  const tokenLocation = nearToken ? locateToken(sql, nearToken) : null;
  if (tokenLocation) return {...tokenLocation, message};

  return {...fallbackDiagnosticRange(sql), message};
}

function locateExplicitPosition(sql: string, message: string) {
  const lineColumnMatch = message.match(/line\s+(\d+)\D+column\s+(\d+)/i);
  if (!lineColumnMatch) return null;

  const lineNumber = Number(lineColumnMatch[1]);
  const columnNumber = Number(lineColumnMatch[2]);
  if (!Number.isFinite(lineNumber) || !Number.isFinite(columnNumber) || lineNumber < 1 || columnNumber < 1) {
    return null;
  }

  const lines = sql.split('\n');
  const targetLine = lines[lineNumber - 1];
  if (targetLine == null) return null;

  const from = lines.slice(0, lineNumber - 1).reduce((total, line) => total + line.length + 1, 0) + (columnNumber - 1);

  return {
    from,
    to: Math.min(sql.length, from + Math.max(1, targetLine.trim().length ? 1 : targetLine.length || 1)),
  };
}

function locateToken(sql: string, rawToken: string) {
  const token = rawToken.replace(/^["'`]+|["'`]+$/g, '');
  if (!token) return null;

  for (const candidate of [token, token.split('.').at(-1) ?? '']) {
    if (!candidate) continue;
    const index = sql.toLowerCase().indexOf(candidate.toLowerCase());
    if (index !== -1) {
      return {from: index, to: index + candidate.length};
    }
  }
  return null;
}

function fallbackDiagnosticRange(sql: string) {
  const firstNonWhitespace = sql.search(/\S/);
  const from = firstNonWhitespace === -1 ? 0 : firstNonWhitespace;
  return {from, to: Math.max(from + 1, sql.length)};
}

type NodeSqliteDatabase = InstanceType<typeof DatabaseSync>;

function runPreparedAll(statement: ReturnType<NodeSqliteDatabase['prepare']>, params: AdHocSqlParams): ResultRow[] {
  if (params == null) return statement.all() as ResultRow[];
  return (
    Array.isArray(params) ? statement.all(...(params as never[])) : statement.all(params as never)
  ) as ResultRow[];
}

function runPreparedRun(statement: ReturnType<NodeSqliteDatabase['prepare']>, params: AdHocSqlParams) {
  if (params == null) return statement.run();
  return Array.isArray(params) ? statement.run(...(params as never[])) : statement.run(params as never);
}

export function createAsyncNodeSqliteClient(database: NodeSqliteDatabase): AsyncClient<NodeSqliteDatabase> {
  const client: AsyncClient<NodeSqliteDatabase> = {
    driver: database,
    system: 'sqlite',
    async all<TRow extends ResultRow = ResultRow>(query: SqlQuery): Promise<TRow[]> {
      return database.prepare(query.sql).all(...(query.args as never[])) as TRow[];
    },
    async run(query: SqlQuery) {
      const result = database.prepare(query.sql).run(...(query.args as never[]));
      return {
        rowsAffected: result.changes == null ? undefined : Number(result.changes),
        lastInsertRowid: result.lastInsertRowid as string | number | bigint | null,
      };
    },
    async raw(sql: string) {
      return rawSqlWithSqlSplittingAsync(async (singleQuery) => {
        const result = database.prepare(singleQuery.sql).run(...(singleQuery.args as never[]));
        return {
          rowsAffected: result.changes == null ? undefined : Number(result.changes),
          lastInsertRowid: result.lastInsertRowid as string | number | bigint | null,
        };
      }, sql);
    },
    iterate<TRow extends ResultRow = ResultRow>(query: SqlQuery): AsyncIterable<TRow> {
      async function* gen() {
        for (const row of database.prepare(query.sql).iterate(...(query.args as never[]))) {
          yield row as TRow;
        }
      }
      return gen();
    },
    transaction: async <TResult>(fn: (tx: AsyncClient<NodeSqliteDatabase>) => Promise<TResult> | TResult) => {
      return surroundWithBeginCommitRollbackAsync(client, fn);
    },
    sql: undefined as unknown as AsyncClient<NodeSqliteDatabase>['sql'],
  };

  (client as {sql: AsyncClient<NodeSqliteDatabase>['sql']}).sql = bindAsyncSql(client);
  return client;
}
