status: not-started
size: medium

# Error taxonomy and call-stack quality

Split out from `named-and-loved-queries` so that PR could ship instrumentation plumbing without waiting on this design.

## Goal

Let users handle errors by *kind* instead of by string-matching the error message.

Motivating cases:

- `seleeeeect * from foo` — syntax error
- `select * from wrongtable` — missing relation (`no such table: wrongtable`)
- Constraint violation (unique, foreign key, not-null)
- Transient / connection errors (sqlite BUSY, pg connection loss)
- Auth / permission errors (pg `insufficient_privilege`)

Right now the error the hook receives is whatever the underlying driver threw. Users can string-match the message, but that's fragile and adapter-specific.

## What the library would need to add

- A shared error shape: `SqlfuError extends Error` with a `kind: SqlfuErrorKind` discriminator and the original `cause` preserved. Something like:
  ```ts
  type SqlfuErrorKind =
    | 'syntax'
    | 'missing_relation'
    | 'missing_column'
    | 'constraint:unique'
    | 'constraint:foreign_key'
    | 'constraint:not_null'
    | 'constraint:check'
    | 'transient'
    | 'auth'
    | 'unknown';
  ```
- Per-adapter mapping. Each adapter's error → shared kind:
  - SQLite (node-sqlite, better-sqlite3, bun): error `code` is usually `SQLITE_ERROR`/`SQLITE_CONSTRAINT` etc.; the sub-code or message discriminates (`no such table`, `UNIQUE constraint failed`).
  - Postgres (if/when added): SQLSTATE 5-char code — this is the cleanest of the three, built for exactly this.
  - D1 / durable-object: pass-through from underlying sqlite in most cases.
  - Libsql: sqlite-shaped.
- Adapter hook so users can extend or override the mapping for their setup.

Open questions:

- Is `missing_relation` really a taxonomic category or a subtype of `syntax` (since the SQL doesn't resolve)? Postgres separates them; SQLite doesn't.
- Do we surface `cause.code` passthrough, or normalize? Probably both — normalize `kind`, preserve original `cause` untouched.
- Do we want a `SqlfuError.query` field pointing back at the `SqlQuery` that caused it, so error reporters don't need the `QueryExecutionContext` separately?

## Scope decisions for reference

Agreed during the `named-and-loved-queries` PR to defer because:

1. Adapter-specific — touches every `createXClient` function, not just instrumentation.
2. Design-heavy — the category set is opinionated; worth discussing before coding.
3. Orthogonal to naming — naming ships without this; this ships later without breaking naming.

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
