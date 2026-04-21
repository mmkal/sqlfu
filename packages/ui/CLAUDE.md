# `sqlfu.dev/ui` explainer

This package is the browser client for sqlfu. The intended product model is inspired by `local.drizzle.studio`, but there are two different modes in this repo and it is easy to confuse them.

## The intended product model

The real target architecture is:

- a hosted UI shell at `https://sqlfu.dev/ui`
- a local sqlfu backend started by the user, typically via `npx sqlfu`
- the hosted UI talks from that public HTTPS origin back to the user's localhost sqlfu backend

That is the same basic idea as `https://local.drizzle.studio`:

1. the browser loads a real hosted website
2. that website's frontend JS talks to a local server on the user's machine
3. the local server talks to the user's database and files

The hosted UI lives under the `/ui` path on the same origin as the marketing + docs site (`sqlfu.dev`). Putting everything on one origin avoids the HTTP/2 / HTTP/3 connection-coalescing bug that the previous `local.sqlfu.dev` sibling subdomain triggered — see `tasks/complete/*retire-local-subdomain*.md` (filename varies with landing date) for the history.

Important: the `/ui` part is not a DNS trick. The browser loads real hosted HTML at `https://sqlfu.dev/ui/`. The "local" part is the follow-up API traffic from the hosted frontend to the localhost backend.

## Why this needs special handling

Modern browsers treat "public HTTPS page talks to localhost" as a special case.

- Chrome / Chromium usually show a "local network access" permission prompt
- Safari and Brave are stricter and may require localhost HTTPS with `mkcert`
- the local backend needs the right CORS and private-network headers

That is why the sqlfu backend in `packages/sqlfu` owns:

- the UI RPC API
- localhost HTTPS / `mkcert` support
- the CORS / private-network behavior

## Repo-local dev/test modes

There are two relevant modes here.

### 1. Normal UI tests and dev harness

`packages/ui/test/start-server.ts` is the default Playwright `webServer`.

It starts one integrated local server that serves:

- the Vite UI
- the local backend API

This is the general-purpose harness for normal UI development and most UI tests. It is not trying to simulate the hosted/public split exactly. It is the convenient "everything local" path.

### 2. Hosted-UI simulation

`pnpm hosted-sim` is the more realistic simulation.

It starts:

- one local sqlfu backend server on `56081`
- one local Vite UI server on `3218`
- one `ngrok` tunnel pointed only at the UI server

So the browser sees:

- public HTTPS for the UI via `ngrok`

while the UI itself talks to:

- the separate local backend origin

This is much closer to the eventual `sqlfu.dev/ui` product model.

In test coverage, this behavior is intentionally an extra spec layered on top of the normal harness:

- `packages/ui/playwright.config.ts` still uses `test/start-server.ts`
- `packages/ui/test/hosted-sim.spec.ts` covers the extra `ngrok` piece

That split is deliberate. The hosted-UI scenario is one important integration path, not the default shape for every UI test.

## Package export conventions

This repo uses source-first workspace exports for local development, with publish-time `dist` exports in `packages/sqlfu/package.json`.

That means:

- repo-local imports like `import {startSqlfuServer} from 'sqlfu/ui'` should resolve to source
- published `sqlfu` still resolves to built `dist` files

There are also browser-safe entrypoints to avoid pulling Node-only code into Vite:

- `sqlfu/browser`
- `sqlfu/ui/browser`

Use those from browser code when you only need browser-safe helpers or types.

Use these from Node-side code:

- `sqlfu`
- `sqlfu/ui`

## Practical rule of thumb

If you are working on:

- normal UI behavior, use the integrated harness and normal UI tests
- hosted-frontend-to-localhost behavior, think in terms of the hosted-UI simulation and the separate ngrok spec
- localhost certs / CORS / private-network issues, those belong in `packages/sqlfu`, not in the UI package

## Demo mode (`?demo=1`)

The same `packages/ui` bundle runs in demo mode when `?demo=1` is in the URL. In demo mode the UI runs fully in the browser against an in-memory SQLite database via `@sqlite.org/sqlite-wasm` — there is no backend at all.

- Mode detection: URL search param `?demo=1`.
- See `src/demo/` for the wasm client, the in-browser router implementation, and the mode helpers. The in-browser router is typed as `RouterClient<UiRouter>` so `client.tsx` can consume it interchangeably with the normal fetch-based oRPC client.
- Only the subset of `UiRouter` that makes sense without a filesystem is implemented: `project.status`, `schema.get`, `table.*`, `sql.run`, `sql.analyze` (no-op), `catalog` (empty). Other procedures throw a "not available in demo mode" error.
- Because demo mode is pure static assets with no backend, the built `dist/` can be hosted anywhere — the `deploy-ui` workflow uploads it as a GitHub Actions artifact so `artifact.ci` can serve PR previews. `vite.config.ts` sets `base: './'` to keep asset paths relative for that case.
