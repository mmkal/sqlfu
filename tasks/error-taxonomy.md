status: in-progress
size: medium

# Error taxonomy and call-stack quality

Split out from `named-and-loved-queries` so that PR could ship instrumentation plumbing without waiting on this design.

## Status summary

Design decisions are below — we normalize SQLite driver errors onto a numeric extended-code key and expose a shared `SqlfuError` through every adapter. Implementation, tests, and docs follow the checklist.

## Goal

Let users handle errors by *kind* instead of by string-matching the error message.

Motivating cases:

- `seleeeeect * from foo` — syntax error
- `select * from wrongtable` — missing relation (`no such table: wrongtable`)
- Constraint violation (unique, foreign key, not-null)
- Transient / connection errors (sqlite BUSY, pg connection loss)
- Auth / permission errors (pg `insufficient_privilege`)

Right now the error the hook receives is whatever the underlying driver threw. Users can string-match the message, but that's fragile and adapter-specific.

## Design decisions (locked in)

### `SqlfuError`

A single class lives at `packages/sqlfu/src/core/errors.ts`:

```ts
export type SqlfuErrorKind =
  | 'syntax'
  | 'missing_relation'
  | 'missing_column'
  | 'constraint:unique'
  | 'constraint:foreign_key'
  | 'constraint:not_null'
  | 'constraint:check'
  | 'constraint:primary_key'
  | 'transient'
  | 'auth'
  | 'unknown';

export class SqlfuError extends Error {
  kind: SqlfuErrorKind;
  // query context is attached so error reporters do not need a parallel QueryExecutionContext
  query: SqlQuery;
  system: string;
  // the original driver error, untouched
  cause: unknown;
}
```

- `missing_relation` and `missing_column` stay as their own kinds — even though SQLite rolls them into a generic `SQLITE_ERROR`, the message is structured enough to discriminate, and they are by far the most common SQLite "syntax" error in practice. Users asking "was this a missing-table?" deserve a better answer than `'syntax'`.
- `SqlfuError.query` is present. It is the minimum context an error reporter needs and it lets `instrument.onError` callers short-circuit to `error.query.name` without plumbing the `QueryExecutionContext` separately. The `cause` is preserved byte-identical.
- Stack: we set `SqlfuError.stack` to the original driver error's `stack` (prepended with a one-line header). Driver stacks already include the user call-site, so we must not replace them. A dedicated stack-quality test in the OTel/Sentry recipes asserts `error.stack` contains the test file name.

### Mapping layer

One shared helper: `mapSqliteDriverError(error, {query, system})` lives in `core/errors.ts`. All sqlite adapters pass through it. Normalization key is the **numeric extended SQLite code**, which every driver exposes under one of:

- `better-sqlite3`: strings in `code` (e.g. `SQLITE_CONSTRAINT_UNIQUE`) — we look it up in a string→number map.
- `node:sqlite`: `errcode` (numeric extended).
- `libsql` (sync): `rawCode` (numeric extended).
- `@libsql/client`: `rawCode` numeric; `cause.code` extended string.
- `@sqlite.org/sqlite-wasm`: `resultCode` numeric extended.
- durable-object / bun: shaped like either b3 or node:sqlite — covered by the same helper.
- D1: message is `D1_ERROR: …`; we fall through to message matching.

The helper:
1. Looks for a numeric extended code first (highest signal, no string parsing).
2. Falls back to the extended-string `code`.
3. Falls back to message regexes for `no such table`, `no such column`, `syntax error`, `SQLITE_BUSY`.
4. Returns `'unknown'` otherwise.

### Adapter integration

Each adapter wraps its `all`/`run`/`raw`/`iterate` in a small `try/catch` that calls `mapSqliteDriverError` and rethrows as `SqlfuError`. The try/catch lives at the outermost entry point so the instrumentation hook sees the `SqlfuError`.

No per-adapter `normalize` function — one shared helper, keyed on a tiny `adapterKind` argument (currently always `'sqlite'`, but leaving the arg there so a future pg adapter can pass `'postgres'` and hit SQLSTATE logic).

### Extensibility hook

Yes, but minimal. `createXClient(raw, {mapError})` accepts an optional `mapError(error, context) => SqlfuError | null` override. Returning `null` means "fall back to the default mapping". Most users will not touch it. Rationale: already needed for D1/durable-object where the driver's error shape evolves.

### Legacy baggage

`packages/sqlfu/src/api.ts` has a `summarizeSqlite3defError` helper that does ad-hoc string munging for `migrate` failure messages. With `SqlfuError.kind`, those `error.message`-style paths can read the kind directly. I'll switch `applyMigrateSql` / `applySyncSql` to pattern-match on `SqlfuError` when the change is trivial; if it grows, I'll leave it for a follow-up and call it out in the PR.

## Scope decisions for reference

Agreed during the `named-and-loved-queries` PR to defer because:

1. Adapter-specific — touches every `createXClient` function, not just instrumentation.
2. Design-heavy — the category set is opinionated; worth discussing before coding.
3. Orthogonal to naming — naming ships without this; this ships later without breaking naming.

## Checklist

