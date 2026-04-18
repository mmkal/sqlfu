import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {gunzipSync} from 'node:zlib';
import {PostHog} from 'posthog-node';
import {expect, test} from 'vitest';

import {createNodeSqliteClient, instrument, type QueryExecutionHook} from '../../src/client.js';

// Recipe: emit a PostHog event per query with timing.
//
// Neither `instrument.onError` nor `instrument.otel` fits PostHog —
// PostHog is event-capture, not tracing or error reporting. But any
// function matching `QueryExecutionHook` plugs straight into `instrument`,
// so we write a small hook inline. That function is the whole recipe.
//
// The test scaffolding (local capture server + `await using posthog`)
// exists so we can make assertions on what would have been sent over the
// wire; in a real app you init a PostHog client once at startup and skip
// that part.
test('every query emits a db_query event to PostHog with name and duration', async () => {
  await using posthog = await setupPostHogForTest();

  const captureQuery: QueryExecutionHook = ({context, execute, processResult}) => {
    const start = Date.now();
    return processResult(execute, (value) => {
      posthog.client.capture({
        distinctId: 'app',
        event: 'db_query',
        properties: {
          'db.query.summary': context.query.name ?? 'sql',
          'db.system.name': context.system,
          duration_ms: Date.now() - start,
          operation: context.operation,
        },
      });
      return value;
    });
  };

  const db = new DatabaseSync(':memory:');
  db.exec(`create table profiles (id integer primary key, name text not null);`);
  db.exec(`insert into profiles (id, name) values (1, 'ada'), (2, 'linus');`);

  const client = instrument(createNodeSqliteClient(db), captureQuery);

  client.all({sql: 'select id, name from profiles order by id', args: [], name: 'list-profiles'});
  client.run({sql: 'insert into profiles (name) values (?)', args: ['grace'], name: 'insert-profile'});

  const events = await posthog.flush();
  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({
    event: 'db_query',
    properties: {
      'db.query.summary': 'list-profiles',
      'db.system.name': 'sqlite',
      operation: 'all',
    },
  });
  expect(events[1]).toMatchObject({
    event: 'db_query',
    properties: {
      'db.query.summary': 'insert-profile',
      'db.system.name': 'sqlite',
      operation: 'run',
    },
  });
  expect(events[0]!.properties.duration_ms).toBeTypeOf('number');
});

async function setupPostHogForTest() {
  const captured: Array<{event: string; properties: Record<string, unknown>}> = [];
  const receiver = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      let body = Buffer.concat(chunks);
      if (req.headers['content-encoding'] === 'gzip') {
        body = gunzipSync(body);
      }
      try {
        const parsed = JSON.parse(body.toString('utf8')) as {batch?: Array<{event: string; properties: Record<string, unknown>}>};
        for (const event of parsed.batch ?? []) {
          captured.push({event: event.event, properties: event.properties});
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
      return captured.filter((e) => e.event === 'db_query');
    },
    async [Symbol.asyncDispose]() {
      await shutdown();
      await new Promise<void>((resolve, reject) =>
        receiver.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}
