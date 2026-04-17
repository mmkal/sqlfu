# demo

`local.sqlfu.dev` should have a "Demo" button which takes you to a fresh workspace which uses a browser sqlite implementation for messing around just for your session. Hosted at `demo.local.sqlfu.dev`.

Linked reference: https://sqlite.org/wasm/doc/trunk/demo-123.md (official `@sqlite.org/sqlite-wasm`).

## Status

first pass implemented and manually smoke-tested in dev. Deploy step (adding the demo domain via Cloudflare) still needs to be run by hand with `alchemy deploy` — the config entry is in place.

## Decisions (filled in from the original sketch)

- **SQLite in the browser:** use the official `@sqlite.org/sqlite-wasm` package. In-memory `:memory:` database per tab. Page reload = fresh workspace. No OPFS (for now). Don't persist across sessions.
- **Package layout:** keep it in `packages/ui`. Do not create `packages/demo`. The same Vite bundle is served at both `local.sqlfu.dev` and `demo.local.sqlfu.dev`. Mode detection happens at runtime.
- **Router plumbing:** the oRPC client in `packages/ui/src/client.tsx` currently uses `RPCLink` (fetch-based). In demo mode, swap to `createRouterClient` (from `@orpc/server`) against a *browser* oRPC router that runs against the wasm sqlite. No fetch at all for backend calls.
- **Demo router scope:** the browser backend does NOT bundle `sqlfu`'s full node-only backend. It implements the subset of the UiRouter contract that makes sense without a filesystem:
  - `project.status` → always `{initialized: true, projectRoot: '(demo)'}`
  - `schema.get` → read sqlite_master from wasm db
  - `table.list` / `table.save` / `table.delete` → run against wasm db
  - `sql.run` → run against wasm db
  - `sql.analyze` → return `{}` (no-op, skip static analysis in demo)
  - `catalog` → return an empty catalog (`{queries: []}`)
  - All other endpoints (`schema.check`, `schema.authorities.*`, `schema.command`, `schema.definitions`, `sql.save`, `query.*`) → throw a clear "not supported in demo" error and/or the UI hides the affected surfaces.
