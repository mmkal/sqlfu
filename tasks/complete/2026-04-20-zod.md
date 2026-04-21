---
status: done
size: medium
---

# Zod schema generation

Generate zod schemas as the source of truth for each query's params and result, with runtime validation baked into the generated wrapper. Plain-TS mode remains the default; opting in replaces TS types with zod-inferred ones — never both.

## Status summary

- Shipped. Config (`generate.zod: true`), new zod renderer, integration tests, and docs page added.
- Primary use case: runtime validation (params + rows) at the generated-wrapper boundary.
- Minor refinement from the spec below: zod schemas are hoisted to module-scoped `const`s (not nested inside `Object.assign`) so the function signature's `z.infer<typeof Params>` doesn't hit a circular-inference snag with the namespace-merged `findPostBySlug.Params` type. Same identifier surface for consumers; cleaner TS inference.

## Design

### 1. Config shape — `generate.zod: boolean`

Add a single `generate` group to `SqlfuConfig`. Keep the top level narrow.

```ts
// sqlfu.config.ts
export default {
  db: './db/app.sqlite',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
  generate: {
    zod: true,
  },
};
```

- `generate` is optional. Default is `{zod: false}` — existing plain-TS output is unchanged.
- `generate.zod` is a scalar boolean. Room for additional scalar flags (`jsonSchema`, etc.) later without widening the top level.
- Not a `style: 'zod' | 'ts'` union — scalar booleans compose better and match the way the rest of the config is written (paths, extensions).

### 2. Zod schemas are the source of truth

When `generate.zod` is enabled, the generator emits **only** zod schemas for Params/Data/Result. Types come from `z.infer`. There is never a hand-written `type Foo = { ... }` next to a `z.object({ ... })` for the same shape.

When `generate.zod` is disabled (default), the generator emits plain TS types exactly as today — no zod, no runtime validation, no dependency.

One mode per project. No hybrid. No legacy-compat switch.

### 3. One identifier per query — namespace merging

The function name (camelCase, matching the SQL filename) is **the** identifier. Zod schemas, SQL text, and inferred types all hang off it:

```ts
// sql/.generated/find-post-by-slug.sql.ts
import {z} from 'zod';
import type {Client, SqlQuery} from 'sqlfu';

const Params = z.object({
  slug: z.string(),
});
const Result = z.object({
  id: z.number(),
  slug: z.string(),
  title: z.string().nullable(),
});
const sql = `select id, slug, title from posts where slug = ? limit 1;`;

export const findPostBySlug = Object.assign(
  async function findPostBySlug(
    client: Client,
    params: z.infer<typeof Params>,
  ): Promise<z.infer<typeof Result> | null> {
    const validatedParams = Params.parse(params);
    const query: SqlQuery = {sql, args: [validatedParams.slug], name: 'find-post-by-slug'};
    const rows = await client.all(query);
    return rows.length > 0 ? Result.parse(rows[0]) : null;
  },
  {Params, Result, sql},
);

export namespace findPostBySlug {
  export type Params = z.infer<typeof findPostBySlug.Params>;
  export type Result = z.infer<typeof findPostBySlug.Result>;
}
```

Consumers write:

```ts
import {findPostBySlug} from './sql/.generated/find-post-by-slug.sql.js';

const post = await findPostBySlug(client, {slug: 'hello'});
//    ^? findPostBySlug.Result | null

type P = findPostBySlug.Params; // { slug: string }
const schema = findPostBySlug.Params; // z.ZodObject<...>
const sql = findPostBySlug.sql; // string
```

- **One identifier (`findPostBySlug`)** reaches everywhere: type, schema, SQL, callable wrapper.
- **One definition** per shape — the zod object — and types come off it via `z.infer`.
- Namespace merging lets `findPostBySlug.Params` work both as a value (zod schema) and a type (`z.infer`).

