---
status: ready
size: small
---

# Outbox: polymorphic sync/async return types

Follow-up to the outbox PR (#41). Today, `sqlfu/outbox` accepts a `SyncClient`
as input but its `emit()`, `claim()`, `setup()` methods always return Promises
regardless — so `createOutbox({client: syncClient}).emit(...)` requires an
await even though nothing async ever happened. That contradicts the
"sync stays sync" promise in `docs/adapters.md`.

## Shape of the change

The two ingredients are already in the codebase:

- `Client = SyncClient<T> | AsyncClient<T>` — already a discriminated union
  (`core/types.ts:50`).
- `client.sync: true | false` — runtime tag already used by the generator to
  pick `function` vs `async function` output.

So the change is:

```ts
createOutbox<TEvents, TClient extends Client>({client: TClient, ...})
```

with conditional return types:

```ts
emit(...): TClient extends SyncClient ? EmitResult : Promise<EmitResult>
claim(...): TClient extends SyncClient ? ClaimedJob[] : Promise<ClaimedJob[]>
setup(): TClient extends SyncClient ? void : Promise<void>
```

`tick()` stays `async` either way — handlers are.

## Two implementation styles to pick from

- **Duplicate-and-strip-awaits.** One sync code path, one async code path.
  Bodies are almost identical except for `await`. ~80 lines of extra code for
  three methods. Boring, obvious, zero new concepts.
- **Quansync via generators.** Write the body once as a generator yielding
  client ops; have two tiny drivers (sync unwraps immediately, async
  `await`s). Smaller overall, but introduces a pattern the rest of the repo
  doesn't use. Worth it if/when a second module wants the same trick.

Recommendation: start with the duplicate-and-strip-aways. Revisit if a second
module needs the same thing.

## Test

Clone the current `test/outbox/outbox.test.ts` fixture for a SyncClient path
(same `node:sqlite` adapter, but assertions assert *plain* return values, not
`await`ed ones). Both test files share a helper that builds the app, parameterised
by client factory.

## Why it's worth doing

- Aligns the outbox with the rest of sqlfu's sync/async preservation story.
- Lets `sqlfu/outbox` run inside a Durable Object alarm, a `better-sqlite3`
  CLI tool, or demo-mode sqlite-wasm without spurious `async` creeping into
  the call site.
- Cheap to do, small surface (only three methods).

## 2026-04-28 implementation pass

Branch: `outbox-polymorphic-sync`

Status (for humans): done. Impl + sync sibling test landed. Full sqlfu suite (1399 tests) green. Typecheck clean.

Plan:

- Make `createOutbox` generic over `TClient extends Client` so `emit`, `claim`, `setup` return polymorphic types via a conditional on `TClient extends SyncClient`.
- Implement two parallel internal code paths: an async path identical to today's, and a sync path that's a literal copy with `await`s stripped and using the `SyncClient` operations. The runtime branches on `client.sync`.
- `tick()` stays async; handlers are async.
- Add a sync sibling test (`outbox.sync.test.ts`) that uses the same `node:sqlite` driver via `SyncClient` and asserts plain (non-Promise) return values.
- Run `pnpm --filter sqlfu test outbox` and `pnpm --filter sqlfu typecheck`.

Checklist:

- [x] type signatures: `createOutbox<TEvents, TClient extends Client = Client>` with conditional return types on `emit`/`claim`/`setup` _via `MaybeAsync<TClient, TSync, TAsync>` helper conditional in `outbox/index.ts`. Defaulted `TClient = Client` keeps the existing `Outbox<Events>` callsites working._
- [x] runtime: split body into `createSyncOutbox` / `createAsyncOutbox` paths picked off `client.sync` _bodies are deliberately copy-pasted with `await`s stripped, per the task's recommendation; comment at the top of `createSyncOutbox` warns to keep them in sync._
- [x] async tests still green _existing `outbox.test.ts` continues to pass unchanged._
- [x] sync sibling test asserting non-Promise returns lands and passes _at `packages/sqlfu/test/outbox/outbox.sync.test.ts`. Mirrors the async file's scenario shape; uses `expect(...).not.toBeInstanceOf(Promise)` on the polymorphic methods (`setup`, `emit`, `claim`) plus a runtime `instanceof Promise` guard inside `signUp` to keep the contract observable from the test code itself._
- [x] typecheck clean _`pnpm --filter sqlfu typecheck` passes._

