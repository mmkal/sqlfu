---
status: done
size: medium
---

# Error taxonomy and call-stack quality (v2)

## Status (2026-04-22)

Implemented on PR #49. Every checklist item below is checked with a breadcrumb. The previous attempt (PR #13) should be closed once this lands.

Revisit of `tasks/error-taxonomy.md`. Previous attempt: PR #13 on branch `error-taxonomy`. User was not happy with the outcome — naming was the suspected root cause. This task file is the result of a grill-you interview (see `tasks/error-taxonomy-v2.interview.md` for every decision with reasoning).

## Executive summary

Ship `SqlfuError` with a `.kind` discriminator so application code branches on outcome instead of string-matching driver messages. Mapping lives at the adapter layer via a single `wrapSyncClientErrors` / `wrapAsyncClientErrors` wrapper applied at factory exit (mirrors `instrumentClient` structurally). No user-supplied `mapError` escape hatch yet. Every sqlite adapter normalized. oRPC middleware in the UI router becomes taxonomy-aware. Adapter-level stack-quality integration test is the real guard; OTel recipe test does not assert on stack.

## Decisions (from the interview)

### Class name: `SqlfuError`

Namespace-safety beats convention here. `SqlError` collides with driver-native `SqliteError`; `DatabaseError` is too generic; `QueryError` is misleading (connection errors aren't query errors). `SqlfuError` is unambiguous in any `catch`.

### Kind values (SQLSTATE-aligned, flat snake_case)

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

- SQLSTATE-aligned names (`unique_violation`, `foreign_key_violation`, …) over colon-namespaced (`constraint:unique`). The day sqlfu adds postgres, the mapping is a direct SQLSTATE → kind lookup with no translation. Engineers who already know pg think in these names.
- `missing_table` / `missing_column` — not `undefined_table` / `undefined_column`. TS `undefined` baggage makes the SQLSTATE names read awkwardly; and the pg mapping for these two is a trivial one-liner either way, so SQLSTATE fidelity buys nothing.
- `primary_key_violation` collapsed into `unique_violation`. From a product POV both are "that row already exists"; users who need the distinction still have `cause.code`.
- `transient` stays as a catch-all. Splitting into `busy` / `lock_timeout` / `connection_lost` is out of scope — retry/backoff is explicitly not sqlfu's job.
- No `auth` kind in the initial shipped set. SQLite's `SQLITE_AUTH` is vanishingly rare in practice, and adding an `auth` kind that's never hit costs readers mental overhead. Add when pg lands (where it matters).

### Field shape

```ts
class SqlfuError extends Error {
  kind: SqlfuErrorKind
  query: SqlQuery   // nested, not flattened — preserves `.name` for tagging
  system: 'sqlite'  // string; `db.system` OTel convention value
  cause: unknown    // driver error, byte-identical
}
```

- `.kind`, not `.code` (collides conceptually with `cause.code`) or `.type` (loaded in TS).
- `.query` and `.system` on the error itself, not only on the hook context — so a plain `catch` block can tag Sentry / log the query name without restructuring around the hook API.
- `.message` = driver's message passed through unchanged (`super(driverMessage)`). A user's `console.error` or Sentry breadcrumb sees the real signal.
- `.stack` = driver's `.stack` verbatim. User's call-site frame is the first useful frame; sqlfu internals would be noise. (A bug in the wrapping layer is caught by the test suite, not by a production stack.)

### Where mapping lives

Adapter layer. `SqlfuError` is the library's unconditional contract — users who skip `instrument()` still get typed errors. Mapping lives where the driver-specific knowledge lives.

### Factoring — one wrapper per factory, not per-call

PR #13 wrapped every `all`/`run`/`raw` and every `iterate` `next()` individually (the iterate loop had three separate wrap calls). Collapse to:

```ts
// packages/sqlfu/src/core/adapter-errors.ts
export function wrapSyncClientErrors<TDriver>(
  client: SyncClient<TDriver>,
  ctx: {system: string},
): SyncClient<TDriver> {
  const map = (e: unknown, query: SqlQuery) => mapSqliteDriverError(e, {query, system: ctx.system})
  const wrapped: SyncClient<TDriver> = {
    ...client,
    all:  (q) => { try { return client.all(q)  } catch (e) { throw map(e, q) } },
    run:  (q) => { try { return client.run(q)  } catch (e) { throw map(e, q) } },
    raw:  (sql) => { try { return client.raw(sql) } catch (e) { throw map(e, {sql, args: []}) } },
    *iterate(q) { try { yield* client.iterate(q) } catch (e) { throw map(e, q) } },
    transaction: (fn) => client.transaction((tx) => fn(wrapSyncClientErrors(tx, ctx))),
    sql: undefined as unknown as SyncClient<TDriver>['sql'],
  }
  wrapped.sql = bindSyncSql(wrapped)
  return wrapped
}
```

Plus matching `wrapAsyncClientErrors`. Each `createXClient` factory becomes:

```ts
export function createBetterSqlite3Client(db, _options = {}): SyncClient<…> {
  const raw = buildRawBetterSqlite3Client(db)   // pure driver logic
  return wrapSyncClientErrors(raw, {system: 'sqlite'})
}
```

### No `mapError` escape hatch

YAGNI. Zero users have asked. Classification bugs should be fixed in the library, not papered over per-user. Adding it later is mechanical (one optional option, threaded through the wrapper).

### Classification: three-tier fallback

Numeric extended code → extended string code (`SQLITE_CONSTRAINT_UNIQUE`) → message substring (`'UNIQUE constraint failed'`). Add a one-line comment on the message-substring block naming which adapters motivate it (D1 and expo-sqlite surface plain `Error` with no structured code). The SQLite message strings come from the C library itself, so drift risk is low; per-adapter × per-kind integration sweep catches any that do.

### oRPC middleware rework

`packages/sqlfu/src/ui/router.ts`: replace the current `toClientError` / `uiBase` middleware with a `SqlfuError`-aware version.

```ts
function kindToOrpcCode(kind: SqlfuErrorKind) {
  switch (kind) {
    case 'unique_violation': return 'CONFLICT'
    case 'transient':        return 'SERVICE_UNAVAILABLE'
    case 'unknown':          return 'INTERNAL_SERVER_ERROR'
    default:                 return 'BAD_REQUEST'
  }
}

const uiBase = os.$context<UiRouterContext>().use(async ({next}) => {
  try {
    return await next()
  } catch (error) {
    if (error instanceof ORPCError) throw error
    if (error instanceof SqlfuError) {
      throw new ORPCError(kindToOrpcCode(error.kind), {
        message: error.message,
        data: {kind: error.kind},
      })
    }
    throw new ORPCError('INTERNAL_SERVER_ERROR', {message: String(error)})
  }
})
```

Delete `toClientError`. Let the five callsites that used it just throw naturally — the middleware catches them. Remove `saveTableRows`' manual `\nSQL: …` enrichment (redundant once `SqlfuError.query.sql` is available).

### Stack-quality guard

One adapter-level integration test in `test/errors.test.ts` asserting `error.stack` contains `__filename`. That covers every sqlite adapter via the same sweep. The OTel recipe test does **not** assert on stack — HTTP dispatch would unwind the test frame anyway, and stack preservation is an instrumentation-layer property, not a transport property. Add a comment in `opentelemetry.test.ts` pointing to `errors.test.ts` for the real sweep.

## Checklist

- [x] `packages/sqlfu/src/core/errors.ts` — `SqlfuError`, `SqlfuErrorKind`, `mapSqliteDriverError`. No `mapError` option type. _Landed in core/errors.ts._
- [x] `packages/sqlfu/src/core/adapter-errors.ts` — `wrapSyncClientErrors`, `wrapAsyncClientErrors`. _Landed; mirrors `instrumentClient` structurally._
- [x] Rewrite each adapter factory to build a raw client then call `wrapXClientErrors` once at exit. Adapters to update: `better-sqlite3`, `node-sqlite`, `bun`, `libsql`, `libsql-client`, `d1`, `durable-object`, `expo-sqlite`, `sqlite-wasm`. _One-liner added to every factory's return; turso-database and turso-serverless also covered._
- [x] Export `SqlfuError` and `SqlfuErrorKind` from `packages/sqlfu/src/client.ts` / `index.ts`. _Re-exports via `export * from './core/errors.js'` in `client.ts`._
- [x] `packages/sqlfu/test/errors.test.ts` — per-adapter × per-kind integration sweep; stack-quality sweep. _28 tests, 4 adapters × 7 assertions (5 kinds + cause + stack). All passing._
- [x] `packages/sqlfu/src/ui/router.ts` — replace middleware with the SqlfuError-aware version; delete `toClientError`; remove `saveTableRows` SQL enrichment. _`toOrpcError` helper + `kindToOrpcCode` switch; all 5 old call-sites collapsed; `deleteTableRow` outer try/catch also removed as it only gated on the stripped `\nSQL:` marker._
- [x] OTel recipe test comment pointing at `errors.test.ts` for the real stack-quality sweep. _Added at the head of `opentelemetry.test.ts`._
- [x] `packages/sqlfu/docs/errors.md` — docs page, argument-first. _Mental model + kind list + handler recipes + `.cause` usage + "why not rethrow"._
- [x] `packages/sqlfu/README.md` — short "Typed errors" capability paragraph. _Added under Observability; links to `docs/errors.md`. No landing-page panel change._
- [x] `packages/sqlfu/docs/observability.md` — one-line cross-reference from the existing `onError` recipe. _Paragraph added after `instrument.onError(report)` section._

## Out of scope

- React-side consumption of `error.kind` in the UI (runner output, relations view, etc.). Separate design task — would balloon this PR.
- Retry / backoff on `transient`.
- Hook-layer error wrapping (users can do it via `instrument.onError`).
- Postgres-specific SQLSTATE mapping code.
- User-supplied `mapError` override.
- Splitting `transient` into granular kinds.
- Adding an `auth` kind. (Add when pg lands and it matters.)

## For the next pass

- When a real user hits a `kind === 'unknown'` in production, they'll either (a) report it and we improve the mapper, or (b) need an override hook. If (b), `mapError` is the mechanical follow-up.
- Render-layer consumption of `.kind`. "How does the UI show `unique_violation` vs `syntax` vs `missing_table`?" That's a UI design task, not a library task.
- Once pg is on the horizon: add `auth` / `permission_denied`, split `transient` into `connection_lost` / `lock_timeout` if pg actually distinguishes them usefully, and write the pg mapper against SQLSTATE.

## Guesses and assumptions (flag for review)

These are the judgement calls I made on the user's behalf during the grill. The user should spot-check them in review — an objection to any is reason to defer this PR.

- `[guess: low-stakes]` Class name `SqlfuError`. The user's dissatisfaction note pointed at naming, but the sub-claude and I both landed on `SqlfuError` as the cleanest anyway. If the real issue was this specific name, speak up.
- `[guess: load-bearing]` SQLSTATE alignment argument for kind values. The assumption is that sqlfu will eventually ship a postgres adapter, and every kind string we invent now is a string we'd have to translate later. If pg is a far-off "maybe", this argument weakens — but I don't think that's the case.
- `[guess: product instinct]` Collapse `primary_key_violation` into `unique_violation`. From an HTTP-code / user-message perspective they're identical; SQLite does separate them at the code level. A SaaS-flavored product would collapse; a lower-level tool would split. sqlfu leans SaaS.
- `[guess: minor]` Drop the `auth` kind from the initial shipped set. It's rare in SQLite and adding a kind that's never seen in practice costs readers mental overhead. If pg-on-the-horizon is near-term, adding it now is also defensible.
- `[guess: scope call]` React-side consumption is a separate PR. Including it here would roughly double the PR size and get into "how does the runner UI render a syntax error" design territory.

## References

- **This task's PR:** #49 (branch `error-taxonomy-v2`)
- Previous attempt: PR #13 (branch `error-taxonomy`). Close once this merges.
- Interview transcript: `tasks/error-taxonomy-v2.interview.md`
- SQLSTATE reference: https://www.postgresql.org/docs/current/errcodes-appendix.html
- SQLite error codes: https://www.sqlite.org/rescode.html

## Implementation log

- 2026-04-22 initial implementation landed in one commit on `error-taxonomy-v2`:
  - `SqlfuError` + kind discriminator: `packages/sqlfu/src/core/errors.ts`
  - Adapter wrapper: `packages/sqlfu/src/core/adapter-errors.ts`
  - Every sqlite adapter (better-sqlite3, node-sqlite, bun, libsql, libsql-client, d1, durable-object, expo-sqlite, sqlite-wasm, turso-database, turso-serverless) wraps its return with `wrapSyncClientErrors` / `wrapAsyncClientErrors`
  - oRPC middleware rewritten in `ui/router.ts`; `toClientError` deleted; `saveTableRows` and `deleteTableRow` dead-catch blocks removed
  - Integration sweep in `test/errors.test.ts` (28 tests, all passing; 4 adapters × 7 assertions covering 5 kinds + cause preservation + stack quality)
  - `posthog.test.ts` and `bun.test.ts` snapshots updated (error name is `SqlfuError` now, was `Error` / `SQLiteError`). `sentry.test.ts` already used `SqlfuError`-compatible patterns and didn't need a snapshot change.
  - OTel recipe test gained a comment explaining why stack-quality isn't asserted there.
  - Docs page `docs/errors.md`, cross-reference in `docs/observability.md`, "Typed errors" capability paragraph in `packages/sqlfu/README.md`.
- Pre-existing failures not touched: `test/formatter.test.ts` (broken `formatSql` import on main, unrelated); `@sqlfu/ui` typecheck (`generateQueryTypes` import, also broken on main).
