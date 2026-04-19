size: medium
status: done
---

## Status

All checklist items complete. Implementation shape:

- New `analyzeMigrateHealth` in `packages/sqlfu/src/api.ts` is narrower than `analyzeDatabase`: it only looks at applied history (+ prefix order) and live-vs-history schema drift. It deliberately does not replay pending migrations, so broken pending SQL still reaches the real migrate path.
- `applyMigrateSql` preflights before applying anything (even with zero pending migrations), wraps `applyMigrations` in a try/catch, and reruns the same narrow health check from the post-failure state.
- Error strings are operator-facing and reuse the existing recommendation-style diagnostics.
- History drift now additionally flags "out-of-order": a new migration file sorting before an already-applied one.
- `surroundWithBeginCommitRollbackSync` now swallows rollback errors so the original migration error survives (previously a migration containing its own `commit` would mask the real error with a `cannot rollback - no transaction is active`).
- Tests cover the four required scenarios; the "reconciliation required" case is exercised with a real migration that includes `commit;` mid-way and then an intentional syntax error.

Handle failed migrations properly.

This task is intentionally about `sqlfu migrate`, not a general redesign of the migration model.

## Problem

Some migrations will fail:

- because the SQL is just wrong
- because the SQL worked in dev but fails in production due to real data
- because a migration attempt leaves the database in a suspicious state

Today `sqlfu` applies each pending migration inside its own transaction and only records a row in `sqlfu_migrations` after the migration SQL succeeds. That is good, but it is not yet enough as a product story. We need `sqlfu migrate` to be explicit about when retry is safe, when it is not safe, and what the operator should do next.

Serious users will also want to know how `sqlfu` thinks about migration failures, so this behavior must be documented, not just implemented.

## Decisions Already Made

Do not re-litigate these unless you discover a concrete incompatibility in the code.

### Core model

- Do **not** store a failed migration row in `sqlfu_migrations`.
- `sqlfu_migrations` should continue to mean: migrations that successfully applied and are part of trusted recorded history.
- `sqlfu` should derive whether a database is healthy for `migrate` from existing authorities:
  - repo migrations
  - recorded migration history
  - live schema
- A failed migration attempt does **not** automatically mean the database is unsafe forever.
- If the failed migration fully rolled back and the live schema still matches the recorded migration-history prefix, retrying `sqlfu migrate` is honest and should be allowed.
- If the failed migration leaves the database in a state where the live schema no longer matches recorded history, `sqlfu migrate` must refuse to continue until the database is reconciled explicitly.

### `migrate` behavior

- `sqlfu migrate` should run a **narrow migrate-specific health check** before applying anything.
- This is **not** the same as literally running `check.all()`.
- The migrate-specific health check should block on the mismatches that make a database unhealthy for `migrate`, especially:
  - repo drift
  - history drift
  - schema drift
- `Pending Migrations` should obviously not block `migrate`.
- `sqlfu migrate` should fail even when there are **zero pending migrations** if the database is not healthy for `migrate`.
- `sqlfu migrate` should run the migrate-health check:
  - once before starting
  - again only if a migration execution fails
- Do **not** add per-migration prechecks before every successful iteration unless you discover a strong reason.

### Error/reporting behavior

- Use one normal non-zero failure exit path. Do **not** introduce distinct magic exit codes for different failure classes.
- Reuse the existing recommendation-style diagnostics rather than forcing the operator to run `sqlfu check` separately.
- If preflight fails, `sqlfu migrate` should say the database is not healthy for `migrate` and then show the relevant recommendation-style diagnostics.
- If a migration fails and the post-failure health check says the database is still healthy for `migrate`, the error should explicitly say that the database remains healthy and it is safe to retry after fixing the migration.
- If a migration fails and the post-failure health check says the database is no longer healthy for `migrate`, the error should explicitly say reconciliation is needed and then show the recommendation-style diagnostics.

### Scope boundaries

- Do **not** add a new `repair` command in this task.
- Do **not** add a failed-migration status table.
- Do **not** expand this into a broad command redesign.
- Stay inside the existing model built around `check`, `baseline`, `goto`, migration replay, and schema comparison.

## Implementation Shape

The likely shape is:

1. Extract a migrate-specific health analysis from the existing authority/mismatch logic in `packages/sqlfu/src/api.ts`.
2. Reuse that analysis from `migrate`.
3. Preflight before applying pending migrations.
4. If preflight fails, throw a recommendation-style error that explains `sqlfu migrate` cannot proceed from the current state.
5. If execution of a migration throws, rerun the same migrate-health analysis against the post-failure database state.
6. If the database is still healthy, throw an error that clearly says retry is safe after fixing the migration.
7. If the database is unhealthy, throw an error that clearly says reconciliation is required, followed by recommendations.

