# packages/sqlfu working notes

## The three-step build is deliberate

`package.json` has:

```jsonc
"build": "pnpm run build:internal-queries && pnpm run build:runtime && pnpm run build:vendor-typesql && pnpm run build:bundle-vendor",
"build:runtime": "tsgo -p tsconfig.build.json",
"build:vendor-typesql": "rm -rf dist/vendor/antlr4 dist/vendor/code-block-writer dist/vendor/typesql dist/vendor/typesql-parser && tsgo -p src/vendor/typesql/tsconfig.json",
"build:bundle-vendor": "tsx scripts/bundle-vendor.ts",
```

(`build:internal-queries` is a codegen step, not part of this discussion.) The three compile/bundle steps **look** like ceremony worth collapsing. They aren't. The split protects real constraints, and every "obvious" simplification we've tried breaks one of them.

### Why two configs

- `tsconfig.build.json` compiles our real code plus the vendored `sql-formatter` (91 files) and `standard-schema`. Strict mode is on. `sql-formatter` files carry `@ts-nocheck` per file; the other vendored trees don't.
- `src/vendor/typesql/tsconfig.json` compiles the vendored TypeSQL + TypeSQL-parser + `code-block-writer` + the ANTLR4 web-bundle (`.js`). It sets `noCheck: true`, `strict: false`, `allowJs: true`, `declaration: false`, and `declarationMap: false`. These codebases have real type errors upstream and emit enormous `.d.ts` files that nobody imports.

### What kills each "collapse" attempt

- **Naive merge into one `tsconfig.build.json` with `noCheck: true`.** `noCheck: true` distorts inferred types in our own code — `src/api.ts`'s `getSchemaAuthorities` return type loses `string | null` fields (observed 2026-04-20 during the collapse investigation). Anything consuming `dist/api.d.ts` gets a subtly different public surface.
- **Merge without `noCheck: true`.** The vendored typesql tree fails type-checking (dozens of `getText`/`ParserRuleContext` errors) the moment it's pulled into the main `tsc` run, because it expects the looser `strict: false, noImplicitAny: false` settings.
- **`tsc -b` composite projects.** Composite projects are not allowed to set `declaration: false` (`TS6304`). Turning declaration on under the vendor config brings back the ~128 unwanted `.d.ts` + `.d.ts.map` files (~2.1 MB uncompressed) that the second step is specifically trying to avoid. You end up needing a post-build `find dist/vendor/{antlr4,code-block-writer,typesql,typesql-parser} -name '*.d.ts*' -delete` which is just a more awkward form of the current `rm -rf`, and you also inherit `.tsbuildinfo` files that need excluding from pack.
- **Bundler-based builders (tsdown, tsup).** Paradigm mismatch. Our consumers read individual files under `dist/` (tests via `packageRoot + '/dist/cli.js'`, `publishConfig.exports` mapping each entry separately, `ensureBuilt()` calling `node dist/cli.js`). Unbundle mode exists but still emits `.mjs`/`.d.mts` by default and still produces `.d.mts` files for the vendor tree. The work to rewrite extensions, exports, and `ensureBuilt()` paths for a build we're not fundamentally unhappy with is a negative ROI.

### What `rm -rf dist/vendor/{antlr4,code-block-writer,typesql,typesql-parser}` is actually for

Not for the merge story — it's orthogonal. It's a **pre-step cleanup** so that obsolete files from a previous build (stale output of renamed/deleted sources in the vendor tree) don't linger in `dist/`. The four directories listed are exactly the ones owned by `build:vendor-typesql` and not by `build:runtime`, so there's no overlap between those two build steps; neither one clobbers the other. The third step (`build:bundle-vendor`) runs after and collapses the typesql + sql-formatter output into a few minified bundles (see below).

## `build:bundle-vendor` — what it does and why

`scripts/bundle-vendor.ts` runs esbuild over `dist/vendor/typesql` and `dist/vendor/sql-formatter` after the tsgo steps have produced unbundled per-file output. It replaces those subtrees with small minified bundles and then deletes the now-orphaned files. Without this step the published tarball is ~18 MB unpacked (dominated by ANTLR parse tables and 20 sql-formatter dialects the sqlite-only runtime never reaches); with it, it's ~1 MB.

Three things to know before changing it:

1. **It targets source, not `dist/`.** Entry points are `src/vendor/typesql/sqlfu.ts`, `src/vendor/sql-formatter/sqlFormatter.ts` (via a stdin wrapper), and `src/vendor/sql-formatter/languages/sqlite/sqlite.formatter.ts`. The output paths mirror the dist layout so `dist/typegen/*` and `dist/formatter.js` (produced by `build:runtime`) keep resolving `./vendor/typesql/sqlfu.js` and `./vendor/sql-formatter/*` without any edits. If you move an entry, update those consumers too.

2. **An esbuild `onLoad` plugin intercepts `src/vendor/sql-formatter/allDialects.ts` at bundle time** and rewrites it to export only `sqlite`. Paired with a stdin entry that re-exports only `formatDialect`, this lets esbuild drop upstream's `format(query, {language})` entry point and, with it, 19 non-sqlite dialect modules (~1.3 MB of keyword/function data). The on-disk `.ts` is untouched so upstream resyncs stay a mechanical copy-over (see `src/vendor/sql-formatter/CLAUDE.md`).

   (There used to be a second plugin, `gut-antlr-parsers`, that stripped the vendored MySQL parser's `_serializedATN` data at bundle time. It's gone — along with the MySQL parser itself — once the sqlite analyzer was untangled from MySQL's AST. See `tasks/slim-package.md` for that history.)

3. **The deletion lists at the end are exhaustive, not "whatever's left".** After bundling, the script `rm -rf`s every path under `dist/vendor/{typesql,sql-formatter}/**` that isn't the bundle output. If a future vendor edit adds a new file, the script won't magically delete it — it'll ship in the tarball until you add it to the list. Check `du -sh dist/vendor/*` after a build if you've touched vendor code.

### What breaks if you try to skip the bundle step

- **Naive tree-shake with just the esbuild defaults on `sqlFormatter.ts`.** Upstream's `import * as allDialects from './allDialects.js'` is a side-effectful namespace import; esbuild won't prune it. You keep all 20 dialects regardless of whether `format` is ever called.

### Performance today (for context, not a constraint to re-verify on every change)

Measured 2026-04-20 with `tsgo` + esbuild:

- `pnpm build:runtime` cold: ~0.37s
- `pnpm build:bundle-vendor` cold: ~0.3s
- `pnpm build` (all three compile/bundle steps) cold: ~3.1s
- `pnpm typecheck`: ~0.81s

`test/adapters/ensure-built.ts` memoizes a `pnpm build:runtime` call so adapter tests that need `dist/` get warmed up cheaply. Don't switch it to `pnpm build` — that'd ~10x the warm path (0.37s → 3.1s) and blow some 5-second test timeouts. Adapter tests don't exercise the bundled vendor output; they only need `dist/cli.js` and the unbundled sqlite dialect files. If a new adapter test DOES need the bundled output, wire it to `pnpm build` specifically, don't change the default.

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
