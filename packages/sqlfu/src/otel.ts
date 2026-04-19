import type {QueryExecutionHook} from './core/instrument.js';
import {spanNameFor} from './core/naming.js';

/**
 * Minimal OTel tracer shape. Authored structurally so consumers can pass a
 * real `Tracer` from `@opentelemetry/api` without sqlfu taking a peer dep.
 */
export interface TracerLike {
  startActiveSpan<TResult>(name: string, fn: (span: SpanLike) => TResult): TResult;
}

export interface SpanLike {
  setAttribute(key: string, value: string | number | boolean): unknown;
  recordException(exception: unknown): void;
  setStatus(status: {code: number; message?: string}): unknown;
  end(): void;
}

/**
 * Reference OTel hook. Emits a span per query with `db.query.summary`,
 * `db.query.text`, `db.system.name`; records exceptions and sets ERROR
 * status on throw.
 *
 * This is a deliberately small and readable reference implementation. If
 * your team has different conventions (different attribute names, extra
 * resource attributes, custom span kind, sampling hints, etc.), copy this
 * function body into your codebase and edit it — that's expected and fine.
 * `QueryExecutionHook` is a stable contract; `createOtelHook` is one way
 * to satisfy it, not the only way.
 */
export function createOtelHook(options: {readonly tracer: TracerLike}): QueryExecutionHook {
  // OTel's SpanStatusCode: UNSET = 0, OK = 1, ERROR = 2. Inlined so the
  // library doesn't need to import from @opentelemetry/api.
  const OTEL_STATUS_OK = 1;
  const OTEL_STATUS_ERROR = 2;

  const {tracer} = options;
  return ({context, execute, processResult}) => {
    const name = spanNameFor(context.query);
    return tracer.startActiveSpan(name, (span) => {
      if (context.query.name) {
        span.setAttribute('db.query.summary', context.query.name);
      }
      span.setAttribute('db.query.text', context.query.sql);
      span.setAttribute('db.system.name', context.system);

      return processResult(
        execute,
        (value) => {
          span.setStatus({code: OTEL_STATUS_OK});
          span.end();
          return value;
        },
        (error) => {
          span.recordException(error);
          span.setStatus({code: OTEL_STATUS_ERROR, message: error instanceof Error ? error.message : String(error)});
          span.end();
          throw error;
        },
      );
    });
  };
}
