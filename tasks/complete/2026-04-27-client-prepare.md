---
status: ready
size: medium
---

# Add `client.prepare(sql)` and retire `client.driver` reach-through

## Status

Spec finalized via grill-me interview. Implementation can begin against this file
without further design work. Interview transcript with all decisions and the
guesses they rest on: [tasks/client-prepare.interview.md](./client-prepare.interview.md).

## Motivation

sqlfu currently prepares every query at the point of execution — each
`client.all(query)` call internally does `database.prepare(query.sql).bind(...).all()`
and throws the prepared statement away. That's a perf cliff for hot paths
(migrations, generated wrappers, the query runner) and — more importantly — it
means any caller that wants to do two things with one prepared statement has
to reach into `client.driver` directly and talk to the raw driver API. That's
exactly what `execAdHocSql` in `packages/sqlfu/src/node/host.ts` used to do,
and it's how the ERR_DISPOSED crash in #58 happened: the sync driver-reach
path silently returned un-awaited Promises on async drivers.

The fix in #59 routed `execAdHocSql` through the Client API instead, but had
to paper over two gaps:

1. **Named params.** The Client API is positional-only (`args: QueryArg[]`).
   `execAdHocSql` rewrites `:name` / `$name` / `@name` to `?` with a tiny
   SQLite tokenizer in-file. Correct enough for the UI SQL runner, but the
   tokenizer doesn't belong in `node-host.ts`.
2. **Double prepare.** Reusing one prepared statement for `.all` then `.run`
   isn't expressible — the Client API throws the statement away each time.

