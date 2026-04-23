---
status: ready
size: large
---

# Public import surface redesign for `sqlfu`

## Status

Grilling complete — 12 turns, every decision branch locked. Supersedes closed PR #48. Full transcript lives in `tasks/import-surface.interview.md`. Implementation hasn't started; this file is the hand-off.

## Why

Pre-pre-pre-alpha. Zero users. Breaking changes are free. The current export map grew organically and conflates three axes that should be independent: **runtime target** (universal vs Node vs browser), **weight** (tiny vs vendor-blob-heavy), and **side effects on import**. Result: `sqlfu/client` is a strict subset of `sqlfu`; `sqlfu/browser` overlaps with root; `sqlfu/ui/browser` is both a condition and a subpath; `sqlfu/cli` runs the CLI on import; `core/` is a grab bag. None of this was wrong historically — it's just vestigial. This task redoes the public surface from first principles.

## The final entry-point list

| Entry | File | Tier | `node:*` | Bare specs | Contract summary |
|---|---|---|---|---|---|
| `sqlfu` | `src/index.ts` | **strict** | denied | denied | Near-zero-cost: adapters, client types, naming/util helpers, instrument + otel, `applyMigrations` + `migrationsFromBundle` + `Migration` + `MigrationBundle`, `defineConfig`, `prettifyStandardSchemaError`. |
| `sqlfu/analyze` | `src/analyze.ts` (renamed from `browser.ts`) | **strict** | denied | denied | Zero-`node:*` analysis: `analyzeVendoredTypesqlQueriesWithClient`, `inspectSqliteSchema`, `planSchemaDiff`, `SqliteInspectedDatabase`. Vendor blobs OK (~140KB typesql). |
| `sqlfu/api` | `src/api.ts` | heavy | allowed | allowed | "All the smart stuff": sqlfu commands as functions, schemadiff, typegen, formatter. Re-exports from `schemadiff/`, `typegen/`, `formatter.ts`. |
| `sqlfu/lint-plugin` | `src/lint-plugin.ts` | heavy | allowed | allowed | ESLint flat plugin + processor + `configs.recommended`. Still must not contribute unnecessary deps. |
| `sqlfu/outbox` | `src/outbox/index.ts` | **strict** | denied | denied | Transactional outbox / job queue. Explicitly zero-Node. |
| `sqlfu/ui` | `src/ui/server.ts` (renamed from `index.ts`) | heavy | allowed | allowed | Node-only UI server entry. `startSqlfuServer`, `ensureLocalhostCertificates`, server types. |
| `sqlfu/ui/browser` | `src/ui/browser.ts` | **strict** | denied | denied | Browser-only UI router + shared types. Explicit subpath, no conditional. |

### Dropped entries

- **`sqlfu/client`** — was a strict subset of root. Root is client-shaped under the new model. One-line update in `packages/ui/src/demo/browser-host.ts`; `packages/sqlfu/docs/adapters.md` needs `from 'sqlfu/client'` → `from 'sqlfu'` throughout.
- **`sqlfu/cli`** — side-effect-on-import (top-level `await cli.run(...)`). `package.json#bin` covers the binary; programmatic callers use `sqlfu/api`.
- **`"browser"` condition on `sqlfu/ui`** — replaced by the explicit `sqlfu/ui/browser` subpath. Each public name maps to exactly one physical file.

## The file-to-new-home audit

### Top-level `src/` after the flatten

| Current path | New path | Notes |
|---|---|---|
| `src/index.ts` | `src/index.ts` | Root export. Slimmed and widened per tier contract above. |
| `src/api.ts` | `src/api.ts` | Absorbs re-exports from schemadiff/typegen/formatter. |
| `src/lint-plugin.ts` | `src/lint-plugin.ts` | Unchanged. Still imports `./formatter.js` internally via relative path. |
| `src/cli.ts` | `src/cli.ts` | Bin script stays at top level. No longer listed in `exports`. |
| `src/instrument.ts` | `src/instrument.ts` | Merged with former `core/instrument.ts` content. Single `instrument.ts` containing user-facing + machinery. |
| `src/otel.ts` | `src/otel.ts` | Unchanged. |
| `src/formatter.ts` | `src/formatter.ts` | Unchanged. Re-exported via `api.ts`. |
| `src/browser.ts` | **`src/analyze.ts`** | Renamed. Only keeps the true analysis exports; other exports migrate to root. |
| `src/client.ts` | **deleted** | Folded into `src/index.ts`. |
| `src/cli-router.ts` | **`src/node/cli-router.ts`** | Moved. |

