import type {AsyncClient, DisposableAsyncClient, ResultRow, RunResult, SqlfuProjectConfig} from './types.js';
import type {QueryCatalog} from './typegen/query-catalog.js';
import type {SqlAnalysisResponse} from './ui/shared.js';

export type {DisposableAsyncClient} from './types.js';

export type AdHocSqlResult =
  | {mode: 'rows'; rows: ResultRow[]}
  | {mode: 'metadata'; metadata: RunResult};

export type AdHocSqlParams = Record<string, unknown> | unknown[] | undefined;

export interface HostFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, contents: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string): Promise<void>;
  rm(path: string, options?: {force?: boolean}): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface HostLogger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface HostCatalog {
  load(config: SqlfuProjectConfig): Promise<QueryCatalog>;
  refresh(config: SqlfuProjectConfig): Promise<void>;
  analyzeSql(config: SqlfuProjectConfig, sql: string): Promise<SqlAnalysisResponse>;
}

export interface SqlfuHost {
  fs: HostFs;
  openDb(config: SqlfuProjectConfig): Promise<DisposableAsyncClient>;
  openScratchDb(slug: string): Promise<DisposableAsyncClient>;
  execAdHocSql(client: AsyncClient, sql: string, params: AdHocSqlParams): Promise<AdHocSqlResult>;
  initializeProject(input: {projectRoot: string; configContents: string}): Promise<void>;
  digest(content: string): Promise<string>;
  now(): Date;
  uuid(): string;
  logger: HostLogger;
  catalog: HostCatalog;
}
