status: in-progress
size: large

# Dev tools: lint plugin + VS Code extension

## Status summary

MVP shipped: `sqlfu/no-unnamed-inline-sql` lint rule + vscode scaffold. Round 2 (this bedtime, 2026-04-20): **expand the lint plugin** to add two more rules — formatting and query validation — and rename the export from `./eslint` to `./lint-plugin` so the module's role is clear (it targets both oxlint and eslint).

**Restructure (post PR #16 review):** the lint plugin was originally shipped as a separate `@sqlfu/eslint-plugin` package. The user rejected that shape — the rule is now bundled inside the main `sqlfu` package as a single-file export. Originally at `sqlfu/eslint` with **zero runtime dependencies**; the round-2 changes introduce a runtime import of `sqlfu`'s formatter (~60 kB bundled), so the module is now more than a shim — hence the rename to `./lint-plugin`.

## Round 2 (2026-04-20)

Three asks from the user:

1. **Export rename**: `sqlfu/eslint` → `sqlfu/lint-plugin`. Pre-alpha — break the export, don't keep a legacy alias.
2. **Formatter rule** (`sqlfu/format-sql`): flag inline SQL template literals that don't match `formatSql(text, {style: 'sqlfu'})`. Offer autofix via the formatter's output. Targets the same `client.{all,run,iterate}` + `client.sql\`…\`` shape as `no-unnamed-inline-sql`.
3. **Query-validation rule** (`sqlfu/valid-sql`, status: deferred tonight): flag inline SQL template literals whose content fails to parse. Requires loading the vendored ANTLR parser, which is itself on the chopping block (see `tasks/drop-antlr.md`). Deferring to the post-drop-antlr world, when the new hand-rolled parser gives us a cheap sync `validate(sql) → diagnostic[]` surface. Task file notes this as a follow-up; the lint plugin gets a stub rule name reserved for it.
4. **Dogfood**: wire the plugin into this repo's `.oxlintrc.json` via `jsPlugins`. Both existing and new rules should run against the sqlfu monorepo's source.

Why only two of three rules ship tonight:
- The formatter rule is synchronous, zero-schema, and cheap. Perfect oxlint/eslint citizen.
- The validation rule needs either the vendored ANTLR parser (which doubles the lint plugin's bundle size — a regression we're specifically trying to avoid with drop-antlr) or the full async `analyzeAdHocSqlForConfig` path (which doesn't fit oxlint's synchronous rule contract). Cleanest path is to wait for drop-antlr's hand-rolled parser: it'll have a small sync `parse()` returning a plain diagnostic list, which the lint plugin can consume at almost-zero extra cost.

- **Lint plugin**: shipped as `sqlfu/eslint` (single file, zero runtime deps). oxlint supports JS plugins via an ESLint-compatible API (alpha, as of 2026-04), so the same export is loadable from `.oxlintrc.json` once the user opts in. MVP rule: `sqlfu/no-unnamed-inline-sql` — flags `client.all(\`...\`)` / `client.run(\`...\`)` / `client.iterate(\`...\`)` callsites where the inline SQL appears verbatim (modulo whitespace) inside a `.sql` file in the sqlfu project's `queries` glob. Suggests the named wrapper import. Scoped to the MVP; other candidate rules listed below but deferred.
- **VS Code extension**: scaffolding only. Downscoping from "show hover types over `.sql` files" (would need an LSP) to **one command**: `sqlfu: open UI`, which runs `sqlfu ui` (or `sqlfu-ui` from the workspace's installed packages) for the current workspace root and opens the UI in a webview panel. This gets the user a real artifact they can load via F5 tonight. Further ambition (codelens over `.sql`, inline types) is sketched below, not built.

## Part A — lint plugin

### Rule menu (be opinionated, pick ONE for MVP)

Candidate rules, roughly ranked by value:

1. **`no-unnamed-inline-sql`** — if a raw-string SQL passed to `client.all`/`client.run`/`client.iterate`/`client.sql\`...\`` has the same normalized text as a checked-in `.sql` file, tell the user to import the generated wrapper. **[MVP]**
2. `no-stale-generation` — `.sql` file exists but `.sql.ts` (or whatever the generated extension is) is missing or has an older mtime. Not a great ESLint fit (cross-file, filesystem-y). Better served by `sqlfu check`.
3. `prefer-lowercase-sql` — enforces the repo's "lowercase SQL keywords" convention. Very cheap, high-hit-rate. Good follow-up once the toolchain works.
4. `no-unknown-schema-ref` — raw queries referencing tables/columns that don't appear in `definitions.sql`. Requires a parse. Out of scope.
5. `zod-generation-required` — if `generate.zod` is on, every `.sql` file should have a corresponding `z.object(...)` in the generated file. Requires generator coupling. Out of scope.

Chosen MVP: **rule 1** — it's the one that most directly enforces sqlfu's "SQL First, TypeScript Second" voice. The whole point of the library is that your SQL is a first-class file; an inline string that duplicates one is a regression.

### Rule semantics (`sqlfu/no-unnamed-inline-sql`)

Fires when:

- A template literal is passed directly to `client.all`, `client.run`, `client.iterate`, or used as the tag body of `client.sql\`...\``, AND
- The template has **no** interpolations (we don't try to reconstruct parameterized queries), AND
- After normalization (`.trim()`, collapse runs of whitespace to single space, lowercase SQL keywords — reuse `normalizeSqlForHash` from `packages/sqlfu/src/core/util.ts` if exported), the text matches a `.sql` file discovered under the project's `queries` glob.

Suggestion: "use the named query `import { <functionName> } from './<path>/<filename>.sql.js'` instead." (We won't ship an autofix in v1 — it'd need to know the correct import path from the lint'd file's location. Message is pointer-only.)

Detection of "client" is deliberately loose in v1: any identifier named `client`, `db`, or anything matching `/Client$/`. Users can disable per-line with `// eslint-disable-next-line sqlfu/no-unnamed-inline-sql`. A stricter version could use the TS type checker, but that's a follow-up and a big dependency jump.

### Package layout

- `packages/sqlfu-eslint-plugin/`
  - `package.json` — name `@sqlfu/eslint-plugin`, main `dist/index.js` (post-build) but exports point at `src/index.ts` for now (the rest of the monorepo already does this).
  - `src/index.ts` — plugin entry: `export default { meta, rules: { 'no-unnamed-inline-sql': rule } }`.
  - `src/rules/no-unnamed-inline-sql.ts` — the rule.
  - `src/lib/normalize.ts` — normalization helper (or re-export from `sqlfu` if we expose it).
  - `src/lib/load-queries.ts` — locate the project root + read the queries glob + cache per rule invocation.
  - `test/no-unnamed-inline-sql.test.ts` — vitest driving the ESLint `RuleTester` plus a small fixture workspace with one `.sql` file and one offending `.ts` file.
  - `README.md` — usage instructions for ESLint flat config + oxlint `jsPlugins`.

### Publishing surface

Export one plugin that works on both ESLint and oxlint (via oxlint's ESLint-compat JS plugins API). **Because oxlint JS plugins are alpha (as of 2026-04-19)**, we ship the rule and tests against ESLint primarily; we document the oxlint wiring but don't gate CI on it yet.

The only asymmetry today is oxlint's plugin loader path (`jsPlugins` in `.oxlintrc.json`) vs ESLint flat config's `plugins` key. Both consume the same exported module.

### MVP acceptance

- Can `pnpm --filter @sqlfu/eslint-plugin test` green.
- A fixture with `client.all(\`select * from users\`)` **and** a `sql/list-users.sql` containing `select * from users` produces one lint error pointing at the template literal, with message naming the file.
- A fixture without the matching `.sql` file produces no errors (no false positive for genuinely ad-hoc SQL).
- README shows ESLint config snippet + oxlint config snippet.

### Not in scope

- Autofix.
- Non-trivial SQL parsing / variable substitution awareness.
- Rules 2–5 above.
- Per-query caching across runs.
- TypeScript-aware client-type detection.

## Part B — VS Code extension

### Goal (downscoped)

One command: `sqlfu: open UI`. Launches `sqlfu ui` for the current workspace (resolves `sqlfu` from the workspace's `node_modules`, else from a globally-installed bin) and opens the resulting URL inside a VS Code webview. That's it.

Why this version:

- Scaffolding a codelens + LSP is deep. Webview + one command is ~40 lines of extension code.
- sqlfu already has a UI (`packages/ui`). This extension is just a shortcut to it for the workspace.
- It's the first piece that gives the user a tangible artifact to F5-load tonight.

### Package layout

- `packages/sqlfu-vscode/`
  - `package.json` — VS Code extension manifest (contributes one command).
  - `src/extension.ts` — activation event registers `sqlfu.openUi` command. The command:
    1. Resolves the workspace folder (error if none).
    2. Resolves the `sqlfu` CLI: look for `node_modules/.bin/sqlfu`, then `pnpm exec sqlfu`, then bail with a clear message.
    3. Spawns `sqlfu ui --port 0` (need to confirm the UI command supports `--port 0`; if not, pick a free port via `net.createServer().listen(0)` first and pass it).
    4. Reads stdout until a "listening on http://..." line appears.
    5. Opens a webview with that URL. (Or: `vscode.env.openExternal` to kick the browser. Simpler fallback — going with webview unless CSP is annoying, in which case fall back to `openExternal`.)
  - `tsconfig.json` — targets VS Code's Node runtime.
  - `README.md` — F5-to-run instructions, "marketplace TBD".
  - `.vscode/launch.json` — "Run Extension" launch config.

### MVP acceptance

- `pnpm --filter @sqlfu/vscode build` compiles.
- Opening the package dir in VS Code and hitting F5 spawns an extension-host window where `Cmd+Shift+P → sqlfu: open UI` in a workspace with a `sqlfu.config.ts` launches the UI.
- No publishing, no `vsce package`. That's a follow-up.

### Sketched (NOT built) ambitions

- CodeLens over every `.sql` file → "Run query" which executes it against the configured dev DB and opens results in a panel.
- Language-server over `.sql` that resolves table/column completions from `definitions.sql`.
- Teaching an existing extension (SQLTools, vscode-sqlite) where the DB lives, via a workspace settings contribution. Less work, maybe better UX — but requires the user to already have that extension, which we can't assume. Note this option for a follow-up.

### Fallback if extension scaffolding gets deep

If the scaffolding turns into an afternoon of tsconfig wrangling or CSP headaches with the webview, pivot to a `scripts/install-dev-extensions.sh` that installs `SQLTools` + writes a `.vscode/settings.json` for the workspace pointing at the dev DB. Record that decision in the implementation notes below.

## Checklist

- [x] flesh out this task file with concrete plan _(committed separately as the first commit on the `devtools` branch)_
- [x] ~~create `packages/sqlfu-eslint-plugin/` with MVP rule + tests~~ _rejected — see next item. Package deleted; rule lives inside `packages/sqlfu/src/lint-plugin.ts`._
- [x] ship the ESLint rule inside `sqlfu` itself with zero runtime deps _implemented at `packages/sqlfu/src/lint-plugin.ts` (originally `eslint.ts`, renamed round 2), tested at `packages/sqlfu/test/lint-plugin.test.ts`_
- [x] create `packages/sqlfu-vscode/` with one-command extension _see implementation notes_
- [x] open PR `devtools: lint plugin + vscode extension scaffolding` _see implementation log_

### Round 2 (2026-04-20)

- [x] rename export `sqlfu/eslint` → `sqlfu/lint-plugin`. _`git mv` for both files; `packages/sqlfu/package.json` and `publishConfig.exports` updated; README updated; consolidated duplicate `peerDependencies` blocks (pre-existing merge artifact) into one._
- [x] add `sqlfu/format-sql` rule: flag inline SQL template literals that don't match `formatSql(text, {style: 'sqlfu'})`. _Implemented in `packages/sqlfu/src/lint-plugin.ts` with autofix via `fixer.replaceTextRange`. 7 new vitest cases. Shared `createClientTemplateVisitor` between the two rules so call-site detection stays consistent._
- [x] dogfood: `.oxlintrc.json` loads `./packages/sqlfu/dist/lint-plugin.js` via `jsPlugins`. Both rules on at error. Test override disables `format-sql` (test files often keep inline SQL compact for readability). Workspace `lint` script now runs `pnpm --filter sqlfu build:runtime` first so the dist/ plugin exists. Repo is clean under the new rules (17 pre-existing lint errors unaffected).
- [x] update docs: `packages/sqlfu/README.md` now documents both rules + ESLint and oxlint configs.
- [x] reserve rule name `sqlfu/valid-sql` as future work — documented in the Round 2 header above; blocked on drop-antlr landing a cheap sync `parse(sql) → diagnostic[]` surface.

### Round 2 gotchas (recorded for future-agents)

- **`.ts` imports via oxlint jsPlugins don't work in Node today.** Node's native type stripping strips types but does NOT rewrite `.js` imports to `.ts`. Our source uses NodeNext's `.js` convention (`import './formatter.js'`), so `import` of `lint-plugin.ts` fails at resolution time. Vitest's bundler handles this fine; Node + oxlint do not. Fix: point `jsPlugins` at the built `dist/lint-plugin.js`, and ensure `pnpm lint` runs `build:runtime` first so the dist plugin is up-to-date.
- **Formatter is assertive.** `formatSql('select b from a', {style: 'sqlfu'})` returns `select b\nfrom a`, because the sqlfu default splits by clause. Short one-liners in tests (`await client.sql\`select b from a\``) will trip the rule. For now, the rule is off in test files via the `overrides` block. If the formatter later gains a "keep short queries on one line" mode, revisit that override.

## Pre-existing flaws noticed (fix in-branch if trivial)

Will log in the implementation notes below if any turn up while wiring this in.

## Implementation notes

### What shipped

- **`packages/sqlfu-eslint-plugin/`** — one rule (`sqlfu/no-unnamed-inline-sql`). 7 vitest cases covering: positive match, ad-hoc negative, parameterized-template negative, whitespace/case normalization, `client.sql\`...\`` tag, nested query dirs, missing `sqlfu.config` no-op. Uses `Linter.verify` with a flat config, with `cwd` set to the fixture tmp dir so the `files` glob actually matches the absolute fixture paths (otherwise ESLint silently reports "No matching configuration found"). Plugin is ESLint-compat so oxlint's `jsPlugins` (alpha) can load the same package.
- **`packages/sqlfu-vscode/`** — scaffold with one command (`sqlfu.openUi`). Resolves the `sqlfu` CLI from the workspace's `node_modules/.bin`, falls back to `node_modules/sqlfu/dist/cli.js`, falls back to global PATH. Spawns `sqlfu serve --port <freePort>`, waits for the port to respond, opens a webview. The webview itself is a splash linking out to the URL — embedding the local http UI inside VS Code requires CSP work that isn't MVP-worthy (the task file predicted this and approved the downscope).

### oxlint plugin status (confirmed)

oxlint 1.x **does** support JS plugins via `jsPlugins` in `.oxlintrc.json`, using an ESLint-compatible API. It's documented as **alpha**. We ship one plugin package that works with ESLint today and is loadable by oxlint when/if the user opts in; the README documents both invocations.

### Things intentionally not done

- No oxlint `jsPlugins` wiring in this repo's `.oxlintrc.json` — the repo's own rules aren't the point of the package, and adding them while oxlint's plugin loader is alpha risks churn. Downstream users enable it in their own configs.
- No autofix on the rule. The correct replacement depends on the file location (relative import path) and the generated wrapper's function name, which the rule does compute — an autofix is a reasonable follow-up once the message-only version has been tried.
- No `.vscode/launch.json` in `packages/sqlfu-vscode/` — the write attempt hit a permission block in the working environment. README documents the JSON to paste in instead.
- No marketplace publish. Out of scope.

### Pre-existing flaws noticed

- The `devtools` worktree's pnpm install didn't build `better-sqlite3` (its build script is in the workspace's `ignoredBuiltDependencies` list, apparently — or simply not yet approved in this worktree). Had to manually run the install script. Not fixing globally because the root workspace has `simple-git-hooks` in `onlyBuiltDependencies` but leaves `better-sqlite3` off; likely intentional for determinism. Documented here as a worktree-setup gotcha.
- Running `pnpm lint` on `main` produces 20 errors, all pre-existing. Our new packages contribute zero new errors. The pre-existing errors overlap with the ones called out in `tasks/complete/2026-04-18-ox.md` and are unrelated to this task.

### Implementation log

| commit | summary |
|---|---|
| e28de61 | task: flesh out devtools plan |
| 50d673b | eslint-plugin MVP + vscode extension scaffold |
| (next) | fold eslint rule into `sqlfu/eslint` (zero runtime deps); delete `packages/sqlfu-eslint-plugin/` |

### Restructure (post PR #16 review)

The user pushed back on `@sqlfu/eslint-plugin` as a separate package: ESLint plugins "are basically just a `create(...) { ... }` function", so the rule belongs inline in the main package. Restructure:

- Deleted `packages/sqlfu-eslint-plugin/` wholesale. Pre-alpha — no back-compat.
- New entry point: `packages/sqlfu/src/eslint.ts` (single file, folds together the rule, the query loader, and the normalization helper).
- New export: `"./eslint": {"types": "./dist/eslint.d.ts", "default": "./dist/eslint.js"}` in `packages/sqlfu/package.json`.
- `eslint` is a peer dep on `sqlfu` itself (optional) so the dep graph of `sqlfu` doesn't change for users who don't lint. `@types/eslint` and `@types/estree` are devDeps-only (type-only imports erase at compile time).
- Compiled `dist/eslint.js` is 10 kB and only imports `node:fs` / `node:path` — zero third-party runtime deps.
- Tests moved to `packages/sqlfu/test/eslint.test.ts`. All 7 cases from the old package pass; full sqlfu suite (1669 tests) still green.
- README gained a short **ESLint rule** section under Capabilities, with a copy-pasteable flat-config snippet.

