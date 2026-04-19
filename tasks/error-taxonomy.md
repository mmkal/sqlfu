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

- [ ] Add `SqlfuError` + `SqlfuErrorKind` + `mapSqliteDriverError` in `core/errors.ts`.
- [ ] Export `SqlfuError` and `SqlfuErrorKind` from `sqlfu/client`.
- [ ] Wire every sqlite adapter through the mapper.
- [ ] `mapError` override hook on every adapter factory.
- [ ] Integration tests in `test/errors.test.ts` covering: `syntax`, `missing_relation`, `constraint:unique`, `constraint:foreign_key`, `constraint:not_null`, `constraint:check`. Adapters: better-sqlite3, node:sqlite, libsql, @libsql/client (async).
- [ ] Stack-quality assertion: `error.stack` contains the test file name, for every adapter in the error-taxonomy test.
- [ ] Delete `summarizeSqlite3defError` if `SqlfuError.message` is now human-readable on its own.
- [ ] Docs: `packages/sqlfu/docs/errors.md` — phrased in product terms ("handle DB errors by kind").
- [ ] One-paragraph link from `packages/sqlfu/README.md` (under Capabilities).
- [ ] `pnpm --filter sqlfu test` + `pnpm --filter sqlfu typecheck` green.

## Included in this task (per same discussion)

- [ ] Call-stack quality check. Add an assertion in the OTel / Sentry / PostHog recipe tests that `error.stack` contains the test file name (proves the instrumentation layer isn't clobbering the user's stack). Cheap guard against accidentally wrapping errors in the future.
- [ ] Verify: does each adapter preserve the native error's stack, or does it rewrite? If any adapter rewrites, investigate and fix.

## References

- SQLite error codes: https://www.sqlite.org/rescode.html
- Postgres SQLSTATE: https://www.postgresql.org/docs/current/errcodes-appendix.html
- D1 error shape: https://developers.cloudflare.com/d1/observability/debug-d1/

## Not in scope

- Retry / backoff behavior on `transient` errors. That's a separate concern (likely lives at the adapter or user level, not in sqlfu core).
- Error rewriting / augmentation at the hook layer. The hook already sees the error and can wrap it if the user wants; we don't need to do that for them.
- D1 / durable-object / bun / expo-sqlite / sqlite-wasm adapter-specific tests. Covered by the shared helper; smoke-tested through the `@libsql/client` async path. Follow-up task can add adapter-specific error tests if behavior drifts.
