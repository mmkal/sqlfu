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

