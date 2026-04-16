status: ready
size: medium

# Named And Loved Queries

## Status Summary

- Mostly clear now: the first implementation should be very small.
- Main completed pieces:
  - `sql/*.sql` already gives queries stable names
  - typegen already knows the filename-derived id
  - generated queries already centralize execution through wrappers
- Main missing pieces:
  - generated wrappers drop the name before runtime
  - there is no runtime field for query name
  - there is no proof that the name shows up in real OTel spans end to end

## Goal

Make generated queries carry exactly one extra piece of observability metadata:

- `db.query.name`

Definition:

- `sql/list-profiles.sql` -> `list-profiles`

That is the entire concept for the first implementation.

Do not add:

- inferred query operation names
- camel-cased variants
- function-name metadata
- extra filename-derived aliases
- a wider query taxonomy

If this works, we can add more later. For now the point is just:

- checked-in SQL files already have good names
- those names should survive to runtime
- OTel spans should expose them

## Current Codebase Reality

- `packages/sqlfu/src/typegen/index.ts`
  - typegen already knows the filename without extension
  - generated wrappers currently emit `const query: SqlQuery = { sql, args }`
  - this is the point where the name is currently lost
- `packages/sqlfu/src/typegen/query-catalog.ts`
  - the runtime catalog already stores `id`, which is effectively the same value we want for `db.query.name`
- `packages/sqlfu/src/core/types.ts`
  - `SqlQuery` is currently just `{ sql, args }`
- adapters currently ignore everything except `sql` and `args`

So the implementation should be mostly:

- add a single optional field to the runtime query shape
- have typegen populate it for generated queries
- preserve it through execution
- expose it to instrumentation

## Attribute Choice

Initial implementation target:

- `db.query.name = "<filename without .sql>"`

Example:

- `sql/list-profiles.sql` -> `db.query.name = "list-profiles"`

Important note:

- this appears to be a custom attribute, not a current standard OTel SQL semantic-convention field
- current OTel SQL semconv documents `db.query.summary`, `db.query.text`, and `db.operation.name`, but not `db.query.name`

That is fine for now.

This task should still build around `db.query.name`, because that is the actual contract we want `sqlfu` to own.

If we later want interoperability polish, we can decide whether to also mirror the same value into `db.query.summary`.

Not for the first pass.

## Design Direction

Keep it boring.

- extend `SqlQuery` with optional `dbQueryName?: string`
  or equivalent, if we want the runtime field name to match the emitted attr exactly
- generated wrappers should set it from the filename without extension
- ad hoc SQL should keep working and simply omit it
- add one official hook point around query execution so instrumentation can read it

The runtime should not try to infer names from SQL text.

Only generated queries from checked-in files get the name automatically.

## Checklist

- [ ] Add a single runtime field for the query name.
  Keep it optional so raw ad hoc SQL remains simple.
- [ ] Make typegen populate the field for generated queries.
  Source of truth: filename without `.sql`.
- [ ] Preserve that field through client and adapter execution without changing behavior.
- [ ] Add one official query-execution hook or callback surface.
  It only needs enough data to emit telemetry cleanly.
- [ ] Emit `db.query.name` from that hook in the reference OTel integration.
- [ ] Do not add extra filename-derived metadata in this first implementation.
- [ ] Prove the feature with a real OTel end-to-end test, not just a unit test.

## Testing / Proof Plan

This should be proved with a small but real end-to-end fixture, not by asserting on hand-built fake span objects.

### Sanity Check

The proposed shape mostly makes sense, with one adjustment:

- a fully functional Hono backend is a good fixture
- sending telemetry through real OTel SDK/export code is a good idea
- catching OTLP requests in a local test server is realistic
- spinning up a full trace UI for CI snapshots is probably too heavy for the first pass

Recommended replacement for "visualise traces in CI":

- render the exported spans into a small normalized trace tree string
- inline-snapshot that string

That gives the same review value with much less moving parts.

Example shape:

```text
trace:
  GET /profiles
    sql query
      db.query.name=list-profiles
```

The exact names do not matter yet. The point is to snapshot the hierarchy and key attrs in a stable human-readable way.

### Fixture Shape

Create a test fixture that runs:

- a real Hono app on Node.js
- with `@hono/node-server`
- with a real `sqlfu` generated query loaded from `sql/*.sql`
- with OpenTelemetry Node SDK enabled
- with OTel HTTP instrumentation enabled for the inbound request
- with `sqlfu` creating a child DB span or equivalent span event through its instrumentation hook
- with the trace exporter pointing at a local test OTLP receiver

