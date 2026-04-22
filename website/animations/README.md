# sqlfu website animations

Remotion 4.x compositions for the landing page.

The default landing page ships no animation. Animations are opt-in via
`?animation=<name>`:

- `?animation=sequential` — the main animated treatment. A single
  1280x720 stage that plays all three beats (schema, generate, draft)
  end-to-end over 28s. Composition: `anim-sequential`.
- `?animation=a|b|c|d` — the original three-panel alternatives.
  Each card in the value-panel grid gets a dedicated video:
  - `alt-a-*` — single-card showreel (all three beats in one panel)
  - `alt-b-*` — terminal-first: everything through the CLI transcript
  - `alt-c-*` — diff-centric: the animation is the diff between two files
  - `alt-d-*` — playful: heavy spring animations, bouncy energy

Also available in the studio as reference material:

- `anim-1-schema` — schema refactor in `definitions.sql` (10s, beat 1 only)
- `anim-2-generate` — `.sql` to generated `.sql.ts` (10s, beat 2 only)
- `anim-3-draft` — edit schema, `sqlfu draft`, migration lands (10s, beat 3 only)

## Commands

```sh
# Live-edit compositions
pnpm studio

# Render every composition to website/public/assets/animations/
pnpm render

# Render a single composition (fast iteration)
pnpm render anim-sequential

# Render specific frames as stills for eyeballing (outputs to /tmp)
pnpm tsx scripts/sample-stills.ts anim-sequential 60 160 260 460 580 830
```

Rendered outputs land in `website/public/assets/animations/<name>.webm`,
`<name>.mp4`, `<name>.poster.jpg`. Astro serves `public/` at the site root,
so the landing page loads them from `/assets/animations/` at build time.

## Fixtures

The SQL fixtures in `src/fixtures.ts` are verbatim output from running
`sqlfu generate` and `sqlfu draft` against a tiny users/posts project
(see the header comment in `src/fixtures.ts` for provenance). If the
generator output format changes substantively, re-run those commands
by hand and paste the new output into the fixture file.
