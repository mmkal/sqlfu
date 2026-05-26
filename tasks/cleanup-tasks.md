---
status: evergreen
size: small
---

# Cleanup Tasks

## Status summary

2026-05-17 pass is done. One completed active task file was filed for merged PR #125, and eleven clean local worktrees for merged or stale compare branches were removed. Open, dirty, ahead, ambiguous, and evergreen worktrees/tasks were left in place.

2026-05-15 pass is done. PRs #115 and #116 were evergreen logs that stay active, so no task files moved. Eight clean local worktrees for merged, closed, or stale compare branches were removed; open, dirty, and ambiguous worktrees were left in place.

Sometimes agents forget to move their task files to "done". Look at recent commits and see if that's happened. If it has, open a housekeeping PR to do just that. While you're there, you can also add to Implementation Notes if there's anything you spot in the change that wasn't tidied up properly that also wasn't documented in the task file.

Make sure local worktrees are cleaned up too.

## 2026-05-17 pass

Branch: `bedtime/2026-05-17-cleanup-tasks`.

Scope:

- Inspect recent merged, closed, and open PRs against active task files.
- Move active task files to `tasks/complete/` only when the matching work is clearly merged or otherwise done on `origin/main`.
- Keep evergreen tasks open.
- Remove only clean, clearly stale local worktrees; preserve dirty, ambiguous, active review, local, and remote branches.
- Record skipped candidates with enough context for the next cleanup pass.

Checklist:

- [x] Create the requested isolated worktree from `origin/main` and commit this status note first. _worktree is `/Users/mmkal/src/worktrees/sqlfu/bedtime-2026-05-17-cleanup-tasks` on branch `bedtime/2026-05-17-cleanup-tasks`._
- [x] Open the early PR after the task-only commit. _PR #130 opened from first commit `fe0af32`._
- [x] Inspect recent merged, closed, and open PRs, active task files, and local worktrees. _recent merged candidates were #120 through #126; open PRs #111, #127, #128, #129, and #130 stay active. PRs #131 and #132 opened after this cleanup snapshot and are noted below._
- [x] File completed active task files into `tasks/complete/` only when the matching work is clearly done on `origin/main`. _moved `tasks/architecture-2026-05-15.md` to `tasks/complete/2026-05-16-architecture-2026-05-15.md` after PR #125 merged._
- [x] Remove safe clean local worktrees, or record why each candidate was left alone. _removed eleven clean merged/stale worktrees; left open, dirty, ahead, ambiguous, evergreen, and out-of-scope worktrees in place._
- [x] Verify the final task tree, worktree list, and git status. _checked `find tasks -maxdepth 2 -type f | sort`, `git worktree list --porcelain`, and `git status --short`; only the task move and this cleanup log remain before the final commit._

Implementation notes:

