# Interview log: light root export refactor

Topic: how to make `import { ... } from 'sqlfu'` truly runtime-safe (zero `node:*`, zero heavy deps) and enforce it going forward.

Worktree: `../worktrees/sqlfu/light-root-export` (branch `light-root-export`).

Session: `37f73924-1910-4c3f-90e1-508fa1feaeab`.


---

## Turn 1 — Question from sub-claude

Good picture now. `resolveProjectConfig` in `core/config.ts` is the sneaky one: it has no I/O, but it still calls `path.dirname` and `path.resolve` — both from `node:path`. That's a `node:*` import even if the function is purely computational.

---

**Here's what I see in the code → proposed answer → does it match your intent?**

The light-path currently pulls in `node:path` through `core/config.ts` in two ways:

1. **Obviously heavy** — `loadProjectConfig`, `loadProjectStateFrom`, `initializeProject`, `loadConfigFile`, `loadTsconfigPreferences`, `findTsconfigPath` all touch `node:fs/promises` and `node:url`. These clearly move to the heavy path regardless.

2. **Sneakily heavy** — `resolveProjectConfig` has no I/O but calls `path.dirname(configPath)` and `path.resolve(configDir, configValue)`. These are pure string operations, but they live in `node:path`.

The question for the contract is: **is the ban on `node:*` absolute — including `node:path` used only for string math — or is pure-computation `node:path` acceptable?**

My recommendation: **absolute ban**. `node:path` requires `nodejs_compat` on Cloudflare Workers and isn't available in plain browser contexts. `path.dirname` and `path.resolve` are ~3 lines of string manipulation to inline. More importantly, an absolute rule is unambiguous — the moment you carve out "pure computation from `node:*` is OK", contributors will wonder whether `node:crypto`'s `createHash` counts. The clean line is: the built `dist/index.js` import graph contains zero `node:*` references.