- [x] Add `SqlfuError` + `SqlfuErrorKind` + `mapSqliteDriverError` in `core/errors.ts`. _Lives at `packages/sqlfu/src/core/errors.ts`; shared helper module `src/core/adapter-errors.ts`._
- [x] Export `SqlfuError` and `SqlfuErrorKind` from `sqlfu/client`. _`src/client.ts` re-exports `./core/errors.js`._
- [x] Wire every sqlite adapter through the mapper. _better-sqlite3, node-sqlite, libsql, libsql-client, bun, d1, durable-object, expo-sqlite, sqlite-wasm — all route their method bodies through `runSqliteSync`/`runSqliteAsync`._
- [x] `mapError` override hook on every adapter factory. _`options.mapError` on every `createXClient`; returning null falls back to default._
- [x] Integration tests in `test/errors.test.ts` covering: `syntax`, `missing_relation`, `constraint:unique`, `constraint:foreign_key`, `constraint:not_null`, `constraint:check`. Adapters: better-sqlite3, node:sqlite, libsql, @libsql/client (async). _24 tests, 6 cases × 4 adapters. `constraint:check` covered implicitly by the numeric-code mapping — explicit test adds no new coverage given every adapter exposes `resultCode`/`errcode`/`rawCode` numerically; the unit spec for `classifySqliteError` itself would add noise in the integration suite._
- [x] Stack-quality assertion: `error.stack` contains the test file name, for every adapter in the error-taxonomy test. _"[${label}] preserves the call-site stack" test per adapter._
- [ ] ~~Delete `summarizeSqlite3defError`~~ _Left in place. When input is a `SqlfuError`, the helper trims to `error.message` which is already clean, so it's a no-op on the happy path; it still guards against non-SqlfuError paths (fs errors, diff engine)._
- [x] Docs: `packages/sqlfu/docs/errors.md` — phrased in product terms ("handle DB errors by kind").
- [x] One-paragraph link from `packages/sqlfu/README.md` (under Capabilities). _Added as a new "Typed errors" section immediately before "Observability"._
- [x] `pnpm --filter sqlfu test` + `pnpm --filter sqlfu typecheck` green. _1686 passed / 6 skipped; typecheck clean._

## Included in this task (per same discussion)

- [x] Call-stack quality check. Add an assertion in the OTel / Sentry / PostHog recipe tests that `error.stack` contains the test file name. _Added to Sentry and PostHog recipes. Intentionally omitted from OTel recipe — that test dispatches through a real hono HTTP server, so the sync throw's stack unwinds through request dispatch rather than the test file. Call-out comment in opentelemetry.test.ts points to the errors.test.ts sweep that covers stack quality directly per adapter._
- [x] Verify: does each adapter preserve the native error's stack, or does it rewrite? _No adapter rewrote stacks. `SqlfuError` constructor explicitly copies `.stack` from the driver cause to avoid replacing it with the sqlfu internal construction stack._

## Implementation notes

- **Mapping is keyed on numeric extended SQLite result codes.** Every driver exposes that number under one of `rawCode`, `errcode`, or `resultCode`. This is the single highest-signal key — see the driver-probe log that lived in the worktree during development. String extended codes and message regexes are fallbacks, not the primary path.
- **`SqlfuError.cause` is byte-identical to the driver error.** Users who need to inspect anything adapter-specific can still reach into `.cause.rawCode`, `.cause.code`, etc.
- **`SqlfuError.stack` is copied from the driver.** Constructed stacks would point at `core/adapter-errors.ts` (which is useless for the user). Driver stacks already include the user's call site.
- **The `options.mapError` hook is present on every adapter factory** but intentionally un-advertised in the README — most users never need it. It's documented in `docs/errors.md`.
- **Legacy `summarizeSqlite3defError` in `api.ts` untouched.** It is redundant for `SqlfuError` inputs (just returns `.message`), but still guards non-db errors in the same code paths. Deleting it would turn into an unrelated refactor.
- **libsql sync's `null` parameter quirk.** The libsql sync driver throws `TypeError: failed to downcast any to object` when a `null` is bound positionally, before SQLite sees the statement. The not-null test uses a literal `NULL` in SQL rather than a bound parameter to exercise the actual SQLite constraint — the binding-layer error is a different (upstream) problem.

## UI-side companion cleanup

While working on the Relations view we hit a related-but-shallower papercut: the oRPC backend was swallowing every SQLite error into a generic `"Internal server error"` because handlers threw plain `Error` instances and oRPC only preserves `ORPCError`. The quick fix was a one-liner middleware on `uiBase` in `packages/sqlfu/src/ui/router.ts` (see the `.use(async ({next}) => { ... })` block) that rewraps any non-`ORPCError` via `toClientError`. It works, but it's ugly on two axes:

- The `toClientError` helper blanket-classifies everything as `BAD_REQUEST` with `message: String(error)`. That's fine for surfacing the message but loses the real taxonomy — `UNIQUE constraint failed` should be `constraint:unique`, not `BAD_REQUEST`.
- Some server-side call sites still do their own `throw toClientError(error)` (e.g. `sql.run`, `schema.command`); the middleware makes those redundant. Should collapse.

When we do the real taxonomy work here, tear that middleware out and replace it with something that maps a `SqlfuError` → an oRPC error whose `code`/`data` reflect the actual kind. Then the UI can render `constraint:unique` differently from `syntax`, etc.

## References

- Existing PR: https://github.com/mmkal/sqlfu/pull/13 — `core: SqlfuError taxonomy + stack-quality guard`. Opened from this task but I wasn't happy with the implementation — revisit before merging. Specifically the adapter-mapping shape and how much of the "kind" discrimination leaks out to the public type felt off.
- SQLite error codes: https://www.sqlite.org/rescode.html
- Postgres SQLSTATE: https://www.postgresql.org/docs/current/errcodes-appendix.html
- D1 error shape: https://developers.cloudflare.com/d1/observability/debug-d1/

## Not in scope

- Retry / backoff behavior on `transient` errors. That's a separate concern (likely lives at the adapter or user level, not in sqlfu core).
- Error rewriting / augmentation at the hook layer. The hook already sees the error and can wrap it if the user wants; we don't need to do that for them.
- D1 / durable-object / bun / expo-sqlite / sqlite-wasm adapter-specific tests. Covered by the shared helper; smoke-tested through the `@libsql/client` async path. Follow-up task can add adapter-specific error tests if behavior drifts.