### `core/` flattens into `src/` (and `src/node/`)

| Current path | New path | Notes |
|---|---|---|
| `core/sql.ts` | `src/sql.ts` | |
| `core/types.ts` | `src/types.ts` | |
| `core/util.ts` | `src/util.ts` | |
| `core/naming.ts` | `src/naming.ts` | |
| `core/instrument.ts` | **merged into `src/instrument.ts`** | |
| `core/sqlite.ts` | **`src/sqlite-text.ts`** | Renamed for clarity — it's SQL text wrangling, not a sqlite client. |
| `core/paths.ts` | `src/paths.ts` | Add `resolvePath(base, relative)` helper while here. |
| `core/init-preview.ts` | `src/init-preview.ts` | |
| `core/sql-editor-diagnostic.ts` | `src/sql-editor-diagnostic.ts` | |
| `core/host.ts` | `src/host.ts` | Types only. |
| `core/config.ts` (pure) | `src/config.ts` | `defineConfig`, `resolveProjectConfig`, `assertConfigShape`. Uses `src/paths.ts` instead of `node:path`. |
| `core/config.ts` (I/O) | **`src/node/config.ts`** | `loadProjectConfig`, `loadProjectStateFrom`, `initializeProject`, private loaders. |
| `core/node-host.ts` | **`src/node/host.ts`** | |
| `core/port-process.ts` | **`src/node/port-process.ts`** | |
| `core/tooling.ts` | **deleted** | Zero callers anywhere in the monorepo. |

### Domain subfolders (unchanged in location, possibly renamed internally)

| Path | Changes |
|---|---|
| `src/adapters/*` | No changes. Already compliant. |
| `src/migrations/*` | No file moves. `applyMigrations` + `migrationsFromBundle` + `Migration` + `MigrationBundle` become public via root. Other exports (`baselineMigrationHistory`, `replaceMigrationHistory`, `readMigrationHistory`, name helpers) stay internal, reachable via `sqlfu/api`. |
| `src/schemadiff/**` | No file moves. Public via `sqlfu/api` re-exports + `sqlfu/analyze` for the browser-safe subset (`inspectSqliteSchema`, `planSchemaDiff`). |
| `src/typegen/**` | No file moves. Public via `sqlfu/api`. `typegen/index.ts` keeps its `node:*` imports — it's a Node-only module in a domain bucket, which is allowed (see rule below). |
| `src/outbox/**` | No changes. |
| `src/ui/index.ts` | **renamed to `src/ui/server.ts`** for symmetry with `ui/browser.ts`. |
| `src/ui/browser.ts` / `router.ts` / `shared.ts` / `certs.ts` / `resolve-sqlfu-ui.ts` | No file moves. |
| `src/vendor/**` | No changes. |

### The `src/node/` rule

`src/node/` is for **Node-only library code that does not have a stronger domain home**. Files that use `node:*` but already live in a domain subfolder — `ui/server.ts`, `ui/certs.ts`, `typegen/index.ts`, `lint-plugin.ts` — stay where they are. Moving them into `src/node/` would fragment the domains for no readability gain.

Contents of `src/node/` after the refactor: `host.ts`, `port-process.ts`, `config.ts`, `cli-router.ts`. That's it.

`src/cli.ts` is the single exception: it lives top-level because it's the bin script entry, not a library module.

### External workspace code that has to change

- `packages/ui/src/demo/browser-host.ts` — `from 'sqlfu/client'` → `from 'sqlfu'`
- `packages/ui/src/{shared.ts, client.tsx, demo/index.ts}` — no change; they already use the explicit `sqlfu/ui/browser` subpath
- `packages/ui/sqlfu.config.ts` — no change; `defineConfig` stays on root
- `packages/ui/src/generate-catalog.ts` — **delete**. 3-line dead file, already broken.
- `packages/sqlfu/docs/adapters.md` — `from 'sqlfu/client'` → `from 'sqlfu'` throughout (affects the adapters docs page)
- `packages/sqlfu/README.md` — update any `sqlfu/client` example (verify none exist)

## Enforcement

Build-time static check via esbuild metafile. One script, one test, per-entry iteration. Strict tier only:

- Entries checked: `sqlfu`, `sqlfu/analyze`, `sqlfu/outbox`, `sqlfu/ui/browser`
- For each: bundle the entry with `platform: 'browser'`, `bundle: true`, empty allowlist. Any `node:*` or bare specifier in the input graph fails the build with esbuild's native error (which already includes the import chain).
- Entries **not** checked: `sqlfu/api`, `sqlfu/lint-plugin`, `sqlfu/ui`. These deliberately accept Node + heavy deps.

