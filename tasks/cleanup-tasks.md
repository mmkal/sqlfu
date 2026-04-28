status: evergreen

Sometimes agents forget to move their task files to "done". Look at recent commits and see if that's happened. If it has, open a housekeeping PR to do just that. While you're there, you can also add to Implementation Notes if there's anything you spot in the change that wasn't tidied up properly that also wasn't documented in the task file.

Make sure local worktrees are cleaned up too.

## 2026-04-20 pass

Branch: `cleanup-tasks-2026-04-20`.

Survey state at the start of the pass:
- 5 PRs still open from tonight's bedtime: #16 devtools, #31 ci-report-package-size, #32 drop-antlr, #33 api-extractor, #34 typesql-ddl-support. Each PR branch already moves its own task file into `complete/` — when they merge the moves land automatically. I intentionally left those task files in `tasks/` on main to avoid double-moves / merge conflicts.
- No merged tasks to file. The `merged → complete` bucket was empty because nothing merged since `dep-hygiene` (#30), whose task file was already complete.
- No tasks old enough to flag stale — every file is from the last 5 days.
- No duplicates spotted.

Changes made:
- Normalized frontmatter across 9 files that had either bare `status:`/`size:` lines without YAML fences, or no frontmatter at all. Added plausible `status:` + `size:` values where missing (see commit `tasks: normalize frontmatter`).
- Linked `devtools.md` → PR #16 and `id-helpers.md` → PR #25 with `status: in-progress` + a "Tracked in PR #N" breadcrumb at the top. Both tasks had open PRs with no cross-reference in the task file, which made the folder feel staler than it is.

Patterns noticed:
- Two distinct frontmatter shapes are in circulation: YAML with `---` fences (most tasks) and bare text lines (`parser.md`, `error-taxonomy.md`, `typegen-casing-story.md`, `typesql-ddl-support.md`, `landing-page-animations.md`, old `devtools.md`). Worth deciding on one convention; for this pass I normalized to YAML fences since more existing files use that.
- A few brainstorm files (`desired-backfill.md`, `detect-spurious-definitions.md`, `outbox.md`, `pg.md`, `id-helpers.md` before today) shipped as bare prose with no frontmatter at all. Cheap to fix, worth doing routinely.
- This file itself still has a bare `status: evergreen` line instead of YAML-fenced frontmatter, left alone because the task instructions said "don't touch `tasks/cleanup-tasks.md` except to append your log note."

## 2026-04-28 pass

Branch: `cleanup-tasks-2026-04-28`.

Survey state at the start of the pass:
- 25 PRs merged since the 2026-04-20 pass (#11, #14, #15, #17, #18, #19, #20, #21, #22, #23, #24, #25, #29, #31, #32, #37, #39, #40, #41, #42, #44, #45, #46, #47, #49, #50, #52, #53, #55, #56, #59, #61, #62, #64, #66 — counting only post-2026-04-20). Most of those already moved their task files to `complete/` as part of the merging PR. Stragglers in `tasks/` that this pass needs to file: `camelcase-query-name`, `ci-report-package-size`, `client-prepare` (+ `.interview`), `error-taxonomy` (the original; superseded by v2 which is already in `complete/`), `fix-cause-double-error-prefix`, `improve-docs-onboarding-pass`, `migrations-preset`, `outbox`, `retire-local-subdomain`.
- 8 PRs still open: #2 detect-spurious-definitions, #43 sql-runner-named-params, #60 generate-watch, #63 cli-config-flag, #65 lint-generated-queries, #67 target-safety-design, #68 partial-fetch-ui-durable-object, #69 outbox-polymorphic-sync. All have matching files in `tasks/`; leave alone.
- 33 worktrees on disk under `../worktrees/sqlfu/`. After tonight's pass most should be gone — only the 8 open-PR worktrees + the two in-flight bedtime branches (`cleanup-tasks-2026-04-28`, `improve-docs-2026-04-28`) + a couple closed-but-revisit-able ones (`api-extractor`, `typesql-ddl-support`) should remain.
- `landing-page-animations` (PR #14) merged but the task file says "in-progress" with pending pacing review and "decide whether to keep alt-A/B/C/D compositions". Leaving in `tasks/` — there's still real follow-up work the user wants to drive.
- Bare-frontmatter holdouts: `landing-page-animations.md`, `sqlfu-vscode.md`. Will normalize. (`cleanup-tasks.md` and `improve-docs.md` are evergreen; intentionally left as bare lead-in.)

Plan:
- [ ] Move 9 stale task files (8 distinct tasks; `client-prepare` has a `.interview.md` sibling) to `tasks/complete/` with the merge date as prefix.
- [ ] Normalize bare frontmatter on `landing-page-animations.md` and `sqlfu-vscode.md`.
- [ ] Prune merged-PR worktrees: 22 total, leaving the 8 open-PR ones, the in-flight bedtime ones, the active main checkout, the unrelated `sqlfu-vendor-sqlite3def` worktree, and the two closed-without-merging worktrees the user might revisit (`api-extractor`, `typesql-ddl-support`). `typesql-ddl-support` has a dirty working tree; leave it alone.
- [ ] List any orphaned directories under `../worktrees/sqlfu/` (those not in `git worktree list`).

