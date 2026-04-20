---
status: ready
size: small
---

# Vendor nearley runtime, drop npm dep

## Status summary

Not started. Goal is a single mechanical change: move the ~560-line nearley runtime into `packages/sqlfu/src/vendor/sql-formatter/parser/`, rewire the one import, drop `nearley` from `package.json`. No behavior change.

## Motivation

`nearley` appears in `packages/sqlfu/package.json` as a runtime dependency, but the only consumer is the vendored sql-formatter at `packages/sqlfu/src/vendor/sql-formatter/parser/createParser.ts`. It uses exactly two exports: `Parser` and `Grammar.fromCompiled`. The runtime (`node_modules/.pnpm/nearley@2.20.1/node_modules/nearley/lib/nearley.js`) is a single ~564-line dependency-free UMD file.

Vendoring it:

- removes one published-npm dep from our surface
- aligns with how we already treat sql-formatter (vendored because we expect to diverge)
- costs ~560 lines of committed code and a CLAUDE.md note

The grammar file (`grammar.ts`) is already committed — it was pre-generated from `grammar.ne` by the nearley CLI. We are *not* changing the build-time story for regenerating that file; if someone edits `grammar.ne` they still reach for `nearleyc` (via `npx` or a devDep), same as today for sql-formatter upstream.

## Checklist

- [ ] Copy `nearley/lib/nearley.js` into `packages/sqlfu/src/vendor/sql-formatter/parser/nearley-runtime.js` (keep the file as-is, UMD shape and all; add a banner pointing back at upstream + version `2.20.1`)
- [ ] Add a short `.d.ts` (or inline type) covering just `Parser` and `Grammar.fromCompiled` — the two symbols `createParser.ts` uses. Rest can stay untyped; `createParser.ts` is already `@ts-nocheck`.
- [ ] Update `createParser.ts` to import from the vendored file instead of `'nearley'`
- [ ] Remove `"nearley"` from `packages/sqlfu/package.json` dependencies
- [ ] Run `pnpm install` to refresh the lockfile
- [ ] Update `packages/sqlfu/src/vendor/sql-formatter/CLAUDE.md` to mention the vendored runtime and that `grammar.ne` regeneration still needs `nearleyc` (not a runtime need)
- [ ] Verify: `pnpm --filter sqlfu test --run test/formatter.test.ts`
- [ ] Verify: `pnpm --filter sqlfu typecheck`
- [ ] Verify: `pnpm --filter sqlfu build`

## Non-goals

- Not rewriting the parser. Not touching `grammar.ts` / `grammar.ne`. Not unifying with the ANTLR parser from `typesql-parser`.
- Not trimming the nearley runtime. Copy it verbatim so a future resync from upstream nearley is a plain file overwrite.
- Not adding a devDep on `nearley` "just for `nearleyc`". If someone needs to regenerate `grammar.ts`, `pnpm dlx nearleyc` works fine. If that turns out to be a pain, we add the devDep later.

## Implementation notes

(to be filled in during implementation)