For queries that also need update `data`, the shape is `findPostBySlug.Data` + `findPostBySlug.Params` + `findPostBySlug.Result`, consistent with the current plain-TS output.

### 4. Primary use case — runtime validation at the boundary

The generator exists to make SQL → TypeScript a continuous guarantee, not just a compile-time one. With `generate.zod: true`:

- **Params / Data** are `.parse()`-ed on the way in. Invalid inputs fail loudly with a zod `ZodError` at the callsite, not as a cryptic SQL binding error deeper in the adapter.
- **Result rows** are `.parse()`-ed on the way out. Schema drift (a column removed without regenerating, a nullable column that is now non-null, a new enum variant) surfaces immediately at the adapter boundary, not as a silently-wrong object reaching a React component.

Secondary — but free — benefits: the exported `findPostBySlug.Params` / `findPostBySlug.Result` schemas are usable directly for form validation (react-hook-form, @rjsf), tRPC inputs, RPC wire-format validation, fixtures.

This is why the zod schemas are *used* in the generated wrapper, not just re-exported. The value-add is "every query has a validated request/response contract at runtime" — the emission and the use belong together.

### 5. Deleted / replaced

- The `zod: true` top-level flag from the rejected PR (#9) is gone — no back-compat.
- The parallel `FooSchema` + `Foo` identifiers from that PR are gone — single identifier only.
- The separate `renderObjectType` + `renderZodObjectSchema` branches in typegen collapse: the generated file has exactly one shape-definition per thing, whichever mode.

## Checklist

- [x] Extend `SqlfuConfig` + `SqlfuProjectConfig` with a `generate?: {zod?: boolean}` field. _core/types.ts + core/config.ts_
- [x] Update `assertConfigShape` / `resolveProjectConfig` in `core/config.ts` to validate the new group. _see `assertConfigShape`_
- [x] Add a failing integration test asserting the new generated output shape. _test/generate.test.ts — 4 new tests_
- [x] Implement the zod renderer in `typegen/index.ts`. Mode is a single boolean. _`renderZodQueryWrapper`_
- [x] Make the generated wrapper actually call `.parse()` on params/data and each result row.
- [x] Keep the default (zod off) output byte-identical to today. _asserted by the "plain TS output unchanged" test_
- [x] Add `docs/runtime-validation.md` and short mention in `packages/sqlfu/README.md`.
- [x] `pnpm --filter sqlfu test` green. _1665 passed, 6 skipped_
- [x] `pnpm --filter sqlfu typecheck` green.

## Open questions / decisions made-up-on-user's-behalf (bedtime task)

- **Scope of validation**: parse params *and* rows (not just rows). If row validation is wanted without params validation (or vice versa) later we can add `generate.zod: 'rows' | 'params' | true | false` — but start with `true` = both. Simpler mental model.
- **Error boundary**: `.parse()` (throws) vs `.safeParse()` (returns result). Going with `.parse()` — this is a generated wrapper, throwing is the right default. Callers who want recovery can call the schemas directly.
- **Nested query dirs**: `sql/users/list-profiles.sql` → `usersListProfiles` identifier, same as today.
- **Data ordering for updates**: `Data` + `Params` — two separate schemas, same as today's two separate types.
- **Peer vs hard dep on zod**: zod is already a dependency of `sqlfu` (v4). Generated code does `import {z} from 'zod'` — no extra install step for users.
- **BLOB / ArrayBuffer**: `z.instanceof(Uint8Array)` (SQLite adapters surface `Uint8Array`, not `ArrayBuffer`, at runtime; keep the schema honest about what actually arrives).
- **Date**: `z.date()`. Parameters that are Date → `z.date()`; columns typed as Date in TS → `z.date()`. sqlfu's adapters already coerce at the driver boundary.
- **`any`-typed fields**: `z.unknown()`.
- **Invalid SQL placeholder files**: unchanged (`//Invalid SQL\nexport {};`).
