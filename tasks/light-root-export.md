---
status: ready
size: medium
---

# Light root export: make `import 'sqlfu'` runtime-safe

## Status

Spec fleshed out via `grill-you`. Ready for implementation. See `tasks/light-root-export.interview.md` for the full decision log. Implementation hasn't started; this file is the hand-off.

## Why

The user landed `e143355 slim down root export` which trimmed `packages/sqlfu/src/index.ts` and added a top-of-file comment declaring the rule:

> the main index.ts export for the sqlfu package must be "light". it can only import runtime-safe stuff: client, adapters (type-only, no `@libsql/client` / `bun:sqlite` runtime imports), config (same rule — no `node:` imports either). types are fine.

The slim-down was a surface patch. The real violation is in `core/config.ts`, which imports `node:fs/promises`, `node:path`, `node:url` and mixes pure helpers with I/O. Users targeting Cloudflare Workers, Bun, Deno, or browsers should be able to `import { instrument, createD1Client, defineConfig } from 'sqlfu'` without pulling a single `node:*` builtin into their bundle.

Adapters already follow the rule; they import only sqlfu-internal types (`XyzDatabaseLike`) and do not reach into `@libsql/client` / `bun:sqlite` runtime modules. That convention stays.

## The contract

The **runtime graph** of built `dist/index.js` contains:

- Zero `node:*` imports.
- Zero bare-specifier imports (no npm deps — empty allowlist).

Type-only imports (`import type { DatabaseSync } from 'node:sqlite'`) are fine because they erase at build. The enforcement runs against the built JS, so type erasure takes care of itself.

"Runtime graph" = static `import` / `export ... from` graph starting at `dist/index.js`. Dynamic `import()` is not covered by the check — avoid it on the light path.

## Plan

Tiny reversible commits, in this order.

### Commit 1 — add `resolvePath` to `core/paths.ts`

`core/paths.ts` already has `joinPath`, `basename`, `dirname`. Add a `resolvePath(base, relative)` that matches the "absolute → return as-is; otherwise join" half of `node:path`'s `resolve` used today in `core/config.ts`. Four-ish lines. Keep POSIX-only per the file's existing comment.

- [ ] `resolvePath(base: string, value: string): string` added to `core/paths.ts` with a one-line doc comment _(implementation detail: don't try to mimic all of `path.resolve`'s variadic behavior — only the two-arg form `resolveProjectConfig` actually uses)_
- [ ] No consumer changes yet; this commit just adds the helper

### Commit 2 — split `core/config.ts` into pure + I/O halves

- [ ] Create `packages/sqlfu/src/core/config-load.ts`. Move into it: `loadProjectConfig`, `loadProjectState`, `loadProjectStateFrom`, `initializeProject`, plus the private helpers `resolveConfigPath`, `loadConfigFile`, `loadTsconfigPreferences`, `findTsconfigPath`, `parseTsconfigCompilerOptions`, `hasTrueFlag`, `stripJsonComments`, `stripTrailingCommas`, `withTrailingNewline`. These are all the filesystem / `node:*` touching functions and their private helpers.
- [ ] `core/config.ts` keeps the pure surface: `defineConfig`, `resolveProjectConfig`, re-export of `createDefaultInitPreview`, `assertConfigShape`, `resolveConfigPathValue`, `inferImportExtension`, `validValidators`, the `TsconfigPreferences` type, the `LoadedSqlfuProject` type. Drop the `node:fs`, `node:path`, `node:url` imports. Swap the two `path.dirname` / `path.resolve` calls in `resolveProjectConfig` for the in-house `dirname` / `resolvePath` from `core/paths.ts`.
- [ ] `core/config-load.ts` imports the pure half from `core/config.ts` where needed (e.g. it calls `resolveProjectConfig` after loading + `createDefaultInitPreview` for `initializeProject`).
- [ ] Update internal callers to import from `core/config-load.ts`:
  - `src/cli.ts` (imports `loadProjectState`)
  - `src/ui/server.ts` (imports `loadProjectStateFrom`, `resolveProjectConfig`) — `resolveProjectConfig` stays on `core/config.ts`, `loadProjectStateFrom` moves; split the import statement
  - `src/typegen/index.ts` (imports `loadProjectConfig`)
  - `src/core/node-host.ts` (imports `initializeProject`)
- [ ] Do **not** add `./core/config-load` to `publishConfig.exports`. It's internal. Deep imports allowed for off-piste use; no stability guarantee.

### Commit 3 — delete `packages/ui/src/generate-catalog.ts`

