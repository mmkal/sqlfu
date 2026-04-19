---
status: needs-redesign
size: medium
---

# Zod schema generation

Generated typescript should be able to produce zod as well as typescript, configurable tho.

## Prior attempt

A first cut was shipped in [PR #9](https://github.com/mmkal/sqlfu/pull/9) and rejected. Notes so the next attempt does not repeat the same shape:

- **Do not add `zod: true` at the top level of `sqlfu.config.ts`.** Generation options belong grouped under a `generate` field. Shape is open — `generate: {zod: true}` or `generate: {style: 'zod'}` or similar. Let the config evolve as more generation options appear, not by widening the top-level surface.
- **Zod schemas should be the source of truth, types derived via `z.infer`.** Don't emit a TS type alongside an independently-generated zod schema; emit the schema and then `export type Foo = z.infer<typeof FooSchema>`. One definition, no drift.
- **Schema names should match type names.** Not `FooDataSchema` + `Foo` — pick one convention and keep the identifier stems aligned.
- **Form an opinion on how these are meant to be used.** Runtime row validation at the adapter boundary? Form schemas consumed by `@rjsf`? Query-arg validation? The generator's output should be shaped around one primary use case, not scattergunned.
- **Consider namespace merging for per-query exports.** So a consumer can write `listProfiles.Params`, `listProfiles.Result`, `listProfiles.sql` on a single import. Nice-to-have / opportunistic scope, but worth trying if it falls out naturally.
