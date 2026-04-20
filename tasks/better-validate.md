---
status: done
size: medium
---

# Better runtime-validation docs + arktype

Rebalance the runtime-validation story so no single validator is "the default recommendation", add arktype as a fourth option, and replace the per-validator prose dumps in the docs with tabbed code samples.

## Status summary

Shipped in three commits on the `better-validate` branch:

1. fleshed-out spec (this file)
2. arktype added as a fourth validator — reuses the existing Standard Schema codepath; the emitter interface collapses the old `expressionForTsType` + `nullable` + `optional` trio into a single `renderFieldLine` so arktype can own key-suffix optionality (`'title?'`).
3. docs rebalance — `.md` → `.mdx`, alphabetical ordering, Starlight `<Tabs>` for both the generated-output example and the safe-parse snippets.

## Why

1. The current runtime-validation page calls zod "the default recommendation" and slots the others in as alternatives. That's a messaging bias, not a product claim. sqlfu is validator-agnostic via Standard Schema; the docs should say so.
2. arktype is a first-class validator in the Standard Schema ecosystem — its schemas expose `~standard` exactly like valibot and zod-mini, so plugging it in is a small change, not a new mode.
3. "one example per validator, stacked vertically" blows out the page with near-identical snippets. A tabbed code block makes the shared structure obvious and the per-validator surface explicit.

## Design

### 1. Config — `generate.validator: 'arktype'`

Extend the union in `SqlfuValidator`:

```ts
// core/types.ts
export type SqlfuValidator = 'zod' | 'valibot' | 'zod-mini' | 'arktype';
```

Update the `validValidators` list in `core/config.ts` so `assertConfigShape` accepts `'arktype'` and produces an honest error for bogus values. Update the JSDoc on `SqlfuGenerateConfig.validator` in `core/types.ts` to list arktype alongside the others, same neutral framing.

No config changes at the callsite beyond that — arktype drops into the existing union.

### 2. Typegen — arktype emitter reuses the Standard Schema codepath

Arktype schemas implement Standard Schema via the same `~standard` interface. The existing `parseFlavour: 'standard'` path (already used by valibot + zod-mini) handles promise-check → issues-check → value-unwrap without caring which library produced the schema. So the arktype emitter only needs to provide its own:

- import line: `import {type} from 'arktype';`
- `expressionForTsType`: map TS primitives to arktype string literals (`"string"`, `"number"`, `"boolean"`, `"Date"`, `"unknown"`), enums as `'"draft" | "published"'`, arrays as `"<inner>[]"`.
- `nullable(expr)` / `optional(expr)`: arktype uses the `| null` / `.optional()` style. Concretely, for a field expression like `type("string")`, `nullable` means `type("string | null")`, and optional at the object level means trailing `"?"` on the field key. Since the other emitters express optional *per expression*, we'll wrap as `type("string | null")` and, for field-level optional, append `?` to the key in `objectSchemaDeclaration` for arktype — or use `type("string | undefined")`. Go with the key-suffix approach because that's arktype-idiomatic; adjust `renderObjectSchemaDeclaration` so the emitter can control the key rendering. (Alternative: just emit `type("string?")` syntax — decide at implementation time based on what types out cleanly.)
- `objectSchemaDeclaration`: `const Params = type({...});`
- `inferExpression(name)`: `typeof ${name}.infer`.

The renderer in `renderValidatorQueryWrapper` already branches on `parseFlavour`; arktype is `parseFlavour: 'standard'`, so the inline result-guard and `prettifyStandardSchemaError` logic are free.

Runtime-import logic (`buildRuntimeImports`) already does the right thing for the standard flavour: `prettifyStandardSchemaError` when `prettyErrors: true`, only type-imports when `false`.

### 3. Tests

Mirror the existing valibot/zod-mini coverage in `test/generate.test.ts`:

- snapshot test: `generate with validator: arktype emits arktype schemas and validates at runtime` — assert the generated file imports `type` from `arktype`, schemas are declared with `type({...})`, calls `Params['~standard'].validate(rawParams)`, validates round-trip and throws a prettified error on bad input.
- `prettyErrors: false` variant: `generate with prettyErrors: false + validator: arktype throws raw issues inline` — same shape as the valibot/zod-mini prettyErrors-off tests.
- update the `rejects unknown validator values at config load` error message regex to include `'arktype'`.
- update the type annotation in `createGenerateFixture`'s `config` parameter to include `'arktype'`.
- add `arktype` to the `paths` + `rewriteBareImports` mapping in the fixture so transpiled modules can resolve it.

