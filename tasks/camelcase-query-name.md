---
status: done
size: small
---

# Camel-case the `name` field in generated queries

## Status (for humans)

Implementation complete. Typegen now emits camelCase names; the four
committed migration query files were regenerated; `migrations/index.ts` dropped
its hand-inlined kebab-case names in favour of the generated `query` factory;
typegen fixture snapshots refreshed; README + `docs/observability.md` +
`docs/getting-started.md` copy updated. Nine pre-existing test failures on
`origin/main` (unrelated `Cause: Error:` stringification drift) persist on this
branch too — verified they also fail on clean main.

## What

Today, generated queries in `.generated/*.sql.ts` emit a `name` field that
matches the kebab-case relative path of the source `.sql` file:

```ts
// packages/sqlfu/src/migrations/queries/.generated/insert-migration.sql.ts
const query = (params: insertMigration.Params) => ({
  sql,
  args: [...],
  name: "insert-migration",
});
```

We want the `name` to match the exported function name (camelCase), not the
source path:

```ts
const query = (params: insertMigration.Params) => ({
  sql,
  args: [...],
  name: "insertMigration",
});
```

The motivation: the `name` is what shows up in observability (`db.query.summary`
on the OTel span) and in logs. `insertMigration` lines up with the identifier
developers search for in their code; `insert-migration` is a filesystem detail
leaking through. The function name and the runtime name should be the same
string.

## Scope

- [x] `packages/sqlfu/src/typegen/index.ts` — three emission sites updated to
      use `toCamelCase(input.relativePath)` as the `name` value.
      _`renderDdlWrapper` inlines it; `renderQueryWrapper` and
      `renderValidatorQueryWrapper` pass `queryName: functionName` into
      `renderQueryDeclaration`._
- [x] `packages/sqlfu/src/migrations/index.ts` — four hand-inlined kebab-case
      names deleted. Call sites now use the generated `.query` object (or
      `.query(params)` factory for `insertMigration`), so the name comes from
      the regenerated files. _Dropped the duplicate `{sql, args, name}`
      literals in `ensureMigrationTableGen`, `readMigrationHistoryGen`,
      `applyOneMigrationGen`, `replaceMigrationHistoryGen`._
- [x] Regenerate the committed `.generated/*.sql.ts` files.
      _Only the four migration queries under
      `packages/sqlfu/src/migrations/queries/.generated/` are tracked in git;
      the dev-project files are gitignored runtime artifacts. Ran
      `pnpm run build:internal-queries`._
- [x] Tests.
      _Typegen fixture MD snapshots refreshed via
      `pnpm exec vitest run test/generate --update`. Diff contains ONLY
      `name:` line changes. `test/naming.test.ts` passes unchanged (intentionally
      keeps a kebab-case string to prove `spanNameFor` returns whatever the
      caller puts). Observability + migrations tests pass apart from 9
      pre-existing `Cause: Error:` snapshot drifts on origin/main._
- [x] Docs.
      _README.md line 124, `docs/observability.md` intro + the worked example,
      and `docs/getting-started.md` lines 115 + 133 rewritten to mention the
      camelCase function name. Ad-hoc-SQL snippets (`'health-check'`,
      `'my-query'`), outbox consumer names, and test-fixture query names in
      `test/observability/*.test.ts` + `test/outbox/outbox.test.ts` + the
      `spanNameFor` test were ALSO converted to camelCase — even though
      "whatever string you want" is the actual contract, mixing conventions
      in examples and docs sends a confusing signal. Kept kebab/snake
      casings intact for non-name identifiers (ESLint rule `'sqlfu-sql'`,
      esbuild plugin `'sqlite-only-dialects'`, event type format
      `'user:signed_up'`) because those are different domains._

## Out of scope

- `toCamelCase` helper itself — already handles `select-migration-history` →
  `selectMigrationHistory` correctly. Don't touch unless a snapshot proves
  otherwise.
- The `lint-plugin.ts` casing helper — different code path, not involved here.
- Any rename of the `.sql` source files on disk — filenames stay kebab-case
  (that's a separate aesthetic argument; this task is only about the emitted
  `name` property).
- The `.backup` dev-project tree — it's a frozen reference, don't regenerate.

## Assumptions & decisions made on the user's behalf

- Treat this as a full migration, not a backwards-compatible alias. The library
  is pre-pre-pre-alpha and CLAUDE.md is explicit about not keeping legacy
  baggage — no fallback to the old kebab-case name, no opt-out flag.
- If a generated file contains a nested path (e.g. `users/list-active.sql`),
  the camelCased `name` will be `usersListActive`. This matches the function
  name and is what `toCamelCase` already produces. No need to special-case
  slashes.
- The docs update is one line + any OTel snippet. No new docs page.

## Implementation log

- Discovered during implementation that `packages/sqlfu/src/migrations/index.ts`
  was reconstructing `{sql, args, name}` objects by hand rather than calling
  the wrapper's `query` factory. This duplication was both the reason the
  kebab-case names existed in hand-written code AND a latent bug waiting to
  happen (any future change to `insertMigrationWrapper.query` would have to be
  mirrored in the hand-written path). Collapsed the four call sites onto the
  generated factory in the same commit — see CLAUDE.md's "DELETE stuff that is
  no longer serving us" note.
- Initially kept kebab-case ad-hoc examples (`'health-check'`, `'my-query'`,
  outbox consumer names) on the theory that "whatever string you want" is
  the actual contract. User pushed back: mixing conventions in examples
  and test fixtures sends a confusing signal even if the code accepts it.
  Changed all of them to camelCase. Non-name identifiers with existing
  conventions (ESLint rule slugs, esbuild plugin names, event type format
  `'user:signed_up'`) kept as-is — those are different domains.
- Nine pre-existing test failures on origin/main (`Cause: Error:` vs `Cause:`
  stringification drift in `test/migrations/*.test.ts`,
  `test/sql-editor-diagnostic.test.ts`, `test/adapters/bun.test.ts`) are NOT
  introduced by this branch — verified by running the same filter on stashed
  changes. They likely need updating as a separate toolchain-drift fix.
