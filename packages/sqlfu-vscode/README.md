# @sqlfu/vscode

VS Code extension for sqlfu projects.

**Status: scaffold.** One command today: `sqlfu: Open UI`. Starts `sqlfu serve` for the current workspace on a free port, waits for it to come up, then points you at the URL.

## Run locally

Not published to the marketplace yet. To try it:

```sh
pnpm --filter @sqlfu/vscode build
```

Then open this package folder in VS Code and press **F5** ("Run Extension"). If you don't have a `.vscode/launch.json`, create one with:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"]
    }
  ]
}
```

In the new Extension Development Host window, open a folder that has a `sqlfu.config.ts`, then run **`Cmd+Shift+P` → `sqlfu: Open UI`**.

## What it does

1. Resolves the workspace's `sqlfu` CLI (local `node_modules/.bin/sqlfu`, then `node_modules/sqlfu/dist/cli.js`, then global `sqlfu` on PATH).
2. Picks a free port.
3. Spawns `sqlfu serve --port <port>` in the workspace root.
4. Waits for the server to start.
5. Opens a VS Code webview pointing at the local URL.

Because VS Code webviews enforce a strict CSP that blocks local http embeds, the webview today shows a small splash page with a link to the running URL — click it to open in your browser. Embedding the full UI inside VS Code is a follow-up that needs CSP work.

## Roadmap

- CodeLens over `.sql` files: "Run against dev DB" → results pane.
- Inline type hints for `.sql` files, driven by the generated `.sql.ts` typegen artifacts.
- A "Teach SQLTools about my dev DB" one-shot command that writes the workspace `.vscode/settings.json` for the SQLTools extension, for users who prefer that UX.

PRs welcome — the core sqlfu client exposes enough already (`listMigrations`, `runMigrations`, `generate`, `diff`) to power most of the above without additional backend work.
