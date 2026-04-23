# Observability

Generated queries carry their identity to runtime as a `name` field — the camelCase function name, matching the symbol you import. That name reaches OpenTelemetry spans, Sentry errors, PostHog events, Datadog metrics, and anywhere else you want to see it, without extra configuration per destination.

sqlfu's observability story mostly falls out of making query naming a first-class concept. The instrumentation itself is small: one `instrument(client, ...hooks)` wrapper and a couple of reference hooks.

## The `name` field

Every `.sql` file you check in becomes a generated wrapper whose emitted `SqlQuery` carries its camelCased function name as `name`. For `sql/list-profiles.sql` you get:

```ts
// sql/.generated/list-profiles.sql.ts  (generated - do not edit)
const query: SqlQuery = {sql: ListProfilesSql, args: [], name: 'listProfiles'};
```

Nested directories fold into the same camelCase (`sql/users/list-profiles.sql` → `name: 'usersListProfiles'`, also the exported function name). Function names can't collide because distinct file paths produce distinct names.

Ad-hoc SQL (via `` client.sql`...` ``) has no name, but you can pass one explicitly:

```ts
client.run({sql: 'select 1', args: [], name: 'healthCheck'});
```

## `instrument` helper

```ts
import {instrument} from 'sqlfu';

const client = instrument(
  baseClient,
  instrument.otel({tracer: myOtelTracer}),
  instrument.onError(({context, error}) => myErrorReportingService.report(error)),
);
```

`instrument(client, ...hooks)` wraps a client so every `all` / `run` flows through the hooks in order. Hooks are functions matching `QueryExecutionHook`:

```ts
type QueryExecutionHook = <TResult>(args: {
  context: QueryExecutionContext;   // {query, operation, system}
  execute: () => TResult;           // call the next hook / the underlying adapter
  processResult: ProcessResult;     // sync/async-agnostic helper
}) => TResult;
```

`processResult(execute, onSuccess, onError?)` runs `execute` and dispatches to the right handler regardless of whether the underlying client is sync or async. Synchronous throws and promise rejections both go to `onError`; if `onError` is omitted, errors propagate.

`instrument.otel` and `instrument.onError` are reference implementations. `QueryExecutionHook` is the stable contract, not these helpers. Copy their bodies and edit them if your team has different conventions.

## `instrument.otel({tracer})`

Emits one OTel span per query with:

- `db.query.summary`: your `query.name`, when present
- `db.query.text`: the parameterized SQL (values are in `args`, not interpolated into the text)
- `db.system.name`: the adapter's system (e.g. `sqlite`)

On throw: records the exception as a span event and sets span status to `ERROR`.

The `tracer` parameter is typed structurally (`TracerLike`), so there's no peer dependency on `@opentelemetry/api`. Pass any object with a `startActiveSpan(name, fn)` method. The real OTel `Tracer` satisfies this by construction.

## `instrument.onError(report)`

Calls `report({context, error})` whenever a query throws or its promise rejects, then always rethrows. Errors in the reporter itself are swallowed so they can't mask the original error.

```ts
instrument.onError(({context, error}) => {
  console.error(`query ${context.query.name ?? 'sql'} failed:`, error);
});
```

Every driver error is a [`SqlfuError`](./errors.md) with a normalized `.kind` discriminator — `unique_violation`, `missing_table`, `syntax`, etc. That makes it a natural bucketing dimension in your error reporter (`tags: {'db.error.kind': error.kind}`).

## Recipes

The test files under [`packages/sqlfu/test/observability/`](../test/observability/) are the authoritative copy-paste source for each integration. They exercise the real SDKs against captured transports and are kept passing in CI.

### OpenTelemetry (+ Honeycomb / Grafana Tempo / New Relic / Datadog APM / any OTLP backend)

```ts
import {trace} from '@opentelemetry/api';
import {instrument} from 'sqlfu';

const tracer = trace.getTracer('my-service');
const client = instrument(baseClient, instrument.otel({tracer}));
```

Every OTLP-over-HTTP backend works by swapping the exporter URL. For Datadog APM specifically, either point `@opentelemetry/exporter-trace-otlp-http` at Datadog's OTLP intake, or pass `dd-trace`'s OTel-compatible tracer directly. Either way the `instrument.otel` line stays identical.

Full recipe with failing-query + composed error reporter: [`opentelemetry.test.ts`](../test/observability/opentelemetry.test.ts).

### Sentry