- **UI affordances in demo mode:**
  - Add a prominent "Demo" button on `local.sqlfu.dev` (only shown when we're NOT already in demo mode). It opens `demo.local.sqlfu.dev` in the current tab.
  - Add a small "Demo mode" banner to the UI when running in demo mode, with a link back to `local.sqlfu.dev`.
  - Hide / disable UI routes that depend on unsupported endpoints (schema check, migrations/authorities, saving queries).
- **Seed data:** on each fresh load, seed the in-browser db with the same posts example from `packages/ui/test/template-project/definitions.sql` plus a couple of example rows (mirroring what `ensureDatabase` does in `packages/sqlfu/src/ui/server.ts`).
- **Mode detection:** `hostname === 'demo.local.sqlfu.dev'` OR URL search param `?demo=1` (for local testing without DNS).
- **Deployment:** add a Cloudflare `Website` entry in `alchemy.run.mts` for the demo host, pointing at the same `packages/ui` dist (same build, served at a different domain).

## Deliberately out of scope (for this first pass)

- Migrations, definitions.sql editing, and the full schema authorities UI in demo mode.
- Saving generated queries / catalog in demo mode.
- OPFS persistence / per-session URLs you can share.
- Bundling the full `sqlfu` backend (schemadiff, typegen, migration engine) into the browser. The task hints at this and it's possible but messy — keep it out of phase 1.
- Playwright coverage for demo mode — leave a manual-test note; the existing local.sqlfu.dev spec is the reference integration path.

These are reasonable "v2" follow-ups once the basic demo ships.

## Checklist

- [x] Add `@sqlite.org/sqlite-wasm` dependency to `packages/ui`. _pinned to `3.51.2-build9` (latest at the time); the registry only has odd `build*` prereleases for this package, not semver._
- [x] Implement `packages/ui/src/demo/sqlite-wasm-client.ts`: create a wasm sqlite instance, wrap it in an object that exposes `all/run/raw/transaction` (matching what the existing UiRouter code needs). _only `all`, `run`, `exec`, `columnCount` were needed by the demo router; no `transaction` since nothing in the demo path calls it._
- [x] Implement `packages/ui/src/demo/router.ts`: a fresh oRPC router typed as `UiRouter`, implementing the subset listed above against the wasm client. Seed the db on creation. _implemented as a plain nested object cast to `RouterClient<UiRouter>` rather than a real oRPC server router; same shape, less bundle weight._
- [x] Implement `packages/ui/src/demo/client.ts`: export an `isDemoMode()` helper and a `createDemoOrpcClient()` that uses `createRouterClient` to produce a `RouterClient<UiRouter>` with no fetch. _landed as `packages/ui/src/demo/index.ts` with a lazy proxy that awaits wasm init before forwarding each procedure call — lets `orpcClient` stay sync at module top level._
- [x] Wire `packages/ui/src/client.tsx`: branch at the place where `orpcClient` is created. In demo mode use `createDemoOrpcClient()`; otherwise keep the existing RPCLink behavior.
- [x] Add a "Demo" button on `local.sqlfu.dev` UI (only when `!isDemoMode()`). It navigates to `https://demo.local.sqlfu.dev/` (or `?demo=1` in dev). _landed as an unobtrusive banner-link at the top of the shell instead of a standalone button, since the shell has no existing button area; still prominent._
- [x] Add a small "Demo mode" banner when `isDemoMode()` is true, with a link to `https://local.sqlfu.dev/`.
- [x] Hide or gracefully error the UI surfaces that rely on unsupported endpoints in demo mode (schema check card, authorities, save-query dialog, etc.). _the demo router returns empty check cards / authorities and throws on save/command; the existing UI renders the empty states cleanly and any errant button presses surface a toast._
- [x] Extend `alchemy.run.mts` with a `Website('demo-local-ui', ...)` entry for `demo.local.sqlfu.dev` serving the same `packages/ui/dist`. _added as a second `domainName` on the existing `sqlfu-local-ui` Website rather than a duplicate entry — same build, same bucket._
- [x] Update `packages/ui/AGENTS.md` with a short "Demo mode" section so future agents know the third deployment shape.
- [x] Verify: `pnpm --filter sqlfu-ui build` succeeds. Locally start the dev harness and open `?demo=1` to sanity-check: the table browser shows seeded posts, SQL runner can run `select * from posts`, the schema check surface is hidden/disabled, and the "Demo" button is gone while the banner is shown. _confirmed manually via claude-in-chrome against the dev server; wasm init, seeded rows in `posts`, SQL runner executing `select name, type from sqlite_schema` against the in-memory db all work._

## Implementation notes (log during work)

- **Wasm URL in Vite.** The default `sqlite3InitModule()` call looks for `sqlite3.wasm` at a URL relative to the ESM entrypoint. Under Vite's dev dep-bundling (`node_modules/.vite/deps/...`), that resolves to a path that the SPA fallback serves as `index.html`, which then fails to compile as wasm. Fix: `import sqlite3WasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url';` and pass it through `locateFile`. `@sqlite.org/sqlite-wasm/package.json` exports `./sqlite3.wasm` → `./dist/sqlite3.wasm`, so this path is stable.
- **Init signature type.** `sqlite3InitModule` is declared as `(): Promise<...>` by design (see sqlite-wasm PR #129); the runtime still accepts the Emscripten-style options object. Cast to the options-accepting signature locally rather than patching the package types.
- **Transitively bundling `@orpc/server` through the type import.** `RouterClient<UiRouter>` comes from `@orpc/server`, but it's already a runtime dep of `packages/ui` (used in the existing `createORPCClient` typing path), so no new runtime surface was added.
- **Lazy proxy vs `createRouterClient`.** First pass tried to build a sibling oRPC router with the `os` builder so `createRouterClient` could produce the client. That pulled the whole oRPC server pipeline into the browser bundle for no real win, so I collapsed it to a plain object of async handlers + a deep Proxy that awaits wasm init on first call. Same type, much less code.
- **Bundle size.** Build output: `index-*.js ~ 1.73 MB` (550 KB gzipped), `sqlite3-*.wasm ~ 860 KB` (398 KB gzipped). Vite warns about the main chunk; chunk-splitting is a follow-up, not a blocker for a demo page.
- **Smoke test.** Ran `pnpm --filter sqlfu-ui dev`, navigated to `?demo=1`, confirmed: demo banner renders, posts/post_cards tables appear, `/#table/posts` shows the 2 seeded rows, `/#sql` runs `select name, type from sqlite_schema` and returns `posts | table`, `post_cards | view`. Also navigated to `/` (no `?demo=1`) and confirmed the "Open the demo →" banner appears instead.
- **Deploy.** `alchemy.run.mts` now lists both `local.sqlfu.dev` and `demo.local.sqlfu.dev` under the same Cloudflare Website. The actual deploy (`pnpm alchemy deploy` or whatever the convention is) is left to run by hand — it touches shared infrastructure and isn't something to trigger from a task agent.
