status: needs-grilling
size: medium

# Dogfood migration queries through sqlfu itself

## Motivation

The migrations implementation (`packages/sqlfu/src/migrations/index.ts`) hand-writes every SQL it runs as inline template strings. That's the part of sqlfu that should most obviously eat its own dogfood — we ship a CLI that tells users "write SQL in files, let typegen give you typed wrappers," then our own migration runtime scribbles statements inline in TS.

From the PR #15 review:

> we're not eating our own dogfood here. this should be in `queries/insert-migration.sql` (under *some* folder or other).

## Why it matters (beyond aesthetics)

- The **fsless** use case is currently *claimed* but not exercised from within the library itself. If `applyMigrations` loaded its own SQL via a typegen-produced bundle, we'd be forced to keep the "no fs.readFile at runtime" path working — right now it's only load-bearing for third-party end users.
- A `definitions.sql` containing the `sqlfu_migrations` table, plus a generated typed wrapper, would mean the checksum/name/applied_at columns flow from one source of truth instead of being re-typed in SQL strings and TS types separately.

## Rough shape

- New internal `queries/` (or equivalent) folder owned by sqlfu itself, with files like:
  - `queries/definitions.sql` — the `sqlfu_migrations` table DDL.
  - `queries/select-migration-history.sql`
  - `queries/insert-migration.sql`
  - `queries/delete-migration-history.sql`
  - (and whatever else the gen functions need)
- Run sqlfu typegen at build time so the generated wrappers ship in the package. Consumers who install via npm should get pre-generated code — they shouldn't need to run our CLI to use our migration runtime.
- Rename `migrations/index.ts` → probably `schema.ts` (or `db.ts`) and make it the barrel for:
  - the migration list
  - the table definitions
  - a few reusable table-based row types (independent of any query: `type SqlfuMigrationRow = { name: string; checksum: string; applied_at: string }`)
  - optionally super-simple helpers that bake everything in, e.g. `db.migrate(client)` — would hide the `{migrations}` arg.

Reviewer's full description is in PR #15 review comment [#3110098823](https://github.com/mmkal/sqlfu/pull/15#discussion_r3110098823).

## Open questions (to grill on before starting)

- Are sqlfu's own migration-runtime queries actually a good fit for typegen in its current shape? Typegen today assumes the consumer has a project with `sqlfu.config` etc. Running it against ourselves may need a carve-out — or may expose a real hole (e.g. library authors can't easily use typegen).
- Do we want `schema.ts` to be the new name, and does `db.ts` as a re-export barrel make things clearer or just redundant?
- Should `ensureMigrationTable` go away entirely once `definitions.sql` is the source of truth for the table shape? Or does it stay for backwards-compat with DBs that predate the switch?
- The dual-dispatch generator plumbing in `migrations/index.ts` is fairly specific to that file. If we split this into `schema.ts` + generated query wrappers, does the generator layer stay, or does each generated wrapper expose a sync + async pair directly?

## Filtered Schema Authorities (critical pre-req)

Moving sqlfu's own migration runtime onto sqlfu typegen means our migration code ends up "owning" a project that has *one* table: `sqlfu_migrations`. If the Desired Schema / Live Schema diff engine treats that project like any other, it will happily recommend dropping every user table in the DB it's pointed at, because they aren't in its definitions. That is obviously catastrophic.

So before this task is viable, we need a story for **scope-filtered schema authorities**. Rough shape:

- Both Desired Schema and Live Schema need a notion of "the set of objects this project is authoritative for".
- For sqlfu-internal: authority = exactly `sqlfu_migrations` (and whatever else `definitions.sql` declares).
- For a normal user project: authority = everything under the project's `definitions.sql` (today's behavior — the filter is "all").
- The filter should probably be declared in config (`authorityPattern` / `authorityScope` / whatever). Needs to cover tables *and* views *and* indexes. Probably a glob-ish matcher.
- Diff engine must respect it on *both* sides: objects outside the scope are invisible, so they're never flagged for create/drop/alter.

Open design questions:

- Is "authority" a single pattern, or does each object type get its own? (E.g. "we own `sqlfu_%` tables but no views" vs. "we own everything named `sqlfu_%`".)
- How does this interact with baselining — does baselining of a sub-scope leave other scopes' histories intact? Probably yes, and that implies `sqlfu_migrations` rows may want a scope/namespace column eventually.
- Do we need a concept of multiple co-existing sqlfu projects in one DB (one for app, one for sqlfu-internal bookkeeping)? If yes, the `sqlfu_migrations` table itself needs a scope/namespace column so each project's history is distinguishable. This is a potential future-proofing ask worth sketching before landing the dogfood change.

This is a hard prerequisite: until the diff engine can be scoped, sqlfu's own migration runtime can't safely run against any real database.

## Not in scope

- Changing the on-disk checksum format (sha256 stays).
- Reworking the sync/async unification itself (that's landing in PR #15).
- Adding new migration features (rollback, squash, etc.).
