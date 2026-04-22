---
status: ready
size: large
---

## New-user onboarding pass

**Status:** Grill-me interview complete (8 questions). Implementation starting.

**Completed:** Full decision tree resolved -- landing page changes, Getting Started page spec, README surgery plan, sidebar reorder, missing pages (lint plugin), deferred items (outbox), product gap task (generate-preflight), demo cross-link.

**Remaining:** All implementation items below.

---

Redesign sqlfu's docs entry point for a developer arriving from X/Twitter. The bar: within 30 seconds they know what sqlfu is and who it's for; within 3 minutes they've seen a real end-to-end workflow; within 10 minutes they know which page to click next. Main changes:

- New "Getting Started" narrative walkthrough (`posts` app, `node:sqlite`, fully runnable)
- New "Lint Plugin" docs page
- README surgery: Quick Start becomes a pointer, Capabilities tightened, "When a migration fails" moves to migration-model
- Sidebar reorder + "Overview" label for the existing sqlfu page
- Landing page: CTA + demo button + footer updates
- `/docs` redirect updated to Getting Started

---

## Checklist

### Landing page (`website/src/pages/index.astro`)

- [ ] Change primary CTA: "Read the docs" → "Get started in 3 minutes", href `/docs/sqlfu` → `/docs/getting-started`
- [ ] Update nav "Docs" link: `/docs/sqlfu` → `/docs/getting-started`
- [ ] Rename demo button: "Try the demo" → "Try in browser" (communicates no-install without extra copy)
- [ ] Update footer: "Static docs + studio for sqlfu. The studio at `/ui` talks to your local backend when `npx sqlfu` is running." → "The demo runs in your browser. Connect your own project with `npx sqlfu`."

### `website/astro.config.mjs`

- [ ] Update `/docs` redirect: `/docs/sqlfu` → `/docs/getting-started`
- [ ] Rename sidebar label "sqlfu" → "Overview"
- [ ] Add "Getting Started" entry at top of sidebar (slug: `getting-started`, link `/docs/getting-started`)
- [ ] Reorder sidebar: Getting Started → Overview → Adapters → Migration Model → Runtime validation → Dynamic queries → Generate examples → Observability → UI → Schema Diff Model

### New page: `packages/sqlfu/docs/getting-started.md`

- [ ] Filesystem diagram near top showing the final state (what files the reader will have created)
- [ ] Driver choice: `node:sqlite` with one-sentence note pointing to Adapters for other runtimes (Bun, Turso, D1, etc.)
- [ ] Narrative walkthrough, in order:
  1. `pnpm add sqlfu` + macOS/Linux note
  2. `sqlfu init` and what it scaffolds
  3. Edit `definitions.sql` (add `posts` table: `id`, `slug`, `title`, `body`, `published`)
  4. `sqlfu draft --name add_posts_table`, review the generated migration
  5. `sqlfu migrate` to apply
  6. Add `sql/get-posts.sql` query
  7. `sqlfu generate`
  8. Import and call the typed wrapper from app code (show `createClient` with `node:sqlite`, then `client.all(getPostsQuery, {limit: 10})`)
- [ ] "This is what success looks like" payoff: typed wrapper call, IDE hover showing inferred result type, one line about `name` field visible in observability
- [ ] Demo cross-link: "Open the [demo](/ui?demo=1) to see this project running in your browser -- same schema, same queries, no install."
- [ ] "Where to go next" section with reader archetypes:
  - Adapters -- need Turso, D1, Bun, or another driver?
  - Migration Model -- want to understand how migrations actually work?
  - Runtime validation -- need validated rows for tRPC or forms?
  - Generate examples -- want to see more generated type shapes?
  - UI -- want a visual interface for your database?

### New page: `packages/sqlfu/docs/lint-plugin.md`

- [ ] Intro framing: "your filename is your query's identity; the lint plugin enforces it"
- [ ] Quick setup: `...sqlfu.configs.recommended` preset (3-line code block)
- [ ] Rule: `sqlfu/query-naming` -- what it flags, why (inline duplicate loses the name, generated types, and observability metadata), the SQL First connection
- [ ] Rule: `sqlfu/format-sql` -- covers inline SQL + `.sql` files via processor, `eslint --fix` autofix
- [ ] Manual config option (for users who want to wire rules individually)
- [ ] Configuration options: `queriesDir`, `clientIdentifierPattern`
- [ ] Mention `sqlfu/sql` processor in passing: "the preset includes a processor that makes `.sql` files lintable"
- [ ] Note that this is a reference implementation pattern; users can copy the config and adjust for their conventions

### README surgery (`packages/sqlfu/README.md`)

