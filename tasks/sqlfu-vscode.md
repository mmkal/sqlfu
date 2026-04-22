status: needs-grilling
size: medium

# VS Code extension for sqlfu

## Intent

A VS Code extension that makes sqlfu pleasant to use from inside the editor:

1. **Open the sqlfu UI for the current workspace.** One command (`sqlfu: Open UI`) that spawns `sqlfu serve` for the workspace root on a free port, waits for it to come up, and opens the URL — either as a webview or via `vscode.env.openExternal`. This is the MVP that shipped on the `devtools` branch before being pulled out of the lint-plugin PR.
2. **Teach editors where the dev DB lives.** The sqlfu config already points at a concrete dev SQLite path. The extension can surface that as a `.vscode/settings.json` contribution so other extensions (SQLTools, vscode-sqlite, etc.) that the user already trusts can connect without manual configuration. Potentially a one-shot "Teach SQLTools about my dev DB" command.
3. **Run queries from the editor.** CodeLens over `.sql` files: "Run against dev DB" executes the query and opens the results in a panel. The sqlfu client already exposes enough (`listMigrations`, `runMigrations`, `generate`, `diff`, plus the query runner) to power this without new backend work.

Longer-shot:

- Inline hover/type hints on `.sql` files driven by the generated `.sql.ts` artifacts.
- Language-server-ish completion from `definitions.sql` (big — would need a real SQL language server; `pgkit` has prior art).

## Approach notes left on the `devtools` branch (before extraction)

- Package lived at `packages/sqlfu-vscode/` with a single `activate` function in `src/extension.ts` (~170 lines).
- CLI resolution: `node_modules/.bin/sqlfu` → `node_modules/sqlfu/dist/cli.js` via `process.execPath` → bare `sqlfu` on PATH. No package-manager detection.
- Free port via `net.createServer().listen(0)` then pass to `sqlfu serve --port`.
- Webview sandbox blocks embedding a local `http://` server (CSP), so the webview is a splash with a link out to the browser. Embedding the full UI would need CSP gymnastics — deferred as a follow-up. `vscode.env.openExternal` may be a better default and would sidestep the CSP story entirely.
- `engines.vscode ^1.90.0`, `@types/vscode`, `@types/node`, `typescript`. No runtime deps.
- Published: not yet. No `vsce package`; F5-loadable from the package dir.

## Open questions (need a decision before building)

- **Webview vs external browser.** External browser is simpler and matches the UX the user already gets with `npx sqlfu`. Webview keeps them in the editor but costs CSP work and a worse scroll/resize experience. Lean toward `openExternal` unless there's a good argument for webview.
- **Does the extension bundle its own `sqlfu` install?** Today it assumes the workspace has one. If the goal is "install the extension and get the UI", bundling an `npx sqlfu` path might be friendlier — but then versions drift from the project's own install.
- **Marketplace publishing strategy.** Publisher name (`sqlfu`? `mmkal`?), icon, release cadence. Separate from the main sqlfu release cycle or bundled?
- **Teach-SQLTools flow.** Write to `.vscode/settings.json` directly, or contribute a workspace configuration? What does it do if the user already has SQLTools configured?

## Acceptance (MVP)

- `pnpm --filter @sqlfu/vscode build` compiles.
- Open the package in VS Code, F5 → extension-host window with `sqlfu: Open UI` available.
- Running it in a workspace with a `sqlfu.config.ts` launches the UI and opens it (webview or external).
- No publishing in scope for MVP.

## Not in scope

- CodeLens, inline hints, language server (follow-ups once MVP ships).
- Marketplace release.
- Non-sqlite driver support (sqlfu is SQLite-only today anyway).