Install arktype as a devDependency of `packages/sqlfu` (same tier as zod/valibot, which are both dependencies today — actually `zod` and `valibot` are listed under `dependencies`. For consistency, put `arktype` under `dependencies` too; users opting in need the runtime either way, and the package manifest is how `rewriteBareImports` finds it). Decide at implementation time; I'll go with `dependencies` to match zod/valibot.

### 4. Docs rebalance — `docs/runtime-validation.md`

- Title stays `Runtime validation` (good SEO per CLAUDE.md — users search "sqlfu runtime validation").
- Opening para: drop "zod, valibot, or zod/mini" enumeration-of-two with zod-first bias; list alphabetically: "arktype, valibot, zod, or zod/mini". Same prose otherwise.
- "Picking a validator" section: rewrite so each validator gets an honest one-liner tradeoff. No "default recommendation" anywhere. Order alphabetically.
  - `'arktype'` — TypeScript-syntax-as-schema (`type("string | null")`), strongest inference for complex TS types.
  - `'valibot'` — functional composition, smallest bundle.
  - `'zod'` — largest API surface + richest ecosystem (tRPC, react-hook-form). Bundle cost is non-trivial.
  - `'zod-mini'` — same primitives as zod, function-call API, valibot-sized bundle.
- Collapse the "What the generated file looks like" section: one tabbed code block with tabs labelled "TypeScript only (default)", "zod", "valibot", "zod-mini", "arktype". Each tab shows the generated output for the same example query (`find-post-by-slug`). The narrative prose moves to two-three sentences above the tabs: "One callable (`findPostBySlug`) with `.Params`/`.Result`/`.sql` attached; the implementation is the same across all validators."
- Rename the file to `.mdx` to allow importing the Starlight Tabs component.

### 5. Tabs — `@astrojs/starlight/components`

Starlight ships `<Tabs>` + `<TabItem>` from `@astrojs/starlight/components`. Syntax:

```mdx
import {Tabs, TabItem} from '@astrojs/starlight/components';

<Tabs>
  <TabItem label="TypeScript only">…code…</TabItem>
  <TabItem label="Zod">…code…</TabItem>
</Tabs>
```

