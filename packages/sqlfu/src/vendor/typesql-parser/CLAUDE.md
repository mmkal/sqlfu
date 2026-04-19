# Vendored TypeSQL Parser Notes

This directory is a near-copy of `https://github.com/wsporto/typesql-parser` `src/`, initially vendored from package version `0.0.3`.

Keep changes here mechanical where possible. Prefer preserving upstream structure over local cleanup.

Local changes that are expected:
- ESM-compatible relative import suffixes
- local `src/vendor/antlr4/index.js` import paths instead of the external `antlr4` package
- attribution comments or adjacent vendor notes

When updating from upstream:
- recopy upstream `src/` over this directory
- reapply only the local compatibility rewrites
- verify with `pnpm --filter sqlfu test --run test/generate.test.ts`, `pnpm --filter sqlfu typecheck`, and `pnpm --filter sqlfu build`
