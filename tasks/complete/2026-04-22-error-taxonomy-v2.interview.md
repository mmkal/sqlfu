# Interview transcript — error taxonomy v2

Topic: error taxonomy + call-stack quality in sqlfu.
Slug: `error-taxonomy-v2`.
Branch: `error-taxonomy-v2` (worktree at `/Users/mmkal/src/worktrees/sqlfu/error-taxonomy-v2`).
Reference implementation to re-litigate: branch `origin/error-taxonomy` / PR #13.

---

## Q1 — class name — 2026-04-22

PR #13 uses `SqlfuError`. Codebase: runtime types unprefixed (`Client`, `SqlQuery`), config types prefixed (`SqlfuConfig`). `SqlError` collides with driver-native `SqliteError`.

**Rec:** `SqlfuError`.

## A1

Agreed: `SqlfuError`. `[guess: low-stakes — real tension is in kind strings]`

---

## Q2 — kind string style — 2026-04-22

PR #13: colon-namespaced `'constraint:unique'`. Alternatives: flat snake_case, SQLSTATE-aligned (`unique_violation`, `undefined_table`, …). SQLSTATE names match what pg-literate engineers think in; pg mapping becomes direct lookup.

Subquestion: collapse `primary_key_violation` into `unique_violation`? From a product POV both are "that row already exists".

**Rec:** SQLSTATE-aligned flat snake_case; primary_key collapses into unique_violation.

## A2

Yes to SQLSTATE-flat-snake_case; collapse primary_key into unique_violation. `[guess: pg alignment argument is load-bearing — divergence costs every user two vocabularies]`

Pushed back on `undefined_table` — TS `undefined` baggage makes it read oddly. Proposed `missing_table`.

---

## Q3 — missing_table vs undefined_table — 2026-04-22

sub-claude agreed: `missing_table` (and `missing_column`) over the SQLSTATE names. Because for these two kinds, the pg mapping is a trivial one-liner either way — so SQLSTATE fidelity buys nothing, and `undefined_` carries TS baggage.

**Final kind set:**

```ts
type SqlfuErrorKind =
  | 'syntax'
  | 'missing_table'
  | 'missing_column'
  | 'unique_violation'
  | 'not_null_violation'
  | 'foreign_key_violation'
  | 'check_violation'
  | 'transient'
  | 'unknown'
```

## A3

Agreed.

---

## Q3b — 'syntax' vs 'syntax_error', transient granularity — 2026-04-22

sub-claude: `'syntax'` not `'syntax_error'` — the class is already `…Error`, saying it twice is noise. Keep `transient` as catch-all; splitting (busy / lock_timeout / connection_lost) is out of scope per the dossier.

## A3b

Agreed.

---

## Q4 — field name: .kind vs .code vs .type — 2026-04-22

