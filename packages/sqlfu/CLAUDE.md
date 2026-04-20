# packages/sqlfu working notes

## The two-step build is deliberate

`package.json` has:

```jsonc
"build": "pnpm run build:runtime && pnpm run build:vendor-typesql",
"build:runtime": "tsgo -p tsconfig.build.json",
"build:vendor-typesql": "rm -rf dist/vendor/antlr4 dist/vendor/code-block-writer dist/vendor/typesql dist/vendor/typesql-parser && tsgo -p src/vendor/typesql/tsconfig.json",
```

This **looks** like ceremony worth collapsing. It isn't. The split protects two real constraints, and every "obvious" simplification we've tried breaks one of them.

### Why two configs

- `tsconfig.build.json` compiles our real code plus the vendored `sql-formatter` (91 files) and `standard-schema`. Strict mode is on. `sql-formatter` files carry `@ts-nocheck` per file; the other vendored trees don't.
- `src/vendor/typesql/tsconfig.json` compiles the vendored TypeSQL + TypeSQL-parser + `code-block-writer` + the ANTLR4 web-bundle (`.js`). It sets `noCheck: true`, `strict: false`, `allowJs: true`, `declaration: false`, and `declarationMap: false`. These codebases have real type errors upstream and emit enormous `.d.ts` files that nobody imports.

### What kills each "collapse" attempt

- **Naive merge into one `tsconfig.build.json` with `noCheck: true`.** `noCheck: true` distorts inferred types in our own code — `src/api.ts`'s `getSchemaAuthorities` return type loses `string | null` fields (observed 2026-04-20 during the collapse investigation). Anything consuming `dist/api.d.ts` gets a subtly different public surface.
- **Merge without `noCheck: true`.** The vendored typesql tree fails type-checking (dozens of `getText`/`ParserRuleContext` errors) the moment it's pulled into the main `tsc` run, because it expects the looser `strict: false, noImplicitAny: false` settings.
- **`tsc -b` composite projects.** Composite projects are not allowed to set `declaration: false` (`TS6304`). Turning declaration on under the vendor config brings back the ~128 unwanted `.d.ts` + `.d.ts.map` files (~2.1 MB uncompressed) that the second step is specifically trying to avoid. You end up needing a post-build `find dist/vendor/{antlr4,code-block-writer,typesql,typesql-parser} -name '*.d.ts*' -delete` which is just a more awkward form of the current `rm -rf`, and you also inherit `.tsbuildinfo` files that need excluding from pack.
- **Bundler-based builders (tsdown, tsup).** Paradigm mismatch. Our consumers read individual files under `dist/` (tests via `packageRoot + '/dist/cli.js'`, `publishConfig.exports` mapping each entry separately, `ensureBuilt()` calling `node dist/cli.js`). Unbundle mode exists but still emits `.mjs`/`.d.mts` by default and still produces `.d.mts` files for the vendor tree. The work to rewrite extensions, exports, and `ensureBuilt()` paths for a build we're not fundamentally unhappy with is a negative ROI.

### What `rm -rf dist/vendor/{antlr4,code-block-writer,typesql,typesql-parser}` is actually for

Not for the merge story — it's orthogonal. It's a **pre-step cleanup** so that obsolete files from a previous build (stale output of renamed/deleted sources in the vendor tree) don't linger in `dist/`. The four directories listed are exactly the ones owned by `build:vendor-typesql` and not by `build:runtime`, so there's no overlap between the two build steps; neither one clobbers the other.

### Performance today (for context, not a constraint to re-verify on every change)

Measured 2026-04-20 with `tsgo`:

- `pnpm build:runtime` cold: ~0.37s
- `pnpm build` (both steps) cold: ~4.2s
- `pnpm typecheck`: ~0.81s

`test/adapters/ensure-built.ts` memoizes a `pnpm build:runtime` call so adapter tests that need `dist/` get warmed up cheaply. Don't switch it to `pnpm build` — that'd more than 10x the warm path (0.37s → 4.2s) and blow some 5-second test timeouts.

### If you think you've found a clean collapse

Re-run this diff before committing:

```sh
# On the working branch, with dist/ freshly built:
diff -q \
  <(git show main:packages/sqlfu/dist/api.d.ts 2>/dev/null || cat /tmp/main-api.d.ts) \
  packages/sqlfu/dist/api.d.ts
# And for each of: index.d.ts, browser.d.ts, client.d.ts, cli.d.ts, ui/index.d.ts, ui/browser.d.ts
```

If any of the public `.d.ts` shape shifts (especially: nullable fields dropping `| null`), you've rediscovered the `noCheck: true` bug. Stop and use the two-step build.

## Other notes

- `tsgo` is an alias for `@typescript/native-preview`'s `tsc`. Still supports `-b`, project references, etc.
- Public entry points are `index`, `browser`, `client`, `api`, `cli`, `ui/index`, `ui/browser` — see `publishConfig.exports` in `package.json`. Any build change must preserve these exact `dist/{entry}.{js,d.ts}` paths.
