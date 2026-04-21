---
status: ready-to-deploy
size: medium
---

# Retire `local.sqlfu.dev`; serve UI at `sqlfu.dev/ui`

## Short status

Implementation landed on working tree (not committed). Build verified
locally. One step left: run `pnpm deploy` and watch for errors during
Cloudflare's custom-domain transition.

## The bug

Clicking "Try the demo" on the landing page (`www.sqlfu.dev` →
`local.sqlfu.dev/?demo=1`) intermittently returned a **403 from
Cloudflare's edge** — empty body, `cf-ray` present, no firewall event
logged, neither Worker receiving invocations. Guest profiles and
incognito worked; regular Chrome got stuck. The flip-flop observed when
toggling `chrome://net-internals/#sockets` vs `#dns` (one subdomain
works, the other 403s, then vice-versa) pinned the cause:

**HTTP/2 / HTTP/3 connection coalescing.** Both hostnames were covered
by the same Cloudflare Universal SSL wildcard cert and resolved to the
same edge IPs. Chrome was allowed to reuse a connection opened for
`www.sqlfu.dev` to make requests for `local.sqlfu.dev` by just
changing the `:authority` header. Cloudflare's per-hostname Worker
router handled the misdirection incorrectly, returning 403 instead of
the HTTP-spec-correct `421 Misdirected Request`. Chrome doesn't
auto-retry on 403, so the coalesced connection stayed poisoned until
socket flush.

This affects any user whose Chrome coalesces — not a dev-only bug.

## Fix

Go single-origin. Host the UI at `sqlfu.dev/ui/` instead of a separate
`local.sqlfu.dev` subdomain. With both marketing/docs and UI on one
origin, there's nothing to coalesce — one hostname, one connection,
never any cross-Worker routing decision for CF to get wrong.

`sqlfu.dev` becomes the canonical host. `www.sqlfu.dev` 301s to it via
a CF Redirect Rule. `local.sqlfu.dev` is fully retired — no redirect,
any external links to it die (acceptable, since the UI is referenced
almost exclusively from within our own docs/site).

### Why not the other considered options

- **Merge into one Worker serving two hostnames** — fixes the bug but
  couples the two deploys. Rejected in favour of going single-origin,
  which is simpler and has the same effect with less indirection.
- **Separate root domain** (Drizzle's pattern: `drizzle.team` +
  `drizzle.studio`) — works but requires buying and managing a new
  domain. Overkill.
- **Per-hostname certs via Advanced Certificate Manager** — works but
  ~$120/yr ongoing, requires paid CF plan.

## What changed

**Infrastructure:**

- `alchemy.run.mts` — one `Website` (`sqlfu-www`) serving both
  `sqlfu.dev` and `www.sqlfu.dev` from `website/dist`. One
  `RedirectRule` 301s `www.sqlfu.dev/*` → `sqlfu.dev/${1}`.
- The old `sqlfu-local-ui` Worker and its `local.sqlfu.dev` custom
  domain will be destroyed by alchemy on next deploy.

**Build:**

- `website/scripts/sync-ui.mjs` — new script; copies `packages/ui/dist`
  into `website/dist/ui` as the final website build step.
- `website/package.json` — build command now runs
  `astro build && make-portable.mjs && sync-ui.mjs`.
- The root `pnpm build` already builds `@sqlfu/ui` before
  `sqlfu-website`, so `packages/ui/dist` exists by the time sync-ui
  runs.

**UI runtime:**

- `packages/ui/src/runtime.ts` — hostname check now matches
  `sqlfu.dev` / `www.sqlfu.dev`.
- `packages/ui/src/demo/index.ts` — `LOCAL_URL` → `HOSTED_URL` =
  `https://sqlfu.dev/ui/`.
- `packages/ui/src/client.tsx` — demo-mode banner link text "Back to
  sqlfu.dev/ui".
- `packages/ui/src/runtime.test.ts` — fixture URLs updated.
- `packages/ui/src/startup-error.ts` — comment updated.
- `packages/ui/vite.config.ts` — `allowedHosts` no longer includes
  `local.sqlfu.dev` (still has ngrok wildcards for the hosted-sim
  flow).

**CLI / backend:**

- `packages/sqlfu/src/ui/server.ts` — startup message + `allowedHosts`
  + landing HTML copy.
- `packages/sqlfu/src/cli-router.ts` — `serve` description + "sqlfu
  ready at…" message.

**Dev harness:**

- `packages/ui/test/local.sqlfu.dev.ts` → `hosted-sim.ts` (renamed).
- `packages/ui/test/local-sqlfu-dev.spec.ts` → `hosted-sim.spec.ts`
  (renamed + test name updated).
- Root and `@sqlfu/ui` `package.json` — `local.sqlfu.dev` script →
  `hosted-sim`.

**Content:**

- `website/src/pages/index.astro` — nav `Demo` link + hero "Try the
  demo" now `/ui/?demo=1`; footer copy updated.
- `website/astro.config.mjs` — `site` changed to `https://sqlfu.dev`.
- `packages/sqlfu/README.md`, `packages/ui/README.md`,
  `packages/ui/CLAUDE.md`, `skills/using-sqlfu/SKILL.md` — prose
  updates. Root `README.md` and website docs regenerated from these
  via `pnpm sync:root-readme` and the website sync-docs script.

**Tests:**

- `packages/ui/test/demo.spec.ts` — asserts "Back to sqlfu.dev/ui"
  (was "Back to local.sqlfu.dev").

## Verified locally

- `pnpm --filter @sqlfu/ui build` — clean
- `pnpm --filter @sqlfu/ui test:node` — 13/13 pass
- `pnpm --filter @sqlfu/ui typecheck` + `pnpm --filter sqlfu
  typecheck` — clean
- `pnpm --filter sqlfu-website build` — clean; `website/dist/ui/`
  populated; landing page's generated HTML references `./ui/?demo=1`

## Not yet verified (needs deploy)

- Cloudflare accepts the custom-domain transition: `local.sqlfu.dev`
  destroyed, `sqlfu-local-ui` Worker destroyed, `sqlfu.dev` attached
  to `sqlfu-www`. Brief downtime possible during the swap. Alchemy
  should do it in the right order but it's worth babysitting.
- The coalescing bug actually goes away. Fastest repro post-deploy:
  open `sqlfu.dev` in a fresh profile, immediately visit
  `sqlfu.dev/ui/?demo=1` in a new tab of the same profile. Pre-fix
  this was the repro path for the 403. Post-fix it should be boring.

## Deploy

```
pnpm deploy
```

(builds everything + runs alchemy)

## Follow-ups if this doesn't work

- If the coalescing bug somehow *still* manifests on `sqlfu.dev`
  alone, that would indicate the root cause was something else and
  this whole task needs re-investigation.
- Any old external link to `local.sqlfu.dev` will fail depending on
  DNS state. If we find those in the wild, we can add a 301 back
  later.

## Session notes (2026-04-21)

Ray ID from one failing request: `9efc43c39bae8877-LHR` — useful if we
ever want to raise a support ticket with CF about the
403-instead-of-421 behaviour.