Why this is reasonable:

- Hono has an official Node server path via `@hono/node-server`
- Hono also has a testing helper, but for this task a real HTTP server is better because we want actual OTel HTTP spans, not just handler invocation
- OpenTelemetry JS officially supports Node SDK setup, HTTP instrumentation, and OTLP HTTP export

### Export Path

Use the real OTel HTTP/JSON trace exporter in tests:

- `@opentelemetry/exporter-trace-otlp-http`

Point it at a tiny local HTTP server in the test process that receives:

- `POST /v1/traces`

Why this is a good fit:

- the JS exporter supports OTLP over `http/json`
- a local HTTP server can capture the actual exported payload
- snapshotting normalized OTLP JSON is much more realistic than asserting on made-up span structures

### Suggested Test Layers

1. Small plumbing test

- generate a query from `sql/list-profiles.sql`
- assert the generated wrapper includes the query name field

2. Runtime integration test

- execute the generated query against a real sqlite db
- assert the query-execution hook receives `db.query.name = "list-profiles"`

3. OTel end-to-end spec

- start a real Hono server
- install OTel Node SDK and HTTP instrumentation
- configure OTLP HTTP/JSON exporter to send to a local test receiver
- make one real HTTP request to the Hono route
- wait for spans to flush
- normalize the received trace payload
- inline-snapshot the normalized trace tree

### What To Snapshot

Snapshot only stable fields.

Keep:

- span hierarchy
- span name
- selected attributes:
  - `db.query.name`
  - route name / http method if useful
  - error markers when testing failure cases

Strip:

- timestamps
- trace ids
- span ids
- durations unless we round aggressively
- resource noise
- sdk version noise

### Useful Fixture Cases

- happy path request runs one named query
- failing query still emits `db.query.name`
- ad hoc SQL emits no `db.query.name`
- two different generated queries produce distinct names

### Tooling Notes

Useful tools confirmed by docs:

- Hono Node server:
  - https://hono.dev/docs/getting-started/nodejs
- Hono testing helper:
  - https://hono.dev/docs/helpers/testing
- OpenTelemetry JS Node SDK:
  - https://opentelemetry.io/docs/languages/js/getting-started/nodejs/
- OpenTelemetry JS HTTP instrumentation:
  - https://open-telemetry.github.io/opentelemetry-js/modules/_opentelemetry_instrumentation-http.html
- OpenTelemetry JS OTLP HTTP/JSON exporter:
  - https://open-telemetry.github.io/opentelemetry-js/modules/_opentelemetry_exporter-trace-otlp-http.html
- OTLP protocol transport options:
  - https://opentelemetry.io/docs/specs/otel/protocol/exporter/

### Recommended Implementation Order

- first add the name plumbing and a small wrapper snapshot test
- then add the execution hook and runtime test
- then build the Hono + OTel end-to-end fixture

That order keeps the proof incremental and avoids debugging OTel before the core metadata flow exists.

## Acceptance Bar

This task is done when:

- generated queries automatically carry a name derived from the SQL filename
- that name reaches runtime execution unchanged
- the reference OTel path emits `db.query.name`
- there is an end-to-end test using a real Hono server and real OTel export that snapshots a normalized trace showing the named query

## References

- OpenTelemetry SQL DB semantic conventions:
  - https://opentelemetry.io/docs/specs/semconv/db/sql/
- OpenTelemetry JS Node getting started:
  - https://opentelemetry.io/docs/languages/js/getting-started/nodejs/
- OpenTelemetry JS HTTP instrumentation:
  - https://open-telemetry.github.io/opentelemetry-js/modules/_opentelemetry_instrumentation-http.html
- OpenTelemetry JS OTLP HTTP/JSON exporter:
  - https://open-telemetry.github.io/opentelemetry-js/modules/_opentelemetry_exporter-trace-otlp-http.html
- OpenTelemetry protocol exporter transports:
  - https://opentelemetry.io/docs/specs/otel/protocol/exporter/
- Hono Node.js server:
  - https://hono.dev/docs/getting-started/nodejs
- Hono testing helper:
  - https://hono.dev/docs/helpers/testing

## Implementation Notes

- Current likely source of truth:
  - the query filename without extension
- Current likely implementation seam:
  - `renderQueryWrapper()` in `packages/sqlfu/src/typegen/index.ts`
- Current likely proof seam:
  - a new integration-style test under `packages/sqlfu/test/` that starts:
    - sqlite
    - hono
    - otel sdk
    - a local otlp receiver
