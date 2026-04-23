import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

import {expect, test} from 'vitest';

import {createNodeSqliteClient, type Client} from '../../src/index.js';
import {createOutbox, defineConsumer, type Outbox} from '../../src/outbox/index.js';

/**
 * End-to-end scenario: a tiny saas app uses the outbox to fan out `user:signed_up`
 * to multiple consumers, one of them delayed, and the delayed one in turn emits
 * a follow-up event. This test drives the whole thing from a handful of observable
 * side-effects (the app's own `sent_emails` + `slack_posts` tables) rather than
 * by poking the outbox internals.
 */

test('emit is atomic with the domain write', async () => {
  await using app = await createTestApp();

  // happy path: signUp inserts a user AND emits in the same transaction
  await app.signUp('ada@sqlfu.dev');
  expect(await app.listUsers()).toHaveLength(1);
  expect(await app.listEvents()).toHaveLength(1);
  expect(await app.listJobs()).toHaveLength(4); // 3 consumers for user:signed_up

  // failure path: if the domain write throws after emit, everything rolls back
  await expect(app.signUpButExplode('grace@example.com')).rejects.toThrow('oops');
  expect(await app.listUsers()).toHaveLength(1); // still just ada
  expect(await app.listEvents()).toHaveLength(1);
  expect(await app.listJobs()).toHaveLength(4);
});

test('fan-out: one event creates one job per matching consumer', async () => {
  await using app = await createTestApp();
  await app.signUp('ada@sqlfu.dev');

  const jobs = await app.listJobs();
  expect(jobs.map((j) => j.consumer_name).sort()).toEqual(
    ['onboardingReminder', 'slackAdminNotify', 'testDomainWelcome', 'welcomeEmail'].sort(),
  );
  for (const job of jobs) expect(job.status).toBe('pending');
});

test('`when` filter skips consumers whose predicate is falsy', async () => {
  await using app = await createTestApp();
  await app.signUp('ada@example.com'); // NOT @test.com — `testDomainWelcome` should not fan out

  const consumers = (await app.listJobs()).map((j) => j.consumer_name).sort();
  expect(consumers).toEqual(['onboardingReminder', 'slackAdminNotify', 'welcomeEmail'].sort());
  expect(consumers).not.toContain('testDomainWelcome');
});

test('retries a transient failure and eventually succeeds', async () => {
  await using app = await createTestApp();
  app.makeNextWelcomeEmailFail('smtp down');
  await app.signUp('ada@sqlfu.dev');

  // first tick: welcomeEmail attempt 1 fails and gets scheduled for retry
  await app.tick();
  const welcomeAfterFirst = await app.findJob('welcomeEmail');
  expect(welcomeAfterFirst).toMatchObject({status: 'pending', attempt: 1, last_error: expect.stringContaining('smtp')});

  // still too soon — retry backoff hasn't elapsed
  await app.tick();
  expect(await app.findJob('welcomeEmail')).toMatchObject({status: 'pending', attempt: 1});

  // advance past the retry delay — tick re-runs and succeeds
  app.clock.advance(5000);
  await app.tick();
  expect(await app.findJob('welcomeEmail')).toMatchObject({status: 'success', attempt: 2});
  expect(await app.listSentEmails()).toContainEqual(expect.objectContaining({to: 'ada@sqlfu.dev'}));
});

test('permanent failure after retries lands in status=failed', async () => {
  await using app = await createTestApp();
  app.makeWelcomeEmailAlwaysFail('permanently broken');
  await app.signUp('ada@sqlfu.dev');

  // drive the retry schedule to exhaustion — app retry policy caps at 2 attempts
  for (let i = 0; i < 5; i++) {
    await app.tick();
    app.clock.advance(10_000);
  }

  expect(await app.findJob('welcomeEmail')).toMatchObject({
    status: 'failed',
    last_error: expect.stringContaining('permanently broken'),
  });
});

test('delayed consumer does not fire until its run_after', async () => {
  await using app = await createTestApp();
  await app.signUp('ada@sqlfu.dev');

  await app.tick();
  expect(await app.findJob('onboardingReminder')).toMatchObject({status: 'pending'});
  expect(await app.findJob('welcomeEmail')).toMatchObject({status: 'success'});

  app.clock.advance(1000 * 60 * 60 * 23); // 23h — still too early
  await app.tick();
  expect(await app.findJob('onboardingReminder')).toMatchObject({status: 'pending'});

  app.clock.advance(1000 * 60 * 60 * 2); // 25h total, past the 24h delay
  await app.tick();
  expect(await app.findJob('onboardingReminder')).toMatchObject({status: 'success'});
});

test('events emitted inside a handler carry causation back to the originating job', async () => {
  await using app = await createTestApp();
  await app.signUp('ada@sqlfu.dev');

  app.clock.advance(1000 * 60 * 60 * 25); // fast-forward past the 24h delay
  await app.tick();
  await app.tick(); // second tick drains the reminder:due event emitted by the first

  const reminderDueEvent = (await app.listEvents()).find((e) => e.name === 'reminder:due');
  expect(reminderDueEvent).toBeDefined();
  const context = JSON.parse(reminderDueEvent!.context) as {causedBy?: {consumerName: string}};
  expect(context.causedBy?.consumerName).toBe('onboardingReminder');

  // the follow-up email actually lands
  expect(await app.listSentEmails()).toContainEqual(expect.objectContaining({subject: 'Still there?'}));
});

