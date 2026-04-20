/*
 * Support utilities for sqlfu's vendored tree.
 *
 * `Either`, `Result`, `Ok`, `Err`, and `ResultAsync` here are minimal, sqlfu-local
 * reimplementations of the subset of [`neverthrow`](https://github.com/supermacro/neverthrow)
 * (MIT) that the vendored TypeSQL code actually uses. They exist so the vendored
 * `src/vendor/typesql` tree can keep its upstream control-flow shape without pulling
 * neverthrow in as a runtime dependency.
 *
 * Everything else here (`uniqBy`, `camelCase`, `glob`, ISO literal checks,
 * `unsupportedDependency`) is sqlfu-original support code for the vendored tree.
 */
export type Either<L, R> = {readonly _tag: 'Left'; readonly left: L} | {readonly _tag: 'Right'; readonly right: R};

export function left<L, R = never>(value: L): Either<L, R> {
  return {_tag: 'Left', left: value};
}

export function right<R, L = never>(value: R): Either<L, R> {
  return {_tag: 'Right', right: value};
}

export function isLeft<L, R>(value: Either<L, R>): value is {readonly _tag: 'Left'; readonly left: L} {
  return value._tag === 'Left';
}

export function isRight<L, R>(value: Either<L, R>): value is {readonly _tag: 'Right'; readonly right: R} {
  return value._tag === 'Right';
}

export class Ok<T, E> {
  constructor(readonly value: T) {}

  isErr(): this is Err<T, E> {
    return false;
  }

  isOk(): this is Ok<T, E> {
    return true;
  }
}

export class Err<T, E> {
  constructor(readonly error: E) {}

  isErr(): this is Err<T, E> {
    return true;
  }

  isOk(): this is Ok<T, E> {
    return false;
  }
}

export type Result<T, E> = Ok<T, E> | Err<T, E>;

export function ok<T, E = never>(value: T): Result<T, E> {
  return new Ok<T, E>(value);
}

export function err<E, T = never>(error: E): Result<T, E> {
  return new Err<T, E>(error);
}

export function okAsync<T, E = never>(value: T): Promise<Result<T, E>> {
  return Promise.resolve(ok<T, E>(value));
}

export class ResultAsync<T, E> {
  constructor(readonly promise: Promise<Result<T, E>>) {}

  static fromThrowable<T, E>(
    fn: (...args: any[]) => Promise<T> | T,
    mapError: (error: unknown) => E,
  ): (...args: any[]) => ResultAsync<T, E> {
    return (...args: any[]) =>
      new ResultAsync(
        Promise.resolve()
          .then(() => fn(...args))
          .then((value) => ok<T, E>(value))
          .catch((error) => err<E, T>(mapError(error))),
      );
  }

  map<U>(fn: (value: T) => U): ResultAsync<U, E> {
    return new ResultAsync(
      this.promise.then((result) => (result.isErr() ? err<E, U>(result.error) : ok<U, E>(fn(result.value)))),
    );
  }

  asyncAndThen<U>(fn: (value: T) => Promise<Result<U, E>> | Result<U, E>): ResultAsync<U, E> {
    return new ResultAsync(
      this.promise.then((result) => (result.isErr() ? err<E, U>(result.error) : fn(result.value))),
    );
  }
}

export function uniqBy<T>(values: Iterable<T>, keyFn: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
}

export function camelCase(value: string): string {
  const parts = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());

  if (parts.length === 0) {
    return '';
  }

  return parts[0] + parts.slice(1).map((part) => part[0]!.toUpperCase() + part.slice(1)).join('');
}

export async function glob(pattern: string, options?: {cwd?: string}): Promise<string[]> {
  // Deferred so the vendored tree can be bundled for browsers that have no
  // node:fs/promises — browser callers (demo mode) never invoke glob().
  const {glob: fsGlob} = await import('node:fs/promises');
  const matches: string[] = [];
  for await (const match of fsGlob(pattern, options?.cwd ? {cwd: options?.cwd} : {})) {
    matches.push(String(match));
  }

  return matches;
}

export function isIsoDateLiteral(literal: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(literal)) {
    return false;
  }

  const date = new Date(`${literal}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === literal;
}

export function isIsoDateTimeLiteral(literal: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(literal)) {
    return false;
  }

  const date = new Date(literal.replace(' ', 'T') + 'Z');
  return Number.isFinite(date.getTime()) && date.toISOString().replace('T', ' ').slice(0, 19) === literal;
}

export function isIsoTimeLiteral(literal: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(literal);
}

export function unsupportedDependency(message: string): never {
  throw new Error(message);
}
