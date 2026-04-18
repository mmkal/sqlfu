---
status: ready
size: medium
---

# Generate zod schemas alongside TypeScript types

## Summary

sqlfu's typegen currently emits per-query `*.sql.ts` wrappers with `Data`, `Params`, and `Result` TypeScript types. Users often also want runtime zod schemas for the same shapes so they can validate request bodies, feed form libraries, narrow driver output, etc. Add opt-in zod schema generation mirroring whatever TS types are already produced.

## Scope

**In scope** (MVP):
- Emit zod v4 schemas in the same per-query `*.sql.ts` file alongside the TS types. Co-locating avoids a second barrel and keeps the wrapper self-contained.
- For each query that today gets a `XyzData` / `XyzParams` / `XyzResult` type, also export `XyzDataSchema` / `XyzParamsSchema` / `XyzResultSchema` as `z.ZodType` instances when `zod` is enabled.
- Schema shape mirrors the TS type exactly:
  - `string` -> `z.string()`
  - `number` -> `z.number()`
  - `boolean` -> `z.boolean()`
  - `Date` -> `z.date()`
  - `ArrayBuffer` / `Uint8Array` -> `z.instanceof(Uint8Array)` (pragmatic: that's what adapters actually return for BLOBs)
  - `any` (unresolved) -> `z.unknown()`
  - string literal union (enum-like) -> `z.enum([...])`
  - nullable columns: `.nullable()`
  - parameter optionals: `.optional()` (matches `field?: T` in the emitted type)

- Config: add an optional `zod?: boolean` field to `SqlfuConfig` (defaults to `false`, since schemas add weight to generated files). `zod: true` turns on schema emission. Keep it a bare boolean for now and let it grow into an object later without breaking.
- `zod` is already a direct dependency of `sqlfu`, so no peer-dep dance is needed. Generated files can safely `import {z} from 'zod'`.

**Deferred** (not this task):
- Per-table row schemas derived from `definitions.sql` (no per-table TS types exist today, and mirroring the "per-query" scope is simpler to ship and reason about).
- Custom type overrides (e.g. "treat `text` columns matching regex X as `z.email()`"). Would slot into the `zod: {...}` object shape later.
- Bigint / JSON helpers. sqlite doesn't distinguish JSON today; `bigint` isn't currently emitted from the mapper. If/when those surface, we extend.
- Ad-hoc query zod schemas (the SQL runner in the UI uses the JSON schema catalog).

## Design decisions

- **Location**: inline in each `*.sql.ts`, not a separate `schemas.ts`. Rationale: users already import `FooResult` from `./foo.sql.js`; adding `FooResultSchema` there is the lowest-friction API.
- **Import**: add `import {z} from 'zod';` at the top of generated files when `zod` is on. Skip the import when off so users who don't enable it don't pay for it.
- **Nullability vs optional**: match the TS type rules already in `renderObjectType`.
  - Result fields: `notNull === false` -> `.nullable()` (matches the emitted `key?: T` which renders as `T | undefined`; zod's `.nullable()` matches `null` which is what drivers return. Actually TS emits `title?: string` which means `string | undefined` — but the driver returns `null`. Existing code has the same mismatch. We'll go with `.nullable()` because that's the *runtime* truth from sqlite.)
  - Parameter fields: optional params get `.optional()`, nullable params get `.nullable()` (so `.optional().nullable()` when both). Match what `renderObjectType` does for parameter kinds.
- **Export naming**: `<TypeName>Schema`, e.g. `FindPostBySlugResultSchema`. Consistent and greppable.
- **Exports added only when the corresponding TS type is emitted** (Data only if the descriptor has `data`, etc.).

## Config shape

```ts
// sqlfu.config.ts
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
  zod: true,
};
```

Adds `zod?: boolean` to `SqlfuConfig` and `SqlfuProjectConfig`. `resolveProjectConfig` defaults it to `false`.

## Checklist

- [ ] Add `zod?: boolean` to `SqlfuConfig` and `SqlfuProjectConfig` in `core/types.ts`
- [ ] Default `zod` to `false` in `resolveProjectConfig` in `core/config.ts`
- [ ] Update `generateQueryTypesForConfig` to thread the flag through to `renderQueryWrapper`
- [ ] Add a zod-schema renderer that converts a TS type string back to a zod expression (reuse the existing `schemaForTsType` logic — same mapping as json schema)
- [ ] Emit `XyzDataSchema`, `XyzParamsSchema`, `XyzResultSchema` declarations next to the existing type declarations when the flag is on
- [ ] Add `import {z} from 'zod';` to generated files only when zod is on
- [ ] Integration test: a fixture with a nullable column, an enum-like check constraint, and params. Generate with zod on. Import the emitted module, parse a valid row, assert OK. Parse bad data, assert it throws.
- [ ] Snapshot test: an opt-in zod test that captures the emitted file shape so future regressions are obvious.

## Implementation log
