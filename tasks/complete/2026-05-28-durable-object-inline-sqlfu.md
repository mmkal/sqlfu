---
status: complete
size: large
branch: bedtime/2026-05-27-durable-object-inline-sqlfu
---

# Durable Objects full inlinable

## Status

Implementation is complete on the branch. Durable Objects can keep definitions, migrations, and queries in one `inlineSqlfu({...})` TypeScript module; `draft` appends inline migrations, `generate` writes inline query types, and Miniflare covers migration across redeployed object storage. PR review found type/runtime divergence for inline row shapes and expansion-style parameters; those are now covered by tests and fixed.

## Assumptions

- The public authoring API should be `inlineSqlfu({...})` plus `sql` from `sqlfu/api`, not a callback-shaped builder.
- Inline SQL may be limited to simple `sql\`...\`` or `sql<Type>\`...\`` tagged templates inside one top-level `inlineSqlfu(...)` call.
- The CLI can mutate the configured TypeScript file in place when `--config ./path/to/durable-object.ts` points at an inline config module.
- Query type generation only needs to add or replace generic type arguments on existing inline query `sql` templates.
- Migration drafting only needs to insert new `{ name, content: sql\`...\` }` entries into an existing `migrations: [...]` array.
- The runtime wrapper returned by `inlineSqlfu(...)` should be usable inside a Durable Object constructor with `createDurableObjectClient(state.storage)`.
- `db.migrate()` should apply inline migration entries. `db.sync()` may be supported if it falls naturally out of the existing runtime sync code, but migration-backed behavior is the task's acceptance path.
- Constraints can be intentionally strict because this is pre-alpha and there are no external users.

## Checklist

- [x] Add an end-to-end Miniflare Durable Object spec for a self-contained TypeScript module that defines `inlineSqlfu({definitions, migrations, queries})`. _Covered by `inlineSqlfu modules generate, draft, and migrate durable object storage across redeploys` in `packages/sqlfu/test/adapters/durable-object.test.ts`._
- [x] Make `sqlfu --config ./path/to/my-durable-object.ts generate` infer inline query parameter/result types and write them back into the source module. _Implemented through `generateInlineSqlfuTypes(...)` and `writeInlineQueryTypes(...)`._
- [x] Make `sqlfu --config ./path/to/my-durable-object.ts draft` append inline migration entries when definitions drift from current migrations. _Implemented through `draftInlineSqlfuMigration(...)` and `appendInlineMigration(...)`._
- [x] Add a redeploy-style Durable Object spec where old storage is re-awoken with evolved inline definitions and new inline migrations. _The Miniflare fixture persists Durable Object storage between V1 and V2 deploys._
- [x] Expose a runtime `inlineSqlfu` helper through `sqlfu/api` that binds generated query wrappers plus inline migrations to a client. _Added `packages/sqlfu/src/api/inline.ts` and exported `inlineSqlfu` plus generic `sql` from `sqlfu/api`._
- [x] Keep source rewriting strict and parser-backed enough to avoid fragile SQL regex parsing. _Inline source extraction uses `ts-morph` and only accepts object literals, arrays, property assignments, and uninterpolated `sql` templates._
- [x] Update docs or API examples if the new surface is user-visible beyond tests. _Updated `packages/sqlfu/docs/guides/durable-objects.md` with inline module usage._
- [x] Run focused Durable Object/typegen tests plus package typecheck for touched surfaces. _Verified import surface, Durable Object, CLI config, migration, generate runtime, build, and typecheck commands._
- [x] Move this task to `tasks/complete/` before the PR is marked ready. _Moved to `tasks/complete/2026-05-28-durable-object-inline-sqlfu.md`._

## Example

```ts
import {inlineSqlfu, sql} from 'sqlfu/api';

const db = inlineSqlfu({
  definitions: sql`
    create table posts(slug text, body text);
  `,
  migrations: [
    { name: 'create-table-posts', content: sql`create table posts(slug text)` },
  ],
  queries: {
    listPosts: sql`select * from posts limit :limit`,
  }
});

class MyDO extends DurableObject {
  private db: typeof db.$type
  constructor(state) {
    this.db = db(createDurableObjectClient(state.storage))
    this.db.migrate() // or even `this.db.sync()` should work
  }

  listPosts() {
    return this.db.listPosts({ limit: 10 });
  }
}
```

Reason: durable objects are often essentially "standalone". It's prohibitively painful to write a dedicated `sqlfu.config.ts`, `definitions.sql` and `queries.sql` for them - which also then necessitates their own folder etc.

The above would let you do it all in one file.

How it'd work. You write the above manually, then you run

```bash
sqlfu --config ./path/to/my-durable-object.ts generate
```

And it will "add types" to the `inlineSqlfu(...)` `queries` prop:


```ts
  queries: {
    listPosts: sql<{ parameters: { limit: number }; result: { slug: string; body: string } }>`
      select * from posts limit :limit
    `,
  }
```

Similarly migrations are added inline. Running:

```bash
sqlfu --config ./path/to/my-durable-object.ts draft
```

Will add a new migration inline:

```ts
  migrations: [
    { name: 'create-table-posts', content: sql`create table posts(slug text)` },
    { name: 'alter-table-posts', content: sql`alter table posts add column body text` },
  ]
```

To do this it requires a fair amount of constraints on the source code. The rules can start as:

- `const db = inlineSqlfu(...)` at the top level of the module. It does not need to be exported.
- The `inlineSqlfu(...)` call is parseable as TypeScript and contains object literal `definitions`, `migrations`, and `queries` properties.
- Inline SQL values use only `sql\`...\`` or `sql<Type>\`...\`` tagged templates.
- Source rewriting only inserts migration object literals into the migrations array and generic types into query `sql` expressions.

## Implementation Notes

- Existing Durable Object coverage is in `packages/sqlfu/test/adapters/durable-object.test.ts`.
- Existing runtime sync support lives in `packages/sqlfu/src/api/sync.ts`; reuse it for `db.sync()` only if doing so keeps the implementation small.
- Existing query generation code lives under `packages/sqlfu/src/typegen/`; prefer adapting that pipeline instead of reimplementing query inference for inline SQL.
- Existing migration draft code should remain the source of truth for schema diffs; inline mode should provide an alternate IO layer, not a separate migration planner.
- Runtime `inlineSqlfu` deliberately implements `migrate()`, not runtime diff-based `sync()`. This keeps production Durable Object startup tied to reviewable migration entries.
- Inline modules are recognized without importing the configured module, so Worker globals and user module side effects do not run in the Node CLI.
- The browser-safe TypeSQL analyzer path was split from the Node sqlite client loader so `sqlfu/analyze` keeps passing the strict import-surface check.
- The vendor bundler now preserves the PostgreSQL formatter bundle as well as SQLite because `format(sql, {language: 'postgresql'})` imports it from `dist/formatter.js`.
- PR review follow-up made inline result types match raw Durable Object rows (`published_at`, nullable columns) and rejects query shapes such as `in (:ids)` that would need generated wrapper runtime expansion.
- The inline source reader no longer needs `ts-morph` at runtime, keeping `sqlfu/api` importable in Worker bundles and moving `ts-morph` back to dev-only tooling.
- Second review follow-up added a packed-package WebWorker TypeScript compile for `import {inlineSqlfu, sql} from 'sqlfu/api'`, and fixed inline result typing for selected columns named like metadata fields such as `rowsAffected`.
