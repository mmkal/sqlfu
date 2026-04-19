---
status: ready
size: medium
---

# applyMigrations should work for sync clients without a separate function

## Why this exists

`applyMigrations` is `async` today. It awaits every `client.run` / `client.all` / `client.transaction` because `Client = SyncClient | AsyncClient`. For a Node `AsyncClient` that's honest; for a `SyncClient` (durable objects, expo-sqlite-sync, better-sqlite3 in sync mode) the awaits resolve on the next microtask, but they're still real yield points.

In a durable object that matters: each yield is a point where the runtime can flush buffered writes. We already dropped SQL `BEGIN`/`COMMIT` from the DO adapter because DOs reject them, and we're relying on the DO's request-level output gate for atomicity. That works for thrown-error rollback, but a process crash between two statements inside `applyMigrations` can leave `sqlfu_migrations` out of sync with the live schema — one migration's DDL durable, its history row not yet written.

The real fix is to run the whole thing inside `state.storage.transactionSync(() => applyMigrations(syncHost, syncClient, …))`. `transactionSync` requires a *synchronous* callback. `applyMigrations` being async-only doesn't fit.

But we do **not** want users writing `applyMigrationsSync` vs `applyMigrationsAsync`. The call site should stay `applyMigrations(host, client, …)` regardless of which kind of client they have.

## Approach

Two pieces:

1. **Types: function overloads.** The exported signature should branch on the client type so callers get correct return types without casts.
   ```ts
   export function applyMigrations(host, client: SyncClient, params): void;
   export function applyMigrations(host, client: AsyncClient, params): Promise<void>;
   ```
   (Plus probably a `digest` async/sync split in `MigrationsHost` so sync clients can pair with a sync digest. WebCrypto is async; Node's `createHash` is sync. A sync-client consumer likely wants a sync digest helper — maybe ship a sync variant of `defaultMigrationsHost` too, or just export the primitives.)

2. **Runtime: one body, dual-dispatched.** Investigate [`quansync`](https://github.com/quansync-dev/quansync) — it lets you write a single generator-based function once and call it as either sync or async based on the runtime arguments. That's *exactly* the shape we need here. If quansync fits, the implementation stays DRY and we avoid a hand-maintained branching body. If it doesn't fit (e.g. bundle-size cost is unacceptable, or it doesn't cover `try/finally` cases we need), the fallback is a small internal utility that runs the same operation steps against either a sync or async client.

`baselineMigrationHistory` and `replaceMigrationHistory` should get the same treatment — they have the exact same shape.

## Acceptance

- `applyMigrations(host, syncClient, …)` returns `void` (not `Promise<void>`).
- `applyMigrations(host, asyncClient, …)` returns `Promise<void>`.
- Test demonstrating DO use can wrap the call in `state.storage.transactionSync(() => applyMigrations(...))` and get genuine per-migration atomicity — no crash-mid-migration window.
- Node test path (current `bundle.test.ts` + the migration-failure tests) keeps working unchanged.
- No `applyMigrationsSync` / `applyMigrationsAsync` surface. One function.

## Open questions

- Does quansync actually save complexity here or is a hand-rolled dual-dispatch cleaner given how few operations the body has?
- Does `MigrationsHost.digest` need a sync counterpart, or do we require sync clients to bring a sync digest (`createHash` style) themselves? Shipping a sync variant of `defaultMigrationsHost` backed by `node:crypto` seems reasonable for Node callers; DO/browser sync callers would need to provide their own or we wait until WebCrypto sync APIs exist (they don't currently).
- Confirm the DO `client.transaction` adapter change: with a real `storage.transactionSync` wrapping the whole `applyMigrations` call, do we still need the adapter's `transaction` to be a pass-through, or can we restore SQL transactions for sync clients that *don't* ban them?

## References

- PR #8 (commit where this was left open): DO test currently runs `applyMigrations` directly inside `blockConcurrencyWhile` without a SQLite transaction, relying on the DO output gate for atomicity.
- `packages/sqlfu/src/adapters/durable-object.ts` — `transaction()` is currently a pass-through that just invokes the callback without `BEGIN`/`COMMIT`; comment documents the trade-off.
- `packages/sqlfu/src/migrations/index.ts` — `applyMigrations`, `baselineMigrationHistory`, `replaceMigrationHistory` all have the same async-only shape.
- quansync: https://github.com/quansync-dev/quansync
