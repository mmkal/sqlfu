import {createSqliteWasmClient} from 'sqlfu/client';
import {
  analyzeVendoredTypesqlQueriesWithClient,
  isInternalUnsupportedSqlAnalysisError,
  toSqlEditorDiagnostic,
} from 'sqlfu/browser';
import type {
  AdHocSqlParams,
  AdHocSqlResult,
  DisposableAsyncClient,
  HostCatalog,
  HostFs,
  QueryCatalog,
  ResultRow,
  SqlAnalysisResponse,
  SqlfuHost,
  SqlfuProjectConfig,
} from 'sqlfu/browser';

import {buildQueryCatalog} from './catalog.js';
import {openWasmDatabase, type Database} from './sqlite-wasm-client.js';
import {DemoVfs} from './vfs.js';

export const DEMO_PROJECT_ROOT = '/demo';
export const DEMO_PROJECT_NAME = 'demo';

// The `await using ...` bundle helper emitted by esbuild/Vite reads the dispose
// slot as `Symbol.asyncDispose || Symbol.for("Symbol.asyncDispose")`. Using the
// same expression for the *writer* side (here) guarantees we always land the
// method under the key the reader is looking for — otherwise a mismatch between
// native and polyfilled symbols anywhere in the runtime surfaces as the cryptic
// "Object not disposable" TypeError we saw on iOS.
const ASYNC_DISPOSE: symbol =
  (Symbol as unknown as {asyncDispose?: symbol}).asyncDispose ?? Symbol.for('Symbol.asyncDispose');
const DISPOSE: symbol = (Symbol as unknown as {dispose?: symbol}).dispose ?? Symbol.for('Symbol.dispose');

function fallbackUuid() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildDemoConfig(): SqlfuProjectConfig {
  return {
    projectRoot: DEMO_PROJECT_ROOT,
    db: `${DEMO_PROJECT_ROOT}/app.db`,
    definitions: `${DEMO_PROJECT_ROOT}/definitions.sql`,
    migrations: `${DEMO_PROJECT_ROOT}/migrations`,
    queries: `${DEMO_PROJECT_ROOT}/sql`,
    generate: {validator: null, prettyErrors: true, sync: false, importExtension: '.js'},
  };
}

export async function createBrowserHost(input: {
  onSchemaChange: () => void;
}): Promise<{host: SqlfuHost; config: SqlfuProjectConfig; vfs: DemoVfs; database: Database}> {
  const vfs = new DemoVfs();
  const database = await openWasmDatabase();
  const liveClient = createSqliteWasmClient(database);
  seedLiveDatabase(database, vfs.definitions);

  const config = buildDemoConfig();
  const fs = createVfsFs(vfs, config, input.onSchemaChange);
  const catalog = createBrowserCatalog(vfs, database);
  const host: SqlfuHost = {
    fs,
    openDb: async () =>
      ({
        client: liveClient,
        [DISPOSE]() {},
        async [ASYNC_DISPOSE]() {},
      }) as unknown as DisposableAsyncClient,
    openScratchDb: async () => {
      const scratchDatabase = await openWasmDatabase();
      const scratchClient = createSqliteWasmClient(scratchDatabase);
      return {
        client: scratchClient,
        [DISPOSE]() {
          scratchDatabase.close();
        },
        async [ASYNC_DISPOSE]() {
          scratchDatabase.close();
        },
      } as unknown as DisposableAsyncClient;
    },
    execAdHocSql: async (client, sqlText, params): Promise<AdHocSqlResult> => {
      const db = client.driver as Database;
      const bindings = normalizeAdHocParams(params);
      const returnsRows = statementReturnsRows(db, sqlText);
      if (returnsRows) {
        const rows = db.exec({
          sql: sqlText,
          bind: bindings as never,
          rowMode: 'object',
          returnValue: 'resultRows',
        }) as ResultRow[];
        // SELECTs don't mutate the db; skip the schema-change broadcast. The
        // RelationQueryPanel's useQuery subscribes to this same endpoint, so
        // an invalidateQueries() here would re-fire the query and loop.
        return {mode: 'rows', rows};
      }
      db.exec({sql: sqlText, bind: bindings as never});
      input.onSchemaChange();
      const rowsAffected = Number(db.changes(false, false) ?? 0);
      const lastInsertRowidValue = db.selectValue('select last_insert_rowid() as value');
      const lastInsertRowid =
        typeof lastInsertRowidValue === 'bigint'
          ? Number(lastInsertRowidValue)
          : ((lastInsertRowidValue as number | null | undefined) ?? null);
      return {mode: 'metadata', metadata: {rowsAffected, lastInsertRowid}};
    },
    initializeProject: async () => {
      throw new Error('sqlfu init is not supported in demo mode');
    },
    digest: async (content) => {
      const bytes = new TextEncoder().encode(content);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    },
    now: () => new Date(),
    // crypto.randomUUID is iOS 15.4+. fall back manually on older WebKit so a
    // stale iphone doesn't blow up the whole demo at boot.
    uuid: () => (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : fallbackUuid()),
    logger: console,
    catalog,
  };

  return {host, config, vfs, database};
}

function statementReturnsRows(db: Database, sqlText: string): boolean {
  const stmt = db.prepare(sqlText);
  try {
    return stmt.columnCount > 0;
  } finally {
    stmt.finalize();
  }
}

