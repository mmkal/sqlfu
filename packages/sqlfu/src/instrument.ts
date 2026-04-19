import {
  composeHooks,
  createErrorReporterHook,
  instrumentClient,
  type QueryExecutionHook,
} from './core/instrument.js';
import type {Client} from './core/types.js';
import {createOtelHook} from './otel.js';

interface InstrumentFn {
  <TClient extends Client>(
    client: TClient,
    ...hooks: readonly QueryExecutionHook[]
  ): TClient;
  readonly otel: typeof createOtelHook;
  readonly onError: typeof createErrorReporterHook;
}

const instrumentImpl = <TClient extends Client>(
  client: TClient,
  ...hooks: readonly QueryExecutionHook[]
): TClient => instrumentClient(client, composeHooks(...hooks));

/**
 * Wrap a Client with one or more query-execution hooks. Hooks run
 * left-to-right — the first one is the outermost, seeing the call first
 * and the result/error last.
 *
 * ```ts
 * const client = instrument(baseClient,
 *   instrument.otel({tracer}),
 *   instrument.onError(({context, error}) => Sentry.captureException(error)),
 * )
 * ```
 *
 * `instrument.otel` and `instrument.onError` are small reference
 * implementations. If your team has different conventions (different
 * attribute names, extra resource attributes, rate limiting, redaction)
 * copy their bodies and edit them. The stable contract is
 * `QueryExecutionHook`; these helpers are just one way to satisfy it.
 */
export const instrument: InstrumentFn = Object.assign(instrumentImpl, {
  otel: createOtelHook,
  onError: createErrorReporterHook,
});
