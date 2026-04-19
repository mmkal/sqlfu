import {serve} from '@hono/node-server';
import {type Tracer, trace} from '@opentelemetry/api';
import {OTLPTraceExporter} from '@opentelemetry/exporter-trace-otlp-http';
import {NodeTracerProvider, SimpleSpanProcessor} from '@opentelemetry/sdk-trace-node';
import {Hono} from 'hono';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {expect, test} from 'vitest';

import {createNodeSqliteClient, instrument, type SqlQuery} from '../../src/client.js';

// This recipe covers any backend that accepts OTLP over HTTP: OpenTelemetry
// collectors, Honeycomb, Grafana Tempo, New Relic, and Datadog (point the
// `OTLPTraceExporter` url at Datadog's intake URL and add the API key
// header). The hook wiring below is identical for every destination — only
// the exporter's URL and headers change.
test('named and ad-hoc queries surface on OTel spans and error reporter fires on failure', async () => {
  await using otel = await createOtelFixture();
  const errorReports: Array<{queryName: string | undefined; error: unknown}> = [];

  const db = new DatabaseSync(':memory:');
  db.exec(`
    create table profiles (id integer primary key, name text not null);
    insert into profiles (name) values ('ada');
    insert into profiles (name) values ('linus');
  `);

  const client = instrument(
    createNodeSqliteClient(db),
    instrument.otel({tracer: otel.tracer}),
    instrument.onError(({context, error}) => {
      errorReports.push({queryName: context.query.name, error});
    }),
  );

  const listProfilesQuery: SqlQuery = {
    sql: 'select id, name from profiles order by id',
    args: [],
    name: 'list-profiles',
  };
  const brokenQuery: SqlQuery = {
    sql: 'select * from nonexistent_table',
    args: [],
    name: 'broken-query',
  };

  const app = new Hono();
  app.get('/profiles', (c) =>
    otel.tracer.startActiveSpan('GET /profiles', (span) => {
      try {
        return c.json({profiles: client.all(listProfilesQuery)});
      } finally {
        span.end();
      }
    }),
  );
  app.get('/ad-hoc', (c) =>
    otel.tracer.startActiveSpan('GET /ad-hoc', (span) => {
      try {
        return c.json(client.sql.all<{answer: number}>`select 1 + 1 as answer`[0]!);
      } finally {
        span.end();
      }
    }),
  );
  app.get('/broken', (c) =>
    otel.tracer.startActiveSpan('GET /broken', (span) => {
      try {
        client.all(brokenQuery);
        return c.json({unreachable: true});
      } catch (error) {
        return c.json({error: (error as Error).message}, 500);
      } finally {
        span.end();
      }
    }),
  );

  await using server = await startHonoServer(app);

  expect(await server.get('/profiles').then((r) => r.json())).toEqual({
    profiles: [{id: 1, name: 'ada'}, {id: 2, name: 'linus'}],
  });
  expect(await server.get('/ad-hoc').then((r) => r.json())).toEqual({answer: 2});
  expect((await server.get('/broken')).status).toBe(500);

  expect(await otel.renderTrace()).toMatchInlineSnapshot(`
    "GET /profiles
      list-profiles
        db.query.summary=list-profiles
        db.query.text=select id, name from profiles order by id
        db.system.name=sqlite
        status=OK
    GET /ad-hoc
      sql-query-3c297b4
        db.query.text=select 1 + 1 as answer
        db.system.name=sqlite
        status=OK
    GET /broken
      broken-query
        db.query.summary=broken-query
        db.query.text=select * from nonexistent_table
        db.system.name=sqlite
        exception: no such table: nonexistent_table
        status=ERROR"
  `);

  expect(errorReports).toHaveLength(1);
  expect(errorReports[0]!.queryName).toBe('broken-query');
  expect((errorReports[0]!.error as Error).message).toContain('no such table: nonexistent_table');
});

interface CollectedSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly name: string;
  readonly startTimeUnixNano: string;
  readonly attributes: Record<string, string | number | boolean>;
  readonly events: ReadonlyArray<{name: string; attributes: Record<string, string | number | boolean>}>;
  readonly statusCode: number | undefined;
}

async function createOtelFixture() {
  const collected: CollectedSpan[] = [];
  const receiver = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      collected.push(...flattenOtlpTraces(JSON.parse(body)));
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const port = (receiver.address() as AddressInfo).port;

  const exporter = new OTLPTraceExporter({url: `http://127.0.0.1:${port}/v1/traces`});
  const provider = new NodeTracerProvider({spanProcessors: [new SimpleSpanProcessor(exporter)]});
  provider.register();
  const tracer: Tracer = trace.getTracer('sqlfu-otel-test');

  return {
    tracer,
    async renderTrace() {
      await provider.forceFlush();
      return renderTraceTree(collected);
    },
    async [Symbol.asyncDispose]() {
      await provider.shutdown();
      await new Promise<void>((resolve, reject) => receiver.close((err) => (err ? reject(err) : resolve())));
    },
  };
}