- [ ] Add one-liner at very top before TOC: "**New to sqlfu?** Start with the [Getting Started](/docs/getting-started) walkthrough."
- [ ] Collapse Quick Start to a pure pointer: `pnpm add sqlfu` + link to Getting Started (remove filesystem diagram, step-by-step instructions, "When a migration fails" subsection, UI launch steps)
- [ ] Promote configuration fields to their own `## Configuration` reference section (the 4 required fields: `db`, `migrations`, `definitions`, `queries`)
- [ ] Move "When a migration fails" subsection to `docs/migration-model.md`
- [ ] Reorder Capabilities: Client → Migrator → Type Generator → Formatter → Observability → UI → Lint plugin → Agent skill (Diff Engine folds into Migrator summary since it powers `draft`)
- [ ] Tighten each Capabilities entry to 2-4 sentences + link to deep-dive page; capabilities with dedicated pages should not duplicate their page content
- [ ] Update TOC to match new section structure and order
- [ ] Add to `sqlfu generate` entry in Command Reference: one line noting migrations must be applied first (live DB is used for type inference; see `tasks/generate-preflight.md` for the product gap)

### `packages/sqlfu/docs/migration-model.md`

- [ ] Add "When a migration fails" section moved from README (the two-outcome failure model)

### New task: `tasks/generate-preflight.md`

- [ ] Problem statement: new user runs `generate` before `migrate`, gets hollow types silently -- no error, no warning. Live DB schema is used for type inference, so an empty DB produces empty/wrong types.
- [ ] Note solution space without prescribing: preflight check (error on pending migrations / empty live DB), warn-only mode, `--from=live|replay|definitions` flag, or something else
- [ ] Status: `needs-grilling`

### Blog draft link audit (gitignored, not committed)

The blog drafts are gitignored and can only be edited in the main repo working directory, not this worktree. Flag these links for the author to fix before publishing:

- `blog/outbox.ignoreme.md` lines 88 and 170: references `sqlfu/outbox` module and links to `https://sqlfu.dev/docs/outbox` -- module does not exist yet
- `blog/introducing-sqlfu.ignoreme.md` line 110: "An outbox. ... See the [other post](https://sqlfu.dev/blog/outbox)" -- both the module and the post are pre-ship
- `blog/introducing-sqlfu-v2.ignoreme.md` line 120: same outbox bullet -- same situation
- Links that appear valid: `/docs/adapters`, `/docs/dynamic-queries`, `/ui?demo=1`

### Em-dash verification

- [ ] Verify no em-dashes in new or changed content:
  ```sh
  grep -R '—' packages/sqlfu/docs packages/sqlfu/README.md website/src/pages website/src/starlight-overrides skills/using-sqlfu
  ```
  (Only `src/vendor/*/CLAUDE.md` em-dashes are expected; those are agent-facing vendor notes and out of scope.)

### Build verification

- [ ] `pnpm --filter sqlfu-website build` passes after all changes
- [ ] Root `README.md` regenerated by pre-commit hook (via `scripts/sync-root-readme.ts`) -- do not edit directly

---

## Out of scope

- Outbox module: not yet implemented; will get a docs page when `sqlfu/outbox` ships
- Agent skill (`skills/using-sqlfu/SKILL.md`): has no docs URLs, no change needed
- CI enforcement of em-dash rule (manual grep only, for now)
- Formatter: surface too small for its own page; stays in README Capabilities section
- `sqlfu init`: folds into Getting Started walkthrough, not a separate destination
- `src/vendor/*/CLAUDE.md` em-dashes: agent-facing vendor notes, out of scope per prior passes

---

## For the next pass

- Em-dash grep should move into CI
- `tasks/generate-preflight.md` needs grilling before implementation
- Blog drafts can only publish after outbox ships (or outbox bullets are removed from the drafts) and the site is live
- The Authority Mismatches table in `migration-model.md` still has the two-rows-same-comparison issue flagged in the 2026-04-20 passes

---

## Implementation notes

_Grill-me interview completed 2026-04-22. 8 questions covering: landing page framing (CTA change, demo button, footer, lede/eyebrow unchanged), Getting Started page (confirmed: narrative walkthrough, posts app, `node:sqlite`, filesystem diagram, success moment with demo cross-link, 5 reader-archetype "next" section), README surgery (Option A: pure pointer Quick Start, promoted Configuration section, Capabilities reordered and tightened), sidebar order (Getting Started first, Schema Diff Model last as deep-theory page, Runtime validation moved up as early-decision feature), missing pages (lint plugin gets own page; outbox deferred since module unimplemented; formatter stays README), demo architecture (fully self-contained via sqlite-wasm, no backend needed -- posts fixture matches walkthrough scenario), generate ordering bug (separate generate-preflight task, problem statement only), final items (/docs redirect updated, SKILL.md has no docs URLs so no change, em-dash hygiene, root README pre-commit hook)._
