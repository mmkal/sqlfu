---
status: ready
size: small
---

# Camel-case the `name` field in generated queries

## Status (for humans)

Spec only. Implementation still to do.

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

- [ ] `packages/sqlfu/src/typegen/index.ts` — three emission sites use the
      kebab-case `queryName` for the `name` field. Switch the value that lands
      in `name: "..."` to the camelCased function name. The relative path is
      still useful internally (e.g. for the `.d.ts` suggestion filename), so
      don't rename the existing `queryName` variable; derive the emitted name
      from `toCamelCase(queryName)`.
  - `renderDdlWrapper` (~line 110)
  - `renderQueryDeclaration` (~line 618) — called from both the plain-TS and
    validator wrappers; the change likely lives here and the two callers stop
    passing the raw relative path.
- [ ] `packages/sqlfu/src/migrations/index.ts` — drops its four hardcoded
      kebab-case names (`ensure-migration-table`, `select-migration-history`,
      `insert-migration`, `delete-migration-history`). These are now produced
      by the generated files it imports, so the hand-written `name:` overrides
      should be removed entirely rather than rewritten. Verify each call site
      still compiles without the override.
- [ ] Regenerate the six committed `.generated/*.sql.ts` files:
  - `packages/sqlfu/src/migrations/queries/.generated/{insert-migration,select-migration-history,delete-migration-history,ensure-migration-table}.sql.ts`
  - `packages/ui/test/projects/dev-project/sql/.generated/{list-post-cards,find-post-by-slug}.sql.ts`
  - Prefer running the codegen (`pnpm --filter sqlfu build:internal-queries` for
    the migrations set; the dev-project has its own codegen entry) over
    hand-editing, so the files stay a faithful reflection of the generator.
- [ ] Tests:
  - `packages/sqlfu/test/naming.test.ts` — the `spanNameFor` test should still
    pass (it returns `query.name` verbatim), but re-read it to confirm it
    doesn't hard-code a kebab-case string anywhere.
  - Typegen snapshot/expectation tests — re-run `pnpm test` for the sqlfu
    package and accept the updated snapshots (only the `name:` line should
    change; anything else changing is a bug).
  - `packages/ui/test/studio.spec.ts` — references `find-post-by-slug` and
    `list-post-cards` in role selectors. These target UI link text derived from
    function names, which are already camelCased downstream, so the test should
    be unaffected — but confirm.
  - OTel tests, if any, that assert `db.query.summary` strings.
- [ ] Docs — `packages/sqlfu/README.md` line ~124 mentions "generated queries
      carry their filename to runtime as a `name` field". Update the wording to
      reflect that the emitted name is the camelCase function name, and update
      any OTel-snippet showing a `db.query.summary` value. Check
      `packages/sqlfu/docs/*.md` for similar copy.

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

(appended during implementation)