3 lines, no caller, already broken by the slim-down. If we ever want a standalone "generate types from disk" script it lives as a one-liner deep-importing `sqlfu/typegen`, not as a public-API slot.

- [ ] Delete the file

### Commit 4 — enforcement: `scripts/check-light-root.ts`

- [ ] Add `packages/sqlfu/scripts/check-light-root.ts`. Uses esbuild (already a dev dep) with `{entryPoints: ['dist/index.js'], bundle: true, platform: 'browser', metafile: true, write: false}`.
- [ ] `platform: 'browser'` makes esbuild treat `node:*` as unresolvable — the build fails with a clear "Could not resolve 'node:path'" error at the first offender. If any source file imports a bare specifier that isn't in the allowlist (empty), the build also fails. Prefer letting esbuild's own error output surface the offender + import chain, rather than re-implementing that logic by walking the metafile.
- [ ] Output includes the line: _"Static imports only. Dynamic `import()` calls bypass this check — avoid them on the light path."_
- [ ] If failure is due to a new bare specifier, the error message includes: _"To add X to the light path, update the allowlist in scripts/check-light-root.ts and explain why in the PR."_
- [ ] Exit code 1 on any violation.

### Commit 5 — wire the check into the test suite

- [ ] Add `packages/sqlfu/test/light-root-export.test.ts`.
- [ ] Reuse the `test/adapters/ensure-built.ts` memoized `build:runtime` pattern so the first call warms up `dist/` and subsequent tests don't re-build.
- [ ] Either (a) shell out to `tsx scripts/check-light-root.ts` and assert exit code 0, or (b) export the check as a function from the script and call it from the test. _(guess: b is cleaner — single source of truth, no subprocess overhead.)_
- [ ] Ensure the test runs as part of `pnpm test:node` (default vitest run). Do **not** wire it into `pnpm build` — vitest is the feedback loop the user actually exercises.

### Commit 6 — update the top-of-file comment in `src/index.ts`

- [ ] Replace the current "overdue a refactor" comment with a tight "this file must stay light — enforced by `test/light-root-export.test.ts`" comment that points at the test file and the rule.
- [ ] The test is the executable specification; the comment is a breadcrumb for the next contributor who reaches for an `export` here.

## What is explicitly NOT changing

- Adapter conventions (already compliant).
- The three-step build in `packages/sqlfu/package.json` (see `packages/sqlfu/CLAUDE.md` for why).
- Folder structure: `core/` stays flat. The static check is the machine-verifiable boundary; naming (`node-host.ts`, `config-load.ts`, `port-process.ts`, `tooling.ts`) carries the human signal.
- Export conditions on `.`. No `"browser"` / `"workerd"` condition until we actually have a second file to point at. An export condition pointing at the same file as `"default"` is information debt.
- No ESLint rule. The static check against the real artifact is the single source of truth; a second allowlist would drift.
- No new `sqlfu/config` subpath. The four I/O loaders simply vanish from the public API — no re-export, no backcompat shim (pre-pre-pre-alpha).
- `sqlfu/api` surface. Does not gain `generateQueryTypes`, does not gain the four I/O loaders. It stays `SqlfuContext`/`SqlfuHost`-shaped.

## Guesses and assumptions

These are judgement calls I made while standing in for the user in the grilling. Worth a spot-check during review:

- **`defineConfig` + `resolveProjectConfig` + `createDefaultInitPreview` stay together on root** as the coherent "config shape" module. If you'd rather evict `resolveProjectConfig` to `core/config-load.ts` (since its only callers — `ui/server.ts` and internal loaders — are heavy), that's a one-line swap in commit 2. Both are defensible; I chose the version that keeps the root surface more useful for Workers users who might define a config in code and need paths resolved against a runtime-provided root.
- **Check runs in vitest, not `pnpm build`.** Reasoning in the spec. If you'd prefer it as a build step so published artifacts physically cannot regress, move it to the `build` script — that's a one-line change in `package.json`. Trade-off: build gets slightly slower; vitest feedback loop stays fast either way.
- **Empty allowlist.** Zero bare-specifier imports from the light path. If any existing light-path file needs an npm dep I missed, the first CI run of commit 4 will expose it.
- **Check-function form (`b`), not subprocess.** Pure convenience — swap to subprocess if the metafile reuse is awkward in practice.

## Out of scope

- Features in CLI / migrator / diff engine / typegen / formatter / UI.
- Bundling / tree-shaking of the three-step build.
- Publishing / versioning.
- Performance benchmarks beyond "no node:* in light path".
