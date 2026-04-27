# Adapters

`sqlfu` doesn't ship its own database driver. It sits on top of whichever SQLite-compatible client you already use — local file, embedded engine, edge runtime, or a real remote database — and gives you the same typed client surface on top.

This page lists every adapter that ships in `sqlfu` today, with a copy-paste snippet for each.

If you already know which driver you want to use, jump to the section below. If you're picking from scratch, see [Choosing an adapter](#choosing-an-adapter) at the bottom.

## Sync stays sync

Most query libraries force every database call to be `async`, even when the underlying driver is synchronous — the library is written async-first, and that colour leaks into your entire call stack.

`sqlfu` goes out of its way to preserve the sync-ness of the driver you bring:

- Give it `better-sqlite3` → you get a `SyncClient`. `client.all(...)` returns rows, not a `Promise<rows>`. `client.transaction(fn)` calls `fn` synchronously.
- Give it `@libsql/client` → you get an `AsyncClient`. Same surface, but `Promise`-returning.
- Generated wrappers follow suit. A query generated against a sync-backed client is a plain function that returns its rows. Generated against an async-backed client, it returns a `Promise`. No gratuitous `async` creeping up your call stack.
- The migrator follows suit too. `applyMigrations(syncClient, ...)` runs synchronously; `applyMigrations(asyncClient, ...)` returns a promise. This is why Durable Object startup migrations can run directly in the constructor.

Concretely, that's why the Sync/Async column exists in the compatibility matrix below, why the transaction helpers inside sqlfu have [two implementations](../src/sqlite-text.ts): `surroundWithBeginCommitRollbackSync` and `surroundWithBeginCommitRollbackAsync`, and why the migrator uses the same sync/async dual-dispatch internally. The [generator](../src/typegen/index.ts) reads `client.sync: true` / `false` and emits either a plain `function` returning `SyncClient`-flavored rows, or an `async function` returning a `Promise`.

Why this matters:

- **Call sites stay honest.** `function saveUser(user)` calling a sync-backed sqlfu client doesn't silently become `async`. No "await-pollution" spreading through code that didn't actually do anything async.
- **Runtimes that prefer sync stay fast.** Cloudflare Durable Objects' SQLite is synchronous by design. Scripts, CLI tools, and background jobs on `better-sqlite3` don't pay for microtask thrashing they don't need.
- **Swapping drivers is a one-line change, as long as you stay in the same lane.** Going from `better-sqlite3` (sync) to `@tursodatabase/database` (async) does require awaiting, because the work actually did change. `sqlfu` doesn't hide that difference from the type system — it surfaces it.

In short: the client you get matches the driver you brought. sqlfu doesn't pretend a sync driver is async, and it doesn't pretend an async driver is sync.

## Prepared statements

Generated wrappers are still the main application path: put stable queries in `.sql` files, run `sqlfu generate`, and call the generated function. `client.prepare(sql)` is the lower-level client API for SQL that needs to stay dynamic or ad-hoc without reaching through to `client.driver`.

Use it when you want to reuse one statement handle, bind named parameters directly, or call `.all()` and `.run()` against the same SQL string. The handle follows the same sync/async split as the client:

```ts
interface PostRow {
  id: number;
  title: string;
}

using stmt = syncClient.prepare<PostRow>(`
  select id, title
  from posts
  where slug = :slug
`);

const rows = stmt.all({slug: 'hello-world'});
```

```ts
interface PostRow {
  id: number;
  title: string;
}

await using stmt = asyncClient.prepare<PostRow>(`
  select id, title
  from posts
  where slug = :slug
`);

const rows = await stmt.all({slug: 'hello-world'});
```

Prepared handles expose `.all(params)`, `.run(params)`, and `.iterate(params)`. `params` can be a positional array (`[id]`) or a named object (`{slug}`). Adapters that have native prepared statements hold the driver handle and dispose it when the `using` scope exits. Adapters whose driver only exposes an `exec`/`execute` API provide a compatible shim: the method still exists, but each call re-issues the SQL through the driver.


## Compatibility matrix

