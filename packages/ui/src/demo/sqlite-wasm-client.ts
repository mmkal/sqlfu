import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type {Database, SqlValue} from '@sqlite.org/sqlite-wasm';
import sqlite3WasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';

type BindValue = SqlValue | boolean | undefined;
type BindArgs = readonly BindValue[] | Record<string, BindValue>;

export type WasmRunResult = {
  readonly rowsAffected: number;
  readonly lastInsertRowid: number | null;
};

export type WasmSqliteClient = {
  readonly db: Database;
  all<TRow extends Record<string, unknown> = Record<string, unknown>>(sql: string, args: BindArgs): TRow[];
  run(sql: string, args: BindArgs): WasmRunResult;
  exec(sql: string): void;
  columnCount(sql: string): number;
};

let sqlite3Promise: Promise<Awaited<ReturnType<typeof sqlite3InitModule>>> | undefined;

async function loadSqlite3() {
  if (!sqlite3Promise) {
    const init = sqlite3InitModule as unknown as (options: {
      locateFile?: (fileName: string) => string;
    }) => Promise<Awaited<ReturnType<typeof sqlite3InitModule>>>;
    sqlite3Promise = init({
      locateFile: (fileName: string) => (fileName === 'sqlite3.wasm' ? sqlite3WasmUrl : fileName),
    });
  }
  return sqlite3Promise;
}

export async function createWasmSqliteClient(): Promise<WasmSqliteClient> {
  const sqlite3 = await loadSqlite3();
  const db = new sqlite3.oo1.DB(':memory:', 'c');

  return {
    db,
    all<TRow extends Record<string, unknown> = Record<string, unknown>>(sql: string, args: BindArgs) {
      const rows = db.exec({
        sql,
        bind: normalizeBindings(args),
        rowMode: 'object',
        returnValue: 'resultRows',
      });
      return rows as TRow[];
    },
    run(sql: string, args: BindArgs) {
      db.exec({
        sql,
        bind: normalizeBindings(args),
      });
      const lastInsertRowid = db.selectValue('select last_insert_rowid() as value');
      const rowsAffected = Number(db.changes(false, false) ?? 0);
      return {
        rowsAffected,
        lastInsertRowid: typeof lastInsertRowid === 'bigint' ? Number(lastInsertRowid) : (lastInsertRowid as number | null) ?? null,
      };
    },
    exec(sql: string) {
      db.exec(sql);
    },
    columnCount(sql: string) {
      const stmt = db.prepare(sql);
      try {
        return stmt.columnCount;
      } finally {
        stmt.finalize();
      }
    },
  };
}

function normalizeBindings(args: BindArgs) {
  if (Array.isArray(args)) {
    if (args.length === 0) {
      return undefined;
    }
    return args.map(normalizeBindValue) as SqlValue[];
  }
  const entries = Object.entries(args as Record<string, BindValue>);
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(
    entries.map(([key, value]) => [normalizeBindKey(key), normalizeBindValue(value)]),
  ) as Record<string, SqlValue>;
}

function normalizeBindKey(key: string): string {
  return /^[:@$]/.test(key) ? key : `:${key}`;
}

function normalizeBindValue(value: BindValue): SqlValue {
  if (value === undefined) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return value;
}
