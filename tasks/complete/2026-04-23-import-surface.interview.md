# Interview log: sqlfu import-surface redesign

Topic: what should the public import surface of `sqlfu` look like, from first principles?

Worktree: `../worktrees/sqlfu/import-surface` (branch `import-surface`). Supersedes closed PR #48.

Session: `cca3e0d6-6f75-4aa1-8cd7-7acc11cef430`.


---

## Turn 1 — Question from sub-claude

Files read. Here's question 1.

---

**Branch A-1: `sqlfu/client` — keep or eliminate?**

Here's what I see: `src/index.ts` is currently three lines — `export * from './client.js'`, `export * from './core/config.js'`, and `export {prettifyStandardSchemaError}`. Once we evict the I/O half of `core/config.ts` from the root (already decided), the root *is* `client.ts` plus those two extras. There's nothing left that `sqlfu/client` uniquely provides — it would be a strict subset of the root.

My proposed answer: **eliminate `sqlfu/client`**. It's a historical staging artifact from before the root was clearly defined as the light path. Any consumer that imports from `sqlfu/client` today can move to `sqlfu` with no behavioral change. No subpath should exist just to re-export a subset of another subpath.

Does that match, or do you see a case where someone specifically needs `sqlfu/client` as a distinct named import surface?


## Turn 1 — Answer (as user)

Eliminate `sqlfu/client`. Yes.

Grepped: only real consumer is `packages/ui/src/demo/browser-host.ts` (one-line change) and `packages/sqlfu/docs/adapters.md` which imports adapter functions from `sqlfu/client`. Docs get updated to `from 'sqlfu'` as part of the refactor — that's the correct canonical import path under the new model anyway, since the root IS the adapter + types + helpers surface.

No namespacing argument holds up either — the root IS client-shaped by design under the new model; the pair is redundant, not complementary.


---

## Turn 2 — Question from sub-claude

Decided: eliminate `sqlfu/client`. Updating the tree.

---

**Branch A-2: `sqlfu/browser` — keep as a real public subpath, or make it internal?**

Here's what I see: `src/browser.ts` exports things that fall into two distinct groups:
1. Things that *already belong on the light root* — `queryNickname`, all `core/types` types, `toSqlEditorDiagnostic`, pure SQLite text helpers
2. Things that **can't go on the root** because they pull a vendor blob — `analyzeVendoredTypesqlQueriesWithClient` (typesql bundle), `inspectSqliteSchema`, `planSchemaDiff`

Under the new model, group 1 moves to root. The remaining reason `sqlfu/browser` exists is group 2 — heavy in-browser analysis. The question is whether that's a real *external* user surface or just `packages/ui`'s private dependency.

My proposed answer: **keep `sqlfu/browser`**, but reframe its contract cleanly — it's not "the root for browser environments" (root already works in any non-Node runtime), it's "the zero-`node:*`, vendor-blob-inclusive analysis surface for apps doing in-browser schema inspection." External users building SQL editors, playgrounds, or embedded studio UIs would import from here. The `packages/ui` use is the canonical example, not the only customer.

The name "browser" is slightly misleading (root is also browser-safe), but the alternatives — `sqlfu/analysis`, `sqlfu/inspect`, `sqlfu/schema` — are narrower than the actual exports. "browser" signals the runtime contract (no Node), which is the load-bearing property.

Does that match, or would you rather make it explicitly internal (e.g. not listed in public `exports` docs, even if present in `package.json`)?


## Turn 2 — Answer (as user)

Keep it as a real public subpath. But **rename**. The name "browser" is misleading: after the light-root absorbs `queryNickname` / types / `toSqlEditorDiagnostic` / pure SQLite text helpers, what is left in that entry is purely analysis — `analyzeVendoredTypesqlQueriesWithClient`, `inspectSqliteSchema`, `planSchemaDiff`, the inspected-database type. All SQL/schema analysis.

And the root is also browser-safe under the new model. Two subpaths both meaning "browser-safe" is two sources of truth for the same runtime contract. Confusing.

