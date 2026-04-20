---
status: done
size: small
---

# Vendor nearley runtime, drop npm dep

## Status summary

Done. Nearley runtime is vendored as `packages/sqlfu/src/vendor/sql-formatter/parser/nearley-runtime.ts` (ESM, `@ts-nocheck`), `createParser.ts` imports it instead of `'nearley'`, and the `nearley` dependency is gone from `packages/sqlfu/package.json`. Verified with the formatter test suite (1457 passing), typecheck, and build.

## Motivation

`nearley` appears in `packages/sqlfu/package.json` as a runtime dependency, but the only consumer is the vendored sql-formatter at `packages/sqlfu/src/vendor/sql-formatter/parser/createParser.ts`. It uses exactly two exports: `Parser` and `Grammar.fromCompiled`. The runtime (`node_modules/.pnpm/nearley@2.20.1/node_modules/nearley/lib/nearley.js`) is a single ~564-line dependency-free UMD file.

Vendoring it:

- removes one published-npm dep from our surface
- aligns with how we already treat sql-formatter (vendored because we expect to diverge)
- costs ~560 lines of committed code and a CLAUDE.md note

The grammar file (`grammar.ts`) is already committed — it was pre-generated from `grammar.ne` by the nearley CLI. We are *not* changing the build-time story for regenerating that file; if someone edits `grammar.ne` they still reach for `nearleyc` (via `npx` or a devDep), same as today for sql-formatter upstream.

## Checklist

- [x] Copy `nearley/lib/nearley.js` into `packages/sqlfu/src/vendor/sql-formatter/parser/nearley-runtime.ts` _ended up as `.ts` not `.js` — main build (`tsc -p tsconfig.build.json`) only emits `.ts` files from `src/`, so a raw `.js` would not reach `dist/`. UMD wrapper stripped in favor of ESM `export { Parser, Grammar, Rule }` (+ default export matching the shape the factory used to return). File header has `@ts-nocheck` + attribution banner._
- [x] ~~Add a short `.d.ts` covering `Parser` and `Grammar.fromCompiled`~~ _not needed; `createParser.ts` is `@ts-nocheck` so the untyped `@ts-nocheck` runtime file is fine as-is._
- [x] Update `createParser.ts` to import from the vendored file instead of `'nearley'` _one-line swap: `import nearley from './nearley-runtime.js';`_
- [x] Remove `"nearley"` from `packages/sqlfu/package.json` dependencies
- [x] Run `pnpm install` to refresh the lockfile
- [x] Update `packages/sqlfu/src/vendor/sql-formatter/CLAUDE.md` with a note about the vendored runtime and how to regenerate `grammar.ne` via `pnpm dlx nearleyc`
- [x] Verify: `pnpm --filter sqlfu test --run test/formatter.test.ts` _1457 passed_
- [x] Verify: `pnpm --filter sqlfu typecheck`
- [x] Verify: `pnpm --filter sqlfu build`

## Non-goals

- Not rewriting the parser. Not touching `grammar.ts` / `grammar.ne`. Not unifying with the ANTLR parser from `typesql-parser`.
- Not trimming the nearley runtime. Copy it verbatim so a future resync from upstream nearley is a plain file overwrite.
- Not adding a devDep on `nearley` "just for `nearleyc`". If someone needs to regenerate `grammar.ts`, `pnpm dlx nearleyc` works fine. If that turns out to be a pain, we add the devDep later.

## Implementation notes

- The `.js` → `.ts` rename is worth flagging: the sqlfu vendor tree has a precedent for vendored `.js` files (see `src/vendor/antlr4/index.js`), but antlr4 is only consumed by the typesql subtree which is excluded from the main build and compiled by a separate `tsconfig.json` with `allowJs: true`. sql-formatter is part of the main build, which does not enable `allowJs`, so a `.js` file here would be silently dropped from `dist/`.
- Stripping the UMD wrapper is the only non-mechanical transformation. `(function(root, factory) { ... }(this, function() { body; return { Parser, Grammar, Rule }; }))` becomes `body; export { Parser, Grammar, Rule }; export default { Parser, Grammar, Rule };`. The body is byte-for-byte identical to upstream `nearley@2.20.1`. Anyone wanting to resync from upstream can diff the body regions.
- Pre-existing build bug was also fixed in this branch after follow-up from the user. Two layered problems:
  1. `build:vendor-typesql` ran `rm -rf dist/vendor && tsc -p src/vendor/typesql/tsconfig.json`, which destroyed `dist/vendor/sql-formatter/` emitted by `build:runtime`. Narrowed the `rm` to only the dirs that build step actually owns (`antlr4`, `code-block-writer`, `typesql`, `typesql-parser`).
  2. Even with sql-formatter surviving the rm, its emitted `.js` was broken at runtime: the vendored sources all have `// @ts-nocheck` (so no type checking) and the workspace has `verbatimModuleSyntax: true`, so type-only value imports like `import { PrefixedQuoteType } from './TokenizerOptions.js'` were preserved in the emit and blew up as "does not provide an export named". Fixed by setting `verbatimModuleSyntax: false` in `tsconfig.build.json` only — the typecheck config still enforces strict `verbatimModuleSyntax` for our own source. This was initially solved with a dedicated sql-formatter tsconfig + extra build script, but collapsed back to a one-line setting after review: the simpler fix keeps the build graph at two steps and avoids future maintenance burden.
  Smoke-tested by running `node -e "import('./dist/formatter.js').then(m => console.log(m.formatSql('select 1, 2 from foo where x = 1', {dialect: 'postgresql'})))"` against the built output. Full sqlfu test suite (1668 passing) also runs green.