Works inside `.mdx` files; Astro treats them as components. Syntax-highlighting inside `<TabItem>` uses the usual ``` fences.

For this to flow through `website/scripts/sync-docs.mjs`:

- The script currently hardcodes `${doc.slug}.md` as the destination extension. Change it so the destination preserves the source file's extension (`.md` → `.md`, `.mdx` → `.mdx`). Tiny diff.
- Rename `packages/sqlfu/docs/runtime-validation.md` → `runtime-validation.mdx`. Update the entry in `docs` array inside `sync-docs.mjs`. Update any internal links pointing at it.
- The package README's link to `docs/runtime-validation.md` is resolved by `sync-docs.mjs`'s own link rewriter — so whatever slug it ends up at, the mapping needs to include the new filename. `docBySourcePath` indexes by source path, so pointing it at `runtime-validation.mdx` means incoming links must use `.mdx` too. Fix the README link accordingly.

Fallback if MDX-in-sync-docs turns out to be more work than expected: do H3 per-validator subsections ("### Zod", "### Valibot", etc.) with the same code snippets. Ugly but works everywhere, no toolchain changes.

## Checklist

- [x] Flesh out this spec file and commit in isolation.
- [x] Add `'arktype'` to `SqlfuValidator` union in `core/types.ts` and `validValidators` in `core/config.ts`; update JSDoc.
- [x] Install `arktype` as a `packages/sqlfu` dependency.
- [x] Add `arktypeEmitter` in `typegen/index.ts` and wire it into `getValidatorEmitter`. _turned the three-function interface (`expressionForTsType` + `nullable` + `optional`) into a single `renderFieldLine` so arktype can own key-rendering_
- [x] Figure out the right optional/nullable rendering for arktype (key-suffix `?` for optional, `| null` for nullable) and adjust `renderObjectSchemaDeclaration` if needed. _key-suffix via `JSON.stringify('name?')`, `| null` inlined into the arktype string form for string-expressible types, `type.instanceOf(Uint8Array)` as an escape hatch_
- [x] Failing → passing integration tests: `validator: 'arktype'` snapshot + runtime; `prettyErrors: false + arktype` snapshot + runtime; unknown-validator error message includes `'arktype'`.
- [x] Update fixture `paths` + `rewriteBareImports` to resolve `arktype`.
- [x] `pnpm --filter sqlfu test --run` green. _32/32 generate tests pass; 2 unrelated test files (better-sqlite3 native module not rebuilt, packages/ui vite config) fail on main too_
- [x] `pnpm --filter sqlfu typecheck` green.
- [x] Rewrite `docs/runtime-validation.md` → `.mdx`: drop "default recommendation", alphabetical ordering, honest per-validator tradeoffs, tabbed code samples.
- [x] Tweak `website/scripts/sync-docs.mjs` so `.mdx` sources round-trip as `.mdx` outputs; update the docs-array entry + the README link.
- [x] `pnpm --filter sqlfu-website build` green.

## Decisions made-up-on-user's-behalf (bedtime task)

- **New key**: `'arktype'`. Matches the npm package name. Consistent with `'zod-mini'` / `'valibot'`.
- **Dependency tier**: `arktype` goes under `dependencies` (same tier as `zod` + `valibot`).
- **Optional/nullable shape**: arktype emits `type("string | null")` for nullable and uses key-suffix `?` for optional params. This keeps the schema source looking like arktype rather than a zod-style chain.
- **Enums**: emit as a TS-like union string — `type('"draft" | "published"')`.
- **Docs page title**: stays `Runtime validation`. `sync-docs.mjs` currently overrides it to `"Runtime validation with zod"` — that goes back to the neutral form.
- **Docs ordering**: alphabetical (`arktype`, `valibot`, `zod`, `zod-mini`). No single "recommended" validator.
- **Tabs implementation**: Starlight's built-in `<Tabs>` / `<TabItem>`, via an MDX doc. If the sync-docs change turns into a rabbit hole, fall back to H3-per-validator subsections — noted in the task log below when that happens.
- **Which tabs**: "TypeScript only (default)", "zod", "valibot", "zod-mini", "arktype". Order matches the alphabetical list except TypeScript-only leads because that's the actual default generator mode.
- **Scope**: `safeParse` / `.infer` style code in the "Error behavior" section also gets an arktype tab (`const result = Schema(input); if (result instanceof type.errors) return handleError(result)` — arktype's native happy path).

## Implementation log

- **Emitter interface refactor.** The original `ValidatorEmitter` had three tiny methods (`expressionForTsType`, `nullable`, `optional`) that the shared renderer composed into a field line. Arktype wants to control the *key* (suffix `?` for optional) and express nullable *inside* the arktype string. Collapsed to a single `renderFieldLine(field, fieldKind)`, with a `valueWrappedFieldLine` helper for the zod/valibot/zod-mini emitters that keeps their value-wrapping logic intact. Easy to read, and arktype slots in without spreading special-cases through the renderer.
- **Arktype types that can't be strings.** `Uint8Array` isn't an arktype keyword. Handled by escape-hatching to `type.instanceOf(Uint8Array)` (arktype accepts a Type value as an object-literal field). Arrays of instance-of types use `.array()`; everything else stays in the string grammar.
- **MDX-through-sync.** `sync-docs.mjs` used to hardcode `.md` on the destination. One-line change to preserve `path.extname(sourcePath)` so `.mdx` → `.mdx`, `.md` → `.md`. Verified by running `pnpm --filter sqlfu-website build` — `arktype` appears 11 times in the rendered HTML, Starlight's `<Tabs>` component builds correctly.
- **Source frontmatter.** First pass at the `.mdx` doc had a `---\ntitle: …\n---` frontmatter block above the content; `sync-docs.mjs` prepends its own generated frontmatter, so the output had doubled frontmatter. Dropped the source frontmatter — the sync pipeline is the source of truth for Starlight frontmatter.
- **Unrelated test failures (not from this branch).** `test/adapters/better-sqlite3.test.ts` needs a native-module rebuild in this worktree; `test/ui-server.test.ts` fails because packages/ui's vite.config.ts can't be loaded. Both reproduce on `main` without my changes. Left for follow-up.