```ts
import * as Sentry from '@sentry/node';
import {instrument} from 'sqlfu';

Sentry.init({dsn: process.env.SENTRY_DSN});

const client = instrument(baseClient,
  instrument.onError(({context, error}) => {
    Sentry.captureException(error, {
      tags: {
        'db.query.summary': context.query.name ?? 'sql',
        'db.system.name': context.system,
      },
      extra: {'db.query.text': context.query.sql},
    });
  }),
);
```

Sentry groups errors by tag, so `db.query.summary` becomes the per-query bucket.

Full recipe: [`sentry.test.ts`](../test/observability/sentry.test.ts).

### PostHog (events + error capture)

PostHog handles product-analytics events and error tracking in the same SDK, so one hook covers both. Success emits `db_query` with timing; failure emits the same event and additionally calls `captureException`:

```ts
import {PostHog} from 'posthog-node';
import {instrument} from 'sqlfu';

const posthog = new PostHog(process.env.POSTHOG_KEY!, {host: 'https://us.i.posthog.com'});

const client = instrument(baseClient,
  ({context, execute, processResult}) => {
    const start = Date.now();
    const distinctId = currentUserId();
    const baseProps = {
      'db.query.summary': context.query.name ?? 'sql',
      'db.system.name': context.system,
      operation: context.operation,
    };
    return processResult(execute,
      (value) => {
        posthog.capture({
          distinctId,
          event: 'db_query',
          properties: {...baseProps, duration_ms: Date.now() - start, outcome: 'success'},
        });
        return value;
      },
      (error) => {
        posthog.capture({
          distinctId,
          event: 'db_query',
          properties: {...baseProps, duration_ms: Date.now() - start, outcome: 'error'},
        });
        posthog.captureException(error, distinctId, {...baseProps, 'db.query.text': context.query.sql});
        throw error;
      },
    );
  },
);
```

PostHog doesn't have a separate "metrics" API. Numeric properties on events are your metrics (`avg(duration_ms) WHERE event = 'db_query'`).

Full recipe: [`posthog.test.ts`](../test/observability/posthog.test.ts).

### Datadog (DogStatsD metrics)

For Datadog APM traces, use the OpenTelemetry recipe above with Datadog's OTel-compatible tracer or OTLP intake. For **metrics** (query counts and timings grouped by `db.query.summary`), use DogStatsD:

```ts
import {StatsD} from 'hot-shots';
import {instrument} from 'sqlfu';

const statsd = new StatsD({host: 'localhost', port: 8125});

const client = instrument(
  baseClient,
  ({context, execute, processResult}) => {
    const start = Date.now();
    const tags = [
      `db.query.summary:${context.query.name ?? 'sql'}`,
      `db.system.name:${context.system}`,
      `operation:${context.operation}`,
    ];
    return processResult(execute,
      (value) => {
        statsd.timing('db.query.duration', Date.now() - start, tags);
        statsd.increment('db.query.count', tags);
        return value;
      },
      (error) => {
        statsd.increment('db.query.count', [...tags, 'outcome:error']);
        throw error;
      },
    );
  },
);
```

Full recipe: [`datadog.test.ts`](../test/observability/datadog.test.ts).

## Caveats

**`client.raw(sql)` is not uniquely identified.** `raw` interpolates values into the SQL text, so per-call distinctness depends on parameter values rather than on a stable name. If you need named observability on dynamic SQL, assemble a `SqlQuery` directly:

```ts
client.run({sql, args, name: 'myQuery'});
```

**`iterate` and `transaction` pass through unchanged.** Queries issued *inside* a transaction still fire hooks because the tx client is re-instrumented on entry. Transactions themselves don't get their own spans. If you want transaction-level spans, wrap `client.transaction(...)` calls yourself using your tracer.

**Composition order is outer-to-inner.** `instrument(client, a, b, c)` means `a` wraps `b` wraps `c` wraps the underlying call. If you put `instrument.otel` first, the OTel span covers everything including any error-reporter work. You can of course wrap yourself if you prefer:

```ts
const myClient = instrument(instrument(baseClient, innerHook), outerHook)
```

## Types

All available from `sqlfu`:

- `instrument`: callable, plus `.otel` and `.onError`
- `QueryExecutionHook`, `QueryExecutionHookArgs`, `QueryExecutionContext`, `QueryOperation`
- `ProcessResult`
- `QueryErrorReport`
- `TracerLike`, `SpanLike`
