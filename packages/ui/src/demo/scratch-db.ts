import type {AsyncClient} from 'sqlfu/browser';

import {createWasmSqliteClient, type WasmSqliteClient} from './sqlite-wasm-client.js';
import {createWasmAsyncClient} from './sqlfu-client-adapter.js';

export type ScratchDb = {
  readonly wasm: WasmSqliteClient;
  readonly client: AsyncClient<WasmSqliteClient>;
  [Symbol.asyncDispose](): Promise<void>;
};

export async function createScratchDb(): Promise<ScratchDb> {
  const wasm = await createWasmSqliteClient();
  const client = createWasmAsyncClient(wasm);
  return {
    wasm,
    client,
    async [Symbol.asyncDispose]() {
      wasm.db.close();
    },
  };
}
