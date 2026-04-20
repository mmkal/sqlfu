---
status: in-progress
size: medium
branch: slimmer-package
---

# Shrink the published sqlfu package

Get the published tarball to under 1 MB. Started because `npm pack --dry-run` reported 1.5 MB packed / 18.8 MB unpacked / 754 files for `sqlfu@0.0.2`, most of it vendored parsers and multi-dialect formatter data that sqlite-only sqlfu never touches.

## Status

- under 1 MB packed: yes, **245 kB** (originally 1.5 MB)
- unpacked: **1.1 MB** (originally 18.8 MB)
- all 1071 tests pass (down from 1688 — the 617 removed were non-sqlite sql-formatter fixtures deleted with the multi-dialect API)
- still in progress: sqlite-query-analyzer still imports from MySQL's AST (via `instanceof *Context`), keeping ~846 kB of MySQL context classes reachable
- next: untangle sqlite-query-analyzer from the MySQL AST; then decide on replacing ANTLR entirely

## Progress

- [x] **Drop source maps from the publish** — added `"!dist/**/*.js.map"` to `files`. _1.5 MB → 1.1 MB packed, 18.8 MB → 9.0 MB unpacked._
- [x] **Stop emitting `.d.ts.map`** — `declarationMap: false` in `tsconfig.build.json`, dropped the corresponding exclusion from `files`. Local-dist noise only; tarball unchanged.
- [x] **Prune dead postgres + unreached typesql files** — added `src/vendor/typesql/tsconfig.json` excludes for `typesql-parser/postgres/**`, `typesql/postgres-query-analyzer/**`, `codegen/pg.ts`, `codegen/mysql2.ts`, `dialects/**`, `drivers/{libsql,postgres,types}.ts`, `cli.ts`, `load-config.ts`, `sql-generator.ts`. _1.1 MB → 741 kB packed, 9.0 MB → 5.4 MB unpacked._
- [x] **Bundle `vendor/typesql` with esbuild** — `scripts/bundle-vendor.ts` collapses `dist/vendor/{typesql,typesql-parser,antlr4,code-block-writer,small-utils}` into one minified `dist/vendor/typesql/sqlfu.js`. Only external consumer is `dist/typegen/analyze-vendored-typesql-with-client.js` and the bundle entry preserves that import path. _741 kB → 595 kB packed, 5.4 MB → 3.0 MB unpacked, 368 → 313 files._
- [x] **Gut MySQLParser's parse tables at bundle time** — esbuild `onLoad` plugin (`gut-antlr-parsers`) rewrites `MySQLParser.ts`/`MySQLLexer.ts` in-memory, stripping the 2 MB `_serializedATN` data, parse methods, and ATN/DFA initializers. Context classes and static constants (the only things the sqlite path references) stay. Source files on disk untouched. Required vendor edits first: trim `describe-query.ts` to pure utils, gut `mysql-query-analyzer/parse.ts` to AST helpers only, remove test-only `describeNestedQuery`/`parseAndInferNotNull` helpers. _595 kB → 366 kB packed, 3.0 MB → 1.6 MB unpacked._
- [x] **Sqlite-only sql-formatter + bundle** — `src/formatter.ts` now calls `formatDialect` directly with the sqlite dialect; dropped the `dialect` option and `supportedSqlDialects` from the public API. Added a second esbuild pass with a stdin entry re-exporting only `formatDialect` and an `onLoad` plugin that rewrites `allDialects.ts` to export only sqlite, so the 19 other dialect modules tree-shake. Deleted 5 multi-dialect fixture files (bigquery/mariadb/mysql/postgresql/tsql). _366 kB → 245 kB packed, 1.6 MB → 1.1 MB unpacked, 313 → 141 files._
- [x] **Document the three-step build in `packages/sqlfu/CLAUDE.md`** — explained the bundle step, the two `onLoad` plugins, and why vendor edits live in the build plugin rather than in source (so upstream resyncs stay mechanical).
- [ ] **Untangle sqlite-query-analyzer from the MySQL AST** — the remaining 846 kB of typesql bundle input is MySQL `*Context` classes kept because sqlite-query-analyzer does `instanceof` checks against them. Port those to SQLite context classes from `typesql-parser/sqlite/SQLiteParser.ts`, then drop the `typesql-parser/mysql` subtree and `typesql/mysql-query-analyzer` shared utilities entirely.

## Size progression

| Stage | Packed | Unpacked | Files |
|---|---|---|---|
| Baseline (`0.0.2`) | 1.5 MB | 18.8 MB | 754 |
| Drop `.js.map` from publish | 1.1 MB | 9.0 MB | 378 |
| Prune dead postgres + unreached typesql | 741 kB | 5.4 MB | 368 |
| Bundle `vendor/typesql` with esbuild | 595 kB | 3.0 MB | 313 |
| Gut MySQLParser parse tables | 366 kB | 1.6 MB | 313 |
| Sqlite-only sql-formatter + bundle | **245 kB** | **1.1 MB** | **141** |

## Remaining typesql bundle breakdown (post-gut, pre-untangle)

