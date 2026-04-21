status: revised-impl-done-pending-review
size: medium

# Named And Loved Queries

## Status Summary

- Revised implementation landed as a series of small commits on `named-and-loved-queries`. All 1652 sqlfu tests pass (1626 baseline + 25 new naming tests + 1 new nested-typegen test; otel test rewritten).
- Shipped: packaged `createOtelHook` + `createErrorReporterHook` + `composeHooks` with structural `TracerLike`/`SpanLike` types (no peer deps); `db.query.summary` / `db.query.text` / `db.system.name` emitted; span name via `queryNickname` + 7-char djb2 hash; `dedent` tag + `shortHash` in core/util; nested query directories supported in typegen (query name + function name use the relative path so collisions can't happen).

## Revision — post-review (2026-04-18)

After reviewing the first pass, six things are changing. The core mechanism (name on `SqlQuery`, typegen emits it, `instrumentClient` wraps a client with a hook, end-to-end OTel test) stays.

### 1. Field rename: `dbQueryName` → `name`

Original justification ("matches the wire attribute `db.query.name` exactly") is dead because we're switching wire attribute to `db.query.summary` (see below). With the 1:1 motivation gone, `query.name` is cleaner and less ugly than `query.dbQueryName`.

### 2. Wire attribute: `db.query.summary`, not `db.query.name`

`db.query.name` is a custom key and isn't a standard OTel attribute. `db.query.summary` *is* official ("low-cardinality summary of the query") and observability tools (Sentry, Datadog, etc.) bucket spans by it automatically. A user-authored filename like `list-profiles` is low-cardinality by construction — arguably a better summary than any auto-derived one. Emit `db.query.summary=<name>` and drop `db.query.name`.

Also add:
- `db.query.text = query.sql` (raw parameterized SQL, no values interpolated)
- `db.system = client.system` — new field on `Client`, stamped by each adapter (`'sqlite'` for node-sqlite/better-sqlite3, `'postgresql'` for pg, etc.). Values match OTel's official `db.system` vocabulary so mapping is 1:1 at the hook.

### 3. Ship a packaged OTel helper + error hook + composition primitive — no peer deps

First pass punted the packaged helper to a follow-up. Reopening: shipping the mechanism without an integration means every user writes ~18 lines of identical OTel boilerplate. Do it now.

No peer dependencies on `@opentelemetry/api` or `@sentry/*`. Instead: author minimal structural types (`TracerLike`, `SpanLike`) that OTel's real `Tracer`/`Span` happen to satisfy. Users pass their tracer instance in. Doc: "if you use OpenTelemetry, pass `trace.getTracer('...')` as `tracer`."

Rationale: peer deps are painful (version conflicts, `peerDependenciesMeta.optional`, managing a floor), and the surface we touch is tiny (5 methods). A drift in OTel's types would surface as a user-side compile error at the callsite, not inside `sqlfu`, which is the correct place for it to surface.

Sentry specifically: we are **not** shipping a dedicated Sentry helper. Sentry v8+ has first-class OTel integration, so OTel users already route spans to Sentry. Users who want Sentry without OTel get it via a generic "on error" hook primitive.

New public surface (all from `sqlfu` root; no `sqlfu/otel` subpath — helpers are small enough):

```ts
// core:
instrumentClient(client, hook)  // already exists
composeHooks(...hooks)          // new — runs hooks left-to-right, each wrapping the next

// packaged helpers:
createOtelHook({ tracer: TracerLike })      // new — stays narrow, just tracing
createErrorReporterHook(report)             // new — (ctx, error) => void; fires on thrown errors only

// structural types (authored by us, no peer dep):
export interface TracerLike { startActiveSpan<T>(name: string, fn: (span: SpanLike) => T): T }
export interface SpanLike {
  setAttribute(key: string, value: string | number | boolean): this | void
  recordException(error: unknown): void
  setStatus(status: { code: number; message?: string }): this | void
  end(): void
}
```

Usage:

```ts
const hook = composeHooks(
  createOtelHook({ tracer: trace.getTracer('my-app') }),
  createErrorReporterHook((ctx, error) => Sentry.captureException(error, {
    tags: { 'db.query.summary': ctx.query.name ?? 'sql' },
  })),
)
const client = instrumentClient(baseClient, hook)
```

### 4. Span naming via existing `naming.ts` + short hash

Span name is derived in a single helper (`packages/sqlfu/src/core/naming.ts` already exists and has `queryNickname`, `migrationNickname`, `generateRandomName`):

- Named query: span name = `query.name` verbatim (e.g. `list-profiles`). Stable across SQL edits — author opts into stability by giving the query a name. If the query's purpose genuinely changes, the author renames the file.
- Ad-hoc query: span name = `sql-${queryNickname(query.sql)}-${shortHash(normalize(query.sql))}`. Examples: `sql-list-profiles-a1b2c3`, `sql-update-users-d4e5f6`. Readable prefix from `queryNickname` (already implemented), hash over the parameterized SQL so different `id` values don't fragment buckets.
  - Normalization before hashing: `dedent(sql).trim().replace(/\s+/g, ' ')`. Covers whitespace nudges; not a full SQL parser.
  - Hash length: 7 hex chars.
  - `client.raw()` callers are on their own — raw interpolates values into `query.sql`, so the hash becomes per-value. Documented caveat, not a code change. Escape hatch: `client.run({ sql, args, name: 'custom' })` — first-class because `name` is just an optional field on `SqlQuery`.
- Ship a `dedent` tag in `packages/sqlfu/src/core/util.ts` (or existing util home) — ~10 lines, we'll use it internally for SQL fixtures too.
- Add `packages/sqlfu/test/naming.test.ts` with table-driven cases locking in `queryNickname` and `migrationNickname` behavior. `naming.ts` is load-bearing for span identity; it needs tests.

### 5. Nested query directories: relative to the glob's static prefix

Relaxing the "flat only" instinct. Instead, typegen derives the name as the file path relative to the glob's static prefix (everything before the first wildcard char, truncated to the last `/`):

| `queries` config | base | file | name |
|---|---|---|---|
| `sql/*.sql` | `sql/` | `sql/list-profiles.sql` | `list-profiles` |
| `sql/**/*.sql` | `sql/` | `sql/users/list-profiles.sql` | `users/list-profiles` |
| `sql/users/*.sql` | `sql/users/` | `sql/users/list-profiles.sql` | `list-profiles` |
| `**/*.sql` | `./` | `sql/list-profiles.sql` | `sql/list-profiles` |

OTel span names happily contain `/`. No collisions, no prescription, no magic. Author's choice of glob = author's choice of namespace.

Document this behavior in the config docs. Leaving a future door open for a structured config shape (`queries: string | { glob, base }`) once real users have opinions.

### 6. Not in scope this revision

- `@opentelemetry/instrumentation-http` auto-instrumentation (still not needed to prove anything).
- Hash-seeded `generateRandomName` for ad-hoc (cute, not essential — hex hash is more pragmatic).
- Structured `queries` config shape. String-only for now.
- Typegen collision detection (moot under path-relative names).
- `iterate` / `raw` / `transaction`-span-level instrumentation. `iterate` remains pass-through (task file previously misdescribed this as "lazy" — it isn't, and shouldn't be in this pass). Queries inside transactions still fire the hook because the tx client is re-instrumented.

### Revised checklist

- [x] Add `name?: string` on `SqlQuery` + typegen emission + generate.test.ts snapshots. _Commit eb2ba5a. The first-pass `dbQueryName` field was never committed, so this landed as an addition rather than a rename._
- [x] Add `system: string` to `Client` interface; stamp on every adapter. _Commit bb84864. All 8 current adapters stamp `'sqlite'`._
- [x] Add `dedent` tag util. _Commit fb4e74b. Also added `normalizeSqlForHash` and djb2-based `shortHash` in the same util file (runtime-agnostic — no `node:crypto` dep so it works in workerd / expo)._
- [x] Add `packages/sqlfu/test/naming.test.ts` covering `queryNickname` + `migrationNickname`. _Commit 812b9e1. Table-driven with 11 queryNickname + 7 migrationNickname cases plus spanNameFor / dedent / shortHash sanity tests._
- [x] Add span-name helper in `naming.ts`. _Commit 812b9e1. `spanNameFor(query)` returns `query.name` verbatim or `sql-<nickname>-<hash>` for ad-hoc. Also fixed an existing bug where `queryNickname` returned `insert-into` instead of `insert-<table>` for INSERT statements — test caught it._
- [x] Support nested query directories in typegen. _Commit f0c007e. Recursive walk under `config.queries`; output mirrors source tree; `query.name`, function name, catalog id all use the relative path (e.g. `users/list-profiles`). Using the full relative path means collisions are impossible by construction — I'd originally flagged this as bigger scope than it turned out to be._
- [x] Add `TracerLike` / `SpanLike` structural types. _Commit 3e51f1c. Five methods total across two interfaces; verified that real `@opentelemetry/api` Tracer is assignable to `TracerLike`._
- [x] Implement `composeHooks`. _Commit 3e51f1c. Chains hooks left-to-right, outermost first._
- [x] Implement `createOtelHook({ tracer })`. _Commit 3e51f1c. Emits `db.query.summary` / `db.query.text` / `db.system.name`; records exception + ERROR status on throw; handles sync and async execute via `isPromiseLike`._
- [x] Implement `createErrorReporterHook(report)`. _Commit 3e51f1c. Fires on throw or rejected promise, always rethrows, swallows errors in the reporter itself so they can't mask the original error._
- [x] Update `test/observability/opentelemetry.test.ts` (originally `test/otel-tracing.test.ts`). _Commits 63429da, 63e1fe3. Hono + real OTLP exporter + local receiver; snapshot covers named + ad-hoc + failing query; asserts the errorReporter hook captured the failure. Moved into `test/observability/` alongside `sentry.test.ts` and `posthog.test.ts` so each file doubles as a copy-pasteable recipe._
- [ ] User-facing docs (see [Docs plan](#docs-plan) below). Inline JSDoc covers the `client.raw()` caveat for now.
- [ ] User-facing docs: nested query folder naming rule (same page as above).

## Docs plan

Not built yet — sketched after the implementation so it's locked in before anyone writes copy.

**Framing that shaped every decision.** This looks like "observability integration" but it's really: *your filename is your query's identity everywhere.* You name `sql/list-profiles.sql` and that name reaches typegen, runtime `SqlQuery.name`, Sentry, Datadog. That framing fits sqlfu's existing "SQL First. TypeScript Second." voice — observability is a *consequence* of naming, not a new feature axis. Naming is foundational; OTel is the payoff for users who happen to use OTel.

**Importance.** Tentpole-adjacent, not tentpole. Irrelevant to hobbyists; a genuine differentiator against Drizzle / Kysely / Prisma (none of which do this out of the box) for teams running in prod. Earns prominent-but-not-dominant placement.

**Placement.**

1. **Landing page** — augment the existing "Types, generated" panel with one sentence: *"Your query names travel with them — to OpenTelemetry, Sentry, Datadog, whatever."* Don't add a 4th panel (would feel like a feature-grid pivot). Don't make it the headline (overclaims — the three current panels are the actual core).
2. **New docs page** — 5th in sidebar, `packages/sqlfu/docs/observability.md`, registered in `website/build.mjs`. Title **Observability** (not "Tracing and errors" — chose the jargon for SEO; `sqlfu observability` / `sqlfu opentelemetry` / `sqlfu sentry` should land here). Covers: the `name` field, `QueryExecutionHook`, `instrumentClient`, `composeHooks`, `sqlfu/otel`'s `createOtelHook`, `createErrorReporterHook` + Sentry example, the `client.raw()` caveat, the nested-dir naming rule.
3. **`packages/sqlfu/README.md`** — one paragraph under core concepts noting that generated queries carry names and those names reach observability tools. NOTE this file IS the website's "sqlfu" overview docs page (synced via `website/build.mjs`), so edit it once.
4. **Root `README.md`** — **do not edit directly**. It's generated from `packages/ui/README.md` via `scripts/sync-root-readme.ts`. Irrelevant to this feature since it's the UI readme.

**Positioning of the reference hooks.** Docs should invite copy-paste. `instrument.otel` and `instrument.onError` are ~40 lines each. They're reference implementations, not the blessed-forever API. The stable contract is `QueryExecutionHook`; the helpers are one valid satisfaction of it. Doc should say so plainly.

**Public API shape (final).** Single `instrument` export from `sqlfu` root — callable-with-attached-helpers pattern (`Object.assign` of a variadic function plus `.otel`/`.onError`). Example:

```ts
import {instrument} from 'sqlfu'

const client = instrument(baseClient,
  instrument.otel({tracer}),
  instrument.onError(({context, error}) => Sentry.captureException(error)),
)
```

One import, autocomplete-driven discovery. Any function matching `QueryExecutionHook` works in the variadic slot, so custom hooks (metrics, slow-query loggers) aren't penalized. The earlier `sqlfu/otel` subpath was dropped — it created a "some from `sqlfu`, some from `sqlfu/otel`" split-brain for users. See commit `cb8bc47`. `createOtelHook` still lives in `src/otel.ts` internally, just isn't directly importable.

## Implementation log (2026-04-18)

Commits on `named-and-loved-queries`:

| commit | summary |
|---|---|
| 08c78b4 | spec: revise after first-pass review |
| eb2ba5a | typegen: emit `name` field on every generated SqlQuery |
| bb84864 | adapters: stamp `system` on every Client |
| fb4e74b | add core/util.ts (dedent, normalizeSqlForHash, shortHash) |
| 812b9e1 | add `spanNameFor` + naming.test.ts; fix queryNickname insert bug |
| 3e51f1c | add `instrumentClient`, `composeHooks`, `createOtelHook`, `createErrorReporterHook` |
| 63429da | test: otel trace snapshot covers named, ad-hoc, failing queries |
| 01e2f67 | tasks: mark checklist complete |
| f0c007e | typegen: support nested query directories |
| 31475cf | instrument: error reporter takes {context, error} bag; inline OTel status codes |
| 34589cd | (superseded) move OTel helper to sqlfu/otel subpath |
| cb8bc47 | collapse instrumentation surface to a single `instrument` export |
| 63e1fe3 | test/observability: sentry and posthog recipes; defer error taxonomy |

Notable decisions reaffirmed during implementation:

- **djb2 over sha256.** `shortHash` uses djb2 rather than `node:crypto` so it runs on workerd, expo, and anywhere else the sqlfu adapters might land. 7 hex chars from a 32-bit hash is still fine for per-app ad-hoc query distinguishability.
- **`iterate` and `raw` remain pass-through.** First-pass description of `iterate` as "lazy" was wrong — it's just pass-through, and the revision keeps it that way. Queries inside transactions still fire the hook because the tx client is re-instrumented in `transaction: (fn) => client.transaction((tx) => fn(instrumentAsync(tx, hook)))`.
- **Structural types actually work.** Verified that a real `Tracer` from `@opentelemetry/api` is assignable to `TracerLike` without gymnastics. Users pass their tracer directly with no adapter layer.
- **Exception branch runs in tests.** The `/broken` route in the snapshot test verifies the OTel hook records the exception as a span event AND the composed error reporter captures it with the query name — demonstrating the Sentry-style forwarding without the library owning any Sentry SDK.

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
  (runtime field name matches the OTel attribute name exactly, so instrumentation reads `query.dbQueryName` and emits `db.query.name`)
- generated wrappers should set it from the filename without extension
- ad hoc SQL should keep working and simply omit it
- add one official hook point around query execution so instrumentation can read it

The runtime should not try to infer names from SQL text.

Only generated queries from checked-in files get the name automatically.

### Assumptions (AFK — recorded before coding)

These are the concrete choices made while the user is away. If they're wrong, this commit should be reverted and the task re-specced.

1. **Field name is `dbQueryName`** (not `queryName` or `name`). Matches the wire attribute `db.query.name` directly so instrumentation is a one-liner. Still optional on `SqlQuery`.

2. **Hook surface shape**: a new exported `instrumentClient(client, hook)` in `packages/sqlfu/src/core/instrument.ts` that wraps a `Client` and returns a `Client` of the same shape. The hook is a single "around" function:

   ```ts
   export interface QueryExecutionContext {
     readonly query: SqlQuery;
     readonly operation: 'all' | 'run' | 'iterate';
   }
   export type QueryExecutionHook = <TResult>(
     context: QueryExecutionContext,
     execute: () => TResult,
   ) => TResult;
   ```

   An around-function is the natural shape for OTel's `tracer.startActiveSpan(name, fn)`. It's transparent to sync vs async because `TResult` can be `T | Promise<T>`.

   `run` and `all` are wrapped. `iterate` is wrapped lazily (span starts on first pull). `raw` is not instrumented (intentionally — it has no name anyway). `transaction` is not instrumented in this first pass.

3. **Where the hook module lives**: `packages/sqlfu/src/core/instrument.ts`, re-exported from `src/client.ts` so both `import { instrumentClient } from 'sqlfu'` and `import { instrumentClient } from 'sqlfu/client'` work.

4. **OTel integration module**: not adding a dedicated `sqlfu/otel` subpath in this first pass. The end-to-end test builds the hook inline using the plain OTel JS API (a few lines). If the pattern looks right, we can fold a helper into the library in a follow-up.

5. **End-to-end test location**: `packages/sqlfu/test/otel-tracing.test.ts`. Uses:
   - `hono` + `@hono/node-server` for the real server
   - `@opentelemetry/sdk-node`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/instrumentation-http`
   - A local `http.createServer` that collects `POST /v1/traces` payloads
   - `node:sqlite` for the real DB
   - Generates a query wrapper on disk via the existing fixture pattern, then imports it
   - Installed as devDependencies of `packages/sqlfu`

6. **Snapshot format**: normalized text tree. Minimal, human-skimmable:

   ```
   GET /profiles
     sqlfu.list-profiles  (db.query.name=list-profiles)
   ```

   Stripped: timestamps, trace ids, span ids, durations, sdk metadata. Order of sibling spans is sorted by start time then name for stability.

7. **Ad-hoc SQL test**: asserted in the same file — a second route uses `client.sql\`select 1 as x\`` and the snapshot shows no `db.query.name` attribute on that span.

8. **What is NOT done in this pass**: no camelCase alias, no `db.query.summary` mirror, no `db.operation.name`, no `db.system.name`, no typegen emitting `sqlFile` into the wrapper, no changes to the query catalog. Those can follow once the mechanism is proven.

## Checklist

- [x] Add a single runtime field for the query name. _`dbQueryName?: string` on `SqlQuery` in `packages/sqlfu/src/core/types.ts`._
- [x] Make typegen populate the field for generated queries. _`renderQueryWrapper` in `packages/sqlfu/src/typegen/index.ts` now emits `dbQueryName: "<filename>"` in every generated wrapper; `test/generate.test.ts` snapshots updated._
- [x] Preserve that field through client and adapter execution without changing behavior. _Adapters pass the full `SqlQuery` object through; they only read `.sql` and `.args`, so `.dbQueryName` survives untouched to any instrumentation wrapper._
- [x] Add one official query-execution hook or callback surface. _`instrumentClient(client, hook)` in `packages/sqlfu/src/core/instrument.ts`, re-exported from `sqlfu/client`._
- [x] Emit `db.query.name` from that hook in the reference OTel integration. _Shown in `test/otel-tracing.test.ts`: the hook calls `span.setAttribute('db.query.name', ctx.query.dbQueryName)`._
- [x] Do not add extra filename-derived metadata in this first implementation. _Only `dbQueryName` is added. No function-name metadata, no camelCase alias, no `sqlFile` on the runtime query, no `db.operation.name`._
- [x] Prove the feature with a real OTel end-to-end test, not just a unit test. _`test/otel-tracing.test.ts` runs a real Hono server via `@hono/node-server`, a real `NodeTracerProvider` with `SimpleSpanProcessor` + `OTLPTraceExporter` (HTTP/JSON), and a local HTTP receiver on 127.0.0.1 that captures `POST /v1/traces` payloads. Inline snapshot shows the normalized trace tree._

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

- start with writing a "normal" hono app in a test
- set it up as a sqlfu project, with some imaginary realistic tables
- add a couple of query files under `sql/*.sql`
- set the project up with otel using whatever the industry standard otel lib is in js/ts (research this)
- set up a local otel collector as necessary
- create an realistic product app api endpoint which exercises the db (ideally inside some larger span)
- set up sqlfu to write otel traces via some imaginary helper function that we'll eventually implement as part of the library api surface
- dump the otel trace(s) in some readable text format
- add a simple assertion that somewhere in that trace the name of the query that was exercised
- inline snapshot it too - may need to fudge timings etc.

After that we can take a look, but at that point it would be good to pause and validate the design is what we want it to be, and then suggest more tests including things like parameterised queries.

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

### Log

- `src/core/types.ts` — added `dbQueryName?: string` to `SqlQuery`.
- `src/typegen/index.ts` — `renderQueryWrapper` now emits `dbQueryName: "<filename>"` on the generated query object literal. Derived from `path.basename(sqlPath, '.sql')` (same source used for `functionName` and the catalog `id`).
- `src/core/instrument.ts` (new) — exports `instrumentClient`, `QueryExecutionHook`, `QueryExecutionContext`, `QueryOperation = 'all' | 'run'`. Dispatches to sync vs async wrapper based on `client.all.constructor.name === 'AsyncFunction'` (side-effect-free discriminator that works with every existing sqlfu adapter). The wrapper preserves the original adapter's `driver`, delegates `raw` / `iterate` / `transaction` through, and rewraps the tx client so queries inside transactions are instrumented too. `raw` and `iterate` are intentionally not instrumented in this first pass.
- `src/client.ts` — re-exports `./core/instrument.js`.
- `test/generate.test.ts` — inline snapshots updated to include `dbQueryName` in every generated wrapper.
- `test/otel-tracing.test.ts` (new) — real Hono server + real `NodeTracerProvider` + real `OTLPTraceExporter` + local `POST /v1/traces` receiver. Two routes: `/profiles` uses a named-generated-query-shaped `SqlQuery`; `/ad-hoc` uses the `sql` template tag. Snapshot asserts:

  ```
  GET /profiles
    sqlfu.list-profiles
      db.query.name=list-profiles
  GET /ad-hoc
    sqlfu.ad-hoc-query
  ```

### Design choices worth calling out

- **Field name is `dbQueryName`** (not `name` / `queryName`). The OTel attribute we want to emit is `db.query.name`; matching the shape means the instrumentation hook is a one-liner and future typegen additions (`db.operation.name`, `db.system.name`, etc.) stay consistent.
- **Hook is an around-function**, not a pair of start/end callbacks. An around-function is the canonical shape for OTel's `startActiveSpan(name, fn)`; start/end callbacks are awkward for span scoping and error recording.
- **`instrumentClient` returns the same `Client` shape** — both sync and async — so user code that already typechecks against `SyncClient<T>` or `AsyncClient<T>` keeps working without casts.
- **No dedicated `sqlfu/otel` subpath in this pass.** The hook body is ~10 lines of plain OTel JS API in the test. Once the test shape looks right, we can fold a helper into `sqlfu/otel` in a follow-up.

### Skipped / deferred

- `iterate` instrumentation — would require wrapping the iterator and starting the span lazily. Not needed for OTel parity with the common case (`all`/`run`). Easy to add later by calling the hook inside the generator.
- `raw` instrumentation — no query name available, skip.
- Parameterized-query snapshot cases. Worth adding once the design is validated.
- Failure path snapshot. The hook already handles errors (records exception, sets ERROR status, rethrows) but it isn't asserted in a snapshot yet.
- `@opentelemetry/instrumentation-http` auto-instrumentation. Would show an inbound HTTP span too. Would add a big dependency that isn't needed to prove the feature.

### Files changed

- modified: `packages/sqlfu/package.json` (dev deps)
- modified: `packages/sqlfu/src/client.ts`
- modified: `packages/sqlfu/src/core/types.ts`
- modified: `packages/sqlfu/src/typegen/index.ts`
- modified: `packages/sqlfu/test/generate.test.ts` (snapshot updates only)
- added: `packages/sqlfu/src/core/instrument.ts`
- added: `packages/sqlfu/test/otel-tracing.test.ts`
