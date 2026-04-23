/**
 * sqlfu/outbox — a small transactional-outbox / job-queue built on any sqlfu
 * `Client` (sync or async; `tick()` is async regardless, since handlers are).
 *
 * SQLite serialises writers for us, so claim-and-lease works as a plain
 * `BEGIN; select pending; update to running; commit` — no row-locking dance
 * needed.
 *
 * Zero Node-only dependencies: causation propagation is explicit (the handler
 * receives an `emit` helper already bound to its own job context) rather than
 * via `AsyncLocalStorage`, which keeps this module runnable in browsers, edge
 * workers, and anywhere else sqlfu already runs.
 */

import type {Client} from '../types.js';

export type TimeUnit = 's' | 'm' | 'h' | 'd';
export type TimePeriod = `${number}${TimeUnit}`;

export type JobContext = {
  jobId: number;
  eventId: number;
  attempt: number;
  consumerName: string;
};

export type Causation = {
  eventId: number;
  consumerName: string;
  jobId: number;
};

export type WhenFn<TPayload> = (input: {payload: TPayload}) => boolean | null | undefined | '';
export type DelayFn<TPayload> = (input: {payload: TPayload}) => TimePeriod;

export type RetryOutcome =
  | {retry: false; reason: string; delay?: never}
  | {retry: true; reason: string; delay: TimePeriod};

export type RetryFn = (job: JobContext, error: unknown) => RetryOutcome;

export type EmitInput<TEvents extends EventMap, K extends keyof TEvents> = {
  name: K;
  payload: TEvents[K];
};

export type EmitOptions = {
  /** Pass a transaction client to make emit atomic with the surrounding domain write. */
  client?: Client;
};

export type EmitResult = {eventId: number};

export type EmitFn<TEvents extends EventMap> = <K extends keyof TEvents>(
  event: EmitInput<TEvents, K>,
  options?: EmitOptions,
) => Promise<EmitResult>;

export type ConsumerHandlerInput<TPayload, TEvents extends EventMap> = {
  payload: TPayload;
  eventId: number;
  eventName: string;
  job: {id: number; attempt: number};
  /**
   * Emit a follow-up event from inside this handler. This `emit` is pre-bound
   * to the running job's causation, so the downstream event's
   * `context.causedBy` points back to this job/consumer/event automatically.
   *
   * If you need to emit from outside a handler, use the top-level
   * `outbox.emit`.
   */
  emit: EmitFn<TEvents>;
};

export type ConsumerDefinition<TPayload, TEvents extends EventMap = EventMap> = {
  name: string;
  when?: WhenFn<TPayload>;
  delay?: DelayFn<TPayload>;
  retry?: RetryFn;
  visibilityTimeout?: TimePeriod;
  handler: (input: ConsumerHandlerInput<TPayload, TEvents>) => Promise<void>;
};

export type OutboxDefaults = {
  visibilityTimeout?: TimePeriod;
  retry?: RetryFn;
  /** Hard cap on attempts: once reached after a failed run, the job transitions to `failed` regardless of `retry`. */
  maxAttempts?: number;
  /** Application environment tag written onto every event — useful when the same DB sees events from dev + CI. */
  environment?: string;
  /** How many jobs to claim per tick(). */
  batchSize?: number;
  /**
   * Hook for bookkeeping errors — updates that fail after a handler has
   * already run its side effects. Default is `console.warn`; pass a custom
   * logger or Sentry hook to surface these in production. Distinct from
   * handler errors, which are routed through the retry policy.
   */
  onBookkeepingError?: (error: unknown, job: JobContext) => void;
};

export type EventMap = Record<string, unknown>;

export type OutboxConsumers<TEvents extends EventMap> = {
  [K in keyof TEvents]?: ConsumerDefinition<TEvents[K], TEvents>[];
};

