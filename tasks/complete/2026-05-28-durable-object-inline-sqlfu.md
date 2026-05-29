---
status: complete
size: large
branch: bedtime/2026-05-27-durable-object-inline-sqlfu
---

# Durable Objects full inlinable

## Status

Implementation is complete on the branch. Durable Objects can keep definitions, migrations, and queries in one static inline `defineConfig({...})` class property; module-level inline configs remain supported. `draft` appends inline migrations, `generate` writes inline query metadata, `generate --watch` watches the inline module, and Miniflare covers migration across redeployed object storage. PR review found type/runtime divergence for inline row shapes and expansion-style parameters; those are now covered by tests and fixed.

## Assumptions

- The public authoring API should be root `defineConfig({...})` plus `sql` from `sqlfu`, shared with file-backed config instead of a separate inline helper.
- Inline SQL may be limited to simple `sql\`...\`` tagged templates inside one or more top-level `const name = defineConfig(...)` calls or static properties on top-level named classes.
- The CLI can mutate the configured TypeScript file in place when `--config ./path/to/durable-object.ts` points at an inline config module.
- Query type generation only needs to add or replace `mode` and `$type` properties on inline query objects.
- Migration drafting only needs to insert new `{ name, content: sql\`...\` }` entries into an existing `migrations: [...]` array.
- The runtime wrapper returned by inline `defineConfig(...)` should be usable inside a Durable Object constructor with `createDurableObjectClient(state.storage)`.
- `db.migrate()` should apply inline migration entries. `db.sync()` may be supported if it falls naturally out of the existing runtime sync code, but migration-backed behavior is the task's acceptance path.
- Constraints can be intentionally strict because this is pre-alpha and there are no external users.

## Checklist

- [x] Add an end-to-end Miniflare Durable Object spec for a self-contained TypeScript module that defines inline `defineConfig({definitions, migrations, queries})`. _Covered by `inline defineConfig modules generate, draft, and migrate durable object storage across redeploys` in `packages/sqlfu/test/adapters/durable-object.test.ts`._
- [x] Make `sqlfu --config ./path/to/my-durable-object.ts generate` infer inline query parameter/result types and write them back into the source module. _Implemented through `generateInlineConfigTypes(...)` and `writeInlineQueryTypes(...)`._
- [x] Make `sqlfu --config ./path/to/my-durable-object.ts generate --watch` rerun inline type generation when the module changes. _Implemented by `watchGenerateInlineConfigModule(...)`, which watches the configured TypeScript module path directly._
- [x] Make `sqlfu --config ./path/to/my-durable-object.ts draft` append inline migration entries when definitions drift from current migrations. _Implemented through `draftInlineConfigMigration(...)` and `appendInlineMigration(...)`._
- [x] Add a redeploy-style Durable Object spec where old storage is re-awoken with evolved inline definitions and new inline migrations. _The Miniflare fixture persists Durable Object storage between V1 and V2 deploys._
- [x] Expose inline config through root `defineConfig(...)`, reusing the light `sqlfu` entrypoint instead of adding a separate public runtime helper. _Implemented in `packages/sqlfu/src/config-inline.ts` and the root `defineConfig` overload._
- [x] Support Durable Object-owned configs as static class properties. _The source reader accepts `static db = defineConfig(...)` on top-level named classes, typegen carries `className`, and the Durable Object guide now recommends this shape._
- [x] Keep source rewriting strict and parser-backed enough to avoid fragile SQL regex parsing. _Inline source extraction uses a small TypeScript source scanner and only accepts object literals, arrays, property assignments, and uninterpolated `sql` templates._
- [x] Update docs or API examples if the new surface is user-visible beyond tests. _Updated `packages/sqlfu/docs/guides/durable-objects.md` with inline module usage._
- [x] Run focused Durable Object/typegen tests plus package typecheck for touched surfaces. _Verified import surface, Durable Object, CLI config, migration, generate runtime, build, and typecheck commands._
- [x] Move this task to `tasks/complete/` before the PR is marked ready. _Moved to `tasks/complete/2026-05-28-durable-object-inline-sqlfu.md`._

## Example

```ts
import {defineConfig, sql} from 'sqlfu';

class MyDO extends DurableObject {
  static db = defineConfig({
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

  private db: typeof MyDO.db.$type

  constructor(state) {
    this.db = MyDO.db(createDurableObjectClient(state.storage))
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

And it will rewrite inline query tags with the inferred mode and type metadata:


```ts
  queries: {
    listPosts: sql.many<{ parameters: { limit: number }; result: { slug: string; body: string } }>`
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

- `const db = defineConfig(...)` at the top level of the module, or `static db = defineConfig(...)` on a top-level named class. It does not need to be exported.
- The `defineConfig(...)` call is parseable as TypeScript and contains object literal `definitions`, `migrations`, and `queries` properties.
- Inline SQL values use only `sql\`...\`` tagged templates.
- Source rewriting only inserts migration object literals into the migrations array and generated `mode` / `$type` properties into query objects.

## Implementation Notes

- Existing Durable Object coverage is in `packages/sqlfu/test/adapters/durable-object.test.ts`.
- Existing runtime sync support lives in `packages/sqlfu/src/api/sync.ts`; reuse it for `db.sync()` only if doing so keeps the implementation small.
- Existing query generation code lives under `packages/sqlfu/src/typegen/`; prefer adapting that pipeline instead of reimplementing query inference for inline SQL.
- Existing migration draft code should remain the source of truth for schema diffs; inline mode should provide an alternate IO layer, not a separate migration planner.
- Runtime inline config deliberately implements `migrate()`, not runtime diff-based `sync()`. This keeps production Durable Object startup tied to reviewable migration entries.
- Inline modules are recognized without importing the configured module, so Worker globals and user module side effects do not run in the Node CLI.
- Durable Object inline configs can live on static class properties; generated query metadata uses `{className, configName, queryName}` internally so module-level and class-owned configs can coexist.
- The browser-safe TypeSQL analyzer path was split from the Node sqlite client loader so `sqlfu/analyze` keeps passing the strict import-surface check.
- The vendor bundler now preserves the PostgreSQL formatter bundle as well as SQLite because `format(sql, {language: 'postgresql'})` imports it from `dist/formatter.js`.
- PR review follow-up made inline result types match raw Durable Object rows (`published_at`, nullable columns) and rejects query shapes such as `in (:ids)` that would need generated wrapper runtime expansion.
- The inline source reader no longer needs `ts-morph` at runtime, keeping `sqlfu/api` importable in Worker bundles and moving `ts-morph` back to dev-only tooling.
- Second review follow-up moved the public inline API to root `defineConfig(...)`, added a packed-package WebWorker TypeScript compile for `import {defineConfig, sql} from 'sqlfu'`, and fixed inline result typing for selected columns named like metadata fields such as `rowsAffected`.
- Inline `generate --watch` now watches the configured module itself instead of rejecting inline configs; coverage lives in `packages/sqlfu/test/generate-watch.test.ts`.
- Bugbot follow-up taught the source scanner to skip nested template expressions outside inline configs, and inline edits now infer trailing-comma style so generated `mode`, `$type`, and migration entries do not fight the surrounding formatter preference.
