# Errors

In sqlfu, you handle database errors by *kind*, not by string-matching the message.

Every error from a sqlfu adapter is a `SqlfuError` with a `.kind` discriminator that has been normalized across adapters. The driver's original error lives on `.cause`, untouched, for when you need to inspect anything adapter-specific.

## The mental model

The code that cares about a database error rarely cares *which* driver threw it. "That email is already in use" is a product outcome — it should become a 409 response, or a red-squiggle in the UI — and the surrounding code shouldn't need to know that better-sqlite3 reports `SQLITE_CONSTRAINT_UNIQUE`, `node:sqlite` reports `errcode: 2067`, and `@libsql/client` wraps both behind a `LibsqlError`.

`SqlfuError.kind` closes that gap. You branch on the discriminator; sqlfu does the per-adapter mapping.

## The kinds

```ts
type SqlfuErrorKind =
  | 'syntax'                  // malformed SQL
  | 'missing_table'           // SQLite "no such table"
  | 'missing_column'          // SQLite "no such column"
  | 'unique_violation'        // unique *or* primary-key constraint
  | 'not_null_violation'
  | 'foreign_key_violation'
  | 'check_violation'
  | 'transient'               // SQLITE_BUSY / SQLITE_LOCKED families
  | 'unknown'                 // mapper didn't recognize; inspect `.cause`
```

Names are SQLSTATE-aligned (matching the [PostgreSQL error codes](https://www.postgresql.org/docs/current/errcodes-appendix.html) convention) so that when a postgres adapter lands, mapping from `SQLSTATE` becomes a direct lookup rather than a second vocabulary. `missing_table` / `missing_column` are the two deliberate deviations — SQLSTATE's `undefined_table` / `undefined_column` collide with TypeScript's `undefined` at reading time.

Primary-key violations collapse into `unique_violation`. From a product perspective both are "that row already exists"; code that needs to distinguish them can still read `.cause.code`.

## Shape

```ts
class SqlfuError extends Error {
  kind: SqlfuErrorKind;
  query: SqlQuery;    // the query that failed — includes `.name` if named
  system: string;     // 'sqlite' (OTel db.system value)
  cause: unknown;     // the original driver error, byte-identical
}
```

- `.message` comes straight from the driver, so `console.error` and Sentry breadcrumbs still show the signal text (`"UNIQUE constraint failed: users.email"`).
- `.stack` is preserved from the driver error — your call-site frame is the first useful frame, so stack traces point at where the query was actually issued rather than at sqlfu internals.
- `.query` stays nested as a `SqlQuery` (rather than flattened to `.sql`/`.args`) so handlers can still reach `error.query.name` for tagging, and so `error.query` can be passed as-is into logs or follow-up calls.

## Handling errors in application code

```ts
import {SqlfuError} from 'sqlfu';

try {
  await client.run(createUser);
} catch (error) {
  if (error instanceof SqlfuError && error.kind === 'unique_violation') {
    return response.status(409).json({error: 'email already taken'});
  }
  throw error;
}
```

## Handling errors in a hook

Because `.query` and `.system` are on the error itself, a plain error-reporter hook doesn't need a parallel context object:

```ts
import {instrument, SqlfuError} from 'sqlfu';

const client = instrument(
  baseClient,
  instrument.onError(({error}) => {
    if (error instanceof SqlfuError) {
      Sentry.captureException(error, {
        tags: {
          'db.error.kind': error.kind,
          'db.query.summary': error.query.name || 'sql',
          'db.system': error.system,
        },
      });
    }
  }),
);
```

`kind` is a natural low-cardinality dimension for Sentry / PostHog / DataDog — high enough to tell a constraint violation from a transient lock, low enough not to explode your tag index.

## Working with `.cause`

`.cause` holds the driver's original error verbatim. Useful for the long tail: adapter-specific flags, nested wrapping, or debugging a `kind: 'unknown'`.

```ts
catch (error) {
  if (error instanceof SqlfuError && error.kind === 'unknown') {
    console.error('unrecognized DB error — please file an issue', error.cause);
  }
}
```

If you see `kind: 'unknown'` in production, the right response is to file a bug with the driver + message — the mapper is library-owned, not per-user-configurable.

## Why not rethrow the driver error?

1. **Branching on `.kind` is stable across adapters.** `error.code === 'SQLITE_CONSTRAINT_UNIQUE'` works for better-sqlite3, silently breaks when you switch to `@libsql/client` (which reports the extended code on `.cause.code`), and breaks again for `node:sqlite` (which uses a numeric `errcode`). `error.kind === 'unique_violation'` works everywhere.
2. **`.query` and `.system` let a plain `catch` do its job.** Error reporters are the main consumer of typed errors; they need the context, and carrying it on the error itself means no `QueryExecutionContext` plumbing.

## References

- [SQLite result codes](https://www.sqlite.org/rescode.html)
- [PostgreSQL SQLSTATE codes](https://www.postgresql.org/docs/current/errcodes-appendix.html) (for context on the naming convention)
- [observability.md](./observability.md) — how `onError` composes with OpenTelemetry, Sentry, PostHog
