Refactor `sqlfu`'s migration model to remove `snapshot.sql`, make draft/final migration status explicit, and align code, tests, and docs around one coherent workflow.

## Problem Statement

The current migration model mixes a few competing ideas:

- `definitions.sql` is supposed to be the schema-authoring surface.
- `snapshot.sql` is treated as a committed finalized baseline cache.
- migration commands still reflect an older "generate a migration from snapshot" mental model.

That creates conceptual drag:

- users have to understand both `definitions.sql` and `snapshot.sql`
- repo integrity depends on keeping duplicate schema artifacts in sync
- the draft/final migration lifecycle is not the center of the design
- docs and implementation risk drifting because the old snapshot-based language is still present

We now want a simpler model:

- `definitions.sql` is the only schema-authoring surface
- finalized baseline is computed by replaying migrations into a temporary database
- there is at most one draft migration
- the draft is part of the in-progress migration state
- `finalize` only flips metadata after validation
- `sqlfu check` is the main integrity surface

## Ubiquitous Language

These terms should be used consistently in code, docs, tests, and CLI output.

- `definitions.sql`
  The desired schema. This is the only human-authored schema document.
- finalized migrations
  Immutable migration history. Applied in filename order.
- draft migration
  The single mutable migration file, if it exists. It must be lexically last.
- effective migration state
  The schema produced by replaying finalized migrations, plus the draft if one exists.
- finalize
  Validate that the effective migration state matches `definitions.sql`, then flip the draft metadata from `draft` to `final`.
- check
  Run named integrity checks over migration files and the schema produced by replaying them.

Terms to remove:

- `snapshot.sql`
- snapshot baseline
- snapshot repair
- dump schema as part of the migration model
- "migrate new" language if it implies creating history from a committed snapshot file

## Agreed Behavior

### Migration metadata

- Every migration file must have parseable metadata on the first line.
- The first line format is a strict SQL comment, for example:

```sql
-- status: draft
```

- The actual parser should support the agreed comma-separated key/value shape, for example:

```sql
-- status: draft, somekey: somevalue
```

- Missing metadata is an error.
- Invalid metadata is an error.
- Status is explicit metadata, not inferred from filenames or git.
- A configurable callback may later override status determination, but the default behavior is strict first-line metadata parsing.

### Draft rules

- There may be zero or one draft migration.
- The draft must be lexically last.
- Migration application order is filename order.
- A draft file lives in the same directory and uses the same filename scheme as finalized migrations.
- `sqlfu draft` fails if a draft exists but is not lexically last, unless `--bump-timestamp` is passed.
- `sqlfu draft --bump-timestamp` renames the existing draft to a later timestamp, preserves contents, and then continues normal draft behavior.

### Draft generation

- If no draft exists, `sqlfu draft`:
  - replays finalized migrations into a temporary database
  - diffs that schema against `definitions.sql`
  - creates a draft migration file
- If a draft exists, `sqlfu draft`:
  - replays finalized migrations plus the existing draft into a temporary database
  - diffs that effective migration state against `definitions.sql`
  - appends newly needed SQL to the existing draft file
- If the existing draft does not execute successfully, `sqlfu draft` fails.
- If the effective migration state already matches `definitions.sql`, `sqlfu draft` is a no-op and says so clearly.
- `sqlfu draft --rewrite` preserves the current draft path, blanks and replaces the file contents, and regenerates the draft from finalized migrations only.

### Sync and migrate

- `sqlfu sync` mutates the target database only.
- `sqlfu sync` must not create or update draft files.
- `sqlfu sync` must not invent semantic data migration logic.
- `sqlfu sync` should fail conservatively for changes that require manual migration logic, such as destructive changes or non-trivial data movement.
- `sqlfu migrate` applies finalized migrations only.
- `sqlfu migrate` fails if a draft exists, unless `--include-draft` is passed.
- `sqlfu migrate --include-draft` is the way to exercise the historical path while a draft exists.

### Finalize

- `sqlfu finalize` validates by replaying finalized migrations plus the draft into a temporary database and comparing the result to `definitions.sql`.
- If validation fails, `finalize` fails.
- If validation succeeds, `finalize` updates the same draft file in place by changing metadata from `status: draft` to `status: final`.
- `finalize` should not rename the file.
- `finalize` should not reformat or otherwise rewrite the SQL body.
- `finalize` mutates repo artifacts only. It should not mutate the user's local development database.

### Check

- `sqlfu check` runs all checks and prints a multi-status report.
- `sqlfu check <name>` runs one named check.
- The named checks should be:
  - `draft-count`
  - `migration-metadata`
  - `draft-is-last`
  - `migrations-match-definitions`
  - `no-draft`
- `migrations-match-definitions` means:
  - replay finalized migrations into a temporary database
  - if a draft exists, apply it too
  - compare the resulting schema to `definitions.sql`
  - distinguish between replay failure and schema mismatch in output
- `sqlfu check` should be CI-safe by including `no-draft`.
- That means:
  - if a draft exists but otherwise everything is valid, the report should make it obvious that the repo is ready for `sqlfu finalize`
  - if the only failing check is `no-draft`, that is a useful signal rather than noisy failure

## Docs Requirements

We need a brief but strong explanation of why there is no `snapshot.sql` file.

The docs should say:

