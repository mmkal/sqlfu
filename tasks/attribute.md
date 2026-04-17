status: in-progress
size: medium

Attribute inspirations and sources properly, both out of respect and pragmatism: people can and should compare.

## High-level status

Rough state: starting implementation. Vendor folders already have directory-level `AGENTS.md` attribution. Biggest gaps are in the top-level `README.md` (no "prior art" section covering drizzle, schemainspect/migra, pgkit) and in the `packages/sqlfu/src/schemadiff/**` files which are inspired by pgkit/schemainspect/migra ports of djrobstep's Python originals but do not say so at the file level.

## Projects to acknowledge

- **drizzle** - studio inspiration (`local.drizzle.studio` product model already noted in `packages/ui/AGENTS.md`), generally high working-with-databases bar
- **typesql** - mostly vendored under `packages/sqlfu/src/vendor/typesql` for the TypeScript type generation
- **typesql-parser** - vendored under `packages/sqlfu/src/vendor/typesql-parser`
- **antlr4 runtime** - vendored under `packages/sqlfu/src/vendor/antlr4`
- **code-block-writer** - vendored under `packages/sqlfu/src/vendor/code-block-writer`
- **sql-formatter** - vendored whole under `packages/sqlfu/src/vendor/sql-formatter`, wrapped by `packages/sqlfu/src/formatter.ts`
- **@pgkit/schemainspect** and **@pgkit/migra** - inspiration for `packages/sqlfu/src/schemadiff/**`, already linked by `packages/sqlfu/src/schemadiff/AGENTS.md` but not by the source files themselves
- **djrobstep's Python `schemainspect` and `migra`** - upstream of the pgkit ports
- **pgkit** - author's earlier Postgres-focused project, prior art for the whole shape of sqlfu

## Plan

- [ ] audit vendor directories (`packages/sqlfu/src/vendor/*`) and confirm each has directory-level attribution; add file-level attribution at entry-point files where it is load-bearing for readers _AGENTS.md already covers each vendor dir; entry-point attribution added only where helpful_
- [ ] add file-level attribution to `packages/sqlfu/src/schemadiff/**` files that are inspired by `@pgkit/schemainspect` / `@pgkit/migra` / djrobstep's Python originals
- [ ] add a "prior art and acknowledgements" section to `packages/sqlfu/README.md`
- [ ] cross-link that section from `packages/sqlfu/docs/schema-diff-model.md` if appropriate
- [ ] audit `website/build.mjs` and generated docs page so the acknowledgements section shows up on the docs site
- [ ] update the task file with notes and move it to `tasks/complete/2026-04-18-attribute.md` when done
- [ ] commit in sensible chunks; do NOT push; do NOT merge to main

## Non-goals

- not rewriting vendored code
- not adding attribution to every vendored file (directory-level AGENTS.md plus entry-point headers is enough)
- not changing licenses, `package.json` metadata, or `LICENSE` files - just code and docs attribution

## Implementation log

(populated as work progresses)
