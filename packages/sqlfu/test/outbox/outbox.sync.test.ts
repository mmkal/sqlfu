import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

import {expect, test} from 'vitest';

import {createNodeSqliteClient, type SyncClient} from '../../src/index.js';
import {createOutbox, defineConsumer, type Outbox} from '../../src/outbox/index.js';

/**
 * Mirror of `outbox.test.ts`'s scenario, but pinned to the sync path: the
 * outbox is built over a `SyncClient` and `setup()` / `emit()` / `claim()` are
 * asserted to return plain (non-Promise) values. `tick()` stays async because
 * consumer handlers are.
 *
 * If you're chasing parity with the async file, the bodies under each
 * `test(...)` block are deliberately the same shape — the diff between the
 * two files should be exactly: stripped `await`s + `expect(...).not.toBeInstanceOf(Promise)`
 * on the polymorphic methods.
 */

test('setup, emit, claim return plain values on a SyncClient', () => {
  using app = createTestApp();

  const setupResult = app.outbox.setup();
  expect(setupResult).toBeUndefined();
  expect(setupResult).not.toBeInstanceOf(Promise);

  const emitResult = app.signUp('ada@sqlfu.dev');
  expect(emitResult).not.toBeInstanceOf(Promise);
  expect(emitResult).toMatchObject({userId: expect.any(Number)});

  const claimed = app.outbox.claim({limit: 10});
  expect(claimed).not.toBeInstanceOf(Promise);
  expect(Array.isArray(claimed)).toBe(true);
  // onboardingReminder is delayed 24h; the other three are claimable immediately.
  expect(claimed.map((c) => c.consumer_name).sort()).toEqual(
    ['slackAdminNotify', 'testDomainWelcome', 'welcomeEmail'].sort(),
  );
});

test('emit is atomic with the domain write (sync path)', () => {
  using app = createTestApp();
  app.outbox.setup();

  app.signUp('ada@sqlfu.dev');
  expect(app.listUsers()).toHaveLength(1);
  expect(app.listEvents()).toHaveLength(1);
  expect(app.listJobs()).toHaveLength(4);

  expect(() => app.signUpButExplode('grace@example.com')).toThrow('oops');
  expect(app.listUsers()).toHaveLength(1);
  expect(app.listEvents()).toHaveLength(1);
  expect(app.listJobs()).toHaveLength(4);
});

test('fan-out and `when` filter behave the same on the sync path', () => {
  using app = createTestApp();
  app.outbox.setup();

  app.signUp('ada@example.com'); // not a `@sqlfu.dev` / `@test.com` address — skip testDomainWelcome
  const consumers = app.listJobs().map((j) => j.consumer_name).sort();
  expect(consumers).toEqual(['onboardingReminder', 'slackAdminNotify', 'welcomeEmail'].sort());
});

test('tick() drives consumers end-to-end via a sync client', async () => {
  using app = createTestApp();
  app.outbox.setup();
  app.signUp('ada@sqlfu.dev');

  const tickResult = await app.outbox.tick();
  expect(tickResult).toMatchObject({succeeded: 3}); // welcomeEmail + slackAdminNotify + testDomainWelcome
  expect(app.listSentEmails()).toContainEqual(expect.objectContaining({to: 'ada@sqlfu.dev', subject: 'Welcome'}));

  // delayed consumer hasn't fired yet
  expect(app.findJob('onboardingReminder')).toMatchObject({status: 'pending'});

  app.clock.advance(1000 * 60 * 60 * 25); // past the 24h delay
  await app.outbox.tick();
  expect(app.findJob('onboardingReminder')).toMatchObject({status: 'success'});
});

test('handler exceptions still route through the async retry policy', async () => {
  using app = createTestApp();
  app.outbox.setup();
  app.makeNextWelcomeEmailFail('smtp down');
  app.signUp('ada@sqlfu.dev');

  await app.outbox.tick();
  expect(app.findJob('welcomeEmail')).toMatchObject({status: 'pending', attempt: 1, last_error: expect.stringContaining('smtp')});

  app.clock.advance(5000);
  await app.outbox.tick();
  expect(app.findJob('welcomeEmail')).toMatchObject({status: 'success', attempt: 2});
});

/* -------------------------------------------------------------------------- */
/*                               Test app below                               */
/* -------------------------------------------------------------------------- */

type UserSignedUpPayload = {userId: number; email: string};
type ReminderDuePayload = {userId: number; email: string};

type AppEvents = {
  'user:signed_up': UserSignedUpPayload;
  'reminder:due': ReminderDuePayload;
};

