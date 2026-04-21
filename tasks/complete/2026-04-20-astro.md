---
status: ready
size: large
---

# Migrate website to Astro + Starlight

## Status

Spec. Implementation starts after this doc is committed in isolation.

## Why

The current `website/build.mjs` is a hand-rolled markdown-to-html build. It works, but:

- no out-of-the-box search, mobile-friendly docs chrome, prev/next links, syntax highlighting, or anchor icons
- the path-prefix-portable HTML rewrite is clever but fragile
- the navigation is one hand-rolled `<details>` element and a tiny bit of inline JS
- every new feature (e.g. "toc collapse on mobile") is bespoke code

A real docs framework gives us those features for free and keeps the build surface small.

## Decision: Astro + Starlight

Chosen over alternatives:

- **Starlight** (Astro's official docs starter): minimalist by default, theme-able via CSS variables, has pagefind search, auto sidebar, anchor links, syntax highlighting, mobile nav, prev/next, and an optional "splash" landing template. Plays nicely with a custom `src/pages/index.astro` for the hand-rolled landing page. Picked.
- Docusaurus: too React-heavy, too opinionated visually, harder to reskin to the current earthy aesthetic without fighting it.
- Nextra: tied to Next.js; Astro is lighter for a pure-static docs site.
- VitePress: fine, but Starlight is more extensible and the Astro component/content-collection story is better for repos like this where docs live across multiple packages.
- Keep hand-rolled: rejected — task explicitly asks for a real tool.

## Aesthetic: keep "motherfuckingwebsite"

The current site's visual identity must survive:

- warm beige/orange palette (`--bg`, `--accent` etc. in `website/src/styles.css`)
- serif body text, mono eyebrow labels, rounded panels with subtle shadow
- landing page hero with the giant `all you need is sql.` headline
- `i know sqlfu` showreel image
- docs pages get a sidebar (docs list + on-this-page TOC) and a "Source: …" link back to GitHub

Starlight makes this straightforward via custom CSS layered on top of its default theme, and a custom `src/pages/index.astro` for the landing page (bypassing Starlight's layout entirely for `/`).

## Routing & path portability

The dist is sometimes served under arbitrary prefixes (e.g. `/artifact/view/.../website/`). Current solution: after rendering, rewrite every `href="/…"` / `src="/…"` to a relative path based on the file's depth.

Plan: keep the same post-build step. Astro emits absolute `/` paths by default when `site` is set; after `astro build`, run a small `scripts/make-portable.mjs` that walks `dist/**/*.html` and applies the same rewrite. This is robust, independent of the framework, and matches existing behaviour.

(Astro's own `base` config requires a fixed prefix at build time and doesn't solve the runtime-unknown-prefix case. `build.assetsPrefix` doesn't help either. A post-build rewrite is the right tool.)

## Docs content sourcing

Docs live outside `website/`:

- `packages/sqlfu/README.md` → slug `sqlfu`
- `packages/sqlfu/docs/schema-diff-model.md` → slug `schema-diff-model`
- `packages/sqlfu/docs/migration-model.md` → slug `migration-model`
- `packages/sqlfu/docs/observability.md` → slug `observability`
- `packages/ui/README.md` → slug `ui`

Approach: a small `scripts/sync-docs.mjs` that runs before `astro build`:

1. reads each source `.md`
2. prepends Starlight frontmatter (`title`, `description`)
3. rewrites inter-doc relative links (e.g. `./docs/observability.md` → `/docs/observability/`)
4. rewrites image `src` and copies assets into `public/docs/assets/<repo-path>/…`, preferring `.webp` over `.gif`
5. writes the result into `src/content/docs/<slug>.md`

Links that point outside the docs set (to repo source files) become GitHub permalinks at the current git SHA — matching current behaviour.

Sync outputs are gitignored (`src/content/docs/*.md` except an `index.mdx` / `404.md` we author directly; `public/docs/assets/` generated).

## Landing page

`src/pages/index.astro` owns `/`. Hand-rolled, minimal, imports `src/styles/site.css`. The HTML is ported from the current `renderLandingPage` output in `build.mjs`.

Starlight only renders under `/docs/*`.

## Deliverables checklist

- [x] scaffold Astro + Starlight under `website/` _astro 5 + starlight 0.37, no integration scaffold; wrote config by hand_
- [x] port `website/src/styles.css` into Astro's custom-css layer + site.css for the landing page _custom.css for Starlight, landing.css for src/pages/index.astro_
- [x] write `scripts/sync-docs.mjs` (link rewriting, asset copying, frontmatter prepending) _sync-docs.mjs; strips leading h1 since Starlight renders title from frontmatter_
- [x] configure Starlight sidebar with the five existing docs _slugs under docs/ so URLs are /docs/<slug>/_
- [x] landing page at `src/pages/index.astro` _hand-rolled, bypasses Starlight_
- [x] post-build `scripts/make-portable.mjs` that replicates the path-prefix rewrite _walks dist/**/*.html and rewrites absolute hrefs/srcs_
- [x] update root `package.json` scripts _`build:website`, `build`, `website` all point at pnpm --filter sqlfu-website; `website` now runs dev server_
- [x] add `website` to pnpm workspace _added to pnpm-workspace.yaml_
- [x] delete `website/build.mjs` _done; old src/styles.css also removed_
- [x] verify `alchemy.run.mts` still works _no changes needed; it runs `pnpm build` in ./website and reads ./dist_
- [x] visually spot-check `dist/` _index.html, all five docs pages, i-know-sqlfu.webp present, absolute paths rewritten to relative_
- [x] custom "Source: …" link in each docs page pointing at the GitHub permalink _via src/starlight-overrides/PageTitle.astro reading sourceUrl/sourcePath frontmatter injected by sync-docs.mjs_

## Implementation log

- Starlight's official export map doesn't expose `./constants`, so `PAGE_TITLE_ID = '_top'` is inlined in the PageTitle override. Low-risk since it's a public HTML id and unlikely to churn.
- Starlight's theme selector (Dark/Light/Auto) is left enabled even though the source site is single-themed. Low-cost to keep; if it looks bad we can drop it in the config.
- `/docs/` redirects to `/docs/sqlfu/` via astro's `redirects` config.
- The README's top-of-page manual anchor TOC renders under the Starlight TOC. Mildly redundant but harmless; fixing it would require a sync-docs pass that strips the top bullet block from the sqlfu README specifically, which is more surgery than bedtime warrants.

### Dark mode (follow-up)

Shipping a real dark mode across landing + docs. Previously `custom.css` had a `:root[data-theme='light'], :root[data-theme='dark']` block that forced the same light palette on both, making Starlight's toggle a no-op. That override is deleted.

Design decisions:

- **Shared mechanism.** Both surfaces key off `:root[data-theme='dark']`. Starlight already owns the "read localStorage + apply `data-theme` to `<html>`" script; the landing page reuses it verbatim (inlined `<script is:inline>` in `<head>`) so clicking Starlight's toggle on a docs page and navigating back to `/` shows the chosen theme with no flash.
- **Default = auto.** `prefers-color-scheme` wins when no `starlight-theme` key is set. Matches Starlight's default behaviour; no UA sniffing.
- **Landing toggle.** Sun/moon unicode glyph button in the landing header, cycling light → dark → auto. Writes the same localStorage key Starlight writes. No framework, no deps, no icon library.
- **Dark palette.** Warm-sepia night mode, not generic "inverted". Base `#1a1410`, surface `#211912`, text `#f0e6d6`, muted `#b5a58f`, accent `#e89b66` (lighter than the light-mode deep brown-orange so it has enough contrast on the dark base). Targets 4.5:1+ for body text.
- **Showreel image.** WebP of a text UI; full-on invert would look wrong. Apply a subtle `filter: brightness(0.88) contrast(0.95)` in dark mode to take the glare off, no hue shift.
- **Code block.** Already a dark `#20140f` in light mode (intentional, part of the aesthetic); in dark mode lift it slightly to `#15100c` so it still reads as "deeper than the page" without being black-on-black.

## Non-goals (this PR)

- client-side search: Starlight ships pagefind; leave default on.
- dark mode: Starlight provides one, but the current site is single-themed. Default to light only (or leave Starlight's toggle — TBD during impl).
- full design parity with every pixel of the current site: the goal is "unmistakably the same aesthetic", not a CSS-perfect port.

## Notes

If Starlight's splash page covers the landing page needs well enough that a custom `src/pages/index.astro` is overkill, prefer splash. But don't bend the content to fit the template — the `all you need is sql.` hero is the product's identity.