export type OutboxConfig<TEvents extends EventMap> = {
  client: Client;
  consumers: OutboxConsumers<TEvents>;
  now?: () => Date;
  defaults?: OutboxDefaults;
};

export type ClaimedJob = {
  id: number;
  event_id: number;
  consumer_name: string;
  event_name: string;
  event_payload: string;
  event_context: string;
  attempt: number;
  vt_until: number;
};

export type TickResult = {
  claimed: number;
  succeeded: number;
  failed: number;
  retried: number;
};

export interface Outbox<TEvents extends EventMap> {
  setup(): Promise<void>;
  emit: EmitFn<TEvents>;
  tick(): Promise<TickResult>;
  claim(input?: {limit?: number}): Promise<ClaimedJob[]>;
}

export function defineConsumer<TPayload, TEvents extends EventMap = EventMap>(
  definition: ConsumerDefinition<TPayload, TEvents>,
): ConsumerDefinition<TPayload, TEvents> {
  return definition;
}

const DEFAULT_BATCH_SIZE = 32;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_VT: TimePeriod = '30s';
const DEFAULT_RETRY: RetryFn = (_, error) => ({retry: true, reason: String(error), delay: '10s'});

export function createOutbox<TEvents extends EventMap>(config: OutboxConfig<TEvents>): Outbox<TEvents> {
  const {client} = config;
  const now = config.now ?? (() => new Date());
  const defaults: Required<Omit<OutboxDefaults, 'onBookkeepingError'>> & Pick<OutboxDefaults, 'onBookkeepingError'> = {
    visibilityTimeout: config.defaults?.visibilityTimeout ?? DEFAULT_VT,
    retry: config.defaults?.retry ?? DEFAULT_RETRY,
    maxAttempts: config.defaults?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    environment: config.defaults?.environment ?? 'development',
    batchSize: config.defaults?.batchSize ?? DEFAULT_BATCH_SIZE,
    onBookkeepingError: config.defaults?.onBookkeepingError,
  };

  const consumersByEvent = new Map<string, ConsumerDefinition<unknown, TEvents>[]>();
  for (const eventName of Object.keys(config.consumers) as (keyof TEvents & string)[]) {
    const list = config.consumers[eventName] as ConsumerDefinition<unknown, TEvents>[] | undefined;
    if (list?.length) consumersByEvent.set(eventName, list);
  }

  async function setup(): Promise<void> {
    await client.raw(SCHEMA_DDL);
  }

  async function emitWithCausation<K extends keyof TEvents>(
    event: EmitInput<TEvents, K>,
    options: EmitOptions,
    causedBy: Causation | null,
  ): Promise<EmitResult> {
    const effectiveClient = options.client ?? client;
    const context = causedBy ? {causedBy} : {};
    const eventName = event.name as string & keyof TEvents;
    const nowMs = now().getTime();

    // Use `returning id` + .all() rather than .run() + lastInsertRowid: libsql-client's
    // .execute() doesn't populate lastInsertRowid when the statement has a RETURNING clause,
    // so reading the row back is the portable path.
    const insertedRows = await effectiveClient.all<{id: number}>({
      sql: `insert into sqlfu_outbox_events (name, payload, context, environment, created_at)
            values (?, ?, ?, ?, ?) returning id`,
      args: [eventName, JSON.stringify(event.payload), JSON.stringify(context), defaults.environment, nowMs],
    });

    const eventIdRaw = insertedRows[0]?.id;
    if (typeof eventIdRaw !== 'number' || eventIdRaw <= 0) {
      throw new Error(`Could not determine inserted event id (got ${String(eventIdRaw)})`);
    }
    const eventId = eventIdRaw;

    const matching = (consumersByEvent.get(eventName) ?? []).filter((consumer) =>
      consumer.when ? Boolean(consumer.when({payload: event.payload})) : true,
    );

    for (const consumer of matching) {
      const delay = consumer.delay ? consumer.delay({payload: event.payload}) : '0s';
      const runAfter = Math.floor((nowMs + periodMs(delay)) / 1000);
      await effectiveClient.run({
        sql: `insert into sqlfu_outbox_jobs (event_id, consumer_name, run_after, vt_until, attempt, status, created_at, updated_at)
              values (?, ?, ?, 0, 0, 'pending', ?, ?)`,
        args: [eventId, consumer.name, runAfter, nowMs, nowMs],
      });
    }

    return {eventId};
  }

  const emit: EmitFn<TEvents> = (event, options = {}) => emitWithCausation(event, options, null);

  async function claim(input: {limit?: number} = {}): Promise<ClaimedJob[]> {
    const limit = input.limit ?? defaults.batchSize;
    const nowSec = Math.floor(now().getTime() / 1000);

    return client.transaction(async (tx) => {
      const candidates = await tx.all<{id: number; consumer_name: string}>({
        sql: `select j.id, j.consumer_name
              from sqlfu_outbox_jobs j
              where j.run_after <= ?
                and (j.status = 'pending' or (j.status = 'running' and j.vt_until < ?))
              order by j.id
              limit ?`,
        args: [nowSec, nowSec, limit],
      });

      if (candidates.length === 0) return [];

      const vtUntilByConsumer = new Map<string, number>();
      for (const candidate of candidates) {
        const consumer = findConsumerByName(candidate.consumer_name);
        const vt = consumer?.visibilityTimeout ?? defaults.visibilityTimeout;
        vtUntilByConsumer.set(candidate.consumer_name, nowSec + Math.floor(periodMs(vt) / 1000));
      }

      for (const candidate of candidates) {
        await tx.run({
          sql: `update sqlfu_outbox_jobs set status = 'running', vt_until = ?, updated_at = ? where id = ?`,
          args: [vtUntilByConsumer.get(candidate.consumer_name)!, now().getTime(), candidate.id],
        });
      }

      const ids = candidates.map((c) => c.id);
      const placeholders = ids.map(() => '?').join(', ');
      return tx.all<ClaimedJob>({
        sql: `select j.id, j.event_id, j.consumer_name, j.attempt, j.vt_until,
                     e.name as event_name, e.payload as event_payload, e.context as event_context
              from sqlfu_outbox_jobs j
              join sqlfu_outbox_events e on e.id = j.event_id
              where j.id in (${placeholders})
              order by j.id`,
        args: ids,
      });
    });
  }

  async function tick(): Promise<TickResult> {
    const claimed = await claim({limit: defaults.batchSize});
    const result: TickResult = {claimed: claimed.length, succeeded: 0, failed: 0, retried: 0};

    for (const job of claimed) {
      const consumer = findConsumerByName(job.consumer_name);
      if (!consumer) {
        await bookkeep(job, () => markFailed(job, new Error(`No consumer registered for ${job.consumer_name}`)));
        result.failed += 1;
        continue;
      }

      const payload = JSON.parse(job.event_payload || 'null');
      const causation: Causation = {eventId: job.event_id, consumerName: job.consumer_name, jobId: job.id};
      const boundEmit: EmitFn<TEvents> = (event, options = {}) => emitWithCausation(event, options, causation);

      // Split: handler failures → retry policy; bookkeeping (DB) failures → log + let VT recovery handle.
      // Conflating them once caused a successful handler side-effect to be retried when the status
      // update failed.
      let handlerError: unknown = null;
      try {
        await consumer.handler({
          payload,
          eventId: job.event_id,
          eventName: job.event_name,
          job: {id: job.id, attempt: job.attempt + 1},
          emit: boundEmit,
        });
      } catch (error) {
        handlerError = error;
      }

      if (handlerError == null) {
        await bookkeep(job, () => markSuccess(job));
        result.succeeded += 1;
      } else {
        const newAttempt = job.attempt + 1;
        const retryFn = consumer.retry ?? defaults.retry;
        const policy = retryFn({...causation, attempt: newAttempt}, handlerError);

        if (!policy.retry || newAttempt >= defaults.maxAttempts) {
          await bookkeep(job, () => markFailed(job, handlerError, newAttempt));
          result.failed += 1;
        } else {
          const runAfterSec = Math.floor((now().getTime() + periodMs(policy.delay)) / 1000);
          await bookkeep(job, () => markRetry(job, handlerError, newAttempt, runAfterSec));
          result.retried += 1;
        }
      }
    }

    return result;
  }

  async function bookkeep(job: ClaimedJob, update: () => Promise<void>): Promise<void> {
    try {
      await update();
    } catch (error) {
      const report = defaults.onBookkeepingError ?? defaultOnBookkeepingError;
      report(error, {
        jobId: job.id,
        eventId: job.event_id,
        attempt: job.attempt,
        consumerName: job.consumer_name,
      });
    }
  }

  function findConsumerByName(name: string): ConsumerDefinition<unknown, TEvents> | undefined {
    for (const list of consumersByEvent.values()) {
      const found = list.find((c) => c.name === name);
      if (found) return found;
    }
    return undefined;
  }

  async function markSuccess(job: ClaimedJob): Promise<void> {
    await client.run({
      sql: `update sqlfu_outbox_jobs set status = 'success', attempt = ?, last_error = null, updated_at = ? where id = ?`,
      args: [job.attempt + 1, now().getTime(), job.id],
    });
  }

  async function markRetry(job: ClaimedJob, error: unknown, attempt: number, runAfterSec: number): Promise<void> {
    await client.run({
      sql: `update sqlfu_outbox_jobs
              set status = 'pending', attempt = ?, last_error = ?, run_after = ?, vt_until = 0, updated_at = ?
              where id = ?`,
      args: [attempt, String(error), runAfterSec, now().getTime(), job.id],
    });
  }

  async function markFailed(job: ClaimedJob, error: unknown, attempt?: number): Promise<void> {
    await client.run({
      sql: `update sqlfu_outbox_jobs set status = 'failed', attempt = ?, last_error = ?, updated_at = ? where id = ?`,
      args: [attempt ?? job.attempt + 1, String(error), now().getTime(), job.id],
    });
  }

  return {setup, emit, tick, claim};
}

