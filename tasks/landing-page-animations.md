status: ready
size: medium

# Landing-page animations

## Status

Planning only. No implementation yet. Three value panels on `sqlfu.dev` are
currently static text; we want each to get a short looping animation that
dramatizes the concept the copy describes.

## Goal

Replace the bodies of the three value panels on the landing page with
animated cards. Keep the three-card structure, keep the current themes
(source of truth / types generated / diff-driven migrations). Each card
gets its own short, self-contained, looping animation.

## Decisions

- **Keep three cards.** Same themes as today: source of truth, types
  generated, diff-driven migrations. Headings/copy may tighten but the
  direction stays.
- **Three independent autoplaying loops**, not one sequential showreel.
  Lower stakes if one fails to load; each card is a self-contained
  explainer.
- **Pre-rendered video** (webm + mp4 fallback), embedded as
  `<video autoplay loop muted playsinline preload="metadata">`. Small on
  the wire, crisp on retina, no JS runtime cost beyond the page itself.
  Inline DOM animation (Remotion `<Player>` or Framer Motion) can come
  later if we want scroll-scrubbing or interactivity.
- **Author in Remotion.** React-based, renders through headless Chrome,
  mature support for code typing/diffing. Same source can be re-used if
  we later want an inline `<Player>` version.
- `prefers-reduced-motion`: skip autoplay, show the video's poster frame
  (last frame of the loop is fine).

## The three animations

Each clip target: **~6–10s loop, ~1280×720**, muted, no audio track.
Dark theme matching the site. Keep identifiers realistic — a `users` /
`posts` app-developer schema is fine and familiar.

### 1. "Source of truth" — schema refactor in `definitions.sql`

Single panel, titled `definitions.sql` like an editor tab.

Beat sheet (approximate):

1. Type out `create table users (id integer primary key, name text);`.
2. Pause half a beat. Cursor drops to a new line, type
   `create table posts (id integer primary key, author_name text, content text);`.
3. The refactor moment: cursor jumps back inside `posts`, deletes
   `author_name text` (show it highlight-then-vanish), replaces it with
   `author_id integer references users(id)`. This is the beat that
   separates sqlfu from "just write a schema file once" — you edit SQL
   like you edit any other code.
4. Optionally: add `created_at datetime default current_timestamp` to
   `users`. Keep this beat only if the earlier ones feel rushed.
5. Hold final state, then loop.

Message: your schema is just SQL in one file. Edit it like code. There is
no DSL to fight, no intermediate object model.

Variant to consider if the FK refactor is too busy: start with
`users(id, name)`, add `email text not null`, then add a `unique` index.
Simpler, still a familiar app-dev moment.

### 2. "Types, generated" — `.sql` → `.sql.ts`

Two panels side by side.

Beat sheet:

1. Left panel appears with `sql/user-by-id.sql`:
   ```sql
   select id, name, email
   from users
   where id = :id;
   ```
2. Small terminal strip briefly flashes `$ sqlfu generate`.
3. Right panel materializes `sql/.generated/user-by-id.sql.ts` with the
   typed wrapper — the exact shape should mirror what `sqlfu generate`
   actually emits today (check `packages/sqlfu/src/generator` or a real
   generated file in the repo before picking a final shape). Params and
   row types should be visibly derived from the SQL on the left.
4. Payoff beat: cursor dips into a third tiny pane titled `app.ts`
   showing `await client.execute(userById, {id: 1})`. An autocomplete
   popover lists `.id`, `.name`, `.email`. This is the "oh, for free?"
   moment that sells it.
5. Hold, then loop.

Message: you write SQL, sqlfu reads your SQL, TypeScript follows. The
types aren't hand-written and aren't approximate.

### 3. "Diff-driven migrations" — edit → draft → new file

Three zones in one frame: left is `definitions.sql`, bottom is a
terminal, right is a `migrations/` file tree.

Beat sheet:

1. Initial state: `definitions.sql` shows `users(id, name)` and the
   tree shows `migrations/0001_init.sql`.
2. Cursor edits `definitions.sql` to add a column (e.g.
   `email text not null`). Highlight the added line.
3. Terminal types `$ sqlfu draft`.
4. A new file `migrations/0002_add_email.sql` pops into the tree. Panel
   briefly opens the file to show something like
   `alter table users add column email text not null default '';`. The
   exact SQL should come from running the real command so the animation
   is honest.
5. Hold, then loop.

Message: you declare the end state; sqlfu writes the migration. You
still review and commit — this is a drafting tool, not magic.

## Alternatives

It's very likely that you won't be able to use the above beat sheets to produce anything good. After you're done, come up with at least four alternative combinations of cards. There can of course be overlap, but if there's anything you think I *might* prefer as a combination-of-cards, the best way for me to figure that out is to SEE IT! So, after you're done with Animations 1-3, do the alternatives, and make the alternatives available via a query param or something (no need for a link or button, but make it so if I know about them I can do `animation_alternative=a` or `animation_alternative=b` or `animation_alternative=c` or `animation_alternative=d`).

## Copy direction for the cards

Headings can get tighter now that the animation carries meaning. Rough
direction (iterate during implementation):

- **source of truth** — "Schema lives in SQL." (animation does the rest)
- **types, generated** — "Types follow SQL."
- **diff-driven migrations** — "Migrations draft themselves."

Paragraph under each can shrink to one sentence since the animation is
doing the heavy lifting.

## Technical plan

### Tooling

