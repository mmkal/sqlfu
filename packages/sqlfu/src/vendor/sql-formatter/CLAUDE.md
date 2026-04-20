# Vendored sql-formatter Notes

This directory is a near-copy of `https://github.com/sql-formatter-org/sql-formatter` `src/`, initially vendored from npm package version `15.7.3` / commit `a66b90020b7373155aa2e95a1bdc7d18055ae601`.

Keep changes here mechanical where possible. Prefer preserving upstream structure over "cleaning it up" for local style.

Local changes that are expected:
- sqlfu-specific behavior should stay outside this folder when possible
- attribution comments or adjacent vendor notes
- `parser/nearley-runtime.ts` is a vendored copy of the `nearley` npm package's runtime (`lib/nearley.js` in that package), converted to ESM so we don't depend on `nearley` at runtime. `parser/createParser.ts` imports it instead of `'nearley'`. If `grammar.ne` ever needs regenerating, use `pnpm dlx nearleyc grammar.ne -o grammar.ts` — we don't keep `nearleyc` installed because it's never needed at runtime.

We vendor this instead of treating it as a plain dependency because we expect to change printer behavior locally.
The first target is sql-formatter's tendency to force simple clauses onto separate lines, e.g.:
`select foo, bar from baz`
becoming
`select
  foo,
  bar
from
  baz`

When updating from upstream:
- copy upstream `src/` over this directory again rather than editing file-by-file
- reapply only the local compatibility changes above
- verify with `pnpm --filter sqlfu test --run test/formatter.test.ts`, `pnpm --filter sqlfu typecheck`, and `pnpm --filter sqlfu build`
