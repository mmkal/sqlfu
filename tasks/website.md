status: ready
size: large

# Website

## Status Summary

- Roughly 75% done: the backend move, local-server entrypoint, and website scaffold are in place.
- Main completed pieces: the UI API now lives in `packages/sqlfu`, `npx sqlfu` starts the local backend, `packages/ui` is client-only, `website/` renders existing markdown into a static docs site, and the local launcher now simulates a hosted frontend talking to a separate local backend.
- Main missing pieces: validate the localhost HTTPS path on a machine with `mkcert` installed, and add a fuller end-to-end path that exercises the website-to-local-backend story directly.

## Goal

Ship a public-facing sqlfu website plus a hosted version of the existing UI so local `npm install sqlfu` stays lightweight while users can still open a browser UI when they need it.

Current working idea:

- docs / marketing site deployed on Cloudflare at `www.sqlfu.dev`
- `local.sqlfu.dev` resolves to `localhost:3217`
- `npx sqlfu` runs the local backend that `local.sqlfu.dev` talks to
- the browser-facing API currently living in `packages/ui` moves into `packages/sqlfu`
- `packages/ui` stays a client-only bundle plus local test/dev glue that imports the backend from `packages/sqlfu`

## Why This Exists

- `packages/sqlfu` is the real product surface
- `packages/ui` is currently a local dev tool with a Node server bundled into it
- a hosted UI would make onboarding and demos much easier
- keeping the published `sqlfu` package lightweight matters
- if the UI API stays trapped inside `packages/ui`, the hosted and local stories will drift

## Decisions Made

- [x] Pick the product split. *`packages/sqlfu` owns the backend API; `packages/ui` becomes a client-only app plus test/dev scripts.*
- [x] Pick the website deployment model. *`www.sqlfu.dev` is a static docs site.*
- [x] Pick the local studio model. *`local.sqlfu.dev` points to `localhost:3217` and expects a local `sqlfu` server process.*
- [x] Decide what `npx sqlfu` should do. *Default invocation starts the local backend server for the UI.*
- [ ] Decide how polished the fallback UX should be when `local.sqlfu.dev` is opened without a working local server.

## Checklist

- [x] Extract the current UI server contract from `packages/ui` into a product-level surface owned by `packages/sqlfu`. *Implemented in `packages/sqlfu/src/ui/server.ts` and exported via `sqlfu/ui`.*
- [x] Define the minimum HTTP/API boundary needed for:
  - schema browsing
  - ad hoc SQL execution
  - migration and definitions actions
  - query catalog access
  *The ORPC router moved intact into `packages/sqlfu`, preserving the existing UI surface while changing package ownership.*
- [x] Make the UI consume that extracted API instead of importing local-only assumptions. *`packages/ui` now imports `UiRouter` and shared types from `sqlfu/ui`; the old `packages/ui/src/server.ts` was deleted.*
- [x] Decide how a local project is selected when the UI is not running inside the current Node dev harness. *Use the current working directory / configured project for the default local server, while test/dev harnesses can still provide seeded project roots.*
- [x] Create a website app/package with:
  - landing page
  - docs entry page
  - clear path into the local studio story
  *Added `website/` with a static build script, landing page, docs index, and rendered markdown pages.*
- [x] Move or rewrite the current README material into docs pages so the website is not empty on day one. *The website build renders `packages/sqlfu/README.md`, `packages/sqlfu/docs/*.md`, and `packages/ui/README.md` directly.*
- [x] Add simple deployment config/scripts for the static website. *Root `build` now runs `website/build.mjs`, and `website/package.json` exposes a standalone build script.*
- [x] Keep `sqlfu` package publish size lean.
  That likely means:
  - no shipping the website bundle inside `packages/sqlfu`
  - no coupling the CLI install path to browser assets
  *The backend now serves API plus a small HTML status page by default; frontend assets remain outside the runtime package.*
- [ ] Add an end-to-end spec for the first shipped user journey.
  Good first candidate:
  - open website
  - reach docs
  - open the local studio instructions
  - run `npx sqlfu`
  - load the local backend successfully
- [x] Add a root launcher for the `local.sqlfu.dev` dev simulation. *`pnpm local-sqlfu-dev` now starts a standalone Vite UI server, a standalone sqlfu backend server, and an `ngrok` tunnel that points only at the UI server.*
- [x] Document the local-vs-hosted model clearly so users know what runs where. *Covered in the website landing page, `packages/sqlfu/README.md`, and the local backend HTML page.*

## Recommended First Slice

The right first slice is:

- extract API from `packages/ui` into `packages/sqlfu`
- make `npx sqlfu` start the local backend on `localhost:3217`
- stand up a simple static docs site that points users to `local.sqlfu.dev`

That gives us the intended local product model without taking on remote execution, auth, or user-data hosting.

## Open Questions

- Should `local.sqlfu.dev` serve only the backend plus a helpful info page, or should it eventually also serve a production UI shell?
- Should the website build render markdown ahead of time, or is client-side markdown rendering acceptable for the first version?
- Do we want a custom local error page only in the `sqlfu` server, or also a browser-side fallback on the website when the local backend is unavailable?

## Risks

- Accidentally keeping Vite/build-tool assumptions inside `packages/sqlfu` would muddy the new backend boundary.
- If the UI still imports server-owned types from `packages/ui`, the package split will remain conceptually muddy even after the server move.
- A too-clever website pipeline would cost more than the docs content is worth right now.

## Implementation Notes

- 2026-04-16: expanded this from a rough note into a real task with explicit scope, architecture decisions, and a phased checklist.
- 2026-04-16: product decisions confirmed:
  - `packages/sqlfu` owns the backend API
  - `packages/ui` is client-only
  - `www.sqlfu.dev` is the static docs site
  - `local.sqlfu.dev` targets `localhost:3217`
  - `npx sqlfu` starts the local backend
- 2026-04-16: implemented backend move to `packages/sqlfu/src/ui/server.ts`, added `sqlfu/ui` exports, deleted `packages/ui/src/server.ts`, and switched the UI test harness to import the backend from `sqlfu`.
- 2026-04-16: `packages/sqlfu/src/cli.ts` now starts the local backend by default when invoked as `npx sqlfu`.
- 2026-04-16: added `website/` with a zero-dependency static build script that renders existing markdown into a web docs site.
- 2026-04-16: added a root `pnpm local-sqlfu-dev` launcher that now runs the UI and backend on separate ports, points `ngrok` only at the UI server, and configures the browser client to talk to the standalone backend origin.
