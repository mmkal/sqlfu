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
