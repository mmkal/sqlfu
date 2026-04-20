status: evergreen

Go through all of the docs and improve them. Look for inconsistencies, information being in the wrong place, and poor writing. Do a search through the whole codebase for em-dashes. Those are a good indicator that the docs are "rough" - that is, they've been written by an agent without thorough review yet. So, provide that review, and keep an evergreen

## 2026-04-20 pass

Status: plan drafted, edits pending. Scope is the 8-12 worst em-dash/rough-prose offenders in the source docs surfaces (package READMEs, `packages/sqlfu/docs/*.md`, landing page). Not touching generated sidebar (`website/src/content/docs/*`) or root `README.md`.

Inventory summary:
- ~30 em-dashes across `packages/sqlfu/README.md`, `packages/sqlfu/docs/{observability,runtime-validation,migration-model}.md`, one `&mdash;` in `website/src/pages/index.astro`.
- `docs/observability.md` intro has a grammatical slip ("as a consequence making" → missing "of") and an odd "<200 lines of code" boast that reads like agent filler.
- `docs/runtime-validation.md` opens with a triple em-dash sentence that's hard to scan; lists are dense with em-dashes where colons/periods would read cleaner.
- `docs/migration-model.md` em-dashes are mostly used for parenthetical clauses that could just be sentences; a couple ("for example because … or because it touched something", "— `Pending Migrations` is the whole point") are worth rephrasing.
- `README.md` has em-dashes in the observability + agent-skill paragraphs; both replace cleanly with periods or commas without losing meaning.
- `index.astro`'s `&mdash;` is the only HTML-entity em-dash and lives in the value-panel prose.

Plan bullets:
- [ ] `tasks/improve-docs.md`: land this plan as the first commit so the PR shows up with context. _first commit_
- [ ] `packages/sqlfu/README.md`: replace em-dashes in the observability + agent-skill paragraphs; tighten the "agent-agnostic" line. The paragraph-tail em-dashes aren't load-bearing.
- [ ] `packages/sqlfu/docs/observability.md`: fix the intro typo ("as a consequence making" → "as a consequence of making"), drop the "<200 lines of code" filler, rewrite the three bullet list at `db.query.*` as colon-separated (no em-dash), rephrase the PostHog and Datadog leads without the em-dash asides.
- [ ] `packages/sqlfu/docs/runtime-validation.md`: rewrite the opening sentence without a double em-dash, change the validator-choice bulleted list so each bullet uses a period after the name rather than " — ", dedupe the "That's the value-add" sentence so only one em-dash remains.
- [ ] `packages/sqlfu/docs/migration-model.md`: convert the em-dashes in the failure-path paragraphs to either commas or full stops; keep the meaning intact.
- [ ] `website/src/pages/index.astro`: replace `&mdash;` with a period or comma so the value-panel reads as two short sentences instead of one long one.
- [ ] Verify the docs build still renders: `pnpm --filter sqlfu-website build` after the batch.
- [ ] Update this sub-section with breadcrumb italics as items land.

Not in scope this pass:
- `docs/schema-diff-model.md` — zero em-dashes; prose is already tight. Leave for a future pass if a scan turns up something.
- `packages/ui/README.md` — short, no em-dashes, reads clean.
- `docs/migration-model.md` full rewrite of the big "Authority Mismatches" table paragraphs (prose around the table, not the table itself). Deferred — a bigger re-structure question than this pass is budgeted for.
- Any new docs pages. This pass is strictly local rewrites.
