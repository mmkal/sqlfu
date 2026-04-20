# Vendored TypeSQL Parser Notes

This directory is a near-copy of `https://github.com/wsporto/typesql-parser` `src/`, initially vendored from package version `0.0.3`.

Keep changes here mechanical where possible. Prefer preserving upstream structure over local cleanup.

**sqlfu is sqlite-only.** We've dropped the vendored MySQL and Postgres parser subtrees entirely — they weren't reachable from the sqlite path after we untangled `sqlite-query-analyzer` from MySQL's AST. If you ever need multi-dialect support, resync them from upstream rather than trying to extract from git history; the upstream source is where they stay canonical.

Local changes that are expected:
- ESM-compatible relative import suffixes
- local `src/vendor/antlr4/index.js` import paths instead of the external `antlr4` package
- attribution comments or adjacent vendor notes
- only `typesql-parser/sqlite/` + `typesql-parser/index.ts` are kept

When updating from upstream:
- recopy upstream `src/sqlite/` over `typesql-parser/sqlite/`; do NOT recopy `src/mysql` / `src/postgres`
- reapply only the local compatibility rewrites
- verify with `pnpm --filter sqlfu test --run test/generate.test.ts`, `pnpm --filter sqlfu typecheck`, and `pnpm --filter sqlfu build`
