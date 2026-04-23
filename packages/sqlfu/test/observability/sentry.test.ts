import * as Sentry from '@sentry/node';
import {DatabaseSync} from 'node:sqlite';
import {expect, test} from 'vitest';

import {createNodeSqliteClient, instrument} from '../../src/index.js';

// Recipe: forward query errors to Sentry.
//
// `instrument.onError` fires whenever a query throws (or its promise
// rejects). Inside the hook, call `Sentry.captureException` with the
// query name as a tag so Sentry groups and labels the error usefully.
//
// In a real app you'd call `Sentry.init({dsn, ...})` once at startup and
// then just write the `instrument.onError(...)` block. This test uses
// `beforeSend` to intercept events in-process instead of sending them
// over HTTP — that part is test scaffolding, not part of the recipe.
test('query errors forward to Sentry with db.query.summary as a tag', async () => {
  await using sentry = setupSentryForTest();

  const db = new DatabaseSync(':memory:');
  db.exec(`create table profiles (id integer primary key, name text not null);`);

  const sqlfuClient = instrument(
    createNodeSqliteClient(db),
    instrument.onError(({context, error}) => {
      Sentry.captureException(error, {
        tags: {
          'db.query.summary': context.query.name ?? 'sql',
          'db.system.name': context.system,
        },
        extra: {
          'db.query.text': context.query.sql,
        },
      });
    }),
  );

  expect(() =>
    sqlfuClient.all({
      sql: 'select * from nonexistent_table',
      args: [],
      name: 'findMissing',
    }),
  ).toThrow(/no such table/);

  const events = await sentry.flush();
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    tags: {
      'db.query.summary': 'findMissing',
      'db.system.name': 'sqlite',
    },
    extra: {
      'db.query.text': 'select * from nonexistent_table',
    },
  });
  expect(events[0]!.exception?.values?.[0]?.value).toContain('no such table: nonexistent_table');
});

function setupSentryForTest() {
  const captured: Sentry.ErrorEvent[] = [];
  const client = new Sentry.NodeClient({
    dsn: 'https://public@sentry.test/1',
    transport: () => ({
      send: async () => ({}),
      flush: async () => true,
    }),
    integrations: [],
    stackParser: Sentry.defaultStackParser,
    beforeSend(event) {
      captured.push(event);
      return null;
    },
  });
  Sentry.setCurrentClient(client);
  client.init();

  return {
    async flush() {
      await Sentry.flush(2000);
      return captured;
    },
    async [Symbol.asyncDispose]() {
      await Sentry.close(2000);
    },
  };
}
