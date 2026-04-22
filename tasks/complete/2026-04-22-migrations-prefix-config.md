---
status: done
size: small
---

# Configurable migration filename prefix

## Status

Done. Implementation + tests + docs committed on branch `migrations-prefix-config` (PR #45). Internal `SqlfuProjectConfig.migrations` is normalized to the object form, `getMigrationPrefix` takes the prefix kind + existing file list, `applyDraftSql` threads it through, and five new tests under `packages/sqlfu/test/migrations/prefix-config.test.ts` cover the documented behavior. Doc section added to `packages/sqlfu/docs/migration-model.md`.

## Summary

The `migrations` config option is currently a bare string (path to the migrations directory), and new migrations are always created with an ISO-timestamp prefix like `2026-04-22T10.30.45.123Z_create_people.sql`.

This task widens the config to:

```ts
migrations: string | { path: string; prefix: 'iso' | 'four-digit' }
```

The string form keeps today's behavior (`prefix: 'iso'`). The object form lets a project opt into a sequential four-digit prefix like `0000_create_people.sql`, `0001_add_column.sql`, etc. That's the convention used by pgkit, Kysely, Prisma, etc. — so a project adopting sqlfu with an existing `0000`/`0001`/... layout can keep its existing files AND have newly drafted migrations match the format instead of suddenly switching to ISO.

## Non-goals

- Configurable width. Hard-code four digits for now. We can add `{ kind: 'sequential', width: 6 }` later without breaking the `'four-digit'` literal.
- Renaming or migrating existing files between prefix schemes. If a project mixes formats, that's on them.
- ISO → four-digit switch in an existing ISO project. It's allowed, but lexicographic ordering between ISO and four-digit filenames is not coherent, and we won't try to paper over that. Documented as a caveat.

## Behavior

### Config surface

```ts
// all valid
{ migrations: './migrations' }
{ migrations: { path: './migrations', prefix: 'iso' } }
{ migrations: { path: './migrations', prefix: 'four-digit' } }
```

- The string form is sugar for `{ path: <string>, prefix: 'iso' }`.
- `prefix` is required in the object form (no default).

### New migration naming

- `'iso'` → `<now.toISOString() with ':' → '.'>_<slug>.sql` (today's behavior, unchanged).
- `'four-digit'` → `<NNNN>_<slug>.sql` where `NNNN` is:
  - If the migrations dir contains zero files whose basename matches `^\d{4}_`, start at `0000`.
  - Otherwise, take the max integer across those matching files and add 1, zero-padded to four digits.
  - Files whose basename does not match `^\d{4}_` are ignored when computing the next integer. They still affect sort order as usual, but they don't block numbering.

### What does NOT change

- Migration discovery and ordering still sort by filename (lexicographic). Both ISO and four-digit prefixes sort naturally within themselves.
- The key stored in the `sqlfu_migrations` table is still `basename(path, '.sql')`. A migration applied before this change remains identified by its full filename; nothing gets re-applied.
- `parseMigrationId` in the UI router still splits on the first `_`, which works for both prefix formats.

## Checklist

- [x] Widen the `migrations` config schema in `packages/sqlfu/src/core/types.ts` (`SqlfuConfig` and `SqlfuProjectConfig`) and update `assertConfigShape` + `resolveProjectConfig` in `packages/sqlfu/src/core/config.ts` to accept the object form and normalize to a single internal shape `{ path: string; prefix: 'iso' | 'four-digit' }`. _Added `SqlfuMigrationPrefix` / `SqlfuMigrationsConfig` types; internal form is always the object._
- [x] Replace `getMigrationPrefix(now: Date)` in `packages/sqlfu/src/api.ts` with something that takes the prefix kind and, for `'four-digit'`, the current list of migration files in the directory. Keep the output shape as a string that's then interpolated into `${prefix}_${slug}.sql`. _New signature: `getMigrationPrefix({kind, now, existing})`._
- [x] Update `applyDraftSql` in `packages/sqlfu/src/api.ts` to feed the configured prefix kind into the new helper.
- [x] Update `packages/sqlfu/test/migrations/fixture.ts` helpers so tests can opt into `four-digit` prefix, and keep existing ISO tests passing unchanged. _Added `migrationPrefix?: SqlfuMigrationPrefix` fixture input; pre-seeded filename generation respects it._
- [x] Add tests in `packages/sqlfu/test/migrations/` that cover:
  - [x] `prefix: 'four-digit'` in a fresh migrations dir produces `0000_*.sql`, then `0001_*.sql`, etc.
  - [x] `prefix: 'four-digit'` with existing `0003_foo.sql` produces `0004_<slug>.sql`.
  - [x] `prefix: 'four-digit'` with existing non-matching files (e.g. an old ISO-style migration) still starts at `0000` / respects only four-digit peers.
  - [x] Object config form `{ path, prefix: 'iso' }` behaves identically to the bare-string form.
- [x] ~~If there's a config-schema test that snapshots the accepted config shape, update it.~~ _No such snapshot test exists; `assertConfigShape` has no dedicated unit test to update. Validation is exercised indirectly through project loading._
- [x] Decide doc placement using the "Deciding where a feature gets documented" rubric in `CLAUDE.md`. Candidate surface: a sentence + example in the migrations docs page (`packages/sqlfu/docs/migrations.md` or whatever the current page is called). Likely NOT a landing-page panel. _Landed in `packages/sqlfu/docs/migration-model.md` under the "Migrations" authority section: short example of the object form + a "don't mix prefix formats" note. No landing-page panel, no README edit — this is useful-to-some, not tentpole._

## Notes

- Mixed ISO + four-digit in one dir is a user-visible footgun (ordering). A red test with a mixed dir would be worth writing just to pin down what we do today, even if the doc answer is "don't".
- The other Claude session that motivated this was `636c50cf-dc07-42a5-81c4-29e3a7d14367` — they were trying to preserve existing four-digit migrations in a project and ended up having new ones appear in ISO format. This task removes that friction.

## Implementation log

- The `four-digit-mixed` test in `prefix-config.test.ts` acts as the "red-ish" mixed-dir test the spec asked for: a stray ISO-prefixed file lives alongside four-digit migrations, and we assert that the drafter produces `0000_*.sql` (ignoring the stray ISO file when numbering). It doesn't assert on lexicographic ordering between the two — the doc says "don't mix", not "we'll paper over it".
- The `parseMigrationId` helper in `packages/sqlfu/src/ui/router.ts` was already format-agnostic (splits on first `_`), so no UI changes were needed.
- Four ambient test failures in `test/migrations/migrations.test.ts` and `test/migrations/edge-cases.test.ts` were confirmed to exist on `origin/main` unrelated to this change (error-message snapshots with a duplicated `Error:` prefix).