async function startHonoServer(app: Hono) {
  const server = serve({fetch: app.fetch, port: 0, hostname: '127.0.0.1'}) as Server;
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    get(path: string) {
      return fetch(`${baseUrl}${path}`);
    },
    async [Symbol.asyncDispose]() {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}

function flattenOtlpTraces(payload: unknown): CollectedSpan[] {
  const spans: CollectedSpan[] = [];
  const resourceSpans = (payload as {resourceSpans?: unknown[]}).resourceSpans ?? [];
  for (const rs of resourceSpans as Array<{scopeSpans?: unknown[]}>) {
    for (const ss of (rs.scopeSpans ?? []) as Array<{spans?: unknown[]}>) {
      for (const raw of (ss.spans ?? []) as RawSpan[]) {
        spans.push({
          traceId: raw.traceId,
          spanId: raw.spanId,
          parentSpanId: raw.parentSpanId && raw.parentSpanId !== '' ? raw.parentSpanId : undefined,
          name: raw.name,
          startTimeUnixNano: String(raw.startTimeUnixNano),
          attributes: flattenAttributes(raw.attributes ?? []),
          events: (raw.events ?? []).map((event) => ({
            name: event.name,
            attributes: flattenAttributes(event.attributes ?? []),
          })),
          statusCode: raw.status?.code,
        });
      }
    }
  }
  return spans;
}

interface RawSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly startTimeUnixNano: string | number;
  readonly attributes?: readonly {key: string; value: Record<string, unknown>}[];
  readonly events?: readonly {name: string; attributes?: readonly {key: string; value: Record<string, unknown>}[]}[];
  readonly status?: {code?: number};
}

function flattenAttributes(attributes: readonly {key: string; value: Record<string, unknown>}[]): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const attribute of attributes) {
    const value = attribute.value;
    if ('stringValue' in value) {
      result[attribute.key] = value.stringValue as string;
    } else if ('intValue' in value) {
      result[attribute.key] = Number(value.intValue);
    } else if ('boolValue' in value) {
      result[attribute.key] = Boolean(value.boolValue);
    } else if ('doubleValue' in value) {
      result[attribute.key] = Number(value.doubleValue);
    }
  }
  return result;
}

function renderTraceTree(spans: readonly CollectedSpan[]): string {
  const byTrace = new Map<string, CollectedSpan[]>();
  for (const span of spans) {
    let group = byTrace.get(span.traceId);
    if (!group) {
      group = [];
      byTrace.set(span.traceId, group);
    }
    group.push(span);
  }

  const traces = Array.from(byTrace.values()).sort((left, right) => {
    const leftRoot = findRoot(left);
    const rightRoot = findRoot(right);
    return leftRoot.startTimeUnixNano.localeCompare(rightRoot.startTimeUnixNano);
  });

  const lines: string[] = [];
  for (const group of traces) {
    const byParent = new Map<string | undefined, CollectedSpan[]>();
    for (const span of group) {
      const children = byParent.get(span.parentSpanId) ?? [];
      children.push(span);
      byParent.set(span.parentSpanId, children);
    }
    for (const children of byParent.values()) {
      children.sort((left, right) => left.startTimeUnixNano.localeCompare(right.startTimeUnixNano));
    }
    renderSubtree(undefined, byParent, 0, lines);
  }
  return lines.join('\n');
}

function findRoot(spans: readonly CollectedSpan[]): CollectedSpan {
  return spans.find((span) => !span.parentSpanId) ?? spans[0]!;
}

function renderSubtree(
  parentId: string | undefined,
  byParent: ReadonlyMap<string | undefined, readonly CollectedSpan[]>,
  depth: number,
  lines: string[],
): void {
  const children = byParent.get(parentId) ?? [];
  for (const span of children) {
    const indent = '  '.repeat(depth);
    lines.push(`${indent}${span.name}`);
    for (const [key, value] of Object.entries(span.attributes).sort(([l], [r]) => l.localeCompare(r))) {
      lines.push(`${indent}  ${key}=${String(value)}`);
    }
    for (const event of span.events) {
      if (event.name === 'exception') {
        const message = event.attributes['exception.message'] ?? '<no message>';
        lines.push(`${indent}  exception: ${String(message)}`);
      }
    }
    if (span.statusCode === 2) {
      lines.push(`${indent}  status=ERROR`);
    } else if (span.statusCode === 1) {
      lines.push(`${indent}  status=OK`);
    }
    renderSubtree(span.spanId, byParent, depth + 1, lines);
  }
}
