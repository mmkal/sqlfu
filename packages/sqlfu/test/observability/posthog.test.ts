import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {gunzipSync} from 'node:zlib';
import {PostHog} from 'posthog-node';
import {expect, test} from 'vitest';

import {createNodeSqliteClient, instrument} from '../../src/client.js';

// Recipe: emit a PostHog event per query (success + failure) and capture
// errors as PostHog exceptions — all in one hook.
//
// PostHog surfaces product-analytics events (`capture`) and error
// tracking (`captureException`) through the same SDK. There's no
// separate "metrics" API — numeric properties on events are the metric,
// so you'd query `avg(duration_ms) WHERE event = 'db_query'` in PostHog
// directly.
//
// The hook below:
//   - always emits `db_query` with timing + `outcome: 'success' | 'error'`
//   - additionally calls `captureException` on failure so PostHog's
//     error tracking picks it up with the query name as context
//
// The test scaffolding (local capture server + `await using`) exists so
// we can assert on what would have been sent. In a real app you init a
// PostHog client once at startup and skip that part.
test('queries emit db_query events on success and $exception + db_query on failure', async () => {
  await using posthog = await setupPostHogForTest();

  const db = new DatabaseSync(':memory:');
  db.exec(`create table profiles (id integer primary key, name text not null);`);
  db.exec(`insert into profiles (id, name) values (1, 'ada'), (2, 'linus');`);

  const client = instrument(createNodeSqliteClient(db), ({context, execute, processResult}) => {
    const start = Date.now();
    const distinctId = 'app';
    const baseProps = {
      'db.query.summary': context.query.name ?? 'sql',
      'db.system.name': context.system,
      operation: context.operation,
    };
    return processResult(
      execute,
      (value) => {
        posthog.client.capture({
          distinctId,
          event: 'db_query',
          properties: {...baseProps, duration_ms: Date.now() - start, outcome: 'success'},
        });
        return value;
      },
      (error) => {
        posthog.client.capture({
          distinctId,
          event: 'db_query',
          properties: {...baseProps, duration_ms: Date.now() - start, outcome: 'error'},
        });
        posthog.client.captureException(error, distinctId, {
          ...baseProps,
          'db.query.text': context.query.sql,
        });
        throw error;
      },
    );
  });

  client.all({sql: 'select id, name from profiles order by id', args: [], name: 'listProfiles'});
  expect(() => client.all({sql: 'select * from nonexistent', args: [], name: 'findMissing'})).toThrow(/no such table/);

  const events = await posthog.flush();
  expect(renderEvents(events)).toMatchInlineSnapshot(`
    "db_query  db.query.summary=listProfiles  db.system.name=sqlite  operation=all  outcome=success  duration_ms=<ms>
    db_query  db.query.summary=findMissing  db.system.name=sqlite  operation=all  outcome=error  duration_ms=<ms>
    $exception  db.query.summary=findMissing  db.system.name=sqlite  operation=all  db.query.text=select * from nonexistent  $exception_list=[SqlfuError: no such table: nonexistent]"
  `);
});

interface CapturedEvent {
  event: string;
  properties: Record<string, unknown>;
}

function renderEvents(events: CapturedEvent[]): string {
  const relevantPropertyOrder = [
    'db.query.summary',
    'db.system.name',
    'operation',
    'outcome',
    'duration_ms',
    'db.query.text',
  ];
  return events
    .map((e) => {
      const parts: string[] = [e.event];
      for (const key of relevantPropertyOrder) {
        if (key in e.properties) {
          const raw = e.properties[key];
          const value = key === 'duration_ms' ? '<ms>' : String(raw);
          parts.push(`${key}=${value}`);
        }
      }
      const exceptionList = (e.properties['$exception_list'] ?? undefined) as
        | Array<{type?: string; value?: string}>
        | undefined;
      if (exceptionList && exceptionList.length > 0) {
        const first = exceptionList[0]!;
        parts.push(`$exception_list=[${first.type ?? 'Error'}: ${first.value ?? ''}]`);
      }
      return parts.join('  ');
    })
    .join('\n');
}

async function setupPostHogForTest() {
  const captured: CapturedEvent[] = [];
  const receiver = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      let body = Buffer.concat(chunks);
      if (req.headers['content-encoding'] === 'gzip') {
        body = gunzipSync(body);
      }
      try {
        const parsed = JSON.parse(body.toString('utf8')) as {batch?: CapturedEvent[]};
        for (const event of parsed.batch ?? []) {
          if (event.event === 'db_query' || event.event === '$exception') {
            captured.push({event: event.event, properties: event.properties});
          }
        }
      } catch {
        // posthog may POST other payload shapes on startup; ignore
      }
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end('{}');
    });
  }) as Server;
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const port = (receiver.address() as AddressInfo).port;

  const client = new PostHog('phc_test', {
    host: `http://127.0.0.1:${port}`,
    flushAt: 1,
    flushInterval: 0,
    disableGeoip: true,
  });

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    if (!shutdownPromise) shutdownPromise = client.shutdown();
    return shutdownPromise;
  };

  return {
    client,
    async flush() {
      await shutdown();
      return captured;
    },
    async [Symbol.asyncDispose]() {
      await shutdown();
      await new Promise<void>((resolve, reject) => receiver.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
