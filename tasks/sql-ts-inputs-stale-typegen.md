---
status: needs-design
size: large
---

# `.sql.ts` query inputs and stale typegen detection

## Status (for humans)

Follow-up task drafted from the PgTyped-style typegen review. Nothing is implemented yet. This combines two related ideas: let TypeScript files be query sources, and make stale generated query types obvious when the source query changes without re-running `sqlfu generate`.

## What

Today, `sqlfu generate` treats files under `config.queries` as `.sql` inputs and emits `.generated/*.sql.ts` wrappers. Add support for colocated TypeScript query-source files, while preserving the "named and loved queries" model: the exported query name should still be the durable identity users see in generated functions, logs, query catalog entries, and code search.

Target input shape to evaluate:

```ts
import {sql} from 'sqlfu';

export const listProfiles = sql`
  select id, display_name
  from profiles
  order by display_name;
`;

export const findProfileById = sql`
  select id, display_name
  from profiles
  where id = :id;
`;
```

Generated output shape is not decided yet. The key design question is whether `.sql.ts` files should generate companion modules, declaration augmentation, or source-adjacent generated metadata that the exported `sql` objects can consume.

## Scope

- [ ] Design the `.sql.ts` source convention. Start with `export const queryName = sql\`...\`` and decide whether nested exports, renamed exports, `as const`, or non-template forms are in/out of scope.
- [ ] Decide how `sqlfu generate` discovers `.sql.ts` files without executing arbitrary user code. Prefer static parsing over importing source modules.
- [ ] Preserve named query identity. The export name should be the query name unless there is a compelling reason to add an explicit override.
- [ ] Decide generated output layout for `.sql.ts` inputs. Candidate shapes: `.generated/<source>.sql.ts`, `.generated/<source>.sql-types.ts`, or source-adjacent declaration files.
- [ ] Decide how callers get typed execution ergonomics from the source export. Avoid making users import generated wrappers separately if the point of `.sql.ts` is colocated source usage.
- [ ] Design stale-generation detection keyed on a hash of the source query text plus any relevant expansion/annotation metadata.
- [ ] Decide stale behavior. Preferred target: stale generated metadata fails or degrades at type level; runtime warning is a secondary backup, not the primary safety mechanism.
- [ ] Ensure runtime still works when generated metadata is stale or missing. The source `sql\`...\`` query object should remain executable, but should not pretend stale types are current.
- [ ] Add query catalog support for `.sql.ts` inputs, including stable ids and source-file breadcrumbs.
- [ ] Add fixture/runtime tests showing happy-path typed `.sql.ts` exports, stale hash mismatch behavior, and missing-generation behavior.
- [ ] Document the workflow once it ships, especially the "forgot to run generate" story.

## Assumptions and decisions to validate

- `.sql.ts` should be a source-file format, not a replacement for generated wrappers. Plain `.sql` files remain first-class.
- Static parsing is preferable to importing user `.sql.ts` files because importing can run arbitrary code, require environment variables, or fail on app-only imports.
- Query hash should be computed from the actual SQL text after normalizing only generator-irrelevant trivia. Be conservative: if the text materially changes, the hash should change.
- The type-level stale check is more valuable than a runtime warning. Runtime warnings are easy to miss and do nothing for CI/typecheck.
- A stale query should not break runtime execution by default. The user changed source SQL; they should still be able to run the app, but type confidence should be visibly invalid until regeneration.

## Open design questions

- What should `sql` return before generation? A runtime-only query object, a typed-but-unknown object, or a branded object that can later be refined by generated metadata?
- How does generated metadata attach back to the source export without import cycles or awkward user ceremony?
- Should stale generated metadata produce `unknown` result/params types, a branded compile error, or a hard TypeScript error at the call site?
- Should `.sql.ts` support PgTyped/annotation-style parameter expansions inside the SQL string, or a TS-side option object?
- Should the generator include the file path in the hash input, or only the query text plus metadata?

## Implementation notes

- Current typegen entry point: `packages/sqlfu/src/typegen/index.ts`.
- The PgTyped-style branch introduced an internal `QueryDocument` / `QuerySource` split. `.sql.ts` support should probably reuse that model: file discovery produces query sources; renderers and catalog writers do not need to care whether the source came from `.sql` or `.sql.ts`.
- If static parsing gets complicated, look at existing dev dependency `ts-morph` before adding another parser.
- Runtime/source API likely belongs near `packages/sqlfu/src/sql.ts` and `packages/sqlfu/src/index.ts`, but keep public surface small until the generated-metadata design is clear.
