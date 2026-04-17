export type StartupFailureKind = 'unreachable' | 'client-error' | 'server-error';

export type StartupFailure = {
  kind: StartupFailureKind;
  message: string;
  status: number | null;
};

export function classifyStartupError(error: unknown): StartupFailure {
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
