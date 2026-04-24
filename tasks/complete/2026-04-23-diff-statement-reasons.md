---
status: done
size: small
---

# Annotate weird/destructive diff statements with `-- reason` comments

## Status (executive summary)

Implemented and landed. Reasons are emitted as `-- ...` comment lines above:
- table rebuild prologue (`alter table X rename to __sqlfu_old_X`),
- cascade view/trigger drops+recreates (when the object itself wasn't user-modified),
- drop-column cascade ops (indexes/views/triggers dropped because the column was).

Statements reflecting direct user intent (added/dropped tables, `add column`, user-modified views/triggers) stay uncommented. All 1303 existing tests pass; snapshot fixtures updated and eyeballed. One new fixture case in `basics.sql` covers the "columns reordered" case (`(low, high) -> (low, mid, high)`).

## Summary

When the schema differ emits something destructive or non-obvious — table rebuild via `__sqlfu_old_X` rename, drop-and-recreate of views/triggers that didn't themselves change, drop-index that cascades from a column drop — prepend a single `-- <reason>` comment above the statement (or statement group) so a human reading the generated migration immediately sees **why** it's there.

The reason must cite the underlying trigger, not the surface observation. Don't say "columns reordered" if the real cause is a changed foreign key; don't say "column inserted at position 1" when the generalized reason is "columns reordered" (which is itself caused by position change — report the generalized cause, not the leaf detail). Specific, clear, brief — in that order of priority, but land somewhere reasonable on all three.

## Scope — which statements get reasons

Per statement, not per block. Most statements won't need one. Only annotate when the statement is **unexpected from a naive reading of the baseline/desired diff** — i.e. the user would ask "why is this here?" looking at the migration alone.

**Annotate:**

- [ ] **Table rebuild prologue** (`alter table X rename to __sqlfu_old_X`) — reason cites the specific classification trigger: constraint change (pk/uk/fk), column dropped, column reordered, column type/collation/default/not-null changed, generated/hidden column introduced, etc. One reason per rebuild, above the `rename`. The `create table`, `insert into ... select`, and `drop table __sqlfu_old_X` that follow don't need their own reasons — they're obvious consequences of the rebuild.
- [ ] **View drops/creates that cascade from a table rebuild** (views that were NOT themselves modified) — reason: `recreating because table X was rebuilt`. Annotate both the `drop view` and the following `create view`.
- [ ] **Trigger drops/creates that cascade from a table rebuild or view recreation** — same pattern: `recreating because table X was rebuilt` or `recreating because view X was rebuilt`.
- [ ] **Drop-column cascade ops** (from `planDirectDropColumnOperations`): `drop index`, `drop view`, `drop trigger` that exist only because the column being dropped is referenced. Reason: `dropping because column X is being removed from table Y`. Their recreation counterparts get `recreating because column X was removed from table Y`.

**Do NOT annotate:**

- `create table X` (added), `drop table X` (user removed it), `alter table X add column Y` (trivially reflects intent), `alter table X drop column Y` when requested directly, `create view`/`drop view` when the view itself was added/removed/modified by the user, index creates/drops that reflect user intent directly, trigger creates/drops that reflect user intent directly. The user wrote (or removed) these objects; no explanation needed.

## Reason wording guidelines

- One short line. Lowercase sentence, no trailing period. Fits in ~100 chars.
- Identifier-quote table/column/view/trigger names the same way the SQL does, so copy-paste names line up.
- Generalize to the real cause, not the trigger that fired the classification branch. `columns reordered` beats `column "mid" inserted at position 1` when the latter is an incidental observation of the former. But `column "x" type changed from int to text` is fine — that IS the real cause.
- When multiple reasons could apply to the same rebuild, pick the most specific one (or concatenate briefly with `; `). Don't invent a taxonomy; `freeform strings are absolutely fine` per the user.
- Cascading recreations cite the root cause: the view is being dropped because table X is being rebuilt, not because "dependencies changed".

## Examples

```sql
-- rebuild: column "name" collation changed from nocase to rtrim
alter table person rename to __sqlfu_old_person;
create table person(name text collate rtrim, nickname text collate rtrim);
insert into person(name) select name from __sqlfu_old_person;
drop table __sqlfu_old_person;
```

```sql
-- rebuild: columns reordered
alter table a rename to __sqlfu_old_a;
create table a(low int, mid int, high int);
insert into a(low, high) select low, high from __sqlfu_old_a;
drop table __sqlfu_old_a;
```

```sql
-- recreating because table "users" was rebuilt
drop view active_users;
-- ... (rebuild statements for users)
-- recreating because table "users" was rebuilt
create view active_users as select * from users where active = 1;
```

```sql
-- dropping because column "legacy_id" is being removed from table "users"
drop index users_legacy_id_idx;
alter table users drop column legacy_id;
```

## Implementation plan

### 1. Classify with reasons

- [ ] Extend `classifyTableChange` return value: `{kind: 'rebuild', reason: string}`. The reason is computed at the decision site — each failing condition in the prefix/position check produces a specific string. See `packages/sqlfu/src/schemadiff/sqlite/plan.ts:277-289` for the conditions we already evaluate.
- [ ] Table-rebuild reason taxonomy (freeform strings, not an enum — just examples of what the conditions should report):
  - primary key changed: `rebuild: primary key changed`
  - unique constraints changed: `rebuild: unique constraints changed`
  - foreign keys changed: `rebuild: foreign keys changed`
  - columns reordered (baseline columns not a positional prefix): `rebuild: columns reordered` (if the set is the same) or `rebuild: columns changed` (if set differs too)
  - column definition changed (same name, different shape): `rebuild: column "X" <what> changed from Y to Z` (e.g. type, collation, not-null, default)
  - generated/hidden column introduced in a new column: `rebuild: new column "X" is generated` / `rebuild: new column "X" is hidden`
  - column dropped but drop-column path rejected (check constraint, part of pk/uk/fk, etc.): `rebuild: column "X" dropped and <why direct drop rejected>`
- [ ] Prefer cheap-to-compute specific reasons over a generic fallback. If we genuinely can't pin it down, `rebuild: schema shape changed` is an OK escape hatch but should be rare.

### 2. Plumb reasons through the plan

Keep the planner's output as `string[]` at the function boundary, but allow elements to be either a SQL statement string or a `-- reason` comment line. Concretely: `planTableRebuild` accepts a `reason` argument and prepends `-- ${reason}` as its first emitted line. `splitStatementForOutput` must not drop `--` comment lines.

- [ ] Update `planTableRebuild(baseline, desired, reason)` signature.
- [ ] Verify `splitStatementForOutput` passes through single-line `--` comments unchanged (it already trims whitespace and filters empties; a `-- foo` line should survive).
- [ ] Call site at `plan.ts:111` passes `classification.reason`.

### 3. Cascading recreations (views & triggers)

- [ ] In the main `planSchemaDiff` flow (around `plan.ts:173-234`), when emitting a drop or create for an object in `recreatedViewNames` / `recreatedTriggerNames` (i.e. objects that are NOT in `modifiedViewNames`/`modifiedTriggerNames` and NOT in the user-requested add/remove sets), prepend `-- recreating because table "X" was rebuilt` (or `because view "Y" was recreated`, for triggers that depend on a recreated view).
- [ ] The "because" object is the nearest rebuilt table or modified view in the dependency chain. For now, pick any one rebuilt table the view/trigger (transitively) depends on — don't over-engineer. If multiple, pick lexicographically first, or concatenate with `, `.

### 4. Drop-column cascade reasons

- [ ] In `planDirectDropColumnOperations`, tag each generated `drop-index`, `drop-view`, `drop-trigger`, and their recreation counterparts with a reason. Include it in the `SchemadiffOperation` shape (`sql` field can gain a leading `-- reason\n` line, OR add a `reason?: string` field and prepend at render time).
- [ ] The column-drop `alter table X drop column Y` itself doesn't need a reason — it reflects direct user intent.

### 5. Tests / snapshot update

- [ ] Fixture tests (`packages/sqlfu/test/schemadiff/fixtures/*.sql`) are auto-updatable via `pnpm -C packages/sqlfu test -- -u`. After implementing, run the update and **eyeball every reason** in the diff — this is the review surface for reason wording quality. Don't just accept the snapshot diff blindly.
- [ ] Add at least one new fixture case in `basics.sql` that's specifically about the reason annotation — e.g. column reorder (new column inserted in the middle) — so the snapshot explicitly captures the `rebuild: columns reordered` reason.
- [ ] Integration tests (`packages/sqlfu/test/migrations/migrations.test.ts`) should still pass; comments in SQL don't affect execution. If a test is matching exact SQL strings rather than behavior, rewrite it to match behavior.

### 6. Follow-ups / out of scope

- Structured (tagged-union) reasons for machine consumption by the UI — out of scope. Freeform strings only for now. UI can render `-- ...` comments as hover-tooltips on the relevant statement later if we want.
- Reasons on PostgreSQL diff output — out of scope, there is no pg diff engine yet.

## Notes on design decisions to flag

- **Freeform strings, inline `-- comment` rendering.** Cheapest implementation; matches what the user asked for; easy to iterate on wording without schema changes.
- **Per-statement, not per-block.** User specifically asked for per-statement. A rebuild block gets one reason on the `rename to __sqlfu_old_X` line; the follow-up statements are self-explanatory given that header.
- **Cite root cause, not surface observation.** User explicitly called this out: "inserted at position 1 isn't why — it's because columns reordered".
