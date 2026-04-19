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

- [ ] scaffold Astro + Starlight under `website/` (keep existing folder)
- [ ] port `website/src/styles.css` into Astro's custom-css layer + site.css for the landing page
- [ ] write `scripts/sync-docs.mjs` (link rewriting, asset copying, frontmatter prepending)
- [ ] configure Starlight sidebar with the five existing docs (order: sqlfu, schema-diff-model, migration-model, observability, ui)
- [ ] landing page at `src/pages/index.astro`
- [ ] post-build `scripts/make-portable.mjs` that replicates the path-prefix rewrite
- [ ] update root `package.json` scripts: `pnpm build:website`, `pnpm website` still work; prefer `pnpm --filter sqlfu-website build` too
- [ ] add `website` to pnpm workspace (so workspace filters work; right now it's a standalone package)
- [ ] delete `website/build.mjs` once Astro equivalent renders correctly
- [ ] verify `alchemy.run.mts` still works — its `Website('www', ..., cwd: './website', build: 'pnpm build', assets: './dist')` config should just work since Astro also outputs to `./dist`
- [ ] visually spot-check `dist/`: index.html, `docs/sqlfu/index.html`, `docs/observability/index.html`, asset present at `docs/assets/packages/sqlfu/docs/i-know-sqlfu.webp`
- [ ] custom "Source: …" link in each docs page pointing at the GitHub permalink (Starlight supports an `editUrl` + custom components; or a small `<SourceLink>` component rendered from frontmatter)

## Non-goals (this PR)

- client-side search: Starlight ships pagefind; leave default on.
- dark mode: Starlight provides one, but the current site is single-themed. Default to light only (or leave Starlight's toggle — TBD during impl).
- full design parity with every pixel of the current site: the goal is "unmistakably the same aesthetic", not a CSS-perfect port.

## Notes

If Starlight's splash page covers the landing page needs well enough that a custom `src/pages/index.astro` is overkill, prefer splash. But don't bend the content to fit the template — the `all you need is sql.` hero is the product's identity.
