import semver from 'semver';

export type StartupFailureKind = 'unreachable' | 'client-error' | 'server-error' | 'version-mismatch';

export type StartupFailure =
  | {
      kind: 'unreachable' | 'client-error' | 'server-error';
      message: string;
      status: number | null;
    }
  | {
      kind: 'version-mismatch';
      message: string;
      status: null;
      serverVersion: string | null;
      supportedRange: string;
    };

/**
 * Semver range describing which sqlfu server versions speak today's oRPC
 * contract. Tighten whenever the hosted client relies on a new/changed RPC
 * field, query param, or event shape. The hosted client on sqlfu.dev/ui is
 * always the tip of main; a user's local `npx sqlfu` is whatever they happened
 * to install. When the local server falls outside this range, we show an
 * upgrade screen instead of letting the mismatch surface as a cryptic 4xx.
 */
export const SUPPORTED_SERVER_RANGE = '>=0.0.2-3';

/**
 * Error type thrown from the bootstrap path when the local server is too old
 * for this hosted client. Caught by the `StartupErrorBoundary` and turned
 * into a `version-mismatch` startup failure.
 */
export class ServerVersionMismatchError extends Error {
  readonly serverVersion: string | null;
  readonly supportedRange: string;

  constructor(input: {serverVersion: string | null; supportedRange: string}) {
    const shown = input.serverVersion ?? 'unknown';
    super(`Local sqlfu server is running v${shown}; this UI requires a version satisfying ${input.supportedRange}.`);
    this.name = 'ServerVersionMismatchError';
    this.serverVersion = input.serverVersion;
    this.supportedRange = input.supportedRange;
  }
}

export function classifyStartupError(error: unknown): StartupFailure {
  if (error instanceof ServerVersionMismatchError) {
    return {
      kind: 'version-mismatch',
      message: error.message,
      status: null,
      serverVersion: error.serverVersion,
      supportedRange: error.supportedRange,
    };
  }

  const status = readStatus(error);
  const message = error instanceof Error ? error.message : String(error);

  if (status && status >= 500) {
    return {
      kind: 'server-error',
      message,
      status,
    };
  }

  if (status && status >= 400) {
    return {
      kind: 'client-error',
      message,
      status,
    };
  }

  return {
    kind: 'unreachable',
    message,
    status: null,
  };
}

/**
 * Returns the error the caller should throw, or `null` if the server is
 * compatible. `serverVersion` may be `undefined` for old servers that pre-date
 * the `project.status.serverVersion` field — treated as "definitely too old".
 *
 * `includePrerelease: true` is required because sqlfu ships prerelease-heavy
 * versions (`0.0.2-3`); without it, `semver.satisfies` would reject any
 * prerelease that shares a MAJOR.MINOR.PATCH not explicitly named in the range.
 */
export function checkServerVersion(input: {serverVersion: string | undefined}): ServerVersionMismatchError | null {
  if (!input.serverVersion) {
    return new ServerVersionMismatchError({
      serverVersion: null,
      supportedRange: SUPPORTED_SERVER_RANGE,
    });
  }

  if (!semver.satisfies(input.serverVersion, SUPPORTED_SERVER_RANGE, {includePrerelease: true})) {
    return new ServerVersionMismatchError({
      serverVersion: input.serverVersion,
      supportedRange: SUPPORTED_SERVER_RANGE,
    });
  }

  return null;
}

function readStatus(error: unknown): number | null {
  const candidates = [
    readNumber(error, ['status']),
    readNumber(error, ['response', 'status']),
    readNumber(error, ['cause', 'status']),
    readNumber(error, ['data', 'status']),
    readNumber(error, ['json', 'status']),
  ];

  return candidates.find((value) => value !== null) || null;
}

function readNumber(value: unknown, path: string[]): number | null {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== 'object' || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === 'number' ? current : null;
}
