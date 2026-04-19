# Vendored TypeSQL Notes

This directory is a near-copy of `https://github.com/wsporto/typesql` `src/`, initially vendored from commit `f0356201d41f3f317824968a3f1c7a90fbafdc99`.

Keep changes here mechanical where possible. Prefer preserving upstream structure over "cleaning it up" for local style.

Local changes that are expected:
- ESM-compatible relative import suffixes
- `cli.ts` exports `compile` and `loadVendoredConfig`, and does not auto-run when imported
- attribution comments on touched files
- local imports to `src/vendor/small-utils.ts`
- vendored support code may live alongside this tree under `src/vendor/*`

When updating from upstream:
- copy upstream `src/` over this directory again rather than editing file-by-file
- reapply only the local compatibility changes above
- keep sqlfu-specific behavior outside this folder when possible
- verify with `pnpm --filter sqlfu test --run test/generate.test.ts`, `pnpm --filter sqlfu typecheck`, and `pnpm --filter sqlfu build`
