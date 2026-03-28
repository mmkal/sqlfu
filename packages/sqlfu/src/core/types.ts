export type QueryArg = null | string | number | bigint | Uint8Array | boolean;

export interface SqlFragment {
  readonly sql: string;
  readonly args: readonly QueryArg[];
}

export interface SqlQuery extends SqlFragment {}

export interface RunResult {
  readonly rowsAffected: number;
  readonly lastInsertRowid: string | number | bigint | null;
}

export interface QueryExecutor {
  all<TRow extends Record<string, unknown>>(query: SqlQuery): Promise<readonly TRow[]>;
  first<TRow extends Record<string, unknown>>(query: SqlQuery): Promise<TRow | null>;
  run(query: SqlQuery): Promise<RunResult>;
}

export interface D1ResultRow {
  [key: string]: unknown;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = D1ResultRow>(): Promise<{results: T[]}>;
  first<T = D1ResultRow>(columnName?: string): Promise<T | null>;
  run(): Promise<{
    success: boolean;
    meta?: {
      changes?: number;
      last_row_id?: number | string;
    };
  }>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement;
}

export interface SqlfuConfig {
  readonly dbPath?: string;
  readonly migrationsDir?: string;
  readonly schemaFile?: string;
  readonly definitionsPath?: string;
  readonly sqlDir?: string;
  readonly tempDir?: string;
  readonly tempDbPath?: string;
  readonly typesqlConfigPath?: string;
  readonly sqlite3defVersion?: string;
  readonly sqlite3defBinaryPath?: string;
}

export interface SqlfuProjectConfig {
  readonly cwd: string;
  readonly configPath?: string;
  readonly dbPath: string;
  readonly migrationsDir: string;
  readonly schemaFile: string;
  readonly definitionsPath: string;
  readonly sqlDir: string;
  readonly tempDir: string;
  readonly tempDbPath: string;
  readonly typesqlConfigPath: string;
  readonly sqlite3defVersion: string;
  readonly sqlite3defBinaryPath: string;
}

export interface ProjectConfigOverrides extends SqlfuConfig {
  readonly cwd?: string;
  readonly configPath?: string;
}

export interface MigrateDiffResult {
  readonly drift: boolean;
  readonly output: string;
}
