# sqlfu Migration Model

This document describes the current migration model in plain English.

The important thing is not just which files and tables exist. The important thing is which concepts are authoritative, and what it means when they disagree.

## The Four Authorities

`sqlfu` has four important migration-related authorities.

| Name | Meaning | Current Representation |
| --- | --- | --- |
| Desired Schema | The schema the application wants now | `definitions.sql` |
| Migrations | The ordered transition program | `migrations/*.sql` |
| Migration History | What a specific database claims it has applied | `sqlfu_migrations` |
| Live Schema | What the database actually looks like now | inspected directly from the database |

### Desired Schema

The Desired Schema is the schema you want the application to have now.

This is the schema authoring surface.

### Migrations

Migrations are the ordered transition program.

Today, they are usually stored as `migrations/*.sql`, but the concept is broader than files on disk. In other environments they could come from memory, durable storage, or some other source.

If you replay all migrations from the beginning, they should produce the Desired Schema.

### Migration History

Migration History is what a specific database says it has applied.

Today, this is represented by the `sqlfu_migrations` table inside the target database.

This is not the same thing as Migrations themselves.

Migrations are the full ordered program.
Migration History is one database's record of how far through that program it believes it has gone.

### Live Schema

The Live Schema is the schema the database actually has right now.

This is what you get if you inspect the database directly.

It should usually correspond to the database's Migration History, but it can drift if someone edits the database manually or uses commands that intentionally bypass history.

## The Core Chain

The model is mostly a chain:

1. Desired Schema determines what Migrations should produce.
2. Migrations determine what Migration History may contain.
3. Migration History determines what the Live Schema should look like.

That chain is useful, but only if you are clear about where a command is allowed to cut across it.

`sqlfu sync` is the main example of a command that cuts across the chain:

- it updates the Live Schema directly from the Desired Schema
- it does not update Migration History

That means `sync` is intentionally allowed to make Migration History and Live Schema disagree.

## Authority Mismatches

| Name | Comparison | Meaning | Usually Normal? | Likely Action |
| --- | --- | --- | --- | --- |
| Repo Drift | Desired Schema <> Migrations | Replaying migrations does not produce the desired current schema | Yes, during active schema work | `sqlfu draft` |
| Pending Migrations | Migrations <> Migration History | The database has unapplied migrations | Yes | `sqlfu migrate` |
| History Drift | Migrations <> Migration History | The database claims to have applied migrations that no longer match the known migration set | No | fix the repo first, or reconcile deliberately with `sqlfu baseline <target>` and `sqlfu goto <target>` |
| Schema Drift | Migration History <> Live Schema | The database schema does not match what its recorded history implies | Normal on a dev db after `sqlfu sync` | `sqlfu baseline <target>` or `sqlfu goto <target>` |
| Schema Not Current | Desired Schema <> Live Schema | The database does not currently match the desired schema | Yes | depends on the other mismatches |

## What Each Disagreement Means

### Repo Drift

Question:
If you replay all migrations from the beginning, do you get the Desired Schema?

If not, the repo is inconsistent.

Typical reasons:

- someone edited `definitions.sql` without adding a migration yet
- a migration was generated incorrectly
- a migration was hand-edited incorrectly

This is a repo problem, not a database-specific problem.

This is what `sqlfu check` should primarily validate.

### Pending Migrations And History Drift

Question:
Does this database's recorded history correspond to the migrations that exist now?

If not, one of these is probably true:

- the database has pending migrations
- an applied migration was edited
- an applied migration was deleted or renamed
- the database was initialized against a different migration set

This comparison is about historical identity, not schema shape.

A database can have a perfectly usable Live Schema and still have bad Migration History.

This is why `Pending Migrations` and `History Drift` need to be treated differently.

- `Pending Migrations` is usually routine and should recommend `sqlfu migrate`.
- `History Drift` is usually a serious integrity problem and may not have a single safe automatic recommendation.

Two common causes of `History Drift` are:

1. someone edited an old migration after it had already been applied
2. the database was pushed forward by direct schema operations like repeated `sqlfu sync`, so its existing Migration History no longer corresponds to the current Migrations

If old migrations were edited, the best fix may be outside `sqlfu`, for example restoring the original migration content from git history.

If the user wants to trust the current Desired Schema more than the old recorded history, a more deliberate reconciliation path is:

1. use `sqlfu draft` if `Desired Schema <> Migrations`
2. run `sqlfu baseline <target>`
3. run `sqlfu goto <target>`

### Schema Drift

Question:
Does the real schema of this database match what its recorded migration history implies?

If not, the database has drifted.

Typical reasons:

- someone ran manual SQL like `drop table foo`
- `sqlfu sync` was run
- a migration partially failed
- an external tool modified the schema

This is the main reason `sync` needs to be described carefully.

`sync` is useful, but after running it the database may no longer be history-clean.

### Schema Not Current