You do not have to use exactly these helper boundaries if the code suggests a cleaner factoring, but preserve the semantics above.

## Testing Requirements

Use real tests, not mocks.

Add or update migration-focused tests in `packages/sqlfu/test/migrations/migrations.test.ts`.

We want explicit coverage for at least these cases:

- preflight blocks `migrate` when the database has pending migrations but is not healthy for `migrate`
- preflight blocks `migrate` when there are zero pending migrations but the database is not healthy for `migrate`
- failed migration with clean rollback reports that retry is safe
- failed migration with resulting unhealthy state reports that reconciliation is required

Important:

- The last case should be tested **explicitly now**, not left as a documentation-only path.
- Do not fake this with mocks.
- If SQLite cannot naturally produce the unhealthy post-failure state via a real migration execution path, construct the postcondition honestly in the test so the command path is still exercised meaningfully.
- Keep tests readable. The test body should tell the story first; helper details belong lower in the file if you need them.

## Documentation Requirements

Update both:

- `packages/sqlfu/README.md`
- `packages/sqlfu/docs/migration-model.md`

### README

Keep it concise and operator-facing. It should explain that:

- `sqlfu migrate` starts from a trusted migration-history prefix
- on migration failure, `sqlfu` checks whether the database is still healthy for `migrate`
- if healthy, fix the migration and retry
- if unhealthy, reconcile explicitly with the existing tools

### Migration model doc

Explain the reasoning in more detail:

- why `sqlfu` does not store failed rows in `sqlfu_migrations`
- why “a migration failed” and “the database is unhealthy for `migrate`” are different questions
- how the post-failure health check answers whether retry is safe
- how this fits into the existing authority model

## Checklist

- [x] identify the current mismatch-analysis code path and extract or factor a migrate-specific health check from it _added `analyzeMigrateHealth` in `packages/sqlfu/src/api.ts`, a narrower variant that only inspects applied history and live schema (not pending/broken migrations)_
- [x] make `sqlfu migrate` fail on unhealthy preflight, even with zero pending migrations _`applyMigrateSql` preflights before anything, and still preflights when zero pending migrations exist_
- [x] make `sqlfu migrate` rerun the health check after migration execution failure _`applyMigrateSql` catches errors from `applyMigrations`, reruns `analyzeMigrateHealth` with the open client, and formats the failure accordingly_
- [x] produce clear operator-facing error text for:
  - [x] unhealthy preflight _`formatMigratePreflightFailure`_
  - [x] failed migration but safe-to-retry _`formatMigrateFailure` with no blockers_
  - [x] failed migration and reconciliation-needed _`formatMigrateFailure` with blockers + recommendations_
- [x] add migration tests covering the four required scenarios above _4 new tests at the end of `describe('migrate', ...)` in `packages/sqlfu/test/migrations/migrations.test.ts`_
- [x] update `packages/sqlfu/README.md` _added "When a migration fails" subsection under Draft and Apply Migrations_
- [x] update `packages/sqlfu/docs/migration-model.md` _added "Failed Migrations" section with the four pieces of explanation the task asked for_
- [x] run the relevant test file(s) _all 55 migration tests pass_

## Acceptance Criteria

This task is done when all of the following are true:

- `sqlfu migrate` refuses to run from an unhealthy baseline
- `sqlfu migrate` still permits honest retry after a clean rollback failure
- `sqlfu migrate` clearly distinguishes between “fix and retry” vs “reconcile first”
- no failed rows are added to `sqlfu_migrations`
- the tests cover both the clean-rollback and unhealthy-after-failure stories
- the docs explain the model clearly enough that a serious user can understand the design without reading the implementation

## Meta Instructions For The Implementing Agent

- Read the current `migrate` and check-analysis code before editing.
- Prefer extending the existing authority/mismatch model over inventing a parallel ad hoc check.
- Keep the implementation small and explicit.
- Avoid legacy baggage. If an abstraction ends up half-dead after this refactor, delete it.
- Follow the repo testing guidance in `CLAUDE.md`.
- Do not add mocks unless you hit a wall and can justify them very concretely.
- Update this task file as you go, adding notes inline on every checklist item you check, and leave _italicized_ comments inline anywhere else appropriate.
