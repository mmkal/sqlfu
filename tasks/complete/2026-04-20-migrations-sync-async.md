---
status: in-progress
size: medium
---

# applyMigrations: portable host + sync/async unification

## High-level status

- Done. Dropped the `host` parameter from `applyMigrations`/`baseline`/`replace` entirely. Single function for each; overloaded to return `void` for sync clients and `Promise<void>` for async clients.
- Dual-dispatch: hand-rolled a ~40-line generator utility (`packages/sqlfu/src/migrations/dual-dispatch.ts`), quansync-shaped but no runtime dep on quansync itself.
- Digest: one codepath for both sync and async, using `@noble/hashes/sha2`. Portable (pure JS, zero deps), byte-identical to `node:crypto.createHash('sha256')`, works in Workers/DO without `nodejs_compat`.
- DO adapter left as-is (pass-through `transaction`). The DO test wraps the call in `state.storage.transactionSync(...)` — that's the real per-request atomicity boundary.

## Decisions made for this worktree

1. **Drop the `host: SqlfuHost` parameter entirely** from `applyMigrations`, `baselineMigrationHistory`, and `replaceMigrationHistory`. All three now just take `(client, params)`.
2. **Digest**: one sync implementation (`@noble/hashes/sha2`) serves both sync and async callers. Went with `@noble/hashes` after discovering that `node:crypto.createHash` breaks miniflare's module locator (it'd need `nodejs_compat` and bundling tricks) and that `crypto.subtle.digest` is async-only so it can't service the sync overload. Noble ships pure-JS ESM with explicit file extensions, is zero-dep, and esbuild bundles it cleanly for the DO test.
3. **Dual-dispatch**: internal utility at `packages/sqlfu/src/migrations/dual-dispatch.ts`. Generator-yielded promises get awaited in the async driver, or their synchronous equivalents are passed through in the sync driver. Mirrors `quansync`'s shape (yield a promise, it resolves and becomes the resume value). The sentinel `GET_IS_ASYNC` yield lets the generator branch when it needs to wire `client.transaction(cb)`, where `cb` itself has to be sync or async depending on the client.
4. **DO adapter**: keep `client.transaction` as a pass-through (current behavior). The DO test wraps the whole `applyMigrations` call in `state.storage.transactionSync(...)` — that's the real atomicity boundary. No adapter API change.
5. **DO test fixture**: switched to esbuild bundling for the worker entrypoint so miniflare can resolve `@noble/hashes/sha2.js` (a bare specifier the module locator won't find otherwise). Pre-existing `createDurableObjectClient` unit tests ride on the same fixture and keep passing.

## Original problem statement

Two related problems with `applyMigrations`/`baselineMigrationHistory`/`replaceMigrationHistory`. Both surfaced while building the migrations bundle (PR #8) for durable-object use; both are tracked here for whoever picks them up.

## 1. The `host: SqlfuHost` parameter is too wide for fsless callers

A DO/Worker/browser caller has no filesystem, no scratch db, no catalog — but `applyMigrations` types `host` as full `SqlfuHost`, so they have to fake one. The DO test in this PR currently does:

```ts
const host = {
  digest: async (content) => { /* WebCrypto SHA-256 */ },
  now: () => new Date(),
};
applyMigrations(host as any, client, {…});
```

The cast is the smell. `applyMigrations` only ever calls `host.digest(content)` and `host.now()`. The right shape is either:

- **Narrow the parameter type** to `MigrationsHost = {digest, now}` (a `Pick` of `SqlfuHost`). Existing callers that pass a full `SqlfuHost` keep working (superset). DO/Worker callers can build a 2-method object, no cast.
- **Or drop the parameter entirely** — inline `crypto.subtle.digest('SHA-256', …)` (cross-runtime; Node 19+, Workers, DOs, browsers) and `new Date()`. `applyMigrations(client, {migrations})` — zero ceremony. Ship `MigrationsHost`-style override only if a real use case demands it.

I lean toward dropping the parameter. There's no current consumer that needs to substitute `digest` or `now`, and adding the override later is much easier than removing it.

## 2. Sync clients pay the async tax

Even with WebCrypto, `applyMigrations` stays `async` because `crypto.subtle.digest` is async. In a DO every `await` inside is a yield point where the runtime can flush buffered writes. PR #8 dropped SQL `BEGIN`/`COMMIT` from the DO adapter because DOs reject them; we rely on the request-level output gate for atomicity. Thrown errors roll back cleanly; a process crash mid-migration can leave `sqlfu_migrations` out of sync with the live schema.

The real fix is to let DO callers wrap the whole thing in `state.storage.transactionSync(() => applyMigrations(syncClient, …))`. `transactionSync` requires a **synchronous** callback. `applyMigrations` being async-only doesn't fit.

**But we do not want `applyMigrationsSync` vs `applyMigrationsAsync` as two separate functions.** One name, one call site.

### Approach

1. **Types: function overloads.**
   ```ts
   export function applyMigrations(client: SyncClient, params): void;
   export function applyMigrations(client: AsyncClient, params): Promise<void>;
   ```
2. **Runtime: one body, dual-dispatched.** Investigate [`quansync`](https://github.com/quansync-dev/quansync) — it lets you write a single generator-based function once and call it as either sync or async based on the runtime arguments. That's exactly the shape we need. If quansync doesn't fit (bundle-size cost, `try/finally` gaps, …), fall back to a small internal utility.

`baselineMigrationHistory` and `replaceMigrationHistory` should get the same treatment.

### Digest in the sync path

- Async path: `crypto.subtle.digest` (cross-runtime).
- Sync path needs a sync SHA-256. `node:crypto.createHash` is sync but Node-only. For DO/Worker sync use, we'd either bundle a small vetted sync SHA-256 (~2KB) or accept a user-supplied sync digest. Probably bundle, so sync just works.

## Acceptance

- `applyMigrations(syncClient, …)` returns `void`. `applyMigrations(asyncClient, …)` returns `Promise<void>`. One function.
- DO test wraps the call in `state.storage.transactionSync(() => applyMigrations(client, {…}))` and gets genuine per-migration atomicity — no crash-mid-migration window.
- DO test no longer needs a hand-rolled host stub or `as any` cast.
- All existing tests keep passing — `bundle.test.ts`, the migration-failure tests, everything in `test/migrations/*`.
- No new dependency unless it's `quansync`-like and small.

## Open questions — resolved

- Bundle a sync SHA-256 or accept a user-supplied digest? **Bundle.** Added `@noble/hashes` (zero-dep, ~27KB ESM). Picked it over `node:crypto.createHash` because the Workers runtime needs bundling tricks + `nodejs_compat` for Node built-ins, and over vendoring a hand-rolled sha256 because Noble is audited and small enough. Hash output is byte-identical to `node:crypto` for existing callers, so migration checksums stay stable.
- Can the DO `client.transaction` adapter route automatically to `storage.transactionSync`? **Left as pass-through.** The DO test wraps the outer call in `transactionSync` explicitly — that's the documented atomicity boundary. Auto-routing from inside `client.transaction` would work but is redundant given the explicit outer wrap and harder to reason about when users compose.

## Checklist

- [x] _refined plan, committed in isolation_
- [x] _failing DO integration test that wraps `applyMigrations` in `state.storage.transactionSync`_
- [x] _dual-dispatch utility `packages/sqlfu/src/migrations/dual-dispatch.ts`_
- [x] _overload `applyMigrations` (sync → void, async → Promise<void>)_
- [x] _same treatment for `baselineMigrationHistory` + `replaceMigrationHistory`_
- [x] _drop `host` param from all three; update every caller_
- [x] _remove `as any` + hand-rolled host stub from DO test_
- [x] _all existing tests pass (`pnpm --filter sqlfu test`)_
- [x] _typecheck green (`pnpm --filter sqlfu typecheck`)_

## References

- `packages/sqlfu/src/migrations/index.ts` — current `applyMigrations` etc.
- `packages/sqlfu/src/adapters/durable-object.ts` — `transaction()` pass-through, with comment documenting why.
- `packages/sqlfu/test/adapters/durable-object.test.ts` — the `as any` host cast that this task removes.
- quansync: https://github.com/quansync-dev/quansync