test('visibility-timeout expiry allows crash recovery', async () => {
  await using app = await createTestApp();
  await app.signUp('ada@sqlfu.dev');

  // simulate a worker crashing after claim but before completing: claim without processing
  const claimed = await app.outbox.claim({limit: 10});
  expect(claimed.some((c) => c.consumer_name === 'welcomeEmail')).toBe(true);
  expect(await app.findJob('welcomeEmail')).toMatchObject({status: 'running'});

  // before VT expires — nothing can re-claim it
  await app.tick();
  expect(await app.findJob('welcomeEmail')).toMatchObject({status: 'running', attempt: 0});

  // fast-forward past the VT — next tick re-claims the orphaned job and processes it
  app.clock.advance(1000 * 60); // 60s — default VT is 30s
  await app.tick();
  expect(await app.findJob('welcomeEmail')).toMatchObject({status: 'success'});
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

async function createTestApp() {
  const dbPath = path.join(os.tmpdir(), `sqlfu-outbox-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
  const database = new DatabaseSync(dbPath);
  const client = createNodeSqliteClient(database);
  bootstrapAppSchema(client);

  const clock = createVirtualClock(new Date('2000-01-01T00:00:00Z').getTime());
  let nextWelcomeEmailError: string | null = null;
  let welcomeEmailAlwaysError: string | null = null;

  const welcomeEmail = defineConsumer<UserSignedUpPayload, AppEvents>({
    name: 'welcomeEmail',
    retry: (_, error) => ({retry: true, reason: String(error), delay: '5s'}),
    handler: async ({payload}) => {
      if (welcomeEmailAlwaysError) throw new Error(welcomeEmailAlwaysError);
      if (nextWelcomeEmailError) {
        const err = nextWelcomeEmailError;
        nextWelcomeEmailError = null;
        throw new Error(err);
      }
      await client.run({
        sql: 'insert into sent_emails (to_addr, subject) values (?, ?)',
        args: [payload.email, 'Welcome'],
      });
    },
  });

  const testDomainWelcome = defineConsumer<UserSignedUpPayload, AppEvents>({
    name: 'testDomainWelcome',
    when: ({payload}) => payload.email.endsWith('@test.com') || payload.email.endsWith('@sqlfu.dev'),
    handler: async ({payload}) => {
      await client.run({
        sql: 'insert into sent_emails (to_addr, subject) values (?, ?)',
        args: [payload.email, 'Welcome to the test crew'],
      });
    },
  });

  const slackAdminNotify = defineConsumer<UserSignedUpPayload, AppEvents>({
    name: 'slackAdminNotify',
    handler: async ({payload}) => {
      await client.run({
        sql: 'insert into slack_posts (channel, message) values (?, ?)',
        args: ['#signups', `New user: ${payload.email}`],
      });
    },
  });

  const onboardingReminder = defineConsumer<UserSignedUpPayload, AppEvents>({
    name: 'onboardingReminder',
    delay: () => '24h',
    handler: async ({payload, emit}) => {
      await emit({name: 'reminder:due', payload: {userId: payload.userId, email: payload.email}});
    },
  });

  const reminderDueHandler = defineConsumer<ReminderDuePayload, AppEvents>({
    name: 'reminderEmail',
    handler: async ({payload}) => {
      await client.run({
        sql: 'insert into sent_emails (to_addr, subject) values (?, ?)',
        args: [payload.email, 'Still there?'],
      });
    },
  });

  const outbox: Outbox<AppEvents> = createOutbox<AppEvents>({
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
  await outbox.setup();

  async function signUp(email: string) {
    return client.transaction(async (tx) => {
      const insert = await tx.run({sql: 'insert into users (email) values (?) returning id', args: [email]});
      const userId = Number(insert.lastInsertRowid);
      await outbox.emit({name: 'user:signed_up', payload: {userId, email}}, {client: tx});
      return userId;
    });
  }

  async function signUpButExplode(email: string) {
    return client.transaction(async (tx) => {
      const insert = await tx.run({sql: 'insert into users (email) values (?) returning id', args: [email]});
      const userId = Number(insert.lastInsertRowid);
      await outbox.emit({name: 'user:signed_up', payload: {userId, email}}, {client: tx});
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
    makeWelcomeEmailAlwaysFail: (msg: string) => {
      welcomeEmailAlwaysError = msg;
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
    findJob: async (consumerName: string) => {
      const rows = await client.all<{
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
    tick: () => outbox.tick(),
    async [Symbol.asyncDispose]() {
      database.close();
      await fs.rm(dbPath, {force: true}).catch(() => {});
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

function bootstrapAppSchema(client: Client) {
  client.raw(`
    create table users (id integer primary key, email text not null unique);
    create table sent_emails (id integer primary key, to_addr text not null, subject text not null);
    create table slack_posts (id integer primary key, channel text not null, message text not null);
  `);
}
