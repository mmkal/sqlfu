# sqlfu Migration Model

This document captures the current design direction for `sqlfu`'s migration system.

## Core Model

`sqlfu` treats schema and migration history as separate things with separate jobs:

1. `definitions.sql`
   - The desired schema.
   - This is the only human-authored schema document.

2. Finalized migrations
   - The immutable migration history.
   - These are applied in filename order.

3. The draft migration
   - At most one mutable migration.
   - If it exists, it must be lexically last.
   - It is part of the in-progress migration state.

4. The actual database
   - A real SQLite database file or runtime database.
   - It may be clean, drifted, partially migrated, or hand-edited.

5. Ephemeral replay databases
   - Temporary SQLite databases used to replay migrations, validate drafts, and compare against `definitions.sql`.

There is no committed `snapshot.sql` file in this model.

## Why There Is No Snapshot File

`sqlfu` intentionally avoids a committed schema snapshot artifact.

Reasons:

- `definitions.sql` is already the readable schema document people review.
- A second committed schema file creates drift risk and forces users to understand two schema artifacts.
- The finalized baseline can be computed mechanically by replaying finalized migrations into a temporary database.

If you want the reassurance a snapshot file would normally provide, run `sqlfu check`.
That is the explicit way to ask:

- do the migrations replay successfully?
- does replayed history match `definitions.sql`?
- is a draft still present?

## Command Semantics

### `sqlfu sync`

- Makes the target database match `definitions.sql`.
- Intended for local development and other disposable databases.
- Mutates the database only.
- Does not create or update migration files.
- Must fail conservatively when a change requires semantic data migration or other manual transition logic.

### `sqlfu draft`

- Creates the first draft when no draft exists.
- Updates the existing draft when one already exists.
- Does not depend on the current development database being clean.
- Uses replayed migration state, never the live local database, as its baseline.

Baseline rules:

- no draft exists:
  - diff finalized migrations against `definitions.sql`
- draft exists:
  - replay finalized migrations plus the draft
  - diff that effective migration state against `definitions.sql`

If the existing draft no longer replays cleanly, `sqlfu draft` fails.

If the existing draft is not lexically last, `sqlfu draft` fails unless explicitly told to bump its timestamp.

### `sqlfu migrate`

- Applies finalized migrations to the target database.
- Fails if a draft exists, unless explicitly told to include it.
- `--include-draft` is the way to exercise the historical path while a draft is still in progress.

### `sqlfu finalize`

- Replays finalized migrations plus the draft in a temporary database.
- Compares the result to `definitions.sql`.
- Fails if replay fails or if the resulting schema does not match `definitions.sql`.
- If validation succeeds, flips the draft metadata from `draft` to `final`.
- Does not rename the file.
- Does not rewrite the SQL body.
- Does not mutate the user's development database.

## Metadata Rules

Every migration file must have strict first-line metadata, for example:

```sql
-- status: draft
```

The parser may support additional comma-separated metadata, for example:

```sql
-- status: draft, owner: person-table
```

The important invariants are:

- metadata must be on the first line
- status must be explicit
- status must be either `draft` or `final`
- missing or malformed metadata is an error

## Draft Lifecycle

Typical flow:

1. Edit `definitions.sql`.
2. Run `sqlfu sync` while doing local schema-driven development.
3. Run `sqlfu draft` to create or extend the mutable transition program.
4. Manually edit the draft if the migration needs real data movement or custom sequencing.
5. Run `sqlfu migrate --include-draft` to exercise the historical path.
6. Run `sqlfu check`.
7. If the only failure is `no-draft`, run `sqlfu finalize`.

This separation matters because `definitions.sql` describes the destination, but not always the transition.
For example, splitting `name` into `firstname` and `lastname` may require custom `update` statements that `sqlfu sync` cannot invent safely.

## Checks

`sqlfu check` should run named checks and print a multi-status report.

The current intended checks are:

- `draft-count`
  - there are zero or one draft migrations
- `migration-metadata`
  - all migration metadata is valid
- `draft-is-last`
  - the draft, if present, is lexically last
- `migrations-match-definitions`
  - replayed migrations produce the same schema as `definitions.sql`
  - if a draft exists, it is included in the replay
  - output should distinguish replay failure from schema mismatch
- `no-draft`
  - no draft exists

The plain `sqlfu check` command should be safe for CI because `no-draft` is part of the default set.
That means a branch with a valid draft will still fail `check`, but usefully:

- if `migrations-match-definitions` passes
- and `no-draft` is the only failing check

then the repo is effectively ready for `sqlfu finalize`.

## Non-Goals

- Down migrations
- Multiple drafts
- Best-effort merge of generated SQL into hand-edited SQL
- Using the live local database as the migration-authoring baseline
- Git-aware default draft detection

## Extension Points

The default status policy is strict first-line metadata parsing.
Later, `sqlfu` may allow a configurable callback like:

- `migration.status(filePath) => 'draft' | 'final'`

But the default behavior should remain predictable and explicit.
