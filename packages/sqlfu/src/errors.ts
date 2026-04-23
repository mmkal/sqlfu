import type {SqlQuery} from './types.js';

/**
 * Normalized category for a database error. `kind` is what application code
 * branches on (`error.kind === 'unique_violation'`) instead of string-matching
 * driver messages. Names are SQLSTATE-aligned so that when a postgres adapter
 * lands the mapping is a direct lookup rather than a second vocabulary.
 *
 * `'unknown'` is the explicit "we couldn't classify this" signal — users who
 * see it in production should file a bug; the mapper is library-maintained,
 * not user-overridable.
 */
export type SqlfuErrorKind =
  | 'syntax'
  | 'missing_table'
  | 'missing_column'
  | 'unique_violation'
  | 'not_null_violation'
  | 'foreign_key_violation'
  | 'check_violation'
  | 'transient'
  | 'unknown';

export interface SqlfuErrorContext {
  query: SqlQuery;
  system: string;
}

/**
 * Every sqlfu adapter throws this. `kind` is the normalized discriminator;
 * `cause` preserves the driver's original error byte-identical so users who
 * need adapter-specific fields (`rawCode`, `errcode`, `resultCode`, etc.)
 * still have a path. `query` and `system` are on the error itself so a
 * plain `catch` block can tag a query name or system without restructuring
 * around the hook API.
 *
 * `message` and `stack` come from the driver error verbatim — the user's
 * call-site frame is the first useful frame, and sqlfu internals would be
 * noise in production stacks.
 */
export class SqlfuError extends Error {
  kind: SqlfuErrorKind;
  query: SqlQuery;
  system: string;
  cause: unknown;

  constructor(params: {kind: SqlfuErrorKind; query: SqlQuery; system: string; cause: unknown}) {
    super(extractMessage(params.cause));
    this.name = 'SqlfuError';
    this.kind = params.kind;
    this.query = params.query;
    this.system = params.system;
    this.cause = params.cause;

    const driverStack = extractStack(params.cause);
    if (driverStack) this.stack = driverStack;
  }
}

/** Normalize a sqlite driver error onto `SqlfuError`. Idempotent. */
export function mapSqliteDriverError(error: unknown, context: SqlfuErrorContext): SqlfuError {
  if (error instanceof SqlfuError) return error;
  return new SqlfuError({
    kind: classifySqliteError(error),
    query: context.query,
    system: context.system,
    cause: error,
  });
}

function classifySqliteError(error: unknown): SqlfuErrorKind {
  const numericCode = extractNumericCode(error);
  if (numericCode != null) {
    const kind = kindFromNumericCode(numericCode);
    if (kind) return kind;
  }

  const extendedString = extractExtendedCodeString(error);
  if (extendedString) {
    const kind = kindFromExtendedCodeString(extendedString);
    if (kind) return kind;
  }

  // Message-substring fallback. Motivated by adapters that surface errors as
  // plain `Error` objects with no structured code (D1, expo-sqlite, and any
  // future driver whose transport strips the numeric code). SQLite's message
  // strings come from the C library itself, so drift risk is low; the
  // per-adapter integration sweep in test/errors.test.ts catches any that do.
  return kindFromMessage(extractMessage(error));
}

// SQLite extended result codes. https://www.sqlite.org/rescode.html
function kindFromNumericCode(code: number): SqlfuErrorKind | null {
  switch (code) {
    // Constraint kinds. primary_key collapses into unique_violation —
    // from a product POV both are "that row already exists".
    case 1555: // SQLITE_CONSTRAINT_PRIMARYKEY
    case 2067: // SQLITE_CONSTRAINT_UNIQUE
      return 'unique_violation';
    case 1299: // SQLITE_CONSTRAINT_NOTNULL
      return 'not_null_violation';
    case 787: // SQLITE_CONSTRAINT_FOREIGNKEY
      return 'foreign_key_violation';
    case 275: // SQLITE_CONSTRAINT_CHECK
      return 'check_violation';

    // Transient kinds (BUSY/LOCKED families).
    case 5: // SQLITE_BUSY
    case 261: // SQLITE_BUSY_RECOVERY
    case 517: // SQLITE_BUSY_SNAPSHOT
    case 773: // SQLITE_BUSY_TIMEOUT
    case 6: // SQLITE_LOCKED
    case 262: // SQLITE_LOCKED_SHAREDCACHE
    case 518: // SQLITE_LOCKED_VTAB
      return 'transient';
  }

  // Base constraint code (19) is ambiguous — defer to extended string / message.
  return null;
}

function kindFromExtendedCodeString(code: string): SqlfuErrorKind | null {
  if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE') return 'unique_violation';
  if (code === 'SQLITE_CONSTRAINT_NOTNULL') return 'not_null_violation';
  if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return 'foreign_key_violation';
  if (code === 'SQLITE_CONSTRAINT_CHECK') return 'check_violation';
  if (code === 'SQLITE_BUSY' || code.startsWith('SQLITE_BUSY_')) return 'transient';
  if (code === 'SQLITE_LOCKED' || code.startsWith('SQLITE_LOCKED_')) return 'transient';
  return null;
}

function kindFromMessage(message: string): SqlfuErrorKind {
  const lower = message.toLowerCase();
  if (lower.includes('no such table')) return 'missing_table';
  if (lower.includes('no such column')) return 'missing_column';
  if (lower.includes('syntax error')) return 'syntax';
  if (lower.includes('unique constraint failed')) return 'unique_violation';
  if (lower.includes('not null constraint failed')) return 'not_null_violation';
  if (lower.includes('foreign key constraint failed')) return 'foreign_key_violation';
  if (lower.includes('check constraint failed')) return 'check_violation';
  if (lower.includes('database is locked') || lower.includes('busy')) return 'transient';
  return 'unknown';
}

function extractNumericCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const bag = error as Record<string, unknown>;
  // Different drivers expose the numeric extended result code under different keys.
  //   node:sqlite         → errcode
  //   libsql, @libsql/client, durable-object → rawCode
  //   sqlite-wasm         → resultCode
  for (const key of ['rawCode', 'errcode', 'resultCode']) {
    const value = bag[key];
    if (typeof value === 'number') return value;
  }
  // @libsql/client's LibsqlError wraps a better-sqlite3-style SqliteError on `cause`.
  const cause = bag.cause;
  if (cause && typeof cause === 'object') {
    for (const key of ['rawCode', 'errcode', 'resultCode']) {
      const value = (cause as Record<string, unknown>)[key];
      if (typeof value === 'number') return value;
    }
  }
  return null;
}

function extractExtendedCodeString(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const bag = error as Record<string, unknown>;
  // better-sqlite3 / libsql put the extended code string on `.code`.
  // @libsql/client's top-level `.code` is the *base* category; the extended
  // string lives on `.cause.code`. Prefer the nested one when present.
  const direct = typeof bag.code === 'string' ? bag.code : null;
  const cause = bag.cause;
  const nested =
    cause && typeof cause === 'object' && typeof (cause as Record<string, unknown>).code === 'string'
      ? ((cause as Record<string, unknown>).code as string)
      : null;
  return nested || direct;
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

function extractStack(error: unknown): string | undefined {
  if (error instanceof Error && typeof error.stack === 'string') return error.stack;
  return undefined;
}