/* -------------------------------------------------------------------------- */

function defaultOnBookkeepingError(error: unknown, job: JobContext): void {
  console.warn(`[sqlfu/outbox] bookkeeping failed for job ${job.jobId} (${job.consumerName}):`, error);
}

function periodMs(period: TimePeriod): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(period);
  if (!match) throw new Error(`Expected period like "30s" / "5m" / "1h" / "2d", got ${period}`);
  const value = Number(match[1]);
  const unit = match[2] as TimeUnit;
  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default: {
      const _exhaustive: never = unit;
      throw new Error(`Unknown time unit: ${String(_exhaustive)}`);
    }
  }
}

/* ---- Schema. Kept inline; outbox manages its own tables for now. -------- */

const SCHEMA_DDL = `
create table if not exists sqlfu_outbox_events (
  id integer primary key autoincrement,
  name text not null,
  payload text not null,
  context text not null,
  environment text not null,
  created_at integer not null
);

create index if not exists sqlfu_outbox_events_name_idx on sqlfu_outbox_events (name);

create table if not exists sqlfu_outbox_jobs (
  id integer primary key autoincrement,
  event_id integer not null references sqlfu_outbox_events(id),
  consumer_name text not null,
  run_after integer not null,
  vt_until integer not null default 0,
  attempt integer not null default 0,
  status text not null default 'pending',
  last_error text,
  created_at integer not null,
  updated_at integer not null
);

create index if not exists sqlfu_outbox_jobs_claim_idx
  on sqlfu_outbox_jobs (status, run_after, vt_until);
`;
