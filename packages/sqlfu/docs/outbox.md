# Outbox

>⚠️ Extra-experimental warning! The shape of this module is still in flux and will likely change. The basic principle of events + consumers will remain, so migrations will be easy but will be needed if you use this as-is.

`sqlfu/outbox` is a small transactional-outbox / job-queue built on top of the same sqlfu client you already use. It's a single-file implementation that gives you:

- **Transactional emit**: the event row is inserted in the same transaction as your domain write, so "either both happen or neither does".
- **Per-consumer fan-out**: one emitted event spawns one job per registered consumer.
- **Retry + DLQ**: failed jobs get rescheduled according to a retry policy; once a hard cap is hit, they transition to `status = 'failed'`.
- **Delayed dispatch**: a consumer can schedule its job to run `24h` later.
- **Visibility-timeout crash recovery**: if a worker dies holding a claimed job, after the VT expires the job is re-claimable by a future worker.
- **Causation chains**: an event emitted inside a handler automatically records which job/consumer caused it.

The whole thing is built on the observation that SQLite serialises writers, so you don't need any kind of row-locking or work-leasing dance: a plain `begin; select pending; update to running; commit` is enough.

## Shape

```ts
import {createOutbox, defineConsumer} from 'sqlfu/outbox';

type AppEvents = {
  'user:signed_up': {userId: number; email: string};
};

const welcomeEmail = defineConsumer<AppEvents['user:signed_up']>({
  name: 'welcomeEmail',
  handler: async ({payload}) => {
    await sendEmail(payload.email, 'Welcome!');
  },
});

const outbox = createOutbox<AppEvents>({
  client,                                 // any sqlfu Client (SyncClient or AsyncClient)
  consumers: {
    'user:signed_up': [welcomeEmail, /* ...more consumers */],
  },
  defaults: {
    visibilityTimeout: '30s',
    maxAttempts: 5,
  },
});

await outbox.setup();                      // idempotent; creates sqlfu_outbox_{events,jobs}

// Producer: emit inside the same transaction as the domain write
await client.transaction(async (tx) => {
  await tx.run({sql: 'insert into users (email) values (?)', args: [email]});
  await outbox.emit({name: 'user:signed_up', payload: {userId: 1, email}}, {client: tx});
});

// Worker: drain pending jobs in a loop somewhere
while (!signal.aborted) {
  const result = await outbox.tick();
  if (result.claimed === 0) await sleep(500);
}
```

## Consumer options

Every field except `name` and `handler` is optional:

```ts
defineConsumer<Payload, AppEvents>({
  name: 'myConsumer',
  when: ({payload}) => payload.shouldDispatch,        // truthy → fan-out includes this consumer
  delay: ({payload}) => '24h',                         // job's run_after
  retry: (job, error) => ({retry: true, delay: '30s', reason: String(error)}),
  visibilityTimeout: '2m',                             // how long after claim before reclaim allowed
  handler: async ({payload, eventId, job, emit}) => {
    // `emit` is pre-bound to this job's causation. Any events emitted from
    // here will have `context.causedBy` pointing back to this job/consumer.
    await emit({name: 'myConsumer:didAThing', payload: {/* … */}});
  },
});
```

Time periods use `Ns`, `Nm`, `Nh`, `Nd` (seconds, minutes, hours, days).

## Causation is explicit, not ambient

Handlers receive an `emit` helper that already knows its own job context. Events
emitted through that helper automatically get `context.causedBy = {eventId,
consumerName, jobId}` pointing back to the originating job.

This is by design: sqlfu runs in browsers, edge workers, and mobile (see
[adapters](./adapters.md)), so the outbox avoids any `node:` imports.
`AsyncLocalStorage` would have made causation "magic" for Node users but broken
everywhere else; threading `emit` through the handler input keeps the module
dep-free at the cost of one extra argument.

If you call `outbox.emit(...)` from outside a handler (e.g. in response to a
user action) the event is still emitted, just without a `causedBy` entry.
That's the right behaviour: it wasn't caused by another job.

## Out of scope for now

- oRPC / HTTP-server integration. Wire-up is straightforward: the consumer objects are plain data, and `outbox.tick()` returns quickly; wrap it in whatever scheduler you like.
- Opentelemetry spans per job. Use the existing `instrument()` hook on the sqlfu client; handlers run against the same client.
- Posthog/Sentry DLQ reporting. The `onBookkeepingError` hook + the `status = 'failed'` terminal state are the building blocks; wiring those into your telemetry pipeline is a downstream concern.
