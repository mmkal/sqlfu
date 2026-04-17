status: done
size: medium

Attribute inspirations and sources properly, both out of respect and pragmatism: people can and should compare.

## High-level status

Done. Prior art now acknowledged across vendor tree, schemadiff source files, sqlfu README, UI README, and schema-diff-model doc. Vendored directories keep their `AGENTS.md` workflow intact so future upstream resyncs stay mechanical.

## Projects acknowledged

- **drizzle** - studio inspiration (`local.drizzle.studio` product model), now credited in the sqlfu README prior-art section and in the UI README, on top of the existing `packages/ui/AGENTS.md` note
- **typesql** + **typesql-parser** - vendored under `packages/sqlfu/src/vendor/typesql(-parser)`, credited in the sqlfu README and at the top of vendor entry files
- **antlr4** JS runtime and **code-block-writer** - vendored support, credited in the sqlfu README and in `packages/sqlfu/src/vendor/AGENTS.md`
- **sql-formatter** - vendored whole, wrapped by `packages/sqlfu/src/formatter.ts`, credited everywhere it is used
- **prettier-plugin-sql-cst** - the style and many formatter fixtures come from here, credited in the README prior-art section
- **@pgkit/schemainspect** + **@pgkit/migra** - inspiration for `packages/sqlfu/src/schemadiff`, credited in every schemadiff file header, in the README, and in the schema-diff-model doc
- **djrobstep's Python `schemainspect`+`migra`** - the upstream of the pgkit ports, credited alongside in the same places
- **pgkit** - author's earlier Postgres project, credited as prior art in the sqlfu README
- **neverthrow** - the `Either`/`Result` shapes in `packages/sqlfu/src/vendor/small-utils.ts` are locally-reimplemented approximations of its API; credited in the file banner

## Plan

- [x] audit vendor directories (`packages/sqlfu/src/vendor/*`) and confirm each has directory-level attribution; add file-level attribution at entry-point files where it is load-bearing for readers _every vendor subdirectory already had an AGENTS.md with upstream pin and local-mods list; added a top-level packages/sqlfu/src/vendor/AGENTS.md summarizing the whole tree, and banners on the sql-formatter, typesql-parser, small-utils, and heavily-modified typesql query-executor entry files_
- [x] add file-level attribution to `packages/sqlfu/src/schemadiff/**` files that are inspired by `@pgkit/schemainspect` / `@pgkit/migra` / djrobstep's Python originals _added to schemadiff/index.ts, sqlite/index.ts, sqlite/inspect.ts, sqlite/plan.ts, sqlite/analysis.ts; each links back to schemadiff/AGENTS.md which had the broader inspiration note_
- [x] add a "prior art and acknowledgements" section to `packages/sqlfu/README.md` _covers typesql, sql-formatter, prettier-plugin-sql-cst, antlr4, code-block-writer, drizzle, @pgkit/schemainspect + @pgkit/migra, djrobstep's Python originals, pgkit_
- [x] cross-link that section from `packages/sqlfu/docs/schema-diff-model.md` _added a Prior Art subsection with direct links to @pgkit/schemainspect, @pgkit/migra, djrobstep/schemainspect, djrobstep/migra, and schemadiff/AGENTS.md_
- [x] audit `website/build.mjs` and generated docs page so the acknowledgements section shows up on the docs site _website/build.mjs pulls packages/sqlfu/README.md and packages/sqlfu/docs/*.md straight into the docs site through markdown-it; the new "Prior Art and Acknowledgements" section will render on the docs site and in the on-page TOC automatically - no build-script change needed_
- [x] commit in sensible chunks; do NOT push; do NOT merge to main _committed as: task plan, schemadiff headers, README/doc prior-art section, vendor entry-file banners, vendor AGENTS.md, UI README drizzle credit, prettier-plugin-sql-cst credit_
- [x] update the task file with notes and move it to `tasks/complete/2026-04-18-attribute.md` when done _done at end of run_

## Non-goals

- not rewriting vendored code
- not adding attribution to every vendored file (directory-level AGENTS.md plus entry-point headers is enough, and per-file banners would be overwritten on every upstream resync)
- not changing licenses, `package.json` metadata, or `LICENSE` files - just code and docs attribution

## Implementation log

- **commit 72dccfc** - flesh out the task file into a plan before starting, per global workflow.
- **commit 2bf678c** - added inspiration headers to the schemadiff source files. The `schemadiff/AGENTS.md` already documented the pgkit/migra/djrobstep lineage at the directory level, but someone opening a single file (e.g. `sqlite/plan.ts`) would not see it. Each header points back to the AGENTS.md for the full inspiration notes and to the upstream repos.
- **commit 88f46b3** - added the "Prior Art and Acknowledgements" section to `packages/sqlfu/README.md` and a Prior Art subsection to `packages/sqlfu/docs/schema-diff-model.md`. The website build (`website/build.mjs`) pulls both files verbatim into the docs site, so the credits surface on `local.sqlfu.dev/docs/` automatically.
- **commit 5d2f8b4** - added banners to the vendor entry-point files (`sql-formatter/index.ts`, `sql-formatter/sqlFormatter.ts`, `typesql-parser/index.ts`, `small-utils.ts`, `typesql/sqlite-query-analyzer/query-executor.ts`). Each banner pins the upstream commit/version, license, and the set of local modifications so an upstream resync can reapply them. Also verified that neverthrow is a real upstream typesql dependency whose shape `small-utils.ts` approximates.
- **commit 46744ed** - added `packages/sqlfu/src/vendor/AGENTS.md` as a tree-level summary, including a table of vendored projects with upstream URLs, licenses, and pinned versions. Also documents the per-file attribution policy: rely on directory-level AGENTS.md plus banners on entry and heavily-modified files, not per-file banners that would get overwritten on resync.
- **commit 624e437** - added an "Inspiration" section to `packages/ui/README.md` crediting `local.drizzle.studio`. The root `README.md` is auto-synced from this file by `scripts/sync-root-readme.ts`, so the credit propagates through to the repo root and the docs site. Existing `packages/ui/AGENTS.md` still carries the long-form explanation of why "public HTTPS page talks to localhost" needs the CORS / private-network / `mkcert` handling that lives in `packages/sqlfu`.
- **commit 4cd97cf** - added prettier-plugin-sql-cst to the prior art section after realizing the `generated-prettier-plugin-sql-cst-*.fixture.sql` files under `packages/sqlfu/test/formatter/` are direct imports from its test suite.

### Verification

- `pnpm --filter sqlfu typecheck` passes
- `pnpm --filter sqlfu test --run test/formatter.test.ts` passes (1457 tests)
- `pnpm --filter sqlfu test --run test/generate.test.ts` passes (18 tests)
- pre-commit root-readme sync hook fired and auto-committed the root `README.md` change when the UI README changed