Reported by esbuild metafile as input bytes (after our gut plugin, before minify):

| Area | Size |
|---|---|
| `typesql-parser/mysql` (context classes only) | 846 kB |
| `typesql-parser/sqlite` (real parser) | 517 kB |
| `typesql/mysql-query-analyzer` (shared inference utilities) | 134 kB |
| `antlr4` runtime | 115 kB |
| `typesql/sqlite-query-analyzer` | 92 kB |
| `typesql/codegen` | 59 kB |
| misc | 63 kB |
| **Total** | **~1.83 MB** (minifies to ~640 kB on disk) |

## Remaining sqlfu dist breakdown

After bundling, the tarball contents are mostly sqlfu's own code:

| Chunk | Size |
|---|---|
| `dist/vendor/typesql/sqlfu.js` (bundled) | 640 kB |
| `dist/vendor/sql-formatter` (bundled + leftover `.d.ts`) | 96 kB |
| `dist/core` | 224 kB |
| `dist/schemadiff` | 204 kB |
| `dist/ui` | 188 kB |
| `dist/typegen` | 132 kB |
| `dist/adapters` | 108 kB |
| `dist/migrations` | 104 kB |
| various public entries + small modules | ~100 kB |

## What's NOT being done (and why)

- **Combining nearley (sql-formatter) into the ANTLR parser** — sql-formatter bundle is already 56 kB minified. Nearley is a whitespace/comment-preserving token grammar; rewriting it on ANTLR would be net-neutral complexity for tiny bundle wins.
- **Rewriting typesql from scratch in one night** — the inference engine (nullability propagation, parameter back-inference, dynamic SQL) is the hard part and it's battle-tested. Replacing the parser layer without touching the engine is the right scope.
- **Dropping ANTLR entirely (hand-written SQLite parser)** — open question for a follow-up. ANTLR SQLiteParser is 517 kB + antlr4 runtime 115 kB; a hand-rolled recursive-descent parser for SQLite DML could drop ~500 kB more. But it's a multi-night project with real regression risk, not a quick win.

## Implementation notes

### The esbuild `onLoad` plugins in `scripts/bundle-vendor.ts`

1. **`gut-antlr-parsers`** — rewrites `src/vendor/typesql-parser/mysql/MySQLParser.ts` and `MySQLLexer.ts` in-memory. Anchors on two text lines: `public get serializedATN()` marks the start of the removable region, `static DecisionsToDFA` marks the end. Everything between — including the 2 MB `_serializedATN` data literal, the constructor, thousands of parse methods, the `_ATN` getter, and the `DecisionsToDFA` initializer — is replaced with a stub `public static readonly _serializedATN: number[] = []`. Context classes and static token constants (above) and class close + context class definitions (below) are preserved. If upstream regenerates the parsers and those anchors shift, the plugin throws rather than silently producing broken output.

2. **`sqlite-only-dialects`** — rewrites `allDialects.ts` to only export `sqlite`. Paired with a stdin entry that re-exports only `formatDialect` (not upstream's `format`), this lets esbuild drop the 19 non-sqlite dialect modules.

### Vendor edits needed before the gut plugin could do its job

The `MySQLParser.ts` source was reachable from the sqlite path via a long import chain. The gut plugin alone wasn't enough — the sqlite analyzer was pulling `extractQueryInfo` from `mysql-query-analyzer/parse.ts` (which module-level-instantiates `new MySQLParser(...)`). Required vendor-source changes:

- `describe-query.ts` — removed `describeSql` and `parseSql` (both mysql-only, unused from the sqlite path). File now exports only pure utilities (`preprocessSql`, `verifyNotInferred`, `hasAnnotation`).
- `mysql-query-analyzer/parse.ts` — reduced to the 5 AST-walking helpers the sqlite analyzer actually needs (`extractOrderByParameters`, `extractLimitParameters`, `getAllQuerySpecificationsFromSelectStatement`, `getLimitOptions`, `isSumExpressContext`). Dropped the mysql-specific functions (`parse`, `parseAndInfer`, `parseAndInferParamNullability`, `extractQueryInfo`, `isMultipleRowResult`) and the top-level `new MySQLParser(...)`.
- `describe-nested-query.ts` — dropped the unused test-only `describeNestedQuery` helper.
- `mysql-query-analyzer/infer-column-nullability.ts` — dropped the unused test-only `parseAndInferNotNull` helper.
- `codegen/shared/codegen-util.ts` — moved `writeTypeBlock`, `hasDateColumn`, `replaceOrderByParam` here from `codegen/mysql2.ts` so `codegen/sqlite.ts` doesn't pull mysql2 into the bundle.

### Why the vendor edits weren't moved into the plugin too

Pure-utility splits (moving `hasDateColumn` etc.) are real product changes; they belong in source. Removing unused test helpers is also a real product change. Only the gutting of MySQLParser's 47 000-line class body is intrusive enough to warrant a build-time rewrite — keeping that edit as a plugin means upstream typesql-parser resyncs stay a mechanical directory copy.