- **Remotion** for authoring. Renders React compositions to webm/mp4
  through headless Chrome. Primitives (`interpolate`, `spring`,
  `Sequence`, `AbsoluteFill`) fit this kind of timed code-editor work
  well. Re-verify it's still the best choice at implementation time —
  this plan was written assuming Remotion is current.
- Code rendering: Remotion has code-highlighting helpers
  (`@remotion/shiki` / `@remotion/code-highlighter`). For "typing" a
  file, animate a character-index cursor and re-highlight each frame.
- Output: render both `webm` (vp9) and `mp4` (h264) for
  compatibility; use a poster frame as the `prefers-reduced-motion`
  fallback.

### Where it lives

- New Remotion project under `website/animations/` (its own
  `package.json` in the workspace is fine; keep the landing page build
  independent).
- Rendered outputs land in `website/src/assets/animations/` (or
  wherever `build.mjs` can pick them up) and ship as real static files.
- Landing page in `website/build.mjs` (`renderLandingPage`, currently
  around line 162) updates the three `.value-panel` bodies to wrap
  each heading/copy alongside a `<video>` tag.

### Accessibility / perf

- `playsinline`, `muted`, `autoplay`, `loop`, `preload="metadata"`.
- Provide a still `poster` image for the `prefers-reduced-motion` case.
- CSS media query `@media (prefers-reduced-motion: reduce)` should drop
  `autoplay` — either swap the `<video>` for an `<img>` at the poster
  frame, or leave the video but remove `autoplay`.
- Target each clip under ~400KB. Short loops at 720p should hit that.
- Lazy-load: `loading="lazy"` isn't a thing on `<video>`, so use an
  IntersectionObserver to pause panels that aren't on screen. Minor
  optimization; skip until we see it matter.

## Checklist

- [ ] Verify Remotion is still the right tool (check that
      `@remotion/code-highlighter` or equivalent is current; a quick
      alternative scan of anything better that shipped in the last 6–12
      months is worth the time).
- [ ] Scaffold `website/animations/` as a small Remotion project.
- [ ] Pick final schema/query fixtures for each animation (ideally run
      real `sqlfu generate` / `sqlfu draft` against a tiny fixture
      project and copy the outputs verbatim so the animations are
      honest).
- [ ] Build animation 1 (schema refactor in definitions.sql).
- [ ] Build animation 2 (SQL → generated .sql.ts + autocomplete beat).
- [ ] Build animation 3 (edit → `sqlfu draft` → new migration file).
- [ ] Alternative A for animations 1-3
- [ ] Alternative B for animations 1-3
- [ ] Alternative C for animations 1-3
- [ ] Alternative D for animations 1-3
- [ ] Review pacing end-to-end with the user before rendering finals —
      pacing is where these clips live or die.
- [ ] Render webm + mp4 + poster frame for each.
- [ ] Wire three `<video>` panels into `renderLandingPage` in
      `website/build.mjs`; update the headings/copy per the direction
      above.
- [ ] `prefers-reduced-motion` fallback verified.
- [ ] Eyeball on mobile — ensure videos don't blow past the card width
      and that autoplay works on iOS Safari (requires `playsinline`
      and `muted`).
- [ ] Lighthouse quick check — we don't want these clips tanking the
      landing page's perf score.

## Open questions

- Code surface aesthetic: match the terminal/dark site look, or go for
  a clean neutral code-editor look à la drizzle.team? (Probably match
  the site; decide during animation 1.)
- Aspect ratio per card: 16:9 vs something closer to square? Depends on
  how the `.section-grid` wraps on mobile. Check the current CSS
  (`website/src/styles.css`, `.value-panel`) and pick accordingly.
- Should the autocomplete popover in animation 2 be rendered or skipped
  if it gets too fiddly? It's the best beat but also the hardest to
  fake convincingly.

## Research notes

### Remotion (primary candidate)

- React-based video framework. Write compositions as React components
  using primitives like `Sequence`, `AbsoluteFill`, `interpolate`,
  `spring`, `useCurrentFrame`. Render via `npx remotion render` (uses
  headless Chrome).
- Targets webm/mp4/gif/png-sequence. Good fit for code-heavy scenes.
- Has first-party helpers for code: `@remotion/shiki` and/or
  `@remotion/code-highlighter` for syntax-highlighted, animatable code
  surfaces. Also has a "diff" pattern that's been written up multiple
  times in their docs/blog — useful for the migration beat.
- Can also be embedded live via `<Player>` if we later want inline/
  interactive playback. Same composition source.
- License: source-available with a commercial license required for
  teams over a threshold — sqlfu is an open-source project so this is
  almost certainly fine, but double-check before we rely on it for
  anything monetized.

### Alternatives considered

- **Framer Motion + CodeMirror / Monaco.** Inline DOM, smallest bundle
  impact, real editor behind it. Wins if we ever want interactivity.
  Loses on pacing orchestration for multi-beat sequences — Remotion's
  frame-indexed model is much easier to reason about.
- **Motion Canvas.** TypeScript, canvas-based, strong at code-heavy
  animation. Viable alternative; the project's momentum vs. Remotion
  should be checked when implementing.
- **Asciinema / terminalizer.** Good for the terminal beat in
  animation 3, but useless for the side-by-side file transitions in
  animations 1 and 2. Not worth mixing two tools.
- **Pure CSS keyframes / SVG SMIL.** Fine for a single typing line;
  painful for three-beat sequences with dependent timing. Skip.

### References worth looking at

- drizzle.team — pacing reference for code-heavy landing animations.
- Prisma/tRPC docs pages — how they sell "types follow X" visually.
- Remotion's own showcase page for code-typing references.
