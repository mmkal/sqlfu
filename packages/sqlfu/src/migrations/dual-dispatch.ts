// A tiny dual-dispatch helper in the spirit of `quansync`
// (https://github.com/quansync-dev/quansync). Lets us write the migrations
// logic once as a generator function; each `yield` of a value awaits it in
// async mode and passes it through unchanged in sync mode. Callers that need
// to branch on mode (to wire up a nested callback like
// `client.transaction(cb)`, where `cb` itself is sync for sync clients and
// async for async clients) can read `client.sync` directly — no sentinel
// needed inside the generator.
//
// Why not a dependency on `quansync`? The whole utility is ~30 lines and we
// only need it in one call site. A fresh runtime dep for that is too much.

export type DualGenerator<TReturn> = Generator<unknown, TReturn, unknown>;

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as {then?: unknown} | null)?.then === 'function';
}

export function driveSync<TReturn>(generator: DualGenerator<TReturn>): TReturn {
  let current = generator.next();
  while (!current.done) {
    if (isThenable(current.value)) {
      throw new Error('sqlfu: unexpected promise in sync migration context');
    }
    try {
      current = generator.next(current.value);
    } catch (error) {
      current = generator.throw(error);
    }
  }
  return current.value;
}

export async function driveAsync<TReturn>(generator: DualGenerator<TReturn>): Promise<TReturn> {
  let current = generator.next();
  while (!current.done) {
    let resumed: unknown;
    try {
      resumed = await current.value;
    } catch (error) {
      current = generator.throw(error);
      continue;
    }
    current = generator.next(resumed);
  }
  return current.value;
}