Consequence: `resolveProjectConfig` moves off the root export (it's a dev-time function — no Cloudflare Worker user calls it to resolve their sqlfu config; they pass paths directly). It lives in the heavy path alongside the I/O functions that call it.

Does "zero `node:*` in the built JS, no exceptions" match your intent — or do you want to keep `resolveProjectConfig` on the root and replace the two `node:path` calls with inline string ops instead?


## Turn 1 — Answer (as user)

Absolute ban for the *runtime graph* of the built `dist/index.js`. Type-only imports from `node:*` (e.g. `import type { DatabaseSync } from 'node:sqlite'`) are fine because they erase at build time — the enforcement check runs on the built JS import graph, not the `.ts` source, so they naturally vanish. Be explicit about that in the eventual docs/check so nobody second-guesses.

On `resolveProjectConfig` specifically — pushing back on the conclusion but not the rule. `core/paths.ts` already exists for exactly this reason ("Minimal POSIX-style path helpers for code that runs in both node and the browser"). The tool to keep `resolveProjectConfig` runtime-safe is already in the repo: swap its two `node:path` calls for `joinPath` / `dirname` from `core/paths.ts` and it stays pure.

But you're right that nobody calls `resolveProjectConfig` from a Worker. Make the call based on what the import graph looks like after the split — if it naturally ends up on the heavy side because all its callers are heavy, fine; don't contort to keep it on root, don't eagerly evict it either.

[guess: I'd lean toward keeping `defineConfig` + `resolveProjectConfig` + `createDefaultInitPreview` together on root as the "config shape" module — `defineConfig` is user-facing, `createDefaultInitPreview` is already pure, `resolveProjectConfig` rounds out the set. Filesystem loaders move to a separate `config-load.ts` imported only by heavy-path files.]


---

## Turn 2 — Question from sub-claude

Q1 locked. Q2 decision is in — `core/config-load.ts` for the I/O half, pure half stays in `core/config.ts`. 

One thing to flag before Q3: `core/paths.ts` has `joinPath` and `dirname` but not `resolve`. The `resolveProjectConfig` call `path.resolve(configDir, configValue)` needs a helper that handles the "if absolute, return as-is; otherwise join" case — `joinPath` doesn't do that. My read is a 4-line `resolvePath(base, relative)` goes into `core/paths.ts`, then `resolveProjectConfig` stays clean. I'll treat that as an implementation detail, not a question.

---

Now Q3, the exact post-refactor public surface of the light root. Here's what the split produces:

**Stays on root (`src/index.ts`):**
- Everything from `client.ts` — sql helpers, types, naming, util, instrument, all adapters, OTel types
- From `core/config.ts` (pure half): `defineConfig`, `resolveProjectConfig`, `createDefaultInitPreview`, types (`SqlfuConfig`, `SqlfuProjectConfig`, `SqlfuValidator`, `LoadedSqlfuProject`)
- `prettifyStandardSchemaError` from vendor

**Disappears from root** (moved to `core/config-load.ts`, internal to heavy-path callers):
- `loadProjectConfig`, `loadProjectState`, `loadProjectStateFrom`, `initializeProject`

The question is about the last group. Those four are named exports today on the public `sqlfu` root. After the move they'd be internal — no dedicated public subpath, just imported by `cli.ts`, `ui/server.ts`, `typegen/index.ts`, `node-host.ts` directly. Pre-pre-pre-alpha means no backward-compat shims, so they'd simply vanish from the public API.

My recommendation: **let them vanish**. They're dev-time Node functions. Anyone building custom tooling that calls `loadProjectStateFrom` is deep enough into sqlfu internals that they can import it from `sqlfu/api` (which already exists and covers server-side heavy usage). No new subpath needed.

Does that match — or do any of those four belong on `sqlfu/api`'s public surface explicitly?


## Turn 2 — Answer (as user)

Vanish. `sqlfu/api` is shaped around `SqlfuContext` / `SqlfuHost` — a higher-level surface than "read config off disk". Adding the four loaders to it would muddy that design.

Anyone building tooling who needs them can deep-import `sqlfu/core/config-load` for now. Pre-pre-pre-alpha — that is fine. If it turns out someone genuinely needs them as stable API, promote later.

Explicitly: do NOT list `core/config-load.ts` under `publishConfig.exports`. It is internal. A contributor reaching for it knows they are off-piste.


---

## Turn 3 — Question from sub-claude

Q3 locked: the four I/O loaders vanish from the public API; `core/config-load.ts` is internal, not in `publishConfig.exports`, no deep-import guarantee.

---

Q4: **enforcement mechanism**. There are three real options; I've ruled out `"browser"`/`"workerd"` export conditions (packaging hint, not a runtime-graph check) and publint (covers package structure, not our specific rule).

**Option A — build-time static check** (my recommendation). A script in `packages/sqlfu/scripts/check-light-root.ts` that bundles `dist/index.js` with esbuild (`bundle: true`, `platform: 'browser'`) and inspects the metafile. esbuild is already a dev dep. Browser platform mode treats `node:*` builtins as unresolvable — the metafile flags them before they become a runtime surprise. The script walks metafile inputs, reports the first offender with its import chain (`dist/index.js → dist/core/config.js → node:path`) and a one-line remediation. Fast, deterministic, runs after `build:runtime` in CI. Dynamic `import()` calls would still sneak past — note that explicitly in the script output ("this check covers static imports only").

**Option B — ESLint rule**. A custom rule (lives in `src/lint-plugin.ts`) that denies `node:*` and listed heavy-dep bare specifiers in an allowlisted set of source paths. Catches issues at author-time before a build. Downside: operates on `.ts` source, so needs to correctly skip `import type` (ESLint's `type-imports` support is tricky); also needs a maintained allowlist of "light" file paths that diverges from the actual module graph.

**Option C — runtime smoke test**. `node --experimental-vm-modules -e "import('dist/index.js')"` with a `--import` hook that logs resolved specifiers, failing on `node:*`. Brittle across Node versions, slow, and only catches what actually executes at module-load time.

Recommendation: **A** — build-time static check using esbuild's metafile. It operates on the real artifact (`dist/`), handles `import type` erasure for free, uses a dep already in the project, and runs in CI with a single `tsx scripts/check-light-root.ts` call after `build:runtime`.

Does that match — or do you want to pair it with option B for authoring-time feedback too?


## Turn 3 — Answer (as user)

A only. Skip B. ESLint rule duplicates what the metafile check proves from the real artifact — two sources of truth for one invariant and the allowlist drifts. Cost of a missed author-time catch is one failed CI run; build + check is near-instant.

Two additions to A:

1. The check bans **non-allowlisted bare specifiers, not just `node:*`**. Light-path rule is "zero runtime deps" — both Node builtins and npm deps. Allowlist should be empty for runtime imports (types erased). If a future light-path file legitimately needs a dep, that is a design conversation, not a silent allowlist edit. Error message should say so: "To add X to the light path, update the allowlist in scripts/check-light-root.ts and explain why in the PR."

2. **Wire it into `pnpm test`, not just CI.** Put it in a vitest suite (`test/light-root-export.test.ts`) that either shells out or imports the check function against the pre-built `dist/`. Reasons: (a) rides the existing test feedback loop that agents and I already use; (b) CI-only checks get forgotten until release, this rule must fail the moment it regresses. Reuse the `test/adapters/ensure-built.ts` memoized `build:runtime` pattern so the check does not blow timeouts.

Script output should explicitly note: "Static imports only. Dynamic `import()` calls bypass this check — avoid them on the light path."


---

## Turn 4 — Question from sub-claude

`generate-catalog.ts` is only 3 lines and isn't referenced anywhere else in `packages/ui/` — no build script, no import, nothing. It already broke when the root was slimmed, which suggests it was forgotten before this refactor started.

**Here's what I see → proposed answer → does it match?**

The file imports `generateQueryTypes` from `sqlfu` root. That function lives in `typegen/index.ts`, isn't exported from `sqlfu/api` (api.ts is `SqlfuContext`/`SqlfuHost`-shaped — promoting `generateQueryTypes` there would muddy it, as you noted in Q3), and it's not referenced from any `packages/ui` build or runtime path I can find.

My recommendation: **delete `packages/ui/src/generate-catalog.ts`**. It's dead code that broke silently. If a future need for a standalone "generate types from disk" script emerges, the right shape is a one-liner in a `scripts/` directory that deep-imports `sqlfu/typegen` (same off-piste pattern as `core/config-load`) — but that's a future problem.

Does that match — or is there a use for `generate-catalog.ts` that I'm not seeing?


## Turn 4 — Answer (as user)

Delete it. Dead code. If a future need emerges for a standalone "generate types from disk" script, the right shape is a one-liner that deep-imports `sqlfu/typegen` (off-piste, same category as `sqlfu/core/config-load`) — not a preserved slot on the public root.

No caller, no product requirement, no reason to keep it alive.


---

## Turn 5 — Question from sub-claude

Q7 locked: delete `generate-catalog.ts`, no preserved slot.

---

Q8: **Should the `.` export map gain `"browser"` or `"workerd"` conditions?**

The current `publishConfig.exports` for `.` is just `types` + `default`, both pointing at `dist/index.js`. The `./ui` entry already uses a `"browser"` condition to swap in `dist/ui/browser.js` — a genuinely different file. That pattern makes sense there.

For `.`, the proposed conditions would point at the **same** `dist/index.js`. There's no alternate file to swap in — the light root IS the file.

My recommendation: **skip it**. A `"browser"` or `"workerd"` condition that resolves to the same file as `"default"` is a no-op. It doesn't help bundlers tree-shake, it doesn't guard against the wrong entry being loaded, and it adds two lines to `package.json` that imply a meaningful split where none exists. The real guarantee is enforced by the static check on `dist/index.js` content — not by export map hints. If we ever need a genuinely different browser-only entry (e.g., WebAssembly-backed sqlite adapter), that's when a condition earns its place.

Does that match — or do you see a bundler/tooling scenario where the condition carries actual weight?


## Turn 5 — Answer (as user)

Skip. Agreed on the reasoning. Export map should not imply a split that does not exist in the files — that is information debt. If a Worker-specific variant is ever needed (e.g. WASM-backed SQLite adapter with different loading), add the condition then and point it at a real second file.


---

## Turn 6 — Question from sub-claude

Q8 locked: no conditions until a real second file exists.

---

Q9, last branch: **folder structure**. Should `core/` be split into `core-light/` and `core-node/` (or a `core/node/` subfolder) to make the boundary visible at a glance, or does the folder stay flat and the static check is the single source of truth?

Current state: `core/` holds both. After this refactor it will contain the light files (`sql.ts`, `types.ts`, `util.ts`, `naming.ts`, `instrument.ts`, `sqlite.ts`, `paths.ts`, `init-preview.ts`), the newly-split `config.ts` (pure) and `config-load.ts` (heavy), and the already-heavy `node-host.ts`, `tooling.ts`, `port-process.ts`.

My recommendation: **leave the folder flat**. A rename to `core-light/` / `core-node/` touches every relative import across adapters, cli, typegen, ui/server, formatter, schemadiff — large churn for no runtime effect. The static check is the enforcement mechanism; it already makes the boundary machine-verifiable. The naming convention (`config-load.ts` vs `config.ts`, `node-host.ts` labelling itself) is a readable signal. A folder split would be the right call if `core/` grew to 30+ files and the signal got lost — that's a later commit if it ever becomes necessary.

Does that match — or do you want the folder split done now while the imports are already being touched?


## Turn 6 — Answer (as user)

Leave flat. Agreed. Renaming the folder touches adapters, cli, typegen, ui/server, formatter, schemadiff — large churn for a signal the static check already makes machine-verifiable.

Naming convention carries the signal: `node-host.ts`, `config-load.ts`, `port-process.ts`, `tooling.ts` are self-labelling. If `core/` later grows past a threshold where the boundary visually dissolves, that is a future commit.


---

## Turn 7 — Question from sub-claude

All nine branches have concrete decisions. Summary of what's locked:

1. Zero `node:*` in `dist/index.js` runtime graph — absolute, no exceptions. `import type` erases at build time; check runs on built JS.
2. `core/config.ts` splits into pure half (stays) + `core/config-load.ts` (heavy, not in `publishConfig.exports`). `resolveProjectConfig` stays light via `core/paths.ts` swap.
3. Light root surface: `client.ts` + pure `core/config.ts` + `prettifyStandardSchemaError`. Four I/O loaders vanish from public API.
4–6. Enforcement: esbuild metafile check in `scripts/check-light-root.ts`, wrapped in `test/light-root-export.test.ts` via `ensure-built.ts` pattern. Empty bare-specifier allowlist. "Static imports only" caveat in output.
7. Delete `packages/ui/src/generate-catalog.ts` — dead code.
8. No `"browser"`/`"workerd"` conditions on `.` export — no second file, no condition.
9. `core/` stays flat — naming convention + static check carry the signal.

**Ready for Phase 2.**
