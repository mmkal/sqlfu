---
status: ready
size: medium
---

# applyMigrations: portable host + sync/async unification

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

## Open questions

- Bundle a sync SHA-256 or accept a user-supplied digest? Leaning bundle.
- Can the DO `client.transaction` adapter (currently a pass-through with no `BEGIN`/`COMMIT` — see `packages/sqlfu/src/adapters/durable-object.ts`) route automatically to `storage.transactionSync` once we have a sync `applyMigrations`? Probably yes; the DO adapter would gain a `storage` reference instead of just `storage.sql`.

## References

- `packages/sqlfu/src/migrations/index.ts` — current `applyMigrations` etc.
- `packages/sqlfu/src/adapters/durable-object.ts` — `transaction()` pass-through, with comment documenting why.
- `packages/sqlfu/test/adapters/durable-object.test.ts` — the `as any` host cast that this task removes.
- quansync: https://github.com/quansync-dev/quansync
