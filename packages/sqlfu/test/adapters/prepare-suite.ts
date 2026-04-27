import {expect, test} from 'vitest';

import type {AsyncClient, SyncClient} from '../../src/index.js';

/**
 * Shared `client.prepare(...)` test suite for adapter test files. Each
 * adapter test file invokes one of these at the bottom (below its own
 * `test(...)` calls and fixture helpers) to cover:
 *
 * - positional `args` array
 * - named `Record` params (`:slug`)
 * - prepare once → `.all(p1)` then `.all(p2)` (different params, same handle)
 * - prepare once → `.all()` then `.run()` (the original "reuse" motivation)
 * - iterating rows
 * - dispose is callable; second dispose call doesn't throw
 *
 * `openClient` is invoked fresh for each test, so the suite never leaks state
 * across cases. Each fixture must implement `Symbol.dispose` (sync) /
 * `Symbol.asyncDispose` (async) on the returned object.
 *
 * The schema seeded into each fixture is `seed_posts` with `(id integer
 * primary key, slug text not null, body text)` and a small fixture row.
 */
export interface PrepareSuiteSyncFixture {
  client: SyncClient;
  [Symbol.dispose](): void;
}

export interface PrepareSuiteAsyncFixture {
  client: AsyncClient;
  [Symbol.asyncDispose](): Promise<void>;
}

export function applySyncPrepareSuite(input: {
  label: string;
  openClient: () => PrepareSuiteSyncFixture;
}): void {
  const {label, openClient} = input;

  test(`${label}: prepare binds positional args via array params`, () => {
    using fixture = openSeededSyncFixture(openClient);
    using stmt = fixture.client.prepare<SeedPostRow>(
      'select id, slug from seed_posts where id = ? order by id',
    );
    expect(stmt.all([1])).toMatchObject([{id: 1, slug: 'first'}]);
  });

  test(`${label}: prepare binds named params via Record`, () => {
    using fixture = openSeededSyncFixture(openClient);
    using stmt = fixture.client.prepare<SeedPostRow>(
      'select id, slug from seed_posts where slug = :slug',
    );
    expect(stmt.all({slug: 'second'})).toMatchObject([{id: 2, slug: 'second'}]);
  });

  test(`${label}: prepare reuses the handle across calls with different params`, () => {
    using fixture = openSeededSyncFixture(openClient);
    using stmt = fixture.client.prepare<SeedPostRow>(
      'select id, slug from seed_posts where id = ?',
    );
    expect(stmt.all([1])).toMatchObject([{id: 1, slug: 'first'}]);
    expect(stmt.all([2])).toMatchObject([{id: 2, slug: 'second'}]);
  });

  test(`${label}: prepare supports .all then .run on the same handle for one statement`, () => {
    using fixture = openSeededSyncFixture(openClient);
    using selectStmt = fixture.client.prepare<SeedPostRow>('select id, slug from seed_posts order by id');
    expect(selectStmt.all()).toHaveLength(2);

    using insertStmt = fixture.client.prepare(
      `insert into seed_posts (slug, body) values (:slug, :body)`,
    );
    const first = insertStmt.run({slug: 'third', body: 'c'});
    const second = insertStmt.run({slug: 'fourth', body: 'd'});
    expect(first.rowsAffected).toBe(1);
    expect(second.rowsAffected).toBe(1);
    expect(selectStmt.all()).toHaveLength(4);
  });

  test(`${label}: prepare iterates rows`, () => {
    using fixture = openSeededSyncFixture(openClient);
    using stmt = fixture.client.prepare<SeedPostRow>('select id, slug from seed_posts order by id');
    expect([...stmt.iterate()]).toMatchObject([
      {id: 1, slug: 'first'},
      {id: 2, slug: 'second'},
    ]);
  });

  test(`${label}: dispose is idempotent`, () => {
    using fixture = openSeededSyncFixture(openClient);
    const stmt = fixture.client.prepare('select 1 as v');
    stmt[Symbol.dispose]();
    expect(() => stmt[Symbol.dispose]()).not.toThrow();
  });
}

