sqlfu.dev needs a landing page
https://orm.drizzle.team/ might be a good "how much context do people need" and "what sort of tone/messaging" inspiration

## Status

Landing page is now a single centered column: hero with tagline + one CTA,
animated `i-know-sqlfu` webp centered below, and a three-panel value grid
under "SQL first. TypeScript second." Nothing else &mdash; Local Studio
section, Quick Start aside, and the second-hero docs index are gone. Topbar
nav trimmed to Docs + GitHub.

Copy pass done through the writing-well skill: removed the nested
parens and ellipsis in the lede, tightened the generator panel ("feels like a
real library" / "keep the types honest" were vague and templated), and
nudged the diff-engine panel phrasing.

## Checklist

- [x] kick the broken `don-t-fight-the-weights.png` reference out of the hero aside _removed; aside deleted entirely in follow-up pass_
- [x] find a better home for `i-know-sqlfu.gif/webp` _dropped into a new `.showreel` figure between hero and value grid so the "I know sqlfu" / matrix joke lands as a standalone gag_
- [x] replace "Core Surfaces" copy with real value props _three panels: SQL-as-source, generated TS wrappers, diff-driven migrations; heading is "SQL first. TypeScript second." from the README philosophy_
- [x] strip the Local Studio / docs-index section _gone; topbar's Docs link + hero CTA cover it_
- [x] strip the Quick Start hero aside _gone; hero is now solo and centered_
- [x] copy pass with writing-well _applied_
- [ ] consider a small code sample panel (sample `.sql` + generated `.ts`) _drizzle uses one prominently; still a strong next addition_
- [ ] consider swapping the gif for a real local studio UI screenshot once the UI is stable

## Implementation notes

- landing page lives in `website/build.mjs` inside `renderLandingPage`; the HTML is string-built there
- styles in `website/src/styles.css`: `.showreel`, `.value-panel`, `.hero-solo`
- the gif path `/docs/assets/packages/sqlfu/docs/i-know-sqlfu.webp` is picked up
  because `packages/sqlfu/README.md` already references it; `preferWebpAsset`
  in build.mjs rewrites `.gif` → `.webp` when the webp exists on disk
- verified locally by building with `pnpm website` and loading the served dist:
  hero renders centered at ~458px tall, gif sits centered at ~704×352px, three
  value panels across the full `.site-shell` width
