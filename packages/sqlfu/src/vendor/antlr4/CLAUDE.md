# Vendored antlr4 Notes

This directory is a near-copy of [antlr/antlr4](https://github.com/antlr/antlr4) v4.13.2, specifically the `dist/antlr4.web.mjs` artifact published to npm.

## Why vendored

The vendored TypeSQL tree depends on antlr4 at runtime. Committing one copy lets us ship the same artifact to node (CLI / host) and the browser (demo mode) without each consumer re-resolving antlr4 via `node_modules`.

## Why the web build specifically

The published `dist/antlr4.node.mjs` has a top-level `import {createRequire} from "node:module"`, which it uses *only* to pull in `fs` for `FileStream.fromPath`. sqlfu's typesql pipeline never constructs a `FileStream` — we feed SQL in-memory via `CharStreams.fromString` — and the `node:module` import breaks browser bundling (Vite externalizes `node:module`, the browser then fails to load it). `dist/antlr4.web.mjs` has zero top-level imports, stubs `fs` as `{}` via an empty webpack module, keeps the `FileStream` class for API parity, and is otherwise byte-for-byte the same minified code as the node build. That makes it a clean drop-in for both runtimes.

## Local modifications

- `FileStream.fromPath` / `FileStream` constructor error message rewritten from `"FileStream is only available when running in Node!"` to something less confusing when encountered from sqlfu code (see the replacement below).
- Three type-only aliases (`DecisionState`, `TokenStream`, `Recognizer`) are appended as `export const … = undefined` at the bottom of the file. The ANTLR-generated parser files in `vendor/typesql-parser/` import these names from antlr4 for TS type annotations only, but neither the node nor the web antlr4 bundle actually exports them. esbuild (what Vite uses to transform .ts without a type checker) can't tell types from values, so without the aliases it errors at module load. Exporting `undefined` under each name satisfies the import; no runtime code references these values.
- The trailing `//# sourceMappingURL=antlr4.web.mjs.map` comment was removed; we don't vendor the `.map` alongside, and keeping the reference made Vite's dev server log a noisy `ENOENT` per request.

## When updating from upstream

1. `npm pack antlr4@<version>` and extract the tarball.
2. `cp <tarball>/package/dist/antlr4.web.mjs packages/sqlfu/src/vendor/antlr4/index.js` — overwrite entirely rather than editing in place.
3. Prepend the banner block (copy from the current file's top-of-file comment).
4. Replace both occurrences of:
   - `FileStream is only available when running in Node!`
   - with: `FileStream is not supported in sqlfu's vendored antlr4 (web build); read the file yourself and pass its contents to CharStreams.fromString.`
5. Append the three type-only alias exports (see **Local modifications** above) to the end of the file. If upstream starts exporting any of these names for real, drop the corresponding alias — but keep the others.
6. Remove the trailing `//# sourceMappingURL=antlr4.web.mjs.map` comment (the `.map` file isn't vendored).
7. Verify with `pnpm --filter sqlfu test --run test/generate.test.ts`, `pnpm --filter sqlfu typecheck`, `pnpm --filter sqlfu build`, and `pnpm --filter sqlfu-ui build`.