- 2026-05-17: This pass starts from `origin/main` at `27c0875` and intentionally does not touch the main checkout.
- 2026-05-17: Merged PRs #122, #124, and #126 already filed their task files under `tasks/complete/`. PR #121 and this task are evergreen logs, so they stay active. PR #120 updated `tasks/landing-demo-maintainability.md`, which intentionally stays active for the deferred Outbox demo. PR #123 updated broader `tasks/pg.md`, which still tracks later `@sqlfu/pg` work.
- 2026-05-17: Filed `tasks/architecture-2026-05-15.md` because PR #125 merged on 2026-05-16 and its checklist was complete. The completed file now lives at `tasks/complete/2026-05-16-architecture-2026-05-15.md`.
- 2026-05-17: Removed local worktree checkouts only; local and remote branches were preserved. Removed: `bedtime-2026-05-14-generate-preflight`, `bedtime-2026-05-14-query-identity-manifest`, `bedtime-2026-05-15-architecture`, `bedtime-2026-05-15-cleanup-tasks`, `bedtime-2026-05-15-db-base-directory`, `bedtime-2026-05-15-default-db-gitignore`, `bedtime-2026-05-15-improve-docs`, `bedtime-2026-05-15-landing-trace`, `bedtime-2026-05-15-pg-docs-followup`, `compat-existing-tools`, and `query-identity-refresh-pr-114`.
- 2026-05-17: Left open PR worktrees in place: `issue-110-sqlite3-parser-schemadiff` (#111), `do-inline-sync-tests` (#127), `review-pr-127` (local review checkout for #127), `ui-relations` (#128), `bedtime-2026-05-17-improve-docs` (#129), and this cleanup worktree (#130).
- 2026-05-17: Left active/ambiguous or user-edit worktrees alone: `api-extractor` and `detect-spurious-definitions` still have active root task files; `query-identity-refresh-pr-111` and `improve-codebase-architecture-2026-05-14-pr-111` are still associated with open draft PR #111; `drizzle-benchmark-sqlfu` is ahead of its remote; `effect-client-interop` and `typesql-ddl-support` are dirty; `sqlfu-vendor-sqlite3def` is outside the usual `../worktrees/sqlfu/` cleanup set.
- 2026-05-17: After the cleanup snapshot, `bedtime-2026-05-17-clawpatch` opened PR #131 and `bedtime-2026-05-17-parser-spike` opened PR #132. They should be treated as open active worktrees by the next cleanup pass.

## 2026-05-15 pass

Branch: `bedtime/2026-05-15-cleanup-tasks`.

Scope:

- Inspect PRs #115 and #116, merged on 2026-05-15, against the active and complete task tree.
- Confirm open PR worktrees for #111, #114, and #117 stay in place.
- Remove only clean local worktrees whose branch work is merged or intentionally closed and no longer useful for review.
- Leave evergreen tasks open and record this pass here.

Checklist:

- [x] Create an isolated worktree from `origin/main` and commit this status note first. _worktree is `/Users/mmkal/src/worktrees/sqlfu/bedtime-2026-05-15-cleanup-tasks` on branch `bedtime/2026-05-15-cleanup-tasks`._
- [x] Open the early PR after the task-only commit. _PR #119 opened from first commit `95b3b31`._
- [x] Inspect recent merged/closed PRs and active task files. _#115 and #116 are merged; #111, #114, #117, and this PR #119 are open; active root task files still represent open work or evergreen logs._
- [x] File completed active task files into `tasks/complete/` only when the matching work is clearly done on `origin/main`. _none moved: #115 and #116 update `tasks/improve-docs.md` and `tasks/cleanup-tasks.md`, which stay evergreen._
- [x] Remove safe clean local worktrees, or record why any candidate was left alone. _removed the clean merged worktrees for #115/#116, the clean closed worktrees for #102/#109, and stale clean compare worktrees for merged #101/#108/#115/#116._
- [x] Verify the final task tree, worktree list, and git status. _checked `find tasks -maxdepth 1`, `git worktree list --porcelain`, and `git status --short`; only this cleanup log remains before the final commit._

Implementation notes:

- 2026-05-15: The main checkout was clean at the start of this pass. Open PRs were #117 (`bedtime/2026-05-14-query-identity-manifest`), #114 (`bedtime/2026-05-14-generate-preflight`), and draft #111 (`issue-110-sqlite3-parser-schemadiff`).
- 2026-05-15: PRs #115 and #116 merged into `main` after the prior cleanup pass. Their task files are evergreen logs, so they should remain active, but their local worktrees are cleanup candidates if clean.
- 2026-05-15: Removed local worktree checkouts only; local and remote branches were preserved. Removed: `bedtime-2026-05-14-cleanup-tasks`, `bedtime-2026-05-14-improve-docs`, `bedtime-evergreen-2026-05-12`, `typebox-validator`, `query-identity-refresh-pr-115`, `query-identity-refresh-pr-116`, `improve-codebase-architecture-2026-05-14-pr-101`, and `improve-codebase-architecture-2026-05-14-pr-108`.
- 2026-05-15: Left open PR worktrees in place: `issue-110-sqlite3-parser-schemadiff` (#111), `bedtime-2026-05-14-generate-preflight` (#114), `bedtime-2026-05-14-query-identity-manifest` (#117), this cleanup worktree (#119), and tonight's in-flight docs/default-db/landing worktrees. Also left `query-identity-refresh-pr-111`, `query-identity-refresh-pr-114`, and the older `improve-codebase-architecture-2026-05-14-pr-111` compare worktree because their associated PRs are still open.
- 2026-05-15: Left ambiguous or user-edit worktrees alone: `api-extractor` and `detect-spurious-definitions` still have active root task files despite closed PRs; `drizzle-benchmark-sqlfu` is ahead of its remote; `effect-client-interop` and `typesql-ddl-support` are dirty; `sqlfu-vendor-sqlite3def` is outside the usual `../worktrees/sqlfu/` cleanup set.

## 2026-05-14 pass

Branch: `bedtime/2026-05-14-cleanup-tasks`.

Scope:

- Inspect recent merged PRs #113, #108, and #101 against the current `tasks/complete/` state.
- File active task files only when the matching work is clearly done on `origin/main`.
- Inspect local worktrees and only remove clean worktrees that clearly correspond to merged PR branches.
- Leave evergreen tasks open and record this pass here.

Checklist:

- [x] Read repo instructions and create the requested worktree from `origin/main`. _worktree created at `/Users/mmkal/src/worktrees/sqlfu/bedtime-2026-05-14-cleanup-tasks`; main checkout has unrelated website edits and was left untouched._
- [x] Inspect PRs #113, #108, and #101. _all three are merged into `main`; #113 added `tasks/complete/2026-05-14-query-parameter-expansion-locality.md`, #108 moved `tasks/typegen-casing-story.md`, and #101 moved `tasks/sql-runner-named-params.md`._
- [x] Inspect the active task tree for stale completed files. _found `tasks/intro-blog.md`: PR #100 is merged, but the active task still has an unchecked final PR update item._
- [x] Inspect local worktrees and PR status. _clean merged candidates include `drop-node-20-2026-05-12`, `fix-package-size-pnpm-cache`, `improve-codebase-architecture-2026-05-14`, `pr-body-fixture-before-section`, `schemadiff-normalization-weird-sql-2026-05-12`, `sql-runner-named-params-2026-05-12`, `sweep-doc-query-examples-2026-05-12`, and `typegen-casing`; open/closed-unmerged/dirty worktrees were left out of the candidate set._
- [x] Commit this task/status update in isolation and open a PR early. _first commit `3fa7ac1`; PR #116 opened before moving task files._
- [x] File completed active task files into `tasks/complete/` with 2026-05-14 date prefixes. _moved `tasks/intro-blog.md` to `tasks/complete/2026-05-14-intro-blog.md` after marking the final PR item complete._
- [x] Remove safe clean merged local worktrees, or record why any candidate was left alone. _removed only clean worktrees whose head branches have merged PRs: `drop-node-20-2026-05-12`, `fix-package-size-pnpm-cache`, `improve-codebase-architecture-2026-05-14`, `pr-body-fixture-before-section`, `schemadiff-normalization-weird-sql-2026-05-12`, `sql-runner-named-params-2026-05-12`, `sweep-doc-query-examples-2026-05-12`, and `typegen-casing`._
- [x] Verify the final task tree and git status. _checked `rg --files tasks | sort`, `git worktree list --porcelain`, and `git status --short`; only the intended task-file move and cleanup log edit remain before this commit._

Implementation notes:

- `tasks/complete/2026-05-14-query-parameter-expansion-locality.md`, `tasks/complete/2026-05-12-typegen-casing-story.md`, and `tasks/complete/2026-05-12-sql-runner-named-params.md` already carry completed checklist breadcrumbs. No duplicate move is needed for #113, #108, or #101.
- The only active task file found that is clearly done on `origin/main` was `tasks/intro-blog.md`; PR #100 merged on 2026-05-11, and the file now lives at `tasks/complete/2026-05-14-intro-blog.md`.
- Removed local worktree checkouts only; remote and local branches were left intact.
- Open PR #111 and the active bedtime branches #114/#115 stay in place. Closed-unmerged or dirty worktrees such as `api-extractor`, `bedtime-evergreen-2026-05-12`, `detect-spurious-definitions`, `effect-client-interop`, `typebox-validator`, and `typesql-ddl-support` also stay in place.
- Replacement compare worktrees `improve-codebase-architecture-2026-05-14-pr-101`, `improve-codebase-architecture-2026-05-14-pr-108`, and `improve-codebase-architecture-2026-05-14-pr-111` were left in place because they are no-PR compare branches rather than direct merged PR heads.

## 2026-05-09 pass

Branch: `bedtime-introducing-sqlfu-2026-05-09`.
PR: #100.

Scope:

- File root task files only when the matching PR is clearly merged and the remaining unchecked items are stale or deferred follow-ups.
- Remove clean local worktrees whose PRs are merged or intentionally closed.
- Leave dirty worktrees, no-PR worktrees, and closed-unmerged tasks that still represent possible future work.
- Keep evergreen tasks open and append notes rather than moving them to `complete/`.

Checklist:

- [x] Inspect current open and recently closed/merged PRs. _only open PR at survey time was #99; merged candidates included #60, #73, #86, #88, #89._
- [x] Inspect local worktrees and cleanliness. _25 cleanup candidates were clean; `effect-client-interop` and `typesql-ddl-support` were dirty and left alone._
- [x] File clearly completed task files into `tasks/complete/` with date-prefixed filenames. _filed `generate-watch`, `better-auth-adapter-create-schema`, `cloudflare-d1-helpers`, `pg-package`, and `pg-ui`._
- [x] Normalize stale status summaries/checklists before moving task files. _updated statuses to `done` and marked stale/deferred checklist items with breadcrumbs so the completed folder does not imply unfinished active work._
- [x] Remove safe, clean, merged/closed local worktrees. _removed 25 worktrees including `generate-watch`, `cloudflare-d1-helpers`, `pg-package`-related stacked branches, docs branches, and merged UI/docs feature branches._
- [x] Verify final task tree and worktree list. _remaining worktrees: current checkout, `sqlfu-vendor-sqlite3def`, `api-extractor`, `detect-spurious-definitions`, `drizzle-benchmark-sqlfu`, `effect-client-interop`, and `typesql-ddl-support`._

Implementation notes:

- Left `tasks/landing-demo-maintainability.md` open even though PR #81 merged because the task explicitly preserves remaining fake-trace and Outbox follow-ups.
- Left `tasks/sql-runner-named-params.md` open even though PR #43 merged because the PR recorded a repro and the task still describes the sqlite-wasm `@name` / `$name` bug.
- Left `tasks/pg.md` open because it is a broader pg roadmap file, not just the completed `pg-package` / `pg-ui` slices.
- Left `api-extractor`, `detect-spurious-definitions`, `drizzle-benchmark-sqlfu`, `effect-client-interop`, `typesql-ddl-support`, and `sqlfu-vendor-sqlite3def` worktrees in place. The first two still have active root tasks despite closed PRs, one has no PR found, two are dirty or carry user edits, and one is outside the normal `../worktrees/sqlfu/` cleanup set.

## 2026-04-30 pass

Branch: `cleanup-tasks-2026-04-30`.
Base branch: `nightly/2026-04-30`.
Base PR: #75.

Scope:
- File task files into `tasks/complete/` with date prefixes only when the matching work is clearly merged/done.
- Normalize obviously stale frontmatter or status summaries when the task state is clear from current PR history.
- Prune only clean local worktrees whose PRs are merged or safely closed.
- Leave evergreen tasks open and append this pass instead of moving them to `complete/`.

Assumptions:
- PR #75 has merged into `main`, but `origin/nightly/2026-04-30` still exists at the same tip; per the handoff, this pass still targets `nightly/2026-04-30`.
- Open PR worktrees stay in place: `detect-spurious-definitions`, `generate-watch`, `lint-generated-queries`, `outbox-polymorphic-sync`, `sql-runner-named-params`, `target-safety-design`, plus current open Better Auth worktrees.
- Tonight's named active worktrees stay in place even if they have no PR yet: `affinity-types`, `relations-query-builder-polish`, `improve-docs-2026-04-30`, and this cleanup worktree.
- Closed but not merged/revisit-able worktrees such as `api-extractor` and `typesql-ddl-support` stay in place; `typesql-ddl-support` still has an uncommitted task-file edit in its own worktree.

Checklist:
- [x] Read this evergreen task and prior cleanup passes. _surveyed the 2026-04-20 and 2026-04-28 pass notes before choosing the 2026-04-30 scope._
- [x] Inspect current open/merged PRs. _open PRs: #2, #43, #60, #65, #67, #69, #73, #74; newly merged since the last cleanup pass include #68, #70, #71, #72, and #75._
- [x] Inspect local worktrees and cleanliness. _all current worktrees are clean except the pre-existing `typesql-ddl-support` task-file edit; clean merged candidates are `cleanup-tasks-2026-04-28`, `improve-docs-2026-04-28`, `partial-fetch-ui-durable-object`, and `process-result-sync-async`._
- [x] Commit this task-file update before implementation. _first commit `316d419` only touched `tasks/cleanup-tasks.md`._
- [x] Open a PR targeting `nightly/2026-04-30` before implementation. _PR #77 opened against `nightly/2026-04-30` after the first commit._
- [x] File any clearly completed task files into `tasks/complete/` with date-prefixed filenames. _none needed this pass: #68 and #72 had already filed their task files; #70/#71 are evergreen pass logs; #75 is the nightly base PR._
- [x] Normalize stale task frontmatter/status summaries when the state is unambiguous. _`tasks/intro-blog.md` now has YAML frontmatter, a title, and a short status summary; active/ambiguous bare files were left alone._
- [x] Remove only safe, clean, merged/closed local worktrees. _removed clean merged worktrees for `cleanup-tasks-2026-04-28`, `improve-docs-2026-04-28`, `partial-fetch-ui-durable-object`, and `process-result-sync-async`._
- [x] Verify final task tree and worktree list. _`git status` only shows this pass's intended task-file edits; `git worktree list --porcelain` matches the directories still present under `/Users/mmkal/src/worktrees/sqlfu`._

Implementation notes:
- Initial survey found `tasks/complete/2026-04-30-process-result-sync-async.md` already filed for PR #72 and `tasks/complete/2026-04-28-partial-fetch-ui.md` already filed for PR #68. No root task file has been moved yet in this pass.
- `cleanup-tasks-2026-04-28` (#71) and `improve-docs-2026-04-28` (#70) are merged and their local worktrees are clean.
- `partial-fetch-ui-durable-object` (#68) and `process-result-sync-async` (#72) are merged and their local worktrees are clean.
- Removed those four clean merged local worktrees with `git worktree remove`; remote branches were left alone.
- Left open-PR worktrees and tonight's active worktrees in place. Also left `api-extractor` and `typesql-ddl-support` in place because those were already called out as closed/revisit-able, and `typesql-ddl-support` still has a pre-existing uncommitted task-file edit.
- Left `tasks/affinity-types.md` and `tasks/ui-relations.md` bare because their work is active or ambiguous. Left `tasks/improve-docs.md` untouched because `improve-docs-2026-04-30` is an active worktree tonight and evergreen docs passes append there.

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
- [x] Move 10 stale task files (9 distinct tasks; `client-prepare` has a `.interview.md` sibling) to `tasks/complete/` with the merge date as prefix. _four commits — `tasks: file 2026-04-22 ...`, `tasks: file 2026-04-21 ...`, `tasks: file remaining ...`, `tasks: file id-helpers ...`. The `error-taxonomy.md` original was filed as `2026-04-23-error-taxonomy-original.md` (the date of the v2 PR merge) to keep it adjacent to the v2 file already in `complete/`. `id-helpers.md` (PR #25) was missed in the initial pass — its `status: done` was already set so it slipped past the visual scan; caught on the post-pass directory listing._
- [x] Normalize bare frontmatter on `landing-page-animations.md` and `sqlfu-vscode.md`. _commit `tasks: yaml-fence frontmatter on ...`._
- [x] Prune merged-PR worktrees: 22 removed (`camelcase-query-name`, `cause-double-error-prefix`, `ci-report-package-size`, `cleanup-tasks-2026-04-20`, `client-prepare`, `diff-statement-reasons`, `drop-antlr`, `error-taxonomy`, `error-taxonomy-v2`, `generate-self-contained`, `id-helpers`, `import-surface`, `improve-docs-2026-04-20`, `improve-docs-onboarding-pass`, `light-root-export`, `migrate-yes-flag`, `migrations-prefix-config`, `migrations-preset`, `outbox`, `playwright-ci`, `typegen-pgtyped-support`, `ui-small-ui-tweaks`). All clean working trees; `git worktree remove` succeeded for each. Branches preserved on remote so the moves are reversible. Kept: 7 open-PR worktrees (`detect-spurious-definitions`, `generate-watch`, `lint-generated-queries`, `outbox-polymorphic-sync`, `partial-fetch-ui-durable-object`, `sql-runner-named-params`, `target-safety-design`), the 2 in-flight bedtime ones (`cleanup-tasks-2026-04-28`, `improve-docs-2026-04-28`), 2 closed-without-merging-but-revisit-able (`api-extractor`, `typesql-ddl-support` — the latter has uncommitted changes in `tasks/complete/2026-04-20-typesql-ddl-support.md`, untouched).
- [x] List any orphaned directories under `../worktrees/sqlfu/` (those not in `git worktree list`). _none — every directory is accounted for._

Things flagged for follow-up (not actioned):
- `typesql-ddl-support` worktree has an uncommitted edit to `tasks/complete/2026-04-20-typesql-ddl-support.md`. Per CLAUDE.md, never delete work the user might want; left in place for the user to either commit or stash.
- `landing-page-animations.md` task file is keeping `status: in-progress` despite PR #14 having merged — the task captures unfinished follow-up (pacing review, alt-composition cleanup decision). If the user is happy with what shipped, this is a one-line move-to-complete next pass.
