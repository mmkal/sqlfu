---
status: done
size: large
---

# Typegen query annotations and inline parameter forms

## Status (for humans)

Implementation complete on `typegen-pgtyped-support`, with the parameter syntax revised after review to prefer inference over explicit list/tuple modifiers. `sqlfu generate` keeps unannotated single-query files working, supports `@name` multi-query `.sql` files, expands inferred scalar `IN (:ids)` lists, row-value `(slug, title) in (:keys)` lists, and INSERT `values :posts` params at runtime, groups `:post.slug` dot-path params into typed objects, emits validator schemas for expanded params, records annotated query entries in the catalog, and documents the feature. Focused typegen tests and typecheck pass.

## What

`sqlfu generate` previously treated each `*.sql` file as exactly one generated query whose function name comes from the relative file path. Beef that up with two PgTyped-inspired features, with sqlfu's final syntax chosen after design review:

- multiple queries in one `.sql` file, each preceded by an annotation comment with `@name`
- inline parameter forms and dot paths for runtime placeholder expansion

Example target input:

```sql
/** @name listPosts */
select id, slug from posts order by id;

/** @name listPostsByIds */
select id, slug from posts where id in (:ids);

/** @name insertPost */
insert into posts (slug, title) values (:post.slug, :post.title) returning id, slug, title;

/** @name insertPosts */
insert into posts (slug, title) values :posts;
```

The generated module should stay anchored to the source file path:

```ts
// sql/.generated/posts.sql.ts
export const listPosts = /* ... */;
export const listPostsByIds = /* ... */;
export const insertPosts = /* ... */;
```

## Scope

- [x] Parse query annotation comments from `.sql` files. Support `/* @name foo */`, `/** @name foo */`, and multiline block comments with `@name`. _Implemented in `parseQueryAnnotations` in `packages/sqlfu/src/typegen/index.ts`._
- [x] Split annotated files into one query entry per annotation. Each annotated query is the SQL statement following its annotation. Require an annotation before each query when a file contains multiple queries. _`loadQueryDocuments` now produces `QueryDocument` / `QuerySource` records before analyzer dispatch._
- [x] Preserve the current behavior for a single unannotated `.sql` file: derive the generated function name from the file path and emit one wrapper exactly as today. _Unannotated files keep the original `toCamelCase(relativePath)` path and single-wrapper renderer._
- [x] Generate one `.generated/<relative-path>.sql.ts` module per source `.sql` file. Annotated multi-query files export all named query wrappers from that module, and `.generated/index.ts` continues to export the source module once. _`renderQueryDocument` combines multiple wrapper bodies with unique local constants._
- [x] Make query names come from `@name` for annotated queries. Reject duplicate query names inside the generated output set with a clear error. _Annotation names preserve valid TS identifiers like `myQueryName`; duplicate generated names fail in `assertUniqueQueryFunctionNames`._
- [x] Add parameter expansion support for scalar arrays: `IN (:ids)` uses TypeSQL's array inference, rewrites into a runtime placeholder list, and types the param as an array of the inferred scalar type. _Covered by `listPostsByIds` fixture/runtime assertions._
- [x] Add object-field param support: `:post.slug` and `:post.title` rewrite into individual placeholders and type the param as an object with those fields. _Covered by `insertPost` fixture/runtime assertions._
- [x] Add inferred array-of-object expansion support: `(slug, title) in (:keys)` rewrites into row-value tuples and `insert into posts (slug, title) values :posts` accepts either one object or an array of objects. _Covered by `listPostsByKeys` fixture/runtime assertions and `insertPosts` fixture/runtime assertions._
- [x] Make expanded params work in generated runtime wrappers, query factories, validator wrappers, query catalog entries, and `.sql` constants. _Runtime test checks generated execution and catalog shape; fixture covers zod schema emission for expanded params._
- [x] Add readable fixture coverage under `packages/sqlfu/test/generate/fixtures/` for multi-query files, list expansion, dot-path object params, inferred object-array expansion, validator schemas, and invalid expansion syntax. _Added `packages/sqlfu/test/generate/fixtures/query-annotations.md`._
- [x] Add docs for multi-query files and inline parameter forms. _Added `packages/sqlfu/docs/typegen.md` and linked it from `packages/sqlfu/README.md` / website sidebar; scalar lists now document `IN (:ids)`._
- [x] Run focused typegen tests, docs build checks, and typecheck before calling the task done. _Ran `pnpm --filter sqlfu exec vitest run test/generate`, `pnpm --filter sqlfu exec vitest run test/generate/runtime.test.ts`, `pnpm --filter sqlfu exec vitest run test/generate/fixtures.test.ts --update`, `pnpm --filter sqlfu typecheck`, `pnpm --filter @sqlfu/ui build`, and `pnpm --filter sqlfu-website build`._