| Driver package                      | Runtime                       | Where it runs                          | Sync/Async | Adapter factory                 |
| ----------------------------------- | ----------------------------- | -------------------------------------- | ---------- | ------------------------------- |
| `better-sqlite3`                    | Node                          | Local file / in-memory                 | Sync       | `createBetterSqlite3Client`     |
| `node:sqlite`                       | Node ≥ 22                     | Local file / in-memory                 | Sync       | `createNodeSqliteClient`        |
| `bun:sqlite`                        | Bun                           | Local file / in-memory                 | Sync       | `createBunClient`               |
| `libsql`                            | Node                          | Local file / embedded replica          | Sync       | `createLibsqlSyncClient`        |
| `@libsql/client`                    | Node / Deno / edge runtimes   | Local `file:` or remote `libsql://`    | Async      | `createLibsqlClient`            |
| `@tursodatabase/database`           | Node                          | Local / embedded (Turso's next engine) | Async      | `createTursoDatabaseClient`     |
| `@tursodatabase/serverless`         | Any `fetch()` runtime         | Remote Turso Cloud (HTTP)              | Async      | `createTursoServerlessClient`   |
| `@tursodatabase/sync`               | Node                          | Local file + sync to Turso Cloud       | Async      | `createTursoDatabaseClient`     |
| Cloudflare `D1Database`             | Cloudflare Workers            | D1                                     | Async      | `createD1Client`                |
| Durable Object `SqlStorage`         | Cloudflare Durable Objects    | Per-DO embedded SQLite                 | Sync       | `createDurableObjectClient`  |
| `expo-sqlite`                       | Expo (React Native)           | On-device SQLite                       | Async      | `createExpoSqliteClient`        |
| `@sqlite.org/sqlite-wasm`           | Browsers                      | OPFS / in-memory                       | Async      | `createSqliteWasmClient`        |

Every factory takes the underlying driver's database/connection object as its single argument and returns a `sqlfu` client. None of these drivers are peer dependencies: install only the one you actually use.

## Local and embedded

### `node:sqlite` (Node)

```ts
import {DatabaseSync} from 'node:sqlite';
import {createNodeSqliteClient} from 'sqlfu';

const db = new DatabaseSync('app.db');
const client = createNodeSqliteClient(db);
```

### `bun:sqlite`

```ts
import {Database} from 'bun:sqlite';
import {createBunClient} from 'sqlfu';

const db = new Database('app.db');
const client = createBunClient(db);
```

### `better-sqlite3` (Node)

```ts
import Database from 'better-sqlite3';
import {createBetterSqlite3Client} from 'sqlfu';

const db = new Database('app.db');
const client = createBetterSqlite3Client(db);
```

### `libsql` (native embedded)

```ts
import Database from 'libsql';
import {createLibsqlSyncClient} from 'sqlfu';

const db = new Database('app.db');
const client = createLibsqlSyncClient(db);
```

### `@tursodatabase/database`

The new Turso-built engine, with native bindings. Same API shape as `@tursodatabase/sync`.

```ts
import {connect} from '@tursodatabase/database';
import {createTursoDatabaseClient} from 'sqlfu';

const db = await connect('app.db'); // or ':memory:'
const client = createTursoDatabaseClient(db);
```

## Remote / cloud

### `@libsql/client` — Turso Cloud (or local `file:`)

```ts
import {createClient} from '@libsql/client';
import {createLibsqlClient} from 'sqlfu';

const raw = createClient({
  url: process.env.TURSO_DATABASE_URL!, // libsql://...
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const client = createLibsqlClient(raw);
```

The same adapter works against a local file when `url` is `file:app.db`.

### `@tursodatabase/serverless` — HTTP, no native deps

```ts
import {connect} from '@tursodatabase/serverless';
import {createTursoServerlessClient} from 'sqlfu';

const conn = connect({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const client = createTursoServerlessClient(conn);
```

No native bindings — runs on any runtime with `fetch()` (Vercel Edge, Cloudflare Workers, Deno Deploy, AWS Lambda).

### `@tursodatabase/sync` — local file, synced to Turso

Same adapter as `@tursodatabase/database`; the difference is at the driver level (the driver keeps a local file and knows how to `push()`/`pull()` to a remote Turso DB).

```ts
import {connect} from '@tursodatabase/sync';
import {createTursoDatabaseClient} from 'sqlfu';

const db = await connect({
  path: 'local.db',
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
await db.connect();
const client = createTursoDatabaseClient(db);

// sync at your own cadence — sqlfu doesn't own this
await db.push();
await db.pull();
```

### Cloudflare D1

```ts
import {createD1Client} from 'sqlfu';

export default {
  async fetch(_req, env: {DB: D1Database}) {
    const client = createD1Client(env.DB);
    // ...
  },
};
```

### Cloudflare Durable Object (per-DO SQLite)

```ts
import {DurableObject} from 'cloudflare:workers';
import {createDurableObjectClient} from 'sqlfu';
import {migrate} from '../migrations/.generated/migrations';

export class Counter extends DurableObject {
  client: ReturnType<typeof createDurableObjectClient>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.client = createDurableObjectClient(ctx.storage);

    migrate(this.client);
  }
}
```

Pass `ctx.storage`, not `ctx.storage.sql`. The SQL handle is enough for queries, but the full storage object gives sqlfu access to Cloudflare's `transactionSync()` API, so each migration is applied inside a real Durable Object storage transaction. If you need a query-only escape hatch, pass `{sql: ctx.storage.sql}` explicitly.

The generated migration module is emitted by `sqlfu generate` when `migrations` is configured. Commit `migrations/*.sql`; import `migrate` from `migrations/.generated/migrations.ts` into the Worker bundle; let every Durable Object instance call it during startup. `migrate()` is idempotent: once a given Durable Object's private SQLite database has a row in `sqlfu_migrations`, that migration is skipped on later starts.

## Mobile / browser

### Expo SQLite

```ts
import * as SQLite from 'expo-sqlite';
import {createExpoSqliteClient} from 'sqlfu';

const db = await SQLite.openDatabaseAsync('app.db');
const client = createExpoSqliteClient(db);
```

### `@sqlite.org/sqlite-wasm` (browsers)

```ts
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {createSqliteWasmClient} from 'sqlfu';

const sqlite3 = await sqlite3InitModule();
const db = new sqlite3.oo1.DB('file:app.db?vfs=opfs');
const client = createSqliteWasmClient(db);
```

## Choosing an adapter

A few rules of thumb:

- **You want fast local dev and then "a real database" in prod**: use `@libsql/client` for both. Set `url: 'file:app.db'` locally and `libsql://...` in prod. No code changes needed at the sqlfu layer.
- **You need zero native deps (edge workers, serverless, Lambda)**: `@tursodatabase/serverless` or Cloudflare `D1`.
- **You want an embedded database that can sync to the cloud**: `@tursodatabase/sync`.
- **You want the fastest pure-local experience on Node**: `better-sqlite3` or `@tursodatabase/database`.
- **You're on Bun**: `bun:sqlite`.
- **You're on Node ≥ 22 and want no extra deps**: `node:sqlite`.
- **Mobile / browser**: Expo SQLite or `sqlite-wasm`.

And probably the best thing: you don't have to choose *one*. You can define separate entrypoints for your local, test and production environments and write your application logic using the shared sqlfu `Client` interface, then pass around two different clients, and they'll behave in the same way.

## Writing a custom adapter

Each adapter is a thin function that wraps a driver into a `SyncClient` or `AsyncClient`. The existing adapters in [`src/adapters/`](../src/adapters) are the reference. Shape:

- `all(query)` → rows
- `run(query)` → `{rowsAffected?, lastInsertRowid?}`
- `raw(sql)` → multi-statement string execution
- `iterate(query)` → row iterator
- `prepare(sql)` → reusable statement handle with `.all`, `.run`, `.iterate`, and a dispose method
- `transaction(fn)` → run `fn` inside a transaction (the `sqlfu/core/sqlite` helpers provide `surroundWithBeginCommitRollback{Sync,Async}` that implement this for you using `begin`/`commit`/`rollback`)

If your driver has a native prepared statement, wrap it. If it does not, implement `prepare(sql)` as a small shim that captures the SQL string and calls the driver's normal execution method on each `.all`, `.run`, or `.iterate`. The method should still return a disposable handle so callers can use `using` / `await using` uniformly.

If your driver is SQLite-compatible but not listed, opening a PR with a new adapter file + a test file in `test/adapters/` is usually a small change.