**Where it runs**: vitest suite (`test/import-surface.test.ts`), reusing the `test/adapters/ensure-built.ts` memoized `build:runtime` pattern. Not wired into `pnpm build` — vitest is the feedback loop the user actually uses.

**Script location**: `packages/sqlfu/scripts/check-strict-imports.ts`. Exports a function; the vitest test calls it directly. No subprocess.

**Script output on failure**: esbuild's native message (offender + chain) + remediation line: `"Strict-tier entries cannot import node:* or bare specifiers. If this is intentional, the entry's tier needs to change — discuss in a PR before loosening."`

**Explicit caveat in output**: `"Static imports only. Dynamic import() calls bypass this check — avoid them on strict-tier paths."`

## Plan

Small reversible commits. Order matters because each commit leaves the tree buildable and testable.

### Commit 1 — delete `core/tooling.ts` and `packages/ui/src/generate-catalog.ts`

Pure deletions. No callers. Zero risk.

- [ ] Delete `packages/sqlfu/src/core/tooling.ts`
- [ ] Delete `packages/ui/src/generate-catalog.ts`

### Commit 2 — add `resolvePath` to `core/paths.ts`

Prep for commit 3. Tiny.

- [ ] Add `resolvePath(base: string, value: string): string` to `core/paths.ts`

### Commit 3 — split `core/config.ts` into pure + I/O halves

Still in `core/`; later commit flattens. Internal consumers update.

- [ ] Create `packages/sqlfu/src/core/config-load.ts` with filesystem loaders (later moves to `src/node/config.ts`)
- [ ] `core/config.ts` keeps `defineConfig`, `resolveProjectConfig`, `assertConfigShape`, `createDefaultInitPreview` re-export. Drop the `node:*` imports; use `src/core/paths.ts` helpers.
- [ ] Update internal callers: `src/cli.ts`, `src/ui/server.ts`, `src/typegen/index.ts`, `src/core/node-host.ts` → import I/O functions from `config-load.ts`

### Commit 4 — flatten `core/` into `src/`, move Node-only files to `src/node/`

Large mechanical commit. Best done as one atomic move so the tree stays consistent.

- [ ] Move every file in the "flatten" table. Update every `../core/…` and `./core/…` import across the codebase.
- [ ] Merge `core/instrument.ts` into `src/instrument.ts`.
- [ ] Rename `core/sqlite.ts` → `src/sqlite-text.ts`. Update all importers (adapters, api, browser, etc.).
- [ ] Create `src/node/` and move `node-host.ts` → `src/node/host.ts`, `port-process.ts` → `src/node/port-process.ts`, `config-load.ts` → `src/node/config.ts`, `src/cli-router.ts` → `src/node/cli-router.ts`.

### Commit 5 — rebuild the root export

- [ ] `src/index.ts` becomes: `client.ts` content (adapters + types + naming + util + instrument + sqlite-text helpers + SQL tag helpers) + `defineConfig` + `prettifyStandardSchemaError` + migration-applier subset (`applyMigrations`, `migrationsFromBundle`, `Migration`, `MigrationBundle`).
- [ ] Delete `src/client.ts`. Everything previously there lives in `index.ts` now.
- [ ] Update `packages/ui/src/demo/browser-host.ts` import from `sqlfu/client` → `sqlfu`.
- [ ] Update `packages/sqlfu/docs/adapters.md` imports.

### Commit 6 — rename `browser.ts` → `analyze.ts`, trim exports

- [ ] Rename file. Update `packages/ui/*` consumers to `sqlfu/analyze`.
- [ ] Prune the exports list to only the true analysis surface: `analyzeVendoredTypesqlQueriesWithClient`, `inspectSqliteSchema`, `planSchemaDiff`, `SqliteInspectedDatabase`, related types. Everything else is already on root.

### Commit 7 — rename `ui/index.ts` → `ui/server.ts`, drop conditional

- [ ] Rename file. Update `package.json` exports map — `./ui` → `./src/ui/server.ts` (plain, no condition). `./ui/browser` stays.
- [ ] Update any internal importers.

### Commit 8 — expand `sqlfu/api`

- [ ] `src/api.ts` re-exports from `schemadiff/index.ts`, `schemadiff/sqlite/index.ts`, `typegen/index.ts`, `formatter.ts`. Carefully — only public-facing symbols; don't re-export internal helpers.
- [ ] Optionally re-export `createSqlfuCli` from `sqlfu/api` if we want programmatic CLI spawning (defer if ambiguous — no user asking).