function createTestApp() {
  const dbPath = path.join(os.tmpdir(), `sqlfu-outbox-sync-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const database = new DatabaseSync(dbPath);
  const client = createNodeSqliteClient(database);
  bootstrapAppSchema(client);

  const clock = createVirtualClock(new Date('2000-01-01T00:00:00Z').getTime());
  let nextWelcomeEmailError: string | null = null;

  const welcomeEmail = defineConsumer<UserSignedUpPayload, AppEvents>({
    name: 'welcomeEmail',
    retry: (_, error) => ({retry: true, reason: String(error), delay: '5s'}),
    handler: async ({payload}) => {
      if (nextWelcomeEmailError) {
        const err = nextWelcomeEmailError;
        nextWelcomeEmailError = null;
        throw new Error(err);
      }
      client.run({sql: 'insert into sent_emails (to_addr, subject) values (?, ?)', args: [payload.email, 'Welcome']});
    },
  });

  const testDomainWelcome = defineConsumer<UserSignedUpPayload, AppEvents>({
    name: 'testDomainWelcome',
    when: ({payload}) => payload.email.endsWith('@test.com') || payload.email.endsWith('@sqlfu.dev'),
    handler: async ({payload}) => {
      client.run({sql: 'insert into sent_emails (to_addr, subject) values (?, ?)', args: [payload.email, 'Welcome to the test crew']});
    },
  });

  const slackAdminNotify = defineConsumer<UserSignedUpPayload, AppEvents>({
    name: 'slackAdminNotify',
    handler: async ({payload}) => {
      client.run({sql: 'insert into slack_posts (channel, message) values (?, ?)', args: ['#signups', `New user: ${payload.email}`]});
    },
  });

  const onboardingReminder = defineConsumer<UserSignedUpPayload, AppEvents>({
    name: 'onboardingReminder',
    delay: () => '24h',
    handler: async ({payload, emit}) => {
      // Bound emit is Promise-shaped even on the sync path so consumer code stays uniform.
      await emit({name: 'reminder:due', payload: {userId: payload.userId, email: payload.email}});
    },
  });

  const reminderDueHandler = defineConsumer<ReminderDuePayload, AppEvents>({
    name: 'reminderEmail',
    handler: async ({payload}) => {
      client.run({sql: 'insert into sent_emails (to_addr, subject) values (?, ?)', args: [payload.email, 'Still there?']});
    },
  });

  const outbox: Outbox<AppEvents, SyncClient> = createOutbox<AppEvents, SyncClient>({
    client,
    now: () => new Date(clock.now),
    consumers: {
      'user:signed_up': [welcomeEmail, testDomainWelcome, slackAdminNotify, onboardingReminder],
      'reminder:due': [reminderDueHandler],
    },
    defaults: {
      visibilityTimeout: '30s',
      retry: (_, error) => ({retry: false, reason: String(error)}),
      maxAttempts: 2,
    },
  });

  function signUp(email: string): {userId: number} {
    return client.transaction((tx) => {
      const insert = tx.run({sql: 'insert into users (email) values (?) returning id', args: [email]});
      const userId = Number(insert.lastInsertRowid);
      const emitResult = outbox.emit({name: 'user:signed_up', payload: {userId, email}}, {client: tx});
      // Sanity: on the sync path, emit returns a plain value, not a Promise.
      if (emitResult instanceof Promise) throw new Error('expected sync emit() to return a plain value');
      return {userId};
    });
  }

  function signUpButExplode(email: string) {
    return client.transaction((tx) => {
      tx.run({sql: 'insert into users (email) values (?) returning id', args: [email]});
      throw new Error('oops');
    });
  }

  return {
    outbox,
    clock,
    signUp,
    signUpButExplode,
    makeNextWelcomeEmailFail: (msg: string) => {
      nextWelcomeEmailError = msg;
    },
    listUsers: () => client.all<{id: number; email: string}>({sql: 'select * from users order by id', args: []}),
    listEvents: () =>
      client.all<{id: number; name: string; context: string}>({
        sql: 'select id, name, context from sqlfu_outbox_events order by id',
        args: [],
      }),
    listJobs: () =>
      client.all<{
        id: number;
        consumer_name: string;
        status: string;
        attempt: number;
        last_error: string | null;
        run_after: number;
      }>({
        sql: 'select id, consumer_name, status, attempt, last_error, run_after from sqlfu_outbox_jobs order by id',
        args: [],
      }),
    listSentEmails: () =>
      client.all<{to: string; subject: string}>({
        sql: 'select to_addr as "to", subject from sent_emails order by id',
        args: [],
      }),
    findJob: (consumerName: string) => {
      const rows = client.all<{
        id: number;
        consumer_name: string;
        status: string;
        attempt: number;
        last_error: string | null;
      }>({
        sql: 'select id, consumer_name, status, attempt, last_error from sqlfu_outbox_jobs where consumer_name = ? order by id desc limit 1',
        args: [consumerName],
      });
      return rows[0];
    },
    [Symbol.dispose]() {
      database.close();
      // Best-effort cleanup; not awaited because Symbol.dispose is sync.
      void fs.rm(dbPath, {force: true}).catch(() => {});
    },
  };
}

function createVirtualClock(startMs: number) {
  let current = startMs;
  return {
    get now() {
      return current;
    },
    advance(ms: number) {
      current += ms;
    },
  };
}

function bootstrapAppSchema(client: SyncClient) {
  client.raw(`
    create table users (id integer primary key, email text not null unique);
    create table sent_emails (id integer primary key, to_addr text not null, subject text not null);
    create table slack_posts (id integer primary key, channel text not null, message text not null);
  `);
}
