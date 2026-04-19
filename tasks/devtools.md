status: in-progress
size: large

# Dev tools: lint plugin + VS Code extension

## Status summary

MVP sketch, picking the simplest-viable path for both halves. Original spec was two bullets; this is the AFK-fleshed-out plan the user asked for.

- **Lint plugin**: shipping an ESLint-compatible plugin (`@sqlfu/eslint-plugin`). oxlint supports JS plugins via an ESLint-compatible API (alpha, as of 2026-04), so the same plugin package is loadable from `.oxlintrc.json` once the user opts in. MVP rule: `sqlfu/no-unnamed-inline-sql` — flags `client.all(\`...\`)` / `client.run(\`...\`)` / `client.iterate(\`...\`)` callsites where the inline SQL appears verbatim (modulo whitespace) inside a `.sql` file in the sqlfu project's `queries` glob. Suggests the named wrapper import. Scoped to the MVP; other candidate rules listed below but deferred.
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
- [x] create `packages/sqlfu-eslint-plugin/` with MVP rule + tests _see implementation notes_
- [x] create `packages/sqlfu-vscode/` with one-command extension _see implementation notes_
- [x] open PR `devtools: lint plugin + vscode extension scaffolding` _see implementation log_

## Pre-existing flaws noticed (fix in-branch if trivial)

Will log in the implementation notes below if any turn up while wiring this in.

## Implementation notes

_(Filled in as the work proceeds. Implementation log at the bottom.)_