A `client.prepare(sql)` handle solves both: adapters wrap their driver's native
prepared-statement object (or a shim where the driver doesn't have one), so
named params flow through the driver directly where supported. Callers that
want prepare-once-execute-many get it. `execAdHocSql` becomes a clean
`prepare → classify → all/run` pass-through.

## Interface

```ts
// packages/sqlfu/src/types.ts — alongside SyncClient/AsyncClient.

export interface SyncPreparedStatement<TRow extends ResultRow = ResultRow> {
  all(params?: Record<string, unknown> | QueryArg[]): TRow[];
  run(params?: Record<string, unknown> | QueryArg[]): RunResult;
  iterate(params?: Record<string, unknown> | QueryArg[]): Iterable<TRow>;
  [Symbol.dispose](): void;
}

export interface PreparedStatement<TRow extends ResultRow = ResultRow> {
  all(params?: Record<string, unknown> | QueryArg[]): Promise<TRow[]>;
  run(params?: Record<string, unknown> | QueryArg[]): Promise<RunResult>;
  iterate(params?: Record<string, unknown> | QueryArg[]): AsyncIterable<TRow>;
  [Symbol.asyncDispose](): Promise<void>;
}

// Add to the existing interfaces:
export interface SyncClient<TDriver = unknown> {
  // ...existing...
  prepare<TRow extends ResultRow = ResultRow>(sql: string): SyncPreparedStatement<TRow>;
}
export interface AsyncClient<TDriver = unknown> {
  // ...existing...
  prepare<TRow extends ResultRow = ResultRow>(sql: string): PreparedStatement<TRow>;
}
```

Two symmetric interfaces, mirroring `SyncClient`/`AsyncClient` and
`DisposableAsyncClient`. Sync handle uses `Symbol.dispose`; async handle uses
`Symbol.asyncDispose`. The slot must always exist on the handle — `using` /
`await using` require the symbol present even when the body is a no-op (shim
adapters).

`params` is loose (`Record<string, unknown> | QueryArg[]`). No type-level bind
helper in this task; generated wrappers already typecheck their args at the
call site before constructing the query shape.

## Adapter classification

Two implementation strategies depending on whether the underlying driver
exposes a real prepared-statement handle:

**Native** — wraps a real driver statement object, calls `finalize?.()` in
dispose:

| Adapter | Native handle | Named-param translation |
| --- | --- | --- |
| `node-sqlite` (sync `createNodeSqliteClient`) | `database.prepare(sql)` returns `StatementSync` | driver-native (`.all({name})`); verify at impl |
| `node-sqlite` (async `createAsyncNodeSqliteClient` in `node/host.ts`) | same `StatementSync`, wrapped in async functions | same |
| `better-sqlite3` | `database.prepare<TRow>(sql)` returns `Statement` | driver-native |
| `bun` | `database.query(sql)` returns reusable `Statement` | driver-native (verify; fall back to tokenizer if not) |
| `libsql` (sync) | `database.prepare(sql)` returns `LibsqlSyncStatementLike` | driver-native (libsql passes through to sqlite) |
| `turso-database` (async) | `database.prepare(sql)` returns `TursoDatabaseStatementLike` | driver-native |
| `d1` | hold a `D1PreparedStatement`, `.bind(...positional).all/run` per call | shared tokenizer (positional-only driver) |

**Shim** — captures the SQL string, re-issues the driver's exec/execute call
on each `.all`/`.run`/`.iterate`. Dispose is a no-op (slot still required):

| Adapter | Per-call driver call | Named-param translation |
| --- | --- | --- |
| `durable-object` | `storage.exec(sql, ...bindings)` | shared tokenizer |
| `sqlite-wasm` | `db.exec({sql, bind, rowMode, returnValue})` | driver-native (wasm `bind` accepts `Record`) |
| `expo-sqlite` | `database.getAllAsync/runAsync(sql, [...args])` | shared tokenizer |
| `turso-serverless` | `connection.execute(sql, [...args])` | shared tokenizer |
| `libsql-client` (async) | `client.execute({sql, args})` | driver-native (libsql `args` accepts `Record`) |

When in doubt about whether an adapter's driver natively handles `Record`
params (bun, sqlite-wasm, libsql-client, libsql-sync), the safe fallback is
the shared tokenizer — the interface contract doesn't change either way.
Verify driver-native support at implementation time; if any rejects the
`Record` form, route through the tokenizer for that adapter.

## Plan

1. **Move shared SQL helpers into `packages/sqlfu/src/sqlite-text.ts`.**
   - `sqlReturnsRows(sql: string): boolean` (currently in `node/host.ts`)
   - `rewriteNamedParamsToPositional(sql: string, params: Record<string, unknown> | QueryArg[] | undefined): {sql: string; args: QueryArg[]}` (currently in `node/host.ts`)
   - Both keep the same signatures and behavior. Comment one explaining that
     `sqlReturnsRows` is the read/write classifier (used by `execAdHocSql`)
     and the other is a per-adapter compatibility shim for positional-only drivers.

2. **Add `prepare()` to `SyncClient` and `AsyncClient`** in `types.ts`. Add the
   `SyncPreparedStatement` and `PreparedStatement` interfaces.

3. **Extend `*StatementLike` driver interfaces with `finalize?(): void`** for
   the native-handle adapters that need it: `NodeSqliteStatementLike`,
   `BetterSqlite3StatementLike`, `BunSqliteStatementLike`,
   `LibsqlSyncStatementLike`, `TursoDatabaseStatementLike`. Optional, called
   as `stmt.finalize?.()` in dispose. Optional because these interfaces are
   structural contracts for user-provided drivers — making it required would
   push the contract burden onto every test mock and onto users wrapping a
   sqlite-shaped client without finalize.

4. **Implement `prepare(sql)` in every adapter** following the table above:
   - Native adapters: call the driver's prepare/query, hold the resulting
     statement object, implement `.all/.run/.iterate` against it (driver-native
     params where supported, tokenizer where not), and `finalize?.()` in dispose.
   - Shim adapters: capture `sql` in a closure, call the driver's exec/execute
     each invocation. No-op dispose body. Add a code comment on each shim
     adapter explaining: "This adapter does not hold a native statement
     handle; `prepare` is a shim that re-issues the driver's exec on every
     call. <Driver-specific note about whether the underlying driver caches
     parsed statements at the C level>."

5. **Rewrite `execAdHocSql` in `packages/sqlfu/src/node/host.ts`**:
   ```ts
   execAdHocSql: async (client, sql, params): Promise<AdHocSqlResult> => {
     await using stmt = client.prepare(sql);
     if (sqlReturnsRows(sql)) {
       const rows = await stmt.all(params);
       return {mode: 'rows', rows};
     }
     const result = await stmt.run(params);
     return {mode: 'metadata', metadata: {
       rowsAffected: result.rowsAffected,
       lastInsertRowid: result.lastInsertRowid,
     }};
   },
   ```
   Delete the in-file `rewriteNamedParamsToPositional` and `sqlReturnsRows`
   (now imported from `sqlite-text.ts`). The keyword classifier stays —
   try/catch-on-`.all()` is rejected because (a) node:sqlite returns `[]`
   silently on writes, and (b) better-sqlite3 may execute partial side effects
   before throwing, which would make a `.run()` retry double-execute the write.

6. **Rewrite `execAdHocSql` in `packages/ui/src/demo/browser-host.ts`** the
   same way against the wasm client. Drop `statementReturnsRows` (the local
   helper that compiles a real sqlite-wasm statement to inspect column count)
   in favor of `sqlReturnsRows` from `sqlite-text.ts` — the keyword check is
   sufficient for `execAdHocSql`'s "show rows or row count" decision and
   removes a fragile prepare/finalize dance.

7. **Tests.**
   - New file `packages/sqlfu/test/adapters/prepare-suite.ts`. Exports two
     functions: `applyAsyncPrepareSuite({label, openClient})` and
     `applySyncPrepareSuite({label, openClient})`. Each calls a fixed set of
     `test(...)` cases using `openClient()` per test. Each test uses
     `using` / `await using` to dispose the client (and the prepared statement
     inside). Suite cases (minimum):
     - positional `args` array (`stmt.all([42])`)
     - named `Record` params (`stmt.all({slug: 'x'})`)
     - prepare once, call `.all(p1)` then `.all(p2)` with different params (proves reuse)
     - prepare once, call `.all()` then `.run()` (the original "reuse for read+write" motivation)
     - iterate rows
     - dispose is callable; second dispose call doesn't throw (idempotent)
   - Each existing adapter test file (`packages/sqlfu/test/adapters/*.test.ts`)
     adds one line at the bottom — e.g.
     `applySyncPrepareSuite({label: 'better-sqlite3', openClient: () => ...});`
     — below all existing tests and local fixture helpers, consistent with
     the project's "fixtures at the bottom" convention.

8. **Keep `test/node/exec-ad-hoc-sql.test.ts`.** It's a thin check that
   execAdHocSql routes through whatever implementation replaces the in-file
   tokenizer, and the existing assertions remain valid against the new shape.

## Non-goals

- **Prepare-statement caching** behind `client.all` / `client.run` — separate
  follow-up. A per-client LRU of SQL → prepared statement would be a big win
  for migrations and generated-wrapper hot paths, but it's a distinct design
  question (cache size, invalidation on schema change) and doesn't need to
  block the API shape.
- **Type-level bind helpers** for `params`. Loose `Record<string, unknown> |
  QueryArg[]` is fine for `execAdHocSql`. Generated wrappers already typecheck
  their args at the call site.
- **Migrating every call site to `prepare`.** Migrations and generated
  wrappers stay on the convenience wrappers. Refactor those opportunistically
  in a follow-up if and when the cache lands.
- **Disposed-state tracking** on the handle. No "throw after dispose"
  enforcement. The `using` keyword's job is to call dispose at scope exit.

## Guesses and assumptions

These are calls made during the grill-me interview that the implementer
should sanity-check before locking in:

- **Native named-param support on bun, sqlite-wasm, libsql-client, libsql-sync.**
  90% on better-sqlite3 and node:sqlite from prior projects, less sure on the
  others. If any rejects the unprefixed `Record` form against `:name`
  placeholders at runtime, route through the shared tokenizer for that
  adapter — the interface contract doesn't change.
- **Optional `finalize?(): void` on `*StatementLike` interfaces.** Trading the
  silent-leak risk (test mocks that omit finalize) for ergonomic fit.
  Pre-alpha, optional is fine. If leaks bite later, tighten to required + a
  clear user-facing error.
- **Suite coverage for all 11 adapters.** Some (bun, expo, D1 via miniflare,
  DO via workerd) run in non-vitest runners or need extra fixtures. The
  expectation is that each runs the prepare-suite call under whatever runner
  it currently uses for its existing tests; if any runner can't host the
  helper for a structural reason, leave that adapter for follow-up and call
  it out in the PR description.

## Related

- #58 (closed) — the bug that exposed the shape mismatch.
- #59 — the stopgap that this PR completes: tokenizer + keyword classifier in
  `node-host.ts` get moved to `sqlite-text.ts` and the call site cleans up.