function createBrowserCatalog(vfs: DemoVfs, database: Database): HostCatalog {
  const typesqlDb = wasmDatabaseAsTypesqlClient(database);
  return {
    async load(): Promise<QueryCatalog> {
      return buildQueryCatalog(vfs);
    },
    async refresh() {},
    async analyzeSql(_config, sql): Promise<SqlAnalysisResponse> {
      if (!sql.trim()) return {};
      try {
        const [analysis] = await analyzeVendoredTypesqlQueriesWithClient(typesqlDb, [
          {sqlPath: 'demo-sql-runner.sql', sqlContent: sql},
        ]);
        if (!analysis) return {};
        if (analysis.ok) return {diagnostics: []};
        throw new Error(analysis.error.description);
      } catch (error) {
        if (isInternalUnsupportedSqlAnalysisError(error)) return {};
        return {diagnostics: [toSqlEditorDiagnostic(sql, error)]};
      }
    },
  };
}

function wasmDatabaseAsTypesqlClient(database: Database) {
  const shim = {
    prepare(sql: string) {
      database.prepare(sql).finalize();
      return {
        all(...args: unknown[]): unknown[] {
          const bind = args.length > 0 ? (args as never) : undefined;
          return database.exec({
            sql,
            bind,
            rowMode: 'object',
            returnValue: 'resultRows',
          }) as unknown[];
        },
      };
    },
    exec(sql: string) {
      database.exec(sql);
    },
    close() {},
  };
  return {type: 'sqlite', client: shim} as never;
}

function createVfsFs(vfs: DemoVfs, config: SqlfuProjectConfig, notify: () => void): HostFs {
  const migrationsPrefix = `${config.migrations}/`;
  const queriesPrefix = `${config.queries}/`;

  const matchMigration = (path: string) =>
    path.startsWith(migrationsPrefix) ? path.slice(migrationsPrefix.length) : undefined;
  const matchQuery = (path: string) => (path.startsWith(queriesPrefix) ? path.slice(queriesPrefix.length) : undefined);

  const enoent = (path: string) => {
    const error = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    return error;
  };

  return {
    async readFile(path) {
      if (path === config.definitions) return vfs.definitions;
      const migrationName = matchMigration(path);
      if (migrationName !== undefined) {
        const file = vfs.migrations.find((m) => m.name === migrationName);
        if (!file) throw enoent(path);
        return file.content;
      }
      const queryName = matchQuery(path);
      if (queryName !== undefined) {
        const file = vfs.queries.find((q) => q.name === queryName);
        if (!file) throw enoent(path);
        return file.content;
      }
      throw enoent(path);
    },
    async writeFile(path, contents) {
      if (path === config.definitions) {
        vfs.writeDefinitions(contents);
        notify();
        return;
      }
      const migrationName = matchMigration(path);
      if (migrationName !== undefined) {
        vfs.writeMigration({name: migrationName, content: contents});
        notify();
        return;
      }
      const queryName = matchQuery(path);
      if (queryName !== undefined) {
        vfs.writeQuery({name: queryName, content: contents});
        notify();
        return;
      }
      throw new Error(`Cannot write to path outside of the demo vfs: ${path}`);
    },
    async readdir(path) {
      if (path === config.migrations) return vfs.migrations.map((m) => m.name);
      if (path === config.queries) return vfs.queries.map((q) => q.name);
      throw enoent(path);
    },
    async mkdir() {},
    async rm(path) {
      const queryName = matchQuery(path);
      if (queryName !== undefined) {
        const id = queryName.replace(/\.sql$/, '');
        vfs.deleteQuery(id);
        notify();
        return;
      }
      const migrationName = matchMigration(path);
      if (migrationName !== undefined) {
        const index = vfs.migrations.findIndex((m) => m.name === migrationName);
        if (index !== -1) {
          vfs.migrations.splice(index, 1);
          notify();
        }
        return;
      }
      throw new Error(`Cannot rm path outside of the demo vfs: ${path}`);
    },
    async rename(from, to) {
      const fromQuery = matchQuery(from);
      const toQuery = matchQuery(to);
      if (fromQuery !== undefined && toQuery !== undefined) {
        vfs.renameQuery(fromQuery, toQuery);
        notify();
        return;
      }
      throw new Error(`Unsupported rename in demo vfs: ${from} -> ${to}`);
    },
    async exists(path) {
      if (path === config.definitions) return vfs.definitions.length > 0;
      const migrationName = matchMigration(path);
      if (migrationName !== undefined) return vfs.migrations.some((m) => m.name === migrationName);
      const queryName = matchQuery(path);
      if (queryName !== undefined) return vfs.queries.some((q) => q.name === queryName);
      return false;
    },
  };
}

function seedLiveDatabase(database: Database, definitionsSql: string) {
  database.exec(definitionsSql);
  database.exec(`
    insert into posts (slug, title, body, published) values
      ('hello-world', 'Hello World', 'First post body', 1),
      ('draft-notes', 'Draft Notes', 'Unpublished notes', 0);
  `);
}

function normalizeAdHocParams(params: AdHocSqlParams): Record<string, unknown> | unknown[] {
  if (params == null) return [];
  return params as Record<string, unknown> | unknown[];
}
