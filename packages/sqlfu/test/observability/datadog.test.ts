import {StatsD} from 'hot-shots';
import {createSocket, type Socket} from 'node:dgram';
import type {AddressInfo} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {expect, test} from 'vitest';

import {createNodeSqliteClient, instrument} from '../../src/client.js';

// Recipe: emit per-query metrics to Datadog via DogStatsD (hot-shots).
//
// This is the Datadog path for *metrics* — query counts and timings
// grouped by `db.query.summary` land in Datadog's metric explorer. For
// *APM traces* on Datadog, use `instrument.otel` instead, and either
//   (a) point `@opentelemetry/exporter-trace-otlp-http` at Datadog's
//       OTLP intake (`https://trace.agent.<DD_SITE>/api/v0.2/traces`)
//       with your DD_API_KEY header, or
//   (b) pass dd-trace's OTel-compatible tracer (`trace.getTracer(...)`
//       from `@opentelemetry/api` after `require('dd-trace').init()`).
// Either way, `instrument.otel` is the same one-liner — only the tracer
// instance changes.
test('every query emits a timing + count metric to DogStatsD with tags', async () => {
  await using statsd = await setupStatsdForTest();

  const db = new DatabaseSync(':memory:');
  db.exec(`create table profiles (id integer primary key, name text not null);`);
  db.exec(`insert into profiles (id, name) values (1, 'ada'), (2, 'linus');`);

  const client = instrument(createNodeSqliteClient(db), ({context, execute, processResult}) => {
    const start = Date.now();
    const tags = [
      `db.query.summary:${context.query.name ?? 'sql'}`,
      `db.system.name:${context.system}`,
      `operation:${context.operation}`,
    ];
    return processResult(
      execute,
      (value) => {
        statsd.client.timing('db.query.duration', Date.now() - start, tags);
        statsd.client.increment('db.query.count', tags);
        return value;
      },
      (error) => {
        statsd.client.increment('db.query.count', [...tags, 'outcome:error']);
        throw error;
      },
    );
  });

  client.all({sql: 'select id, name from profiles order by id', args: [], name: 'listProfiles'});
  client.run({sql: 'insert into profiles (name) values (?)', args: ['grace'], name: 'insertProfile'});

  const packets = await statsd.flush();
  expect(renderPackets(packets)).toMatchInlineSnapshot(`
    "db.query.duration:<ms>|ms|#db.query.summary:listProfiles,db.system.name:sqlite,operation:all
    db.query.count:1|c|#db.query.summary:listProfiles,db.system.name:sqlite,operation:all
    db.query.duration:<ms>|ms|#db.query.summary:insertProfile,db.system.name:sqlite,operation:run
    db.query.count:1|c|#db.query.summary:insertProfile,db.system.name:sqlite,operation:run"
  `);
});

interface StatsdPacket {
  metric: string;
  value: number;
  type: 'c' | 'ms' | 'g' | 'h';
  tags: string[];
}

function renderPackets(packets: StatsdPacket[]): string {
  return packets
    .map((packet) => {
      const value = packet.metric === 'db.query.duration' ? '<ms>' : String(packet.value);
      const tags = [...packet.tags].sort().join(',');
      return `${packet.metric}:${value}|${packet.type}|#${tags}`;
    })
    .join('\n');
}

async function setupStatsdForTest() {
  const packets: StatsdPacket[] = [];
  const socket: Socket = createSocket('udp4');
  socket.on('message', (message) => {
    // DogStatsD wire format: `<metric>:<value>|<type>|#<tag>,<tag>`
    for (const line of message.toString('utf8').split('\n')) {
      if (!line) continue;
      const hashIndex = line.indexOf('|#');
      const tags = hashIndex === -1 ? [] : line.slice(hashIndex + 2).split(',');
      const head = hashIndex === -1 ? line : line.slice(0, hashIndex);
      const [metricAndValue, type] = head.split('|');
      const colonIndex = metricAndValue!.indexOf(':');
      packets.push({
        metric: metricAndValue!.slice(0, colonIndex),
        value: Number(metricAndValue!.slice(colonIndex + 1)),
        type: type as StatsdPacket['type'],
        tags,
      });
    }
  });
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const port = (socket.address() as AddressInfo).port;

  const client = new StatsD({host: '127.0.0.1', port, cacheDns: false});

  return {
    client,
    async flush() {
      await new Promise<void>((resolve, reject) => client.close((err) => (err ? reject(err) : resolve())));
      // Give the UDP socket a tick to receive in-flight packets.
      await new Promise((resolve) => setImmediate(resolve));
      return packets;
    },
    async [Symbol.asyncDispose]() {
      await new Promise<void>((resolve) => {
        socket.close(() => resolve());
      });
    },
  };
}
