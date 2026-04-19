---
status: needs-investigation
size: small
priority: low
---

# demo mobile bug

On iOS Chrome (tested via Claude remote-control), loading the artifact.ci
preview directly at `.../ui/index.html?demo=1` — both a fresh navigation and
a plain refresh — renders the startup-error screen with "Backend returned
404" instead of activating demo mode.

Not a priority: the demo is primarily a desktop affordance and we don't
expect many mobile users to try it.

## What we know

- Desktop Chrome: works end-to-end at the same URL. `isDemoMode()` returns
  true, `createDemoClient` is used, sqlite-wasm loads (200 from artifact.ci),
  demo renders.
- iOS Chrome, fresh `?demo=1` refresh: error page shows. Error is classified
  `client-error` with `status: 404`, which in our code only comes from a
  fetch returning HTTP 404 somewhere — `/api/rpc` on artifact.ci returns 404,
  matching the classification.
- iOS Chrome address bar correctly shows `?demo=1` after clicking the
  "Open the demo →" link from the error page.
- No service worker is registered for `mmkal/sqlfu/*` paths on artifact.ci.

## Hypotheses (none confirmed)

1. **Demo mode activates but wasm fetch 404s.** `new URL("sqlite3-XXX.wasm",
   import.meta.url)` resolves correctly on desktop (gives
   `.../ui/assets/sqlite3-XXX.wasm`). If iOS Chrome somehow resolves
   `import.meta.url` to the HTML document URL instead of the module URL, the
   wasm fetch would go to `.../ui/sqlite3-XXX.wasm` and 404. sqlite-wasm's
   Emscripten loader might surface that response-with-status-404 as an error
   with a `status` field that `classifyStartupError` picks up.
2. **`isDemoMode()` returns false despite `?demo=1` in the URL.** Would
   require `window.location.search` to be empty or
   `URLSearchParams.get('demo')` to return something other than `'1'`. Tried
   a fallback parsing `location.href`; it didn't change the outcome, so if
   this is the path, the href is also affected.
3. **iOS bfcache / page cache serving a stale render.** Would not survive a
   manual refresh, but the user reported refresh doesn't help.

## Tried and reverted

- `isDemoMode` fallback re-parsing `window.location.href` with `new URL()`.
- `TryDemoBanner` onClick calling `location.assign(absoluteURL)` instead of
  relying on the browser to resolve the `?demo=1` href.

Both shipped to `branch/demo` in commits `3da2494` and `7670876`, confirmed
not to help, reverted in a follow-up.

## Next step ideas

- Get the actual error object on iOS: add a visible diagnostic panel on the
  startup-error screen that shows `location.href`, `location.search`,
  `isDemoMode()`, and the raw error stack/status. User can screenshot.
- Pair with someone on a real iOS device to inspect via Safari web
  inspector (USB-attached Mac).
- Confirm whether the wasm URL resolves correctly at runtime on iOS by
  temporarily logging it into the DOM.
