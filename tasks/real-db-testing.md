---
status: needs-grilling
size: large
---

# Real / remote DB testing beyond bare adapters

We now have adapter coverage for `@libsql/client`, `@tursodatabase/database`, `@tursodatabase/serverless`, and `@tursodatabase/sync` against a real remote Turso DB (see `packages/sqlfu/test/adapters/turso-remote.test.ts`, gated on `TURSO_TEST_DB_URL`). That proves the adapters **can talk to a real DB**. It does NOT prove the rest of sqlfu — the migrator, diff engine, generator, UI — behave correctly when the DB isn't local.

This task file tracks the work to close the gap so we don't ship and then hear "uh, it doesn't actually work on prod".

## Open questions (grill me)

These decisions affect the plan significantly — need alignment before building:

- Scope: are we targeting *just* Turso Cloud as the "real" backend, or also Cloudflare D1 + Durable Objects + PlanetScale-for-SQLite-style products? (If Turso only: simpler. If generic: we need abstraction over "how do I spin up a scratch DB for this engine?".)
- Isolation: shared single cloud DB + unique table prefixes (what the remote adapter test does now), OR provision-a-fresh-DB-per-test via the Turso admin API? Fresh DB is cleaner but: slow, costs money, needs an admin token with create/destroy perms, needs cleanup if a test crashes.
- Is it OK for CI runs to hit Turso Cloud, or do we want a local-first mock first (sqld in docker) and cloud only on main?
- Do we commit to testing `sqlfu migrate` end-to-end against a remote, or is "migrator functions get called with a remote client and don't crash" enough?

## Things that probably need dedicated real-DB testing

Ordered roughly by risk of "uh, it doesn't work on prod".

### 1. Migrations against a remote DB

The migrator uses `sqlfu_migrations` to track applied state. Against a real DB:

- Does `pragma database_list` return something usable everywhere we use it, on Turso Cloud / D1 / edge?
- Does `begin; ... commit;` behave the way we expect across `@tursodatabase/serverless` (HTTP baton), D1 (batched-statement transactions, no interactive tx), `@tursodatabase/sync` (local-first with push)?
- What happens if the network drops mid-migration? Partial migration recovery — do we re-enter cleanly?
- Does `--check-drift` work when `sqlite_schema` is the remote one?

Red-test target: `migrate` full flow (pending → applied → re-run is a no-op → drift check passes) against a real Turso Cloud DB.

### 2. Schema diff / `sqlite_schema` inspection against remote

`extractSchema` + `inspectSchemaFingerprint` both query `sqlite_schema` + `pragma_table_xinfo` + `pragma_index_list` + `pragma_index_info`. These:

- are supported on Turso Cloud (libsql) but we haven't verified
- are **NOT** fully supported on D1 in all versions (historically `pragma_*` table-valued functions have had gaps)

Red-test target: `sqlfu check` / `sqlfu diff` against each remote backend.

### 3. `sqlfu generate` with a real DB for type inference

We use a temporary in-memory DB today (`packages/ui/test/projects/dev-project` is local). Generate itself probably doesn't need a remote DB because type inference runs from `definitions.sql` directly. **Verify this assumption** — if generate ever peeks at a live DB for anything, that path needs a remote test.

### 4. UI against a remote DB

The UI package uses `createClient` at runtime. Does the UI's "run this query" panel work when the backing client is `@tursodatabase/serverless`? Latency is much higher — do we show a spinner, time out gracefully, handle errors cleanly? Probably lots of minor UX bugs only visible with real latency.

Action: manually poke dev-project with a remote client configured, capture bugs.

### 5. `scratch project` / demo UX against a remote DB

Current dev loop assumes local file. If users point the UI at Turso Cloud, is the "scratch database" affordance (see `packages/ui`) safe to use? We probably don't want the UI to let you accidentally drop tables in a production-shaped DB. Needs a design decision — not just a test.

### 6. Concurrent writes / MVCC semantics

`@tursodatabase/database` advertises concurrent writes. `@libsql/client` serializes. D1 batches. These will eventually bite us if:

- a test assumes row insert ordering
- the migrator assumes "nobody else is writing" mid-migration
- observability hooks see out-of-order query spans

Not urgent but should be tracked.

### 7. Clone / "scratch DB based on a live DB"

User specifically called this out: "eventually that is definitely a scenario we'll need to think about". Need to decide: do we snapshot the remote's schema + seed data into a local file for dev, or do we spin up a fresh Turso DB and replay migrations? The former is cheaper and faster; the latter is closer to prod. Probably both, for different workflows. Design + prototype needed.

## Non-goals (for now)

- Performance / benchmarking across adapters. Interesting but not urgent.
- Every possible backend (D1, Durable Objects, LiteFS, Cloudflare Hyperdrive). Start with Turso Cloud + D1, add others on request.

## Notes

- The current `.env` at repo root has `TURSO_TEST_DB_URL` + `TURSO_TEST_DB_TOKEN` pointing at a personal-dev Turso DB. Fine for local work, but CI needs its own creds (rotate before any public CI).
- `packages/sqlfu/test/adapters/turso-remote.test.ts` is the template for cloud-gated tests. Each test uses `uniqueTableName()` + drops-in-finally so parallel runs / interrupted runs don't accumulate junk tables.