`.code` collides conceptually with `.cause.code` (the driver error's code). `.type` is loaded in TS. `.kind` is already this codebase's discriminator vocabulary (`QueryOperation: 'all' | 'run'`).

**Rec:** `.kind`.

## A4

Agreed. The "don't collide with cause.code" argument seals it.

---

## Q5 — shape of SqlfuError — 2026-04-22

PR #13 shape:

```ts
class SqlfuError extends Error {
  kind: SqlfuErrorKind
  query: SqlQuery   // full object, not flattened
  system: string
  cause: unknown
}
```

Keeping `.query`/`.system` on the error makes it self-contained — a plain `catch` block can reach them without restructuring around the hook API. Keeping `.query` as `SqlQuery` (not flattened) preserves `.name` for tagging.

**Rec:** keep shape exactly. `super(driverMessage)` for `.message`.

## A5

Agreed. `.system` stays even though it's always `'sqlite'` today — OTel `db.system` uses exactly this word, and hook authors shouldn't have to reach for context. `.message` passes the driver's message through unchanged.

---

## Q6 — where mapping lives: adapter vs instrument — 2026-04-22

PR #13: maps at the adapter layer, so `SqlfuError` is thrown regardless of whether the user called `instrument()`.

Alternative: map only at instrument layer → users who skip `instrument()` get raw driver errors.

**Rec:** adapter layer. `SqlfuError` is the library's unconditional error contract.

## A6

Adapter layer. "Every user of the library gets this, not just instrumented ones" wins. And adapter layer is where driver-specific knowledge lives, which is exactly where mapping belongs.

Followup: challenge PR #13's per-call wrapping (`runSqliteSync` around every `all`, `run`, `raw`, and every `iterate` `next()`). Propose cleaner structure.

---

## Q7 — factoring: wrap per-call vs wrap client — 2026-04-22

PR #13 wraps every method call individually — worst offender is `iterate`, three separate `runSqliteSync` calls including one per `next()`. Cleaner: build a raw client, then wrap once at factory exit (mirrors `instrumentClient`):

```ts
export function wrapSyncClientErrors<TDriver>(
  client: SyncClient<TDriver>,
  ctx: {system: string},
): SyncClient<TDriver> {
  const map = (e: unknown, query: SqlQuery) => mapSqliteDriverError(e, {query, system: ctx.system})
  const wrapped = {
    ...client,
    all:  (q) => { try { return client.all(q)  } catch (e) { throw map(e, q) } },
    run:  (q) => { try { return client.run(q)  } catch (e) { throw map(e, q) } },
    raw:  (sql) => { try { return client.raw(sql) } catch (e) { throw map(e, {sql, args: []}) } },
    *iterate(q) { try { yield* client.iterate(q) } catch (e) { throw map(e, q) } },
    transaction: (fn) => client.transaction((tx) => fn(wrapSyncClientErrors(tx, ctx))),
    sql: undefined as unknown,
  }
  wrapped.sql = bindSyncSql(wrapped)
  return wrapped
}
```

Each adapter exit is a one-liner. Matching `wrapAsyncClientErrors` for async.

**Rec:** wrap-at-factory-exit.

## A7

Agreed. Mirroring `instrumentClient` structurally is a feature.

---

## Q8 — mapError escape hatch — 2026-04-22

PR #13 has `options.mapError` on every `createXClient`. No user has asked for it; pre-pre-pre-alpha.

**User's stance:** YAGNI. Classification bugs get fixed in the library, not per-user. Ship without; add when asked.

## A8

Agreed. Addition later is mechanical — one optional param threaded through the wrapper.

---

## Q9 — message-substring fallback — 2026-04-22

PR #13 falls back to `message.includes('no such table')` when numeric/string code extraction yields nothing. D1 and expo-sqlite in particular expose plain `Error` objects with no structured code. SQLite message strings come from the C library itself — stable across adapters.

**Rec:** keep the three-tier hierarchy (numeric → extended string → message substring). Add a comment on the message block naming which adapters motivate it, so the well-behaved adapters don't make it look like dead code.

## A9

Agreed.

---

## Q10 — oRPC middleware rework — 2026-04-22

Proposed mapping:

```ts
kind === 'unique_violation'  → 'CONFLICT' (409)
kind === 'transient'         → 'SERVICE_UNAVAILABLE' (503)
kind === 'auth'              → 'FORBIDDEN' (403)
kind === 'unknown'           → 'INTERNAL_SERVER_ERROR' (500)
default (syntax, missing_*, other constraint) → 'BAD_REQUEST' (400)
```

Middleware puts `{kind}` into `ORPCError.data`. `toClientError` helper deleted — all 5 callsites covered by middleware. `saveTableRows`' manual `\nSQL: ...` enrichment removed (redundant once `SqlfuError.query.sql` is available).

## A10

Mapping holds. In-scope for THIS PR: middleware rewrite, delete `toClientError`, remove `saveTableRows` enrichment. OUT of scope: consuming `error.kind` on the React side (separate design task, would balloon PR). Logged as follow-up in task file.

---

## Q11 — stack quality in OTel test — 2026-04-22

PR #13 skipped stack-quality assertion for OTel because the recipe test dispatches via real Hono HTTP server — sync throw unwinds through dispatch, losing the test frame. Acceptable as documented?

sub-claude: the OTel exception is acceptable **but for the wrong reason**. Stack preservation is a property of the instrumentation layer, not of HTTP transport. Testing through Hono is testing the wrong thing. The right structure: one adapter-level stack test (no HTTP) that calls `client.run(badQuery)` directly and asserts `error.stack` contains the test filename. That test applies per-adapter via the same sweep. OTel recipe tests span export, not stack — stack assertion correctly doesn't belong there.

## A11

Agreed. Stack-quality assertion lives in the direct adapter sweep. OTel recipe test does not assert on stack (with a comment explaining why).

---

## Q12 — stack preservation approach — 2026-04-22

Options:

- (a) `this.stack = driverError.stack` — user's call-site frame is first useful frame; constructor-call frame hidden.
- (b) Prepend `'SqlfuError: <msg>'` line to driver stack — cosmetic only.
- (c) ES2022 `{cause}` without touching `.stack` — default stack points at wrapper internals; user inspects `error.cause.stack`.

**Rec:** (a). User's call-site is the debugging target; sqlfu internals are 99%-noise. A bug in the wrapping itself is a test-suite problem, not a production-stack problem.

## A12

Agreed. (a), keep PR #13's `this.stack = driverStack`.

---

**ready for Phase 2**
