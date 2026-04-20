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

## Not in scope

- Changing the on-disk checksum format (sha256 stays).
- Reworking the sync/async unification itself (that's landing in PR #15).
- Adding new migration features (rollback, squash, etc.).
