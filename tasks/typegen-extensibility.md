---
status: backlog
size: large
---

# Typegen extensibility: pluggable validators + column-level overrides

## Executive summary

`sqlfu generate` has two axes of extensibility it should grow into, neither of which is in scope for the current PR (the `generate.validator: 'zod' | 'valibot' | 'zod-mini' | null` landing in #12):

1. **User-provided validator plugins.** Let a user plug in their own TS-type-to-validator transformer instead of picking from the hardcoded list (`zod` / `valibot` / `zod-mini`). Likely shape: a function in `sqlfu.config.ts` that takes the generated query descriptor and returns the generated wrapper source, or a narrower "map a field's TS type to an expression in my validator library" hook.

2. **Column-level overrides.** Let a user say "this TEXT column should emit `z.string().email()`" (or the valibot / standard-schema equivalent) on a per-column basis. The generator's knowledge caps out at what a SQL type system can say; column-level semantics (email, URL, slug, branded IDs, JSON-with-shape) have to come from the user.

These two are related: both ask "how do you go from a column to a runtime schema expression?". A plugin hook wide enough to let a user swap validator libraries is also the natural place to hang column overrides.

## Prior art — pgkit

[`../pgkit/packages/typegen`](../../pgkit/packages/typegen) is a mature version of this. Specifically:

- `types.ts` declares a `writeTypes: (queries: AnalysedQuery[]) => Promise<void>` hook on `Options`.
- `defaults.ts` wires `defaultWriteTypes()` when the user hasn't overridden it.
- `write/` holds the default emitters, which are exported as `defaultWriteFile` / `defaultWriteTypes` so a user can wrap them instead of replacing them.

Whoever picks this up should study that layering before designing sqlfu's. The shape of `AnalysedQuery` in pgkit is the same kind of descriptor `refineDescriptor` produces in `packages/sqlfu/src/typegen/index.ts`.

## Out of scope for this task file

- The current PR (#12, `generate.validator` union) is the immediate prerequisite. That PR ships three hardcoded options.
- This task is the follow-up that generalises #12's `'zod' | 'valibot' | 'zod-mini'` into "any function you can write". No one's asked for it yet. Breadcrumb only.

## Checklist (placeholders)

- [ ] Design the plugin shape. Start from pgkit's `writeTypes` hook. Does sqlfu want the same coarse hook, or something narrower like `mapColumn(field): string` returning a validator expression?
- [ ] Design the column-override shape. Map keyed on `tableName.columnName` → validator expression string / factory? Or a predicate-based matcher for expression-level columns (aliased, computed)?
- [ ] Decide how the hook composes with `generate.validator`. Plugin replaces the built-in entirely, or layers over it (built-in generates a base expression; user refines per-column)?
- [ ] Decide config-file constraints. `sqlfu.config.ts` is already a full TS module; functions and factories work fine. Double-check the schema validation in `core/config.ts` doesn't reject them.
- [ ] Design failure modes. A plugin that throws on column X should produce a clear "the validator plugin failed on table.column" error, not a crashed `sqlfu generate`.
- [ ] Tests: happy path (plugin replaces default), column override for a specific TEXT column, plugin error surfaces at the right layer.
- [ ] Docs page once it ships — `docs/runtime-validation.md` grows a "custom validators and column overrides" section, or splits into a separate page if the surface is big.

## Breadcrumb in source

A one-line comment lives in `packages/sqlfu/src/typegen/index.ts` near the column-type-to-validator mapping logic so a future agent finds this file without grepping.