export function applyAsyncPrepareSuite(input: {
  label: string;
  openClient: () => PrepareSuiteAsyncFixture | Promise<PrepareSuiteAsyncFixture>;
}): void {
  const {label, openClient} = input;

  test(`${label}: prepare binds positional args via array params`, async () => {
    await using fixture = await openSeededAsyncFixture(openClient);
    await using stmt = fixture.client.prepare<SeedPostRow>(
      'select id, slug from seed_posts where id = ? order by id',
    );
    expect(await stmt.all([1])).toMatchObject([{id: 1, slug: 'first'}]);
  });

  test(`${label}: prepare binds named params via Record`, async () => {
    await using fixture = await openSeededAsyncFixture(openClient);
    await using stmt = fixture.client.prepare<SeedPostRow>(
      'select id, slug from seed_posts where slug = :slug',
    );
    expect(await stmt.all({slug: 'second'})).toMatchObject([{id: 2, slug: 'second'}]);
  });

  test(`${label}: prepare reuses the handle across calls with different params`, async () => {
    await using fixture = await openSeededAsyncFixture(openClient);
    await using stmt = fixture.client.prepare<SeedPostRow>(
      'select id, slug from seed_posts where id = ?',
    );
    expect(await stmt.all([1])).toMatchObject([{id: 1, slug: 'first'}]);
    expect(await stmt.all([2])).toMatchObject([{id: 2, slug: 'second'}]);
  });

  test(`${label}: prepare supports .all then .run on the same handle for one statement`, async () => {
    await using fixture = await openSeededAsyncFixture(openClient);
    await using selectStmt = fixture.client.prepare<SeedPostRow>(
      'select id, slug from seed_posts order by id',
    );
    expect(await selectStmt.all()).toHaveLength(2);

    await using insertStmt = fixture.client.prepare(
      `insert into seed_posts (slug, body) values (:slug, :body)`,
    );
    const first = await insertStmt.run({slug: 'third', body: 'c'});
    const second = await insertStmt.run({slug: 'fourth', body: 'd'});
    expect(first.rowsAffected).toBe(1);
    expect(second.rowsAffected).toBe(1);
    expect(await selectStmt.all()).toHaveLength(4);
  });

  test(`${label}: prepare iterates rows`, async () => {
    await using fixture = await openSeededAsyncFixture(openClient);
    await using stmt = fixture.client.prepare<SeedPostRow>(
      'select id, slug from seed_posts order by id',
    );
    const rows: SeedPostRow[] = [];
    for await (const row of stmt.iterate()) {
      rows.push(row);
    }
    expect(rows).toMatchObject([
      {id: 1, slug: 'first'},
      {id: 2, slug: 'second'},
    ]);
  });

  test(`${label}: dispose is idempotent`, async () => {
    await using fixture = await openSeededAsyncFixture(openClient);
    const stmt = fixture.client.prepare('select 1 as v');
    await stmt[Symbol.asyncDispose]();
    await expect(stmt[Symbol.asyncDispose]()).resolves.not.toThrow();
  });
}

interface SeedPostRow {
  id: number;
  slug: string;
}

function openSeededSyncFixture(open: () => PrepareSuiteSyncFixture): PrepareSuiteSyncFixture {
  const fixture = open();
  fixture.client.raw(SEED_SCHEMA);
  fixture.client.raw(SEED_ROWS);
  return fixture;
}

async function openSeededAsyncFixture(
  open: () => PrepareSuiteAsyncFixture | Promise<PrepareSuiteAsyncFixture>,
): Promise<PrepareSuiteAsyncFixture> {
  const fixture = await open();
  await fixture.client.raw(SEED_SCHEMA);
  await fixture.client.raw(SEED_ROWS);
  return fixture;
}

const SEED_SCHEMA = `
  create table seed_posts (
    id integer primary key,
    slug text not null,
    body text
  );
`;

const SEED_ROWS = `
  insert into seed_posts (slug, body) values
    ('first', 'a'),
    ('second', 'b');
`;