- `sqlfu` does not use a committed schema snapshot file
- `definitions.sql` is the only human-authored schema document
- the finalized baseline is computed by replaying migrations into a temporary database when needed
- this avoids duplicate schema artifacts drifting out of sync
- `sqlfu check` is the mechanism for verifying that migration history reproduces `definitions.sql`
- in CI, plain `sqlfu check` is safe because it also verifies that no draft remains

Docs should also explain:

- the draft lifecycle
- why `sync` and `migrate` are separate loops
- why `sync` may fail on semantic/destructive changes
- that `finalize` only flips migration metadata after validation

## Implementation Stages

The goal is to land this in small, understandable steps while deleting obsolete concepts as soon as replacements exist.

### Stage 1: Freeze the language

- Update the migration design doc to match the new model.
- Update README migration sections to remove `snapshot.sql` and snapshot-centric commands.
- Rename command descriptions and help text to center `draft`, `migrate`, `finalize`, and `check`.
- Remove or rewrite references to old snapshot terminology in comments and test names.

Exit criteria:

- a reader cannot learn the old snapshot-based mental model from current docs
- the docs explain the no-snapshot choice intentionally, not as an omission

### Stage 2: Lock behavior with specs

- Add or rewrite integration-style tests for the new migration stories.
- Prefer readable story-driven specs over low-level unit tests.
- Cover:
  - creating the first draft from empty finalized history
  - finalizing by metadata flip only
  - appending to an existing draft after more `definitions.sql` changes
  - `draft --rewrite` replacing contents in place
  - `draft` failing when the existing draft is broken
  - `draft` failing when the draft is not lexically last
  - `draft --bump-timestamp` repairing order and preserving contents
  - `migrate` failing when a draft exists
  - `migrate --include-draft` exercising the in-progress historical path
  - `check` named subchecks and output shape
  - the case where only `no-draft` fails, indicating readiness to finalize
  - `sync` refusing semantic/destructive changes where automatic transformation is unsafe

Exit criteria:

- the desired workflow is documented in tests before the implementation is swapped over fully

### Stage 3: Replace migration state derivation

- Remove reliance on `snapshot.sql` in the migrator implementation.
- Build finalized baseline by replaying finalized migrations into a temporary database.
- If a draft exists, build effective migration state by applying it after finalized history.
- Keep this baseline logic centralized so `draft`, `finalize`, and `check` all use the same replay model.

Exit criteria:

- no migration command requires or writes `snapshot.sql`
- the effective migration state is computed from migration files only

### Stage 4: Implement strict metadata and draft routing

- Implement strict first-line metadata parsing.
- Enforce zero-or-one draft.
- Enforce draft-is-last.
- Implement `--bump-timestamp`.
- Make command errors targeted and explicit when metadata or ordering is invalid.

Exit criteria:

- migration status resolution is deterministic
- ordering and draft-count violations are easy to diagnose

### Stage 5: Implement draft append and rewrite behavior

- Implement draft creation from finalized baseline when no draft exists.
- Implement append behavior using finalized-plus-draft as the effective baseline when a draft exists.
- Ensure draft replay happens before appending.
- Implement in-place `--rewrite`.
- Ensure no-op behavior when migrations already match `definitions.sql`.

Exit criteria:

- repeated `sqlfu draft` runs support iterative schema work without throwing away manual migration edits

### Stage 6: Implement finalize and check

- Implement `finalize` validation against replayed effective migration state.
- Make `finalize` mutate only the metadata line in the existing draft file.
- Implement named `check` subcommands.
- Implement all-checks report output.
- Ensure `migrations-match-definitions` distinguishes replay failure from schema mismatch.

Exit criteria:

- `finalize` is trustworthy
- `check` is useful both interactively and in CI

### Stage 7: Delete obsolete concepts completely

- Remove code paths, config, docs, tests, and command help related to:
  - `snapshot.sql`
  - snapshot repair
  - snapshot dump as a core migration concept
  - any snapshot-based baseline derivation
- Rename APIs or functions whose names still encode snapshot thinking.
- Delete compatibility shims rather than keeping both models alive.

Exit criteria:

- there is one migration model in the repo, not two

## Explicit Deletions

The following old concepts should be removed, not merely deprecated in place:

- user-facing `snapshot.sql` as a committed baseline artifact
- commands whose main purpose is maintaining `snapshot.sql`
- docs that describe draft generation as "snapshot to definitions"
- implementation paths that trust the current local database as a migration-authoring baseline

## Testing Notes

- Prefer integration/spec coverage in the style already used around the migrator.
- Keep tests readable and story-driven.
- Do not use mocks where replaying real migration SQL into temporary SQLite databases is practical.
- The best tests here assert external behavior:
  - what file got created or renamed
  - whether a command failed
  - what checks were reported
  - whether resulting schema matches `definitions.sql`

## Out of Scope

- multiple drafts
- down migrations
- seeded fixture-data migration testing as a first-class framework
- git-aware default draft/final status resolution
- preserving backward compatibility with the snapshot model

## Suggested Commit Slices

1. Rewrite migration docs and README language to the no-snapshot model.
2. Add or rewrite high-level migration specs for the new workflow.
3. Centralize replay-based baseline computation without changing every command yet.
4. Add strict metadata parsing and draft ordering enforcement.
5. Implement draft append, rewrite, and bump-timestamp behavior.
6. Implement finalize validation and metadata-only finalize behavior.
7. Implement `check` subcommands and multi-status output.
8. Delete snapshot-era code, commands, and docs that are still hanging around.
