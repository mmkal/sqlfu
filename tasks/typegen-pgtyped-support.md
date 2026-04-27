---
status: in-progress
size: large
---

# PgTyped-style typegen annotations and parameter expansion

## Status (for humans)

Spec committed first on `typegen-pgtyped-support`. No implementation has landed yet. The target is to make `.sql` files more expressive without changing the default one-query-per-file workflow: unannotated single-query files keep working, annotated files can contain multiple named queries, and annotated params can expand arrays/objects into driver placeholders.

## What

`sqlfu generate` currently treats each `*.sql` file as exactly one generated query whose function name comes from the relative file path. Beef that up with two PgTyped-inspired features:

- multiple queries in one `.sql` file, each preceded by an annotation comment with `@name`
- parameter expansion metadata in the same annotation block, using `@param name -> ...`

Example target input:

```sql
/** @name listPosts */
select id, slug from posts order by id;

/*
  @name listPostsByIds
  @param ids -> (...)
*/
select id, slug from posts where id in :ids;

/*
  @name insertPosts
  @param posts -> ((slug, title)...)
*/
insert into posts (slug, title) values :posts returning id, slug, title;
```

The generated module should stay anchored to the source file path:

```ts
// sql/.generated/posts.sql.ts
export const listPosts = /* ... */;
export const listPostsByIds = /* ... */;
export const insertPosts = /* ... */;
```

## Scope

- [ ] Parse PgTyped-style annotation comments from query `.sql` files. Support `/* @name foo */`, `/** @name foo */`, and multiline block comments with `@name` plus `@param` tags.
- [ ] Split annotated files into one query entry per annotation. Each annotated query is the SQL statement following its annotation. Require an annotation before each query when a file contains multiple queries.
- [ ] Preserve the current behavior for a single unannotated `.sql` file: derive the generated function name from the file path and emit one wrapper exactly as today.
- [ ] Generate one `.generated/<relative-path>.sql.ts` module per source `.sql` file. Annotated multi-query files export all named query wrappers from that module, and `.generated/index.ts` continues to export the source module once.
- [ ] Make query names come from `@name` for annotated queries. Reject duplicate query names inside the generated output set with a clear error.
- [ ] Add parameter expansion support for scalar arrays: `@param ids -> (...)` rewrites `:ids` into a runtime placeholder list and types the param as an array of the inferred scalar type.
- [ ] Add object-pick expansion support: `@param user -> (name, email)` rewrites `:user` into placeholders for the listed fields and types the param as an object with those fields.
- [ ] Add array-of-object expansion support: `@param users -> ((name, email)...)` rewrites `:users` into repeated row tuples and types the param as an array of objects.
- [ ] Make expanded params work in generated runtime wrappers, query factories, validator wrappers, query catalog entries, and `.sql` constants.
- [ ] Add readable fixture coverage under `packages/sqlfu/test/generate/fixtures/` for multi-query files, scalar array expansion, object pick expansion, and array-of-object expansion.
- [ ] Run focused typegen tests and typecheck before calling the task done.

## Assumptions and decisions

- SQLite stays the concrete target. PgTyped's `$1` examples translate to sqlfu's existing `?` placeholders.
- This task intentionally does not implement PgTyped's nullability suffixes (`:param!`, output aliases like `"name?"` / `"name!"`). Those are related but separate semantics.
- The annotation parser should live in sqlfu's typegen layer, not inside the vendored TypeSQL tree. Keep vendored changes mechanical where possible.
- Expansion happens before analysis so the vendored analyzer sees valid SQLite with concrete placeholders/tuples. The generator still preserves the original SQL file content in the catalog for UI display.
- Runtime expansion should reject empty arrays with an actionable error instead of emitting invalid `in ()` or `values` SQL.
- If a source file has any annotation, all executable statements in it should be annotated. Mixed annotated/unannotated multi-statement files are an error.
- Query names should be valid generated TypeScript identifiers after the existing camel-casing/naming pass. If an annotation cannot produce a usable export name, fail generation clearly.

## PgTyped references

- Annotated SQL files: https://pgtyped.dev/docs/sql-file
- Parameter expansions: https://pgtyped.dev/docs/sql-file#parameter-expansions

## Implementation notes

- Current entry point: `packages/sqlfu/src/typegen/index.ts`.
- Current query source model: `QueryFile` is one file = one query. This likely wants an internal `QueryDocument` / `QuerySource` split so file-level generated modules can contain multiple query wrappers while analysis still runs over individual query statements.
- Current wrapper renderers take `relativePath` and derive `functionName` with `toCamelCase(relativePath)`. Annotated queries need to pass an explicit function name through the render path.
- Current catalog ids are file-relative paths. Multi-query files need stable per-query ids, probably `<relative-path>#<functionName>`, while `sqlFile` remains the actual source file.
