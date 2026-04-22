declare module 'better-sqlite3' {
  type RunResult = {
    changes?: number;
    lastInsertRowid?: string | number | bigint | null;
  };

  class Statement<TRow = unknown> {
    reader: boolean;
    all(...params: unknown[]): TRow[];
    run(...params: unknown[]): RunResult;
    raw(toggle?: boolean): Statement;
  }

  export default class BetterSqlite3Database {
    constructor(filename: string);
    exec(sql: string): this;
    prepare<TRow = unknown>(query: string): Statement<TRow>;
    close(): void;
  }
}
