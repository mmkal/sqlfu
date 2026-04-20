---
status: investigating
size: small
---

# artifact.ci preview breaks CSS/assets on docs pages

## Problem

When the website is served via artifact.ci preview
(`https://www.artifact.ci/artifact/view/mmkal/sqlfu/branch/<branch>/website/`),
landing page renders fine but docs pages come up unstyled. CSS, JS, and
fonts 404 in devtools.

Repro:
1. Open e.g. `https://www.artifact.ci/artifact/view/mmkal/sqlfu/branch/better-validate/website/docs/runtime-validation`.
2. Observe that `../../_astro/index.B63cd_6b.css` resolves one path segment
   too shallow.

## Root cause

Astro is configured with `build.format: 'directory'` + `trailingSlash: 'always'`.
Docs pages are emitted as `dist/docs/runtime-validation/index.html` and the
HTML hrefs assume the URL ends with `/` so that `../../_astro/...` pops back
through `docs/runtime-validation/` → `docs/` → `(website root)`.

artifact.ci **strips the trailing slash** with a 308 redirect before serving
the HTML. Observed:

```
GET /artifact/view/mmkal/sqlfu/branch/better-validate/website/docs/runtime-validation/
↓ 308
GET /artifact/view/mmkal/sqlfu/branch/better-validate/website/docs/runtime-validation
```

Once the URL no longer has a trailing slash, the browser treats the last
segment (`runtime-validation`) as a *filename* for relative URL resolution.
The base for relatives becomes `…/website/docs/`, so `../../_astro/foo.css`
resolves to `…/better-validate/_astro/foo.css` — one level above `website/`,
which 404s.

`website/scripts/make-portable.mjs` computes the `../` prefix assuming the
trailing slash survives. That assumption holds on `www.sqlfu.dev` (alchemy
+ cloudflare preserve trailing slashes) but not on artifact.ci.

## Option space

### A) Switch to `build.format: 'file'` (preferred first try)

Emits `dist/docs/runtime-validation.html` instead of
`dist/docs/runtime-validation/index.html`.

- URL with `.html`: `/…/docs/runtime-validation.html` — the `.html` segment is
  a filename to the browser, so relatives resolve against `…/docs/`.
- URL without `.html` (artifact.ci redirect to `/…/docs/runtime-validation`):
  same thing — last segment is treated as a filename, relatives still resolve
  against `…/docs/`.
- `make-portable.mjs`'s `depth` becomes 1 instead of 2 for these files, and
  the relative prefix is correct in both cases.

Risk: might break Starlight prev/next links, sidebar hrefs, sitemap, or the
`/docs` → `/docs/sqlfu/` redirect. Needs a full spot-check.

### B) Keep `directory` format; teach `make-portable.mjs` about
   non-slash URLs

Change the rewrite so each emitted href gets an extra `../` prefix to cover
the "slash stripped" case. Breaks `www.sqlfu.dev` where the slash is
preserved (would go one level too deep). Not viable without detecting the
host at runtime (which we can't do statically).

### C) `<base>` tag

Can't compute the right base statically without knowing the served URL
prefix at build time. Discarded.

### D) Patch artifact.ci (not an option — external)

## Tried

- Option A: set `build.format: 'file'` in `website/astro.config.mjs`,
  rebuild, re-check `dist/` and deploy-preview. **Result: TBD.**

## Out of scope

- Changing the `alchemy.run.mts` Cloudflare deploy. `www.sqlfu.dev` works
  today; this bug is artifact.ci-specific.
- A new CI workflow to verify artifact.ci previews for every PR. Nice to
  have but unrelated.
