---
status: ready
size: medium
---

# Outbox: a tiny transactional-outbox/queue library built on sqlfu

## Motivation

The transactional-outbox pattern (typically implemented in production on Postgres + pgmq or equivalent) handles:

- transactional event emission (write the event in the same tx as the domain write, so "either both happen or neither does")
- per-consumer job fan-out (one event can be handled by N consumers)
- retry + DLQ
- delayed dispatch
- visibility timeout / work leasing (no double-processing)
- causation chain (event A emitted *because of* job J in response to event E)

For sqlfu we want a ~few hundred-line SQLite equivalent that trades pgmq's multi-worker concurrency for SQLite's single-writer model — which actually makes a lot of the queue correctness story trivially true.

Scope for this PR: ship a first-pass, feature-complete-enough-to-be-useful outbox as a new entry point `sqlfu/outbox` (source at `packages/sqlfu/src/outbox/`), driven by a realistic integration test.

## Design tl;dr

- Two tables, created+owned by the outbox on first use:
  - `sqlfu_outbox_events` — append-only event log. One row per `emit()` call. Columns: id, name, payload (JSON), context (JSON, includes causation), environment, created_at.
  - `sqlfu_outbox_jobs` — one row per (event × consumer) pair. Columns: id, event_id, consumer_name, run_after (unix seconds), vt_until (visibility-timeout-until, unix seconds), attempt, status (`pending` | `running` | `success` | `failed`), last_error, created_at, updated_at.
- Emitter API (transactional by design):
  - `emit(client, {name, payload})` inserts one event row + one job row per registered consumer whose `when({payload})` returns truthy, all in the same transaction.
  - Inside a consumer handler, `emit` reaches the ambient consumer context (AsyncLocalStorage) so the new event's `context.causedBy` is set automatically.
- Consumer API:
  - `defineConsumer({name, when?, delay?, retry?, visibilityTimeout?, handler})`. Familiar pgmq-style consumer shape; everything but `name` and `handler` is optional.
- Worker API:
  - `runWorker({client, consumers, signal})` — a polling loop:
    1. `begin immediate` (SQLite's "exclusive writer" semantics — we rely on this; no pgmq-style row-lock dance needed)
    2. pick up to N pending jobs where `run_after <= now()` and (`status = 'pending'` OR (`status = 'running'` AND `vt_until < now()`))
    3. mark them `running` with a fresh `vt_until = now() + visibilityTimeout`
    4. commit
    5. for each claimed job, run its handler with evaluation context, then update status to `success` or apply retry policy and set `status` back to `pending` or `failed`
  - Exposes a `tick()` for integration tests to drive the loop deterministically; no real timers in tests.

## Why SQLite single-writer is a gift, not a constraint

- No "SELECT … FOR UPDATE SKIP LOCKED" needed — a `BEGIN IMMEDIATE; select pending jobs; update to running; commit;` is atomic and can't race another worker because SQLite serialises writers.
- Multi-worker still works: workers serialize on the write lock, not block-forever. In an outbox workload that's fine — handlers are the long thing, claims are milliseconds.
- Crash recovery trivially falls out of `vt_until`: if a worker dies holding `running` jobs, they become re-claimable after the VT.

## The TDD integration scenario

A tiny saas app with:

- `users` table, written by `signUp(email)`.
- Emits `user:signed_up` → 3 consumers:
  1. **welcome-email**: records an outbound email row. Sometimes the first attempt fails (network).
  2. **slack-admin-notify**: records a slack post row.
  3. **onboarding-reminder**: delayed 24h; when it runs, emits `reminder:due` which feeds a fourth consumer that records another email.

The integration test drives the worker via `tick()`, virtual clock, and asserts:

- emitting is atomic with the domain write (if the `users` insert rolls back, no event/jobs exist)
- fan-out: one event → three jobs
- `when` filter skips jobs (e.g. a spam-email variant of the `welcome-email` consumer that only runs for `@test.com` domains)
- first-attempt failure → retry according to policy → eventually success (state transitions visible in `sqlfu_outbox_jobs`)
- permanent failure → `status = 'failed'` with `last_error`
- delayed consumer doesn't fire until `run_after`
- causation chain: the `reminder:due` event's `context.causedBy` points back to the job/consumer that emitted it
- crash recovery: if we kill the worker between claim and handler-done, after VT expires the job is re-claimable and re-run

## Out of scope for this PR (follow-ups)

- Polymorphic sync/async return types — see `tasks/outbox-polymorphic-sync.md`.
- oRPC middleware for registering consumers / emitting events from handlers.
- tracing / OpenTelemetry span-per-job (easy to add via the existing `instrument()` hook on the client).
- DLQ as a separate queue (today: `status = 'failed'` is the DLQ).
- Multi-process worker coordination (today: each process runs its own loop; fine for the sqlfu-scale app).
- Schema-migration story for the two outbox tables (today: idempotent `create table if not exists` on worker startup; revisit when we tie it into sqlfu's migration model).
- Posthog/Sentry DLQ observability hooks (sketch: wrap each handler in an evlog-style request context and forward `status='failed'` rows to your error tracker).

## Checklist

- [x] fleshed-out spec committed (this file) _(commit ad1acf0)_
- [x] failing integration test for the saas scenario _(commit 14750c9, test/outbox/outbox.test.ts)_
- [x] tables + schema bootstrap _(src/outbox/index.ts SCHEMA_DDL)_
- [x] `emit()` + causation via explicit `emit` helper threaded into each handler _(`ConsumerHandlerInput.emit` in src/outbox/index.ts; the AsyncLocalStorage approach was dropped to keep the module dep-free for browsers/edge/workers — see commit 17e0c93)_
- [x] `defineConsumer()` + `tick()` deterministic driver _(no real timers in tests; works today via a virtual clock injected through `now`)_
- [x] retry policy — fixed delay via `{retry: true, delay: '5s'}`. Exponential backoff is left as a follow-up helper; any user can already express it as a function of `job.attempt`.
- [x] delayed jobs _(`delay` option on the consumer writes `run_after` in the future)_
- [x] VT-based crash recovery _(claim() sets `vt_until`; next claim reads expired rows as reclaimable)_
- [x] `sqlfu/outbox` export wired up in package.json _(both `exports` and `publishConfig.exports`)_
- [x] README paragraph linking to a new `docs/outbox.md` page

## Notes

- The common production shape for this pattern is Postgres + pgmq (per-consumer queue tables, exclusive-read sessions, archive tables). Our version uses vanilla SQLite tables: transactional-emit semantics, consumer shape, retry/delay/causation concepts all carry over; the pgmq-specific machinery doesn't, because SQLite serialises writers for us.