### Commit 9 — remove `sqlfu/client` and `sqlfu/cli` from `exports`

- [ ] Update `packages/sqlfu/package.json` exports map: delete `"./client"` and `"./cli"` entries. Update `publishConfig.exports` identically.
- [ ] Verify no internal `from 'sqlfu/client'` / `from 'sqlfu/cli'` remain.

### Commit 10 — enforcement: `scripts/check-strict-imports.ts` + vitest suite

- [ ] Add `packages/sqlfu/scripts/check-strict-imports.ts`. Exports a `checkStrictImports()` function that bundles each strict-tier entry with `platform: 'browser'`, `bundle: true`. Throws on first violation with esbuild's native error output.
- [ ] Add `packages/sqlfu/test/import-surface.test.ts`. Reuses `test/adapters/ensure-built.ts` for the memoized build. Calls `checkStrictImports()` — expects no throw.
- [ ] Verify the test fails if you add a `node:path` import to `src/index.ts`, then undo.

### Commit 11 — update `packages/sqlfu/src/index.ts` top comment

Replace the current "overdue a refactor" comment with a tight pointer at `test/import-surface.test.ts` as the executable spec.

## What is explicitly NOT changing

- Adapter conventions (already compliant).
- The three-step build in `packages/sqlfu/package.json` (see `packages/sqlfu/CLAUDE.md`).
- Folder structure of domain subfolders (`adapters/`, `migrations/`, `schemadiff/`, `typegen/`, `outbox/`, `ui/`, `vendor/`) — stays.
- Package name, versioning, changelog.
- `SqlfuHost` / `SqlfuContext` design — internal abstractions, not an entry-point question.
- No `publint` / `@arethetypeswrong/cli` wiring in this task (defer).
- No bundle-size check in this task (defer; add if `sqlfu/api` grows problematic).

## Guesses and assumptions

Taste calls I made while standing in for the user during grilling. Worth a spot-check during review:

- **`sqlfu/api` absorbs schemadiff + typegen + formatter** (rather than keeping them internal or splitting into `sqlfu/schemadiff`, `sqlfu/typegen`, `sqlfu/formatter`). The user's prompt said "all the smart stuff"; one subpath is simpler. Tree-shaking means unused imports don't cost. If a real user later says "I want just the formatter without pulling typegen", add `sqlfu/formatter` then. [guess]
- **`sqlfu/ui` renames to `ui/server.ts`** (internal file rename, not a subpath name change). Purely for symmetry with `ui/browser.ts`. If you'd rather leave `ui/index.ts` named that way, it's a one-line task-file edit. [guess]
- **`src/instrument.ts` absorbs `core/instrument.ts`** rather than keeping them as two files. The split between "user-facing API" and "machinery" is artificial for a ~60-line module. If the merge reads badly, undo to `src/instrument.ts` + `src/instrument-hooks.ts`. [guess]
- **`sqlite-text.ts` as the rename** for `core/sqlite.ts`. Alternatives: `sql-text.ts`, `sql-utils.ts`. Pick your preference; the key is it's not called `sqlite.ts` (ambiguous — there's also `adapters/node-sqlite.ts`, `adapters/better-sqlite3.ts`). [guess]
- **Enforcement is strict-tier only, no documented-tier snapshots.** If you later want visibility into which deps each heavy-tier entry pulls, add a snapshot mechanism as a follow-up. Not load-bearing now. [guess]
- **`applyMigrations` transitively pulls only light deps.** I grepped `migrations/**/*.ts` for `node:*` and found none; it uses `sha256` from `vendor/` and the generated query wrappers. The enforcement script will confirm this. If the check fails on commit 5, the fix is in `migrations/*` and is tractable. [guess — high confidence from the grep but not runtime-verified]
- **`packages/sqlfu/docs/adapters.md`** is the only docs file that needs updating for the `sqlfu/client` → `sqlfu` change. I didn't audit every docs/*.md file. If others reference `sqlfu/client`, they need updating too. [guess]
- **`createSqlfuCli` re-export from `sqlfu/api`** is listed as optional. It's arguably useful for someone building an in-process CLI; it's also adding surface area no user has asked for. Lean toward not adding until asked. [guess]

## Out of scope

- Features in CLI / migrator / diff engine / typegen / formatter / UI.
- Bundling / tree-shaking of the three-step build.
- Publishing / versioning.
- The design of `SqlfuHost` / `SqlfuContext`.
- `publint`, `@arethetypeswrong/cli`, bundle-size enforcement.
