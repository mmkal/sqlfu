import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type {Database} from '@sqlite.org/sqlite-wasm';
import sqlite3WasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';

export type {Database} from '@sqlite.org/sqlite-wasm';

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

export async function openWasmDatabase(): Promise<Database> {
  const sqlite3 = await loadSqlite3();
  return new sqlite3.oo1.DB(':memory:', 'c');
}