Question:
Does the database currently match the schema the application wants?

If not, one of these is probably true:

- migrations are pending
- the database has drifted
- `definitions.sql` changed but the database was not updated

This comparison is useful, but it is not enough by itself.

A database can match the Desired Schema and still have broken Migration History.

## What The Commands Mutate

### `sqlfu draft`

Mutates:

- Migrations

It reads the current Migrations, replays them, compares the replayed result to the Desired Schema, and writes a new migration if needed.

It does not mutate:

- Migration History
- Live Schema

### `sqlfu migrate`

Mutates:

- Migration History
- Live Schema

It applies pending migrations to a database and records that they were applied.

It should not mutate:

- Desired Schema
- Migrations

See [Failed Migrations](#failed-migrations) below for how `sqlfu migrate` handles the unhappy path.

### `sqlfu baseline <target>`

Mutates:

- Migration History

It declares that this database should be treated as having applied migrations through `<target>`.

It does not mutate:

- Desired Schema
- Migrations
- Live Schema

### `sqlfu goto <target>`

Mutates:

- Migration History
- Live Schema

It makes the database look like the schema implied by migrations through `<target>`, and records that history in the database.

This is a more powerful and more dangerous command than `migrate`.

It should not mutate:

- Desired Schema
- Migrations

### `sqlfu sync`

Mutates:

- Live Schema

It updates the database directly toward the Desired Schema.

It does not mutate:

- Migrations
- Migration History

This is why `sync` is a convenience command, not a history-preserving command.

After `sync`, the database may be schema-current but history-dirty.

### `sqlfu check`

Mutates:

- nothing

It verifies relationships between the four authorities.

At minimum, it should validate:

- Desired Schema vs Migrations

Later, database-targeted checks may also validate:

- Migrations vs Migration History
- Migration History vs Live Schema
- Desired Schema vs Live Schema

`sqlfu check` may also recommend a target migration when it can prove that the Live Schema exactly matches some replayed migration prefix.

That recommendation should be derived mechanically by replaying:

- migrations `1..1`
- migrations `1..2`
- migrations `1..3`
- and so on

and checking whether any of those resulting schemas exactly matches the Live Schema.

If so, `sqlfu check` can recommend:

- a Baseline target, when the database is ahead of Migration History
- a Goto target, when the database should be reconciled to a known migration prefix

## `sqlfu check` Recommendations

`sqlfu check` should recommend the least-destructive next step it can justify from the evidence it has.

Recommendations should be based on named mismatch types, not generic failure text.

- Repo Drift only
  Recommend `sqlfu draft`.

- Pending Migrations only
  Recommend `sqlfu migrate`.

- Schema Drift only
  Recommend `sqlfu baseline <target>` or `sqlfu goto <target>`.
  If `sqlfu check` can prove that the Live Schema matches a replayed migration prefix exactly, it should recommend that exact target.

- Schema Not Current only
  If the database is otherwise history-clean, recommend:
  - `sqlfu migrate`, if migrations are pending
  - `sqlfu sync`, if the user is intentionally choosing a fast local-development path
  If the database is not otherwise history-clean, the recommendation should defer to the more specific mismatch, especially Schema Drift or History Drift.

- Pending Migrations plus Schema Not Current
  Recommend `sqlfu migrate`.
  If `Sync Drift` is also reported, its recommendation should defer to that same step rather than suggesting `sqlfu sync`.

- Repo Drift plus Schema Not Current
  Recommend `sqlfu draft`.
  The repo needs a migration before the database can become migration-current honestly.
  If `Sync Drift` is also reported, its recommendation should point back to Repo Drift.

- Repo Drift plus Schema Drift
  Recommend:
  1. `sqlfu draft`
  2. then `sqlfu baseline <target>` or `sqlfu goto <target>`
  `sqlfu check` should not pretend the database can be reconciled cleanly before the repo itself is coherent.

- History Drift only
  Do not give a single automatic recommendation.
  Explain that this may mean old migrations were edited after application, or that the database was pushed forward outside the migration system.
  Recommend one of:
  - fix the repo first, if old applied migrations were edited
  - or deliberately reconcile toward a known target with `sqlfu baseline <target>` and `sqlfu goto <target>`

- History Drift plus Repo Drift
  Recommend:
  1. `sqlfu draft`, if needed, to make Desired Schema and Migrations agree
  2. then resolve History Drift deliberately
  This should be presented as a serious integrity problem, not a routine workflow step.

- Multiple mismatch types with no clearly dominant cause
  Prefer the most upstream mismatch first:
  1. Repo Drift
  2. History Drift
  3. Pending Migrations
  4. Schema Drift
  5. Schema Not Current
  This keeps `sqlfu check` from recommending database reconciliation before the repo itself is coherent.
  Downstream cards may still be shown, but their recommendation text should defer to the highest-priority unresolved mismatch.

## Healthy States

### Repo Healthy

The repo is healthy when:

- replaying Migrations produces the Desired Schema

This is the most important non-database-specific invariant.

### Database Healthy For `migrate`

A database is healthy for `migrate` when:

- its Migration History is trustworthy enough to identify pending migrations
- its Live Schema has not drifted away from what its Migration History implies

If those are not true, applying more migrations on top may be unsafe or at least hard to reason about.

### Database Fully Up To Date

A database is fully up to date when:

- all migrations have been applied
- Migration History matches the available Migrations
- Live Schema matches what that full Migration History implies
- Live Schema also matches the Desired Schema

### Database Healthy Enough For Local Development

A database can be good enough for local work even if it is not history-clean.

For example:

- you run `sqlfu sync`
- the Live Schema now matches the Desired Schema
- but Migration History no longer describes how the schema got there

That may be acceptable for local app development.
It is not the same as proving that migrations are correct.

## The Important `sync` Rule

`sqlfu sync` is allowed to make Migration History and Live Schema disagree.

That is not an implementation accident. It is the point of the command.

`sync` is for getting a database into a useful schema shape quickly.
It is not a command that preserves migration-history integrity.

So after `sync`, there are only a few honest options:

1. Accept that the database is local and history-dirty.
2. Rebuild the database from migrations to restore history cleanliness.
3. Use an explicit repair flow in future, if `sqlfu` eventually grows one.

What `sqlfu` should not do is silently pretend that `sync` preserved the migration chain when it did not.

## Failed Migrations

Migrations fail. Production migrations fail in ways dev migrations do not. The important question is not "did a migration fail?", it is "is this database still honest about what it has applied?".

### `sqlfu_migrations` records success only

A row is written to `sqlfu_migrations` only after a migration's SQL has finished successfully. There is no "failed" row and no failure-status column.

`sqlfu_migrations` means: migrations that succeeded and are part of the trusted migration-history prefix.

This keeps the meaning of Migration History stable. Code that trusts it does not have to distinguish "applied" from "tried".

### "A migration failed" vs "the database is unhealthy for `migrate`"

These are two different questions.

"A migration failed" is a statement about one execution attempt. It describes what happened during a single run of `sqlfu migrate`.

"The database is unhealthy for `migrate`" is a statement about the current state of the database. It asks whether it is safe to apply more migrations from the trusted prefix.

A failed migration does not automatically make the database unhealthy for `migrate`. If the migration fully rolled back, the database is still honest about what it has applied.

A failed migration also does not automatically make the database healthy for `migrate` forever after. If the migration partially persisted state (for example because the migration SQL used its own `commit`, or because it touched something outside the transaction's control), the live schema can end up out of sync with recorded history.

### The post-failure health check

When a migration execution fails, `sqlfu migrate` reruns a narrow migrate-specific health check against the post-failure state.

That check asks:

- Is the recorded Migration History still a trusted prefix of Migrations?
- Does the Live Schema still match the schema that the applied Migration History implies?

If both answers are yes, the database is still healthy for `migrate`. The failure message explicitly says the database remains healthy and the operator can fix the migration and retry.

If either answer is no, the database is no longer healthy for `migrate`. The failure message says reconciliation is required and then shows the same recommendation-style diagnostics `sqlfu check` would show: `sqlfu goto <target>`, `sqlfu baseline <target>`, or a repo-level fix, depending on what drifted.

### Preflight

`sqlfu migrate` runs that same migrate-specific health check once before applying anything.

This is deliberately not the full `sqlfu check`. `Pending Migrations` and `Sync Drift` are not blockers for migrate: `Pending Migrations` is the whole point, and `Sync Drift` is downstream of applying them.

The preflight blocks on the things that would make applying more migrations unsafe or dishonest:

- History Drift
- Schema Drift
- (in the future, additional integrity checks specific to migrate)

Preflight runs even when there are zero pending migrations, because a database with no pending work can still be unhealthy for `migrate`.

### How this fits into the authority model

This behavior is not a separate system. It is the same four-authority model the rest of this document describes.

- Repo migrations and recorded migration history together define the trusted prefix.
- Live schema has to match what that prefix implies, or the database is not safe to migrate further.
- If that relationship holds, a migration failure is a retry. If it does not, the database has to be reconciled with the existing tools (`sqlfu goto`, `sqlfu baseline`, or a manual fix) before `sqlfu migrate` will run again.

`sqlfu` does not invent a repair command for failed migrations. It reuses the tools the model already has.

## Non-Goals

This document intentionally does not answer every implementation question yet.

For example, it does not yet pin down:

- what repair commands should exist
- whether `migrate` should ever allow forcing past history drift

Those should be decided after this conceptual model is stable.

## Related Reading

This document is about migration authorities and command semantics.

For the lower-level SQLite schema diff engine that powers `draft`, `sync`, `goto`, and part of `check`, see [schema-diff-model.md](./schema-diff-model.md).
