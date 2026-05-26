// Test fixtures for `@sqlfu/pg`. The test runner expects a postgres server
// reachable at the URL below — start one via docker-compose:
//
//   docker compose -f packages/pg/test/docker-compose.yml up -d
//
// Per-test fixtures (`startTempDatabase`, `startTempDatabasePair`) wrap
// the dialect's own scratch helpers with the same `Symbol.asyncDispose`
// pattern, so `await using` cleans up automatically.
import {createTempDatabase, createTempDatabasePair} from '../src/impl/scratch-database.js';

export const TEST_ADMIN_URL = process.env.SQLFU_PG_TEST_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5544/postgres';

export async function isPgReachable(): Promise<boolean> {
  // Cheap reachability probe — open + close. If postgres isn't running we
  // surface a clear skip message in tests rather than 30s of mysterious
  // timeouts.
  const {Client} = await import('pg');
  const client = new Client({connectionString: TEST_ADMIN_URL});
  try {
    await client.connect();
    await client.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    try {
      await client.end();
    } catch {}
  }
}

/** Spin up a single ephemeral pg database. Disposed via `await using`. */
export const startTempDatabase = () => createTempDatabase(TEST_ADMIN_URL);

/** Spin up a pair (baseline + desired). Disposed via `await using`. */
export const startTempDatabasePair = () => createTempDatabasePair(TEST_ADMIN_URL);

/**
 * Ensure cluster-wide roles referenced by lifted pgkit fixtures exist.
 * Idempotent — calling twice is a no-op. Roles are cluster-scoped, so
 * one creation suffices for all ephemeral scratch dbs.
 *
 * Currently only `schemainspect_test_role`, used by RLS/policy fixtures.
 */
export async function ensureFixtureRoles(): Promise<void> {
  const {Client} = await import('pg');
  const admin = new Client({connectionString: TEST_ADMIN_URL});
  await admin.connect();
  try {
    await admin.query(`do $$ begin
      create role schemainspect_test_role;
    exception
      when duplicate_object or unique_violation then null;
    end $$`);
  } finally {
    await admin.end();
  }
}