## Assumptions and decisions

- SQLite stays the concrete target. The implementation emits `?` placeholders and does not add Postgres-specific behavior.
- This task intentionally does not implement PgTyped's parameter-expansion syntax or nullability suffixes (`@param ids -> (...)`, `:param!`, output aliases like `"name?"` / `"name!"`). `@name` is the borrowed annotation; scalar-list parameter shape comes from TypeSQL's `IN (:ids)` inference, while object shapes are inferred from SQL context or dot paths.
- The annotation parser should live in sqlfu's typegen layer, not inside the vendored TypeSQL tree. Keep vendored changes mechanical where possible.
- Dot-path, row-value `IN`, and INSERT `values :param` object expansion happens before analysis so the vendored analyzer sees valid SQLite with concrete placeholders/tuples. Scalar `IN (:ids)` lists stay in TypeSQL's native shape so its existing list-param inference can run. The generator still preserves the original SQL file content in the catalog for UI display.
- Runtime expansion should reject empty arrays with an actionable error instead of emitting invalid `in ()` or `values` SQL.
- Runtime-expanded params can appear only once per query for now. Reusing `IN (:ids)` twice would need duplicated driver args, so generation rejects it clearly.
- Inferred INSERT `values :posts` params currently reject `RETURNING` so array inputs do not get a misleading single-row return type.
- Nested dot paths such as `:post.author.id` are not supported yet. The current object grouping handles one segment, such as `:post.slug`.
- Typed JSON params are out of scope for this change.
- If a source file has any annotation, all executable statements in it should be annotated. Mixed annotated/unannotated multi-statement files are an error.
- Query names should be valid generated TypeScript identifiers after the existing camel-casing/naming pass. If an annotation cannot produce a usable export name, fail generation clearly.

## Prior-art references

- Annotated SQL files: https://pgtyped.dev/docs/sql-file
- Parameter expansions considered but not adopted: https://pgtyped.dev/docs/sql-file#parameter-expansions
- Inline list modifiers considered but not shipped: https://github.com/vitaly-t/pg-promise#formatting-filters

## Implementation notes

- Current entry point: `packages/sqlfu/src/typegen/index.ts`.
- Query source model now has an internal `QueryDocument` / `QuerySource` split so file-level generated modules can contain multiple query wrappers while analysis still runs over individual query statements.
- Wrapper renderers now accept an explicit function name for annotated queries while preserving `toCamelCase(relativePath)` for unannotated files.
- Catalog ids for annotated queries are `<relative-path>#<functionName>`, while `sqlFile` remains the actual source file.

## Implementation log

- Added a file/query split in the typegen layer: `QueryDocument` keeps the source module identity, while `QuerySource` is the analyzer unit. This keeps output files anchored to source files even when a source file contains multiple named queries.
- Kept the vendored TypeSQL tree unchanged. Object parameter forms are parsed and normalized before analysis; object/object-array expansions use representative named placeholders such as `:post__slug` so the analyzer can still infer SQLite column types.
- Scalar array expansion intentionally cooperates with vendored TypeSQL's existing list-param inference. TypeSQL infers `number[]` from `IN (:ids)`, and sqlfu adapts that descriptor fact into its existing runtime SQL generation instead of maintaining a second list-inference implementation.
- Added runtime SQL generation only for array-shaped expansions. Dot-path object params stay static (`values (?, ?)`), while scalar/object arrays build a runtime SQL string and reject empty arrays before calling the client.
- Replaced the public `:tupleList(...)` syntax with inferred row-value `IN` and INSERT `values :param` object forms, leaving explicit tuple syntax unshipped until a real non-inferable case needs it.
- Added a runtime test for the real generated module behavior and catalog shape, plus fixture snapshots for generated TS and zod validator schemas.
- Added a Type generation docs page and wired it into the website docs/sidebar.