Proposed rename: **`sqlfu/analyze`**. Contract: zero `node:*`, **vendor bundles OK** (typesql ~140KB, schemadiff code). Runs anywhere non-Node. External consumer story: "building a SQL editor, studio, playground, or doing schema inspection in a worker or browser — import from here."

Alternatives rejected: `sqlfu/studio` (clashes with `sqlfu/ui`, which IS a studio), `sqlfu/inspect` (too narrow — excludes query analysis), `sqlfu/schema` (confusing vs schemadiff/migrations product concepts).

If you want to keep "browser" because it is what people google for, that is a defensible call; flag the tradeoff.


---

## Turn 3 — Question from sub-claude

Noted. `sqlfu/analyze` it is — zero `node:*`, vendor bundles OK, anywhere non-Node. The "browser" SEO tradeoff is real but the contract confusion outweighs it.

---

**Branch A-3: `sqlfu/ui/browser` — drop the redundant alias?**

Here's what I see in `package.json`:

```json
"./ui": {
  "browser": "./src/ui/browser.ts",
  "default": "./src/ui/index.ts"
},
"./ui/browser": "./src/ui/browser.ts"
```

The `"browser"` condition on `sqlfu/ui` already routes to `ui/browser.ts` in any bundler that respects export conditions (Vite, esbuild, webpack). The explicit `sqlfu/ui/browser` subpath is a second public name pointing at the identical file — no additional consumer story, no different contract, just a second handle on the same module.

My proposed answer: **drop `sqlfu/ui/browser`**. Keep `sqlfu/ui` with the browser/default condition. Any consumer that currently writes `import { ... } from 'sqlfu/ui/browser'` can write `import { ... } from 'sqlfu/ui'` and get the same file routed by their bundler. The only consumer in the codebase is `packages/ui` itself, which is internal — one-line change.

Does that match?


## Turn 3 — Answer (as user)

Push back on the recommendation. Drop the **conditional**, keep the two explicit subpaths.

Grepped: `packages/ui/src/{shared.ts, client.tsx, demo/index.ts}` all explicitly `import ... from 'sqlfu/ui/browser'` rather than `sqlfu/ui`. That is not legacy — it is code being clear about which runtime it targets. `packages/ui/CLAUDE.md` documents both subpaths as intentional. The files that want the server build say `sqlfu/ui`; the files that want the browser build say `sqlfu/ui/browser`. No bundler magic involved.

Reasons to drop the condition and keep two explicit subpaths:

1. Conditional exports are magic. Reading `import { uiRouter } from 'sqlfu/ui'` in a React component, you cannot tell from the line itself which implementation you got. Explicit paths are self-documenting.
2. Condition support is inconsistent across tools — bundlers mostly honor it, but test runners, tsx runs, ts-node, editors resolving goto-definition, and publint can all get confused when a single path has two targets.
3. It is consistent with the same ethos as the earlier "no `.` browser condition until we have a real second file" call: each public name maps to exactly one physical file.
4. Zero users. We can pick the strict, explicit version now and never regret it.

So: `sqlfu/ui` → `src/ui/server.ts` only. `sqlfu/ui/browser` → `src/ui/browser.ts` only. Drop the `"browser"` condition on `./ui`.


---

## Turn 4 — Question from sub-claude

Accepted. Dropping the condition, keeping two explicit subpaths. `sqlfu/ui` → server only (`src/ui/index.ts`, worth renaming to `src/ui/server.ts` for symmetry). `sqlfu/ui/browser` → browser only, stays explicit.

---

**Branch A-4: `sqlfu/api` — rename?**

Here's what I see in `src/api.ts`: it exports `runSqlfuCommand`, `getCheckAnalysis`, `applyMigrateSql`, `applyDraftSql`, `applyGotoSql`, `applyBaselineSql`, `applySyncSql`, `analyzeDatabase`, `materializeMigrationsSchemaForContext`, plus their result types (`SqlfuContext`, `CheckMismatch`, `CheckRecommendation`, `CheckAnalysis`, `SqlfuCommandConfirm`). These are the sqlfu CLI commands exposed as callable functions, plus the types their results carry.

