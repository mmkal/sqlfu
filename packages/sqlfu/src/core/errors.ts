import type {SqlQuery} from './types.js';

/**
 * Discriminated categories for database errors, normalized across adapters.
 * Handlers can branch on `error.kind` instead of string-matching messages.
 */
export type SqlfuErrorKind =
  | 'syntax'
  | 'missing_relation'
  | 'missing_column'
  | 'constraint:unique'
  | 'constraint:primary_key'
  | 'constraint:foreign_key'
  | 'constraint:not_null'
  | 'constraint:check'
  | 'transient'
  | 'auth'
  | 'unknown';

export interface SqlfuErrorContext {
  query: SqlQuery;
  system: string;
}

/**
 * Typed error raised by every sqlfu adapter. `kind` is the categorized
 * discriminator; `cause` is the untouched driver error for when users need
 * to inspect anything adapter-specific. `query` and `system` are attached
 * so error reporters don't need to plumb a parallel context object.
 *
 * The stack is set to the driver error's stack with a one-line sqlfu
 * header prepended — driver stacks already include the user's call site,
 * and rewriting them would hide where the query was actually issued.
 */
export class SqlfuError extends Error {
  kind: SqlfuErrorKind;
  query: SqlQuery;
  system: string;
  cause: unknown;

  constructor(params: {kind: SqlfuErrorKind; query: SqlQuery; system: string; cause: unknown}) {
    const driverMessage = extractMessage(params.cause);
    super(driverMessage);
    this.name = 'SqlfuError';
    this.kind = params.kind;
    this.query = params.query;
    this.system = params.system;
    this.cause = params.cause;

    const driverStack = extractStack(params.cause);
    if (driverStack) {
      this.stack = driverStack;
    }
  }
}

/**
 * User-supplied override. Return a `SqlfuError` to replace the adapter's
 * default mapping, or `null` to fall back to the default.
 */
export type MapError = (error: unknown, context: SqlfuErrorContext) => SqlfuError | null;

/**
 * Normalize any sqlite driver error onto a `SqlfuError`. If `error` is
 * already a `SqlfuError` it is returned untouched (covers the case where
 * an inner adapter call has already mapped the error).
 */
export function mapSqliteDriverError(error: unknown, context: SqlfuErrorContext, override?: MapError): SqlfuError {
  if (error instanceof SqlfuError) {
    return error;
  }

  if (override) {
    const result = override(error, context);
    if (result) {
      return result;
    }
  }

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

  const message = extractMessage(error);
  return kindFromMessage(message);
}

// SQLite extended result codes: https://www.sqlite.org/rescode.html
function kindFromNumericCode(code: number): SqlfuErrorKind | null {
  switch (code) {
    case 1555: // SQLITE_CONSTRAINT_PRIMARYKEY
      return 'constraint:primary_key';
    case 2067: // SQLITE_CONSTRAINT_UNIQUE
      return 'constraint:unique';
    case 1299: // SQLITE_CONSTRAINT_NOTNULL
      return 'constraint:not_null';
    case 787: // SQLITE_CONSTRAINT_FOREIGNKEY
      return 'constraint:foreign_key';
    case 275: // SQLITE_CONSTRAINT_CHECK
      return 'constraint:check';
    case 5: // SQLITE_BUSY
    case 261: // SQLITE_BUSY_RECOVERY
    case 517: // SQLITE_BUSY_SNAPSHOT
    case 773: // SQLITE_BUSY_TIMEOUT
    case 6: // SQLITE_LOCKED
    case 262: // SQLITE_LOCKED_SHAREDCACHE
    case 518: // SQLITE_LOCKED_VTAB
      return 'transient';
    case 23: // SQLITE_AUTH
    case 279: // SQLITE_AUTH_USER
      return 'auth';
  }

  // Non-extended constraint (base = 19). Defer to the message in that case.
  if (code === 19) {
    return null;
  }

  return null;
}

function kindFromExtendedCodeString(code: string): SqlfuErrorKind | null {
  // Match on the extended code part first, because `SQLITE_CONSTRAINT` alone
  // is ambiguous — libsql's top-level `code` is just the base category.
  if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return 'constraint:primary_key';
  if (code === 'SQLITE_CONSTRAINT_UNIQUE') return 'constraint:unique';
  if (code === 'SQLITE_CONSTRAINT_NOTNULL') return 'constraint:not_null';
  if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') return 'constraint:foreign_key';
  if (code === 'SQLITE_CONSTRAINT_CHECK') return 'constraint:check';
  if (code === 'SQLITE_BUSY' || code.startsWith('SQLITE_BUSY_')) return 'transient';
  if (code === 'SQLITE_LOCKED' || code.startsWith('SQLITE_LOCKED_')) return 'transient';
  if (code === 'SQLITE_AUTH' || code.startsWith('SQLITE_AUTH_')) return 'auth';
  return null;
}

function kindFromMessage(message: string): SqlfuErrorKind {
  const lower = message.toLowerCase();
  if (lower.includes('no such table')) return 'missing_relation';
  if (lower.includes('no such column')) return 'missing_column';
  if (lower.includes('syntax error')) return 'syntax';
  if (lower.includes('unique constraint failed')) return 'constraint:unique';
  if (lower.includes('not null constraint failed')) return 'constraint:not_null';
  if (lower.includes('foreign key constraint failed')) return 'constraint:foreign_key';
  if (lower.includes('check constraint failed')) return 'constraint:check';
  if (lower.includes('database is locked') || lower.includes('busy')) return 'transient';
  return 'unknown';
}

function extractNumericCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const bag = error as Record<string, unknown>;
  // Drivers expose the numeric extended SQLite result code under different keys:
  //   - node:sqlite → errcode
  //   - libsql + @libsql/client → rawCode
  //   - sqlite-wasm → resultCode
  //   - durable-object runtime (Cloudflare Workers) → rawCode in recent versions
  for (const key of ['rawCode', 'errcode', 'resultCode']) {
    const value = bag[key];
    if (typeof value === 'number') return value;
  }
  // Some drivers nest the extended code on `cause` (libsql-client wraps a
  // better-sqlite3-style SqliteError). Walk one level.
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
  // better-sqlite3 + libsql put the extended code string in `code`.
  // @libsql/client puts the *base* code in `code` and the *extended* code
  // in `cause.code`. Prefer the one that actually carries extended info.
  const direct = typeof bag.code === 'string' ? (bag.code as string) : null;
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
  if (error instanceof Error && typeof error.stack === 'string') {
    return error.stack;
  }
  return undefined;
}
