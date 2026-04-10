Continue the `sqlfu` work in `/Users/mmkal/src/sqlfu`.

Current status:
- The repo is now a pnpm workspace with a single package at `packages/sqlfu`.
- `sqlfu` now has a router-driven migration workflow built around `draft`, `migrate`, `finalize`, and `check`.
- `definitions.sql` is the schema-authoring surface, and there is no committed `snapshot.sql`.
- migration replay and validation use injected database provisioning from `sqlfu.config.*`.
- `src/migrator/` has been renamed to `src/schemadiff/`.
- typegen now reads from the configured main database and materializes its own temporary database for TypeSQL.
- real adapter tests exist for libsql, better-sqlite3, bun, expo sqlite, and node:sqlite.

What is already verified:
- `pnpm --filter sqlfu test:node`
- `pnpm --filter sqlfu typecheck`
- `pnpm --filter sqlfu test:node --run test/migrations.test.ts test/generate.test.ts`

What still needs work next:
1. Improve query typing quality from TypeSQL.
   - Right now `packages/sqlfu/sql/list-post-summaries.ts` still emits mostly `any` fields.
   - Investigate whether this is because of the current query shape, the use of the `libsql` client mode, or a missing TypeSQL configuration option.
   - Aim to get more specific result types without abandoning the current SQL-first approach.
2. Decide whether any further migration-model cleanup is worth it.
   - `api.ts` still holds most of the replay/materialization helpers.
   - If that starts slowing development down, extract helpers then. Otherwise leave it alone.
3. Keep docs aligned with the injected-database config model.
   - Examples should use `createDatabase` and `getMainDatabase()`, not dead `dbPath` config.
   - Keep the no-snapshot explanation short and intentional.

Constraints and context to preserve:
- Keep this as a single package at `packages/sqlfu`.
- `definitions.sql` remains the only schema source of truth.
- Generated TypeSQL outputs stay checked into git for now.
- Core code should depend on injected `Database`/`Client` capabilities, not concrete clients.
- Avoid introducing `useEffect`/`useState` if you touch React later, but there is no React work right now.
- Do not rewrite git history; if you commit, create a normal new commit.

Suggested first commands:
```sh
pnpm --filter sqlfu test:node
pnpm --filter sqlfu typecheck
```