"api" is technically accurate but tells you nothing — everything is an API. The content is specifically: **the CLI commands as programmatic functions, behind a `SqlfuHost` abstraction**.

My proposed answer: **rename to `sqlfu/commands`**. It's self-documenting — a developer scanning the package's export map reads "commands" and immediately knows this is the programmatic entry to `check`, `migrate`, `draft`, `sync`, `baseline`, `goto`. It matches the mental model of a CI script author or IDE integration author who wants to call sqlfu operations without shelling out.

Alternatives I considered and rejected:
- `sqlfu/tools` / `sqlfu/tooling` — correct but generic; "commands" is more specific
- `sqlfu/server` — clashes with `sqlfu/ui` server-side thinking
- `sqlfu/dev` — ambiguous (dev-mode? development-only?)
- `sqlfu/node` — misleading; the module itself has no `node:*` (it's host-abstracted), even if in practice you'd pass a NodeHost

Does `sqlfu/commands` match, or do you prefer a different name?


## Turn 4 — Answer (as user)

Push back. Keep `sqlfu/api`.

`commands` is a subset of what lives there — `api.ts` also has pure analysis (`analyzeDatabase`, `getCheckAnalysis`, `getSchemaAuthorities`, `getMigrationResultantSchema`), building blocks (`materializeDefinitionsSchemaForContext`, `compareSchemasForContext`, `readMigrationsFromContext`), and types. Not all commands, not command-only.

Ran the alternatives: `tools` / `tooling` is more generic than `api` so no improvement. `dev` is ambiguous. `node` is wrong since the module has zero `node:*` imports (host-abstracted). `api` is generic but accurate — it IS the programmatic API to sqlfu's operations. User prompt said "could bikeshed the api part" which I read as "fine with it if we can't find something clearly better." We can't. Ship `sqlfu/api`.

Related decision that belongs to Branch E, flagging now so we do not forget: the user's description of `sqlfu/api` was "all the smart stuff - diff engine, smart migrator, type generator, formatter, (mini-parser)" — that is broader than what `api.ts` currently re-exports (schemadiff is only reachable as a transitive internal, typegen is not re-exported at all, formatter is not re-exported). Branch E needs to decide whether `sqlfu/api` grows to actually re-export those, or whether each gets its own named subpath (`sqlfu/schemadiff`, `sqlfu/typegen`, `sqlfu/formatter`). Do not litigate now — just do not forget.


---

## Turn 5 — Question from sub-claude

Noted — `sqlfu/api` stays. And the Branch E flag is logged: does `sqlfu/api` grow to re-export schemadiff/typegen/formatter directly, or do those get their own named subpaths? Not now.

---

**Branch A-5: `sqlfu/cli` — remove from `exports`?**

Here's what I see: `src/cli.ts` has a top-level `await cli.run(...)` at the bottom of the file (lines 67–72). That means `import { createSqlfuCli } from 'sqlfu/cli'` **runs the CLI immediately** — not on calling the function, but on the import itself. This is the side-effect-on-import problem the dossier flagged. The binary entry is already covered by `package.json#bin: { "sqlfu": "./dist/cli.js" }`.

My proposed answer: **remove `sqlfu/cli` from `exports` entirely.** Anyone who wants to invoke sqlfu programmatically uses `sqlfu/api` (`runSqlfuCommand` etc.). Anyone who wants the CLI binary gets it via `npx sqlfu` / the bin entry. There is no legitimate use case for `import { ... } from 'sqlfu/cli'` that isn't better served by one of those two. The side-effect-on-import is disqualifying on its own.

Does that match?


## Turn 5 — Answer (as user)

Yes. Drop `sqlfu/cli` from exports. Side-effect-on-import is disqualifying, and there is no programmatic use case that `sqlfu/api` doesn't already serve. `package.json#bin` covers the binary use.

Implementation detail while we're here: the `createSqlfuCli` factory at the top of `cli.ts` should probably either (a) move its `loadProjectState` + `createNodeHost` wiring into a thin helper, or (b) stay and be re-exported from `sqlfu/api` for anyone who wants to spawn an in-process CLI. Defer that to Phase 2 — the entry-point removal decision is what mattered.


---

## Turn 6 — Question from sub-claude

Decided: `sqlfu/cli` removed from exports. `createSqlfuCli` re-export question deferred to Phase 2.

---

**Branch A-6 + A-8 combined: any new subpaths to add?**

The dossier proposed two candidates and recommended against both. Let me put them together since they're each quick:

**`sqlfu/config`** — would export `loadProjectStateFrom`, `initializeProject`, `loadConfigFile`. Today these are internal, called by the CLI. The only person who'd want them is someone building a custom CLI or editor integration — but `sqlfu/api`'s functions work against a `SqlfuContext` that the caller constructs, so those callers already have a path. Zero users means we can add this later when a real consumer asks.

**A migrations-specific subpath** (`sqlfu/migrations`) — for the "just run the SQL migrations at boot in a CF Worker" case. The dossier floated `migrationsFromBundle` + `applyMigrations` on the root for this. I verified: `migrations/index.ts` has zero `node:*` imports, only a vendored SHA256. Both functions are strong candidates for the light root.

My proposed answers:
- **`sqlfu/config`**: don't add — not yet. Defer until a real consumer exists.
- **`sqlfu/migrations` subpath**: also don't add — instead, put `migrationsFromBundle` + `applyMigrations` + `Migration` type **on the root**. That's the "just-run-the-sql-bro migrator" the user explicitly mentioned for the root, and the migration module is already light.

Does that match on both? Specifically: are you comfortable with migration helpers on root, or do you want them behind a subpath to keep root's surface area minimal?


## Turn 6 — Answer (as user)

Both answers: yes.

`sqlfu/config`: skip. Defer until a real consumer exists.

Migration helpers on root: yes — but be specific about the subset. The "just-run-the-sql-bro migrator" that lives on root is:
- `applyMigrations(client, {migrations})`
- `migrationsFromBundle(bundle)`
- `Migration` type
- `MigrationBundle` type

That is enough to run migrations at CF Worker / Bun boot from a bundle. The other helpers (`baselineMigrationHistory`, `replaceMigrationHistory`, `readMigrationHistory`, checksum wrappers, `migrationName`, `migrationNickname`) stay internal to `sqlfu/api` — they are about reconciling history/drift, which is devtime tooling the worker never does.

Confirm the import chain when implementing: `applyMigrations` transitively uses `sha256` vendor, `dual-dispatch`, generated query wrappers (`deleteMigrationHistoryWrapper`, etc.). All zero-`node:*`, small. Good for root.


---

## Turn 7 — Question from sub-claude

Decided: migration helpers (`applyMigrations`, `migrationsFromBundle`, `Migration`, `MigrationBundle`) on root. History-reconciliation helpers stay internal to `sqlfu/api`.

The flagged Branch E question is now the most load-bearing unresolved decision. Addressing it before the file map.

---

**Branch E-flag: does `sqlfu/api` grow to directly re-export schemadiff / typegen / formatter — or do any of those get their own named subpaths?**

Here's what I see: `api.ts` currently re-exports `analyzeDatabase`, `getCheckAnalysis`, `runSqlfuCommand`, etc. The schemadiff functions (`diffSchemaSql`, `planSchemaDiff`) are reachable only transitively. `typegen` is not re-exported at all. `formatter` is not re-exported — it's imported internally by `lint-plugin` and probably by `schemadiff`. The user's original description of `sqlfu/api` was "all the smart stuff — diff engine, smart migrator, type generator, formatter, (mini-parser)."

The tension: formatter alone is a 1MB vendor bundle. Someone writing a CI migration-check script doesn't want to pay for it. Separate subpaths enable independent import. But we're pre-pre-pre-alpha, and separate subpaths proliferate surface area.

My proposed answer: **`sqlfu/api` absorbs all of them** — schemadiff exports, typegen exports, formatter. One "heavy tools" surface. No `sqlfu/schemadiff`, `sqlfu/typegen`, `sqlfu/formatter` subpaths. Rationale: lint-plugin already has a direct internal path to formatter so that use case is covered; anyone using typegen or schemadiff outside the CLI is the same person who wants the full `sqlfu/api` surface anyway; pre-alpha means we add subpaths when a real splitting need emerges, not preemptively.

Does that match, or do you want formatter (specifically, given the 1MB weight) as its own subpath?


## Turn 7 — Answer (as user)

Agreed. Absorb into `sqlfu/api`. No separate `sqlfu/schemadiff` / `sqlfu/typegen` / `sqlfu/formatter` subpaths.

Audit of the 1MB concern:
- Tree-shaking: modern bundlers (esbuild, rollup) can shake `formatSql` out if the consumer does not reference it. Caveat: the vendored `sql-formatter` file probably needs a sideEffects: false hint to be sure. Worth verifying during implementation but not worth a separate subpath on spec.
- Non-bundled Node scripts: 1MB cold-load is fine on a machine running CI.
- Workers / browsers: do NOT import `sqlfu/api` at all. They use root.

Positive side effects of absorbing:
- `formatSql` becomes a public named export, which someone writing a "format all SQL files in this repo" CI script will want. Today they have to go through `sqlfu/lint-plugin`'s `formatSqlFileContents` re-export, which is sideways.
- The user's mental model from the prompt — "`sqlfu/api` is all the smart stuff — diff engine, smart migrator, type generator, formatter, mini-parser" — now matches reality.

Implementation note (defer to Phase 2): `sqlfu/lint-plugin` should keep importing `./formatter.js` internally via relative path rather than `sqlfu/api`. Same code, simpler build graph.


---

## Turn 8 — Question from sub-claude

Decided: `sqlfu/api` absorbs schemadiff, typegen, formatter. Lint-plugin keeps its direct internal path.

Branch A is now complete. Moving to the most load-bearing structural question.

---

**Branch C: flatten `src/core/` — yes or no?**

Here's what I see: `src/core/` currently holds 12 files. After the decisions above:
- 9 of them are pure light-path modules (`sql.ts`, `types.ts`, `util.ts`, `naming.ts`, `instrument.ts`, `sqlite.ts`, `paths.ts`, `init-preview.ts`, `sql-editor-diagnostic.ts`, `host.ts`)
- 2 are Node-specific / heavy (`config.ts` I/O half, `node-host.ts`)
- 1 is dead (`tooling.ts` — zero callers in src/)

The "core" label does no work. Every file in it is just a sqlfu library module. Meanwhile `adapters/`, `migrations/`, `outbox/`, `schemadiff/`, `typegen/`, `ui/` all sit at `src/` level as peer concerns — and they import from `core/` as if it were a privileged inner layer, when it isn't.

My proposed answer: **flatten `core/` into `src/`**. `src/sql.ts`, `src/types.ts`, `src/naming.ts`, etc. Delete `tooling.ts` (unused). Move the two Node-specific files into a new `src/node/` folder (covered in Branch D). Split `core/config.ts` into `src/config.ts` (pure: `defineConfig`, `assertConfigShape`) and `src/node/config.ts` (I/O: `loadProjectConfig`, `loadProjectStateFrom`, `initializeProject`).

The flat structure makes the entry-point mapping legible at a glance: anything directly under `src/` is a candidate for a light-path entry; anything under `src/node/` requires Node; subfolders like `migrations/`, `schemadiff/` are self-contained concerns.

Does that match?


## Turn 8 — Answer (as user)

Yes, flatten. Agreed.

Verified `tooling.ts` is truly dead — greps the whole monorepo and only hit is the file itself. Delete.

Two collisions / renames to flag while flattening, implementation-detail for Phase 2 but worth calling out now:

1. **`src/instrument.ts` vs `core/instrument.ts`**. The top-level one is the user-facing `instrument(client, ...hooks)` function. The core one is the underlying machinery (`instrumentClient`, `composeHooks`, hook types, `createErrorReporterHook`). Two options when flattening: (a) merge into a single `src/instrument.ts`, or (b) rename `core/instrument.ts` → `src/instrument-hooks.ts` or similar. Prefer (a) if it reads cleanly — the split is artificial.

2. **`core/sqlite.ts`** is not a sqlite client — it is SQL text wrangling (`splitSqlStatements`, `surroundWithBeginCommitRollback*`, `rawSqlWithSqlSplitting*`, `extractSchema` helpers). Post-flatten rename: `src/sqlite-text.ts` or `src/sql-text.ts`. Clearer intent.

Everything else flattens with the same filename: `core/sql.ts` → `src/sql.ts`, `core/types.ts` → `src/types.ts`, `core/util.ts` → `src/util.ts`, etc.


---

## Turn 9 — Question from sub-claude

Noted: `instrument.ts` merge preferred, `core/sqlite.ts` → `src/sqlite-text.ts` (or `sql-text.ts`). All other core files flatten with same filename.

---

**Branch D: Node-specific code → `src/node/` folder**

Here's what I see after the flatten + the decisions above. The files that are Node-runtime-only and can't live cleanly in top-level `src/`:

| Current path | Proposed `src/node/` path | Why it's Node-only |
|---|---|---|
| `core/node-host.ts` | `src/node/host.ts` | Implements `SqlfuHost` with real `fs`/`spawn` |
| `core/port-process.ts` | `src/node/port-process.ts` | `node:child_process` lsof/kill wrappers |
| `core/config.ts` (I/O half) | `src/node/config.ts` | `node:fs`, `node:path`, `node:url` loaders |
| `cli-router.ts` | `src/node/cli-router.ts` | Transitively Node via host + spawn |

The one bikeshed: **`src/cli.ts`** — it's the bin entry. Arguments for keeping it at `src/cli.ts`: it's an entry point, not a library module, and bin entries conventionally sit at the top level. Arguments for moving to `src/node/cli.ts`: it has `node:*` imports and fits the "everything Node-specific goes in `src/node/`" invariant.

My proposed answer: **keep `src/cli.ts` at the top level** — it's the bin entry, not a library module. The `src/node/` invariant is "Node-only library code". `cli.ts` is a script entry, not something another module imports. The four files in the table above move to `src/node/`.

Does that match?


## Turn 9 — Answer (as user)

Matches. Yes.

Small clarification to lock down so the rule is unambiguous for future contributors: `src/node/` is only for **Node-only library code that does not have a stronger domain home**. Files that use `node:*` but already live in a domain subfolder (`ui/server.ts`, `ui/certs.ts`, `typegen/index.ts`) stay where they are — moving them into `src/node/` would fragment the `ui/` and `typegen/` domains for no readability gain.

So `src/node/` contents are exactly:
- `src/node/host.ts` (was `core/node-host.ts`)
- `src/node/port-process.ts`
- `src/node/config.ts` (I/O half of `core/config.ts`)
- `src/node/cli-router.ts` (was top-level `cli-router.ts`)

And `src/cli.ts` stays top-level as the bin script entry. Single exception, justified by "scripts go at top level".


---

## Turn 10 — Question from sub-claude

`ui/shared.ts` exports UI wire types — `StudioSchemaResponse`, `SchemaCheckCard`, `SchemaCheckResponse`, `SchemaAuthorityMigration`, etc. These are the request/response shapes for the studio's API endpoints. Both sides need them: the server to produce them, the browser client to consume them.

My proposed answer: **re-export from both `sqlfu/ui` and `sqlfu/ui/browser`**. These are the shared protocol types — the browser client can't function without importing them, and the server exports them as part of its contract. They're public by necessity. No third subpath needed; both existing entry points re-export from `ui/shared.ts` and that's the right shape.

Does that match?


## Turn 10 — Answer (as user)

Yes. Already shaped that way today (both `ui/index.ts` and `ui/browser.ts` re-export from `ui/shared.ts`). Nothing to change.


---

## Turn 11 — Question from sub-claude

Branch E spot-checks complete. Moving to the final branch.

---

**Branch F: enforcement — per-entry allowlists or a single root-only check?**

Here's what I see: the prior grill locked in the mechanism — build the artifact with esbuild, inspect the metafile, run the check inside the vitest suite. What's unresolved is the *scope*: does enforcement cover every entry point with its own allowlist, or just the root (the one contract we're most worried about)?

The case for per-entry: the root check alone catches violations at the light boundary, but it doesn't prevent someone from accidentally pulling `node:child_process` into `sqlfu/analyze` or bare-specifier-importing something heavy into `sqlfu/outbox`. Per-entry allowlists make those violations impossible to miss, not just unlikely.

The case for root-only: simpler to maintain; the "no `node:*` in root" invariant is the only one that would actually break a Cloudflare Worker at runtime. Everything else is a bundle-size or correctness concern, not a hard runtime failure.

My proposed answer: **per-entry allowlists, but tiered**. Two tiers:

- **Strict tier** (root, `sqlfu/analyze`, `sqlfu/outbox`, `sqlfu/ui/browser`): `node:*` denied, bare specifiers denied. Build fails if either appears.
- **Documented tier** (`sqlfu/api`, `sqlfu/lint-plugin`, `sqlfu/ui`): no automated denial — but the enforcement script prints the `node:*` modules and bare specifiers actually used, so drift is visible in CI without blocking. The allowlist lives in the test itself as a snapshot, not a hard deny.

Rationale: the strict tier is where a runtime violation silently breaks production. The documented tier is where you *expect* Node and heavy deps — the risk is surprises, not presence, so a snapshot-diff is the right tool.

Does that match, or do you want full hard-deny allowlists across all entries?


## Turn 11 — Answer (as user)

Push back. Skip the documented tier. Strict only.

The failure mode we care about is: someone accidentally pulls `node:*` into an entry that must run in a Worker/browser. That is exactly the strict tier. Everything else is aspirational observability — useful eventually, not load-bearing now, and snapshots have update-fatigue which erodes the signal.

So: strict tier gets a hard-deny metafile check. No snapshots for the heavy tier. If bundle size or surprise deps become a real problem in `sqlfu/api` later, add a bundle-size check or a `publint` step then — do not preemptively build a snapshot mechanism for pre-alpha.

Strict tier entries, each with an empty bare-specifier allowlist and `node:*` denied:
- `sqlfu`
- `sqlfu/analyze`
- `sqlfu/outbox`
- `sqlfu/ui/browser`

Heavy tier entries with no check at all:
- `sqlfu/api`
- `sqlfu/lint-plugin`
- `sqlfu/ui`

That is enforcement done.


---

## Turn 12 — Question from sub-claude

All branches have concrete decisions:

- **A**: final entry points = `sqlfu`, `sqlfu/analyze`, `sqlfu/api`, `sqlfu/lint-plugin`, `sqlfu/outbox`, `sqlfu/ui`, `sqlfu/ui/browser`. Drop `sqlfu/client`, `sqlfu/cli`, `sqlfu/ui/browser` condition. `sqlfu/api` absorbs schemadiff/typegen/formatter. Migration helpers on root.
- **B**: root = adapters + types + helpers + `applyMigrations` / `migrationsFromBundle` / `Migration` / `MigrationBundle` + `prettifyStandardSchemaError` + `defineConfig` + instrument/otel. Zero `node:*`.
- **C**: flatten `core/` into `src/`. Delete `tooling.ts`. Merge `instrument.ts`. Rename `sqlite.ts` → `sqlite-text.ts`.
- **D**: `src/node/` = {`host.ts`, `port-process.ts`, `config.ts`, `cli-router.ts`}. Domain subfolders keep their own Node files. `src/cli.ts` stays top-level.
- **E**: full file-to-entry-point table is a Phase 2 deliverable. Spot-checks resolved.
- **F**: strict hard-deny on `sqlfu`, `sqlfu/analyze`, `sqlfu/outbox`, `sqlfu/ui/browser`. No checks on heavy tier.

**ready for Phase 2**
