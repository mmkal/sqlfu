Continue the `sqlfu` bootstrap in `/Users/mmkal/src/sqlight`.

Current status:
- The repo is now a pnpm workspace with a single package at `packages/sqlfu`.
- `sqlfu` has an initial runtime SQL layer, libsql and D1 adapters, a `sqlite3def`-backed migrator, a `typesql-cli` wrapper, and a `trpc-cli` CLI.
- The example schema in `packages/sqlfu/definitions.sql` was simplified so `sqlite3def` can apply it while still covering tables, a view, an FTS table, and triggers.
- `packages/sqlfu/src/typegen/index.ts` now writes a working `typesql.json` and runs `typesql compile` with an explicit `--config` path, so generation works both in-place and from temporary smoke-test workspaces.
- `packages/sqlfu/src/migrator/index.ts` now ignores the noisy FTS shadow-table cleanup output that `sqlite3def --dry-run` emits, so `migrate check` treats a clean FTS-backed schema as clean.
- A smoke test was added at `packages/sqlfu/test/smoke.test.js`; it builds the package, generates types in a temp workspace, checks that generated files exist, and verifies `diffDatabase`/`checkDatabase` stay clean.

What is already verified:
- `pnpm --filter sqlfu build`
- `pnpm --filter sqlfu test`
- `pnpm --filter sqlfu typecheck`
- `node ./dist/cli/main.js generate`
- `node ./dist/cli/main.js migrate diff --db-path .sqlfu/typegen.db`
- `node ./dist/cli/main.js migrate check --db-path .sqlfu/typegen.db`

What still needs work next:
1. Improve query typing quality from TypeSQL.
   - Right now `packages/sqlfu/sql/list-post-summaries.ts` still emits mostly `any` fields.
   - Investigate whether this is because of the current query shape, the use of the `libsql` client mode, or a missing TypeSQL configuration option.
   - Aim to get more specific result types without abandoning the current SQL-first approach.
2. Tighten the smoke coverage if useful.
   - Consider asserting more about generated output shape or adding a direct CLI smoke path.
   - Keep tests isolated in temp directories; do not rely on mutating tracked files.
3. Refresh docs.
   - Update `packages/sqlfu/README.md` to mention the working `generate`, `migrate diff`, and `migrate check` flow.
   - Mention the current limitations around Windows auto-install and the still-rough generated typing story.

Constraints and context to preserve:
- Keep this as a single package at `packages/sqlfu`.
- `definitions.sql` remains the only schema source of truth.
- Generated TypeSQL outputs stay checked into git for now.
- Prefer `@libsql/client` over `better-sqlite3`.
- Avoid introducing `useEffect`/`useState` if you touch React later, but there is no React work right now.
- Do not rewrite git history; if you commit, create a normal new commit.

Suggested first commands:
```sh
pnpm --filter sqlfu test
pnpm --filter sqlfu generate
pnpm --filter sqlfu typecheck
```
