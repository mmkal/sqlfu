---
status: done
size: medium
---

# detect spurious definitions

## Status

Implementation complete. Integration tests cover insert/update/delete, pragma, pure DDL, alter-table, and drop-cancels-create cases. Docs note added in `migration-model.md`. Ready for rename into `tasks/complete/`.

## Problem

`definitions.sql` is meant to declare the desired schema. Users could put non-schema statements there by mistake:

```sql
create table posts(id int, slug text, title text, body text);

insert into posts(id, slug, title, body)
values (1, 'hello-world', 'Hello World', 'How is everybody doing');
```

The `insert` has no effect on the declared schema. sqlfu happily parses and runs it in its ephemeral scratch database, then throws the data away when it extracts the schema. The user's intent silently dies. The fact that `definitions.sql` is "just a bag of SQL" rather than a DDL-only file is a footgun.

## Decisions

1. **Detection strategy.** For each non-comment statement in `definitions.sql`, apply it to a scratch database that already has every *other* definitions statement applied, and compare the schema before and after. If the schema did not change, the statement is "spurious" (it had no effect on what sqlfu treats as the source of truth).

   Rationale: the simplest correct check is to use the actual diff engine as an oracle, rather than trying to build a statement classifier. Any statement that doesn't change the inspected schema is by definition a statement that won't make it into any migration drafted by sqlfu. The N+1 scratch-db overhead is acceptable for a lint-style check (definitions.sql is usually small).

   Sketch:

   ```
   baseline_schema = schema_after(all statements)
   for each statement i:
     without_i = schema_after(all statements except i)
     if without_i == baseline_schema:
       flag statement i as spurious
   ```

   Using "leave-one-out" rather than "apply in sequence, diff at each step" is important because it correctly handles cases where two statements share responsibility for a schema object (e.g. `create table` then `alter table add column`). Leave-one-out says "remove this and see if anything is missing". Applied-in-sequence would false-positive on `alter table` statements that look like a no-op for that step but are actually part of building up the final schema incrementally — wait, that's wrong: `alter table add column` *does* change the schema compared to the previous step. But consider `create table t(a int); drop table t; create table t(b int);` — the middle statement is spurious under leave-one-out (removing `drop table t` makes `create table t` fail, actually). So there are degenerate cases. The leave-one-out approach is the most defensible heuristic: it answers "is this statement load-bearing?" It also handles the main real-world cases cleanly.

   Note: `drop table` / `drop index` are load-bearing when preceded by a matching `create` — they are NOT spurious. This falls out of the algorithm naturally.

2. **Where this lives.** New check kind `spuriousDefinitions` added to the `analyzeDatabase` analysis. It appears as a mismatch from `sqlfu check` the same way `repoDrift` or `syncDrift` do. No separate command. Keeps the surface small and fits the existing "analyze everything, recommend next action" pattern.

3. **Severity.** Error (causes `check` to fail), same as other mismatches. Rationale: if there's an `insert` in `definitions.sql`, the user's mental model is broken. The error is *always* a bug, unlike some other mismatches which can be acceptable mid-workflow. We list affected statement fragments in the `details` array.

4. **Ambiguous cases.**
   - `pragma foreign_keys = on` — does not appear in `sqlite_schema`, so after our `extractSchema` it is never observed. It would be flagged as spurious. That's correct behavior: sqlfu does not treat pragmas as part of the schema authority. Document this if the test reveals a naive user would hit it.
   - `insert into sqlite_sequence ...` — similarly ignored, similarly flagged. Fine.
   - A statement that errors when applied in isolation (e.g. an `insert` that references a column the leave-one-out set doesn't create) — we treat apply-failures during leave-one-out as "the statement was load-bearing in some way; don't flag as spurious". Safer default.

5. **No recommendation.** The fix is manual: the user needs to decide what to do with the spurious statements (move to a migration? delete?). We don't auto-generate anything. We just report.

6. **Separate concern: inserts in migrations being wiped by `goto`.** The task file's secondary ask. This is documentation-only for now — `goto` is by design destructive. We add a docs note under the migration model callouts warning that data-mutating statements in migrations can be silently discarded by `sqlfu goto <earlier>` because goto takes the live schema down to the replayed target, which cannot reproduce data-only side-effects. This is NOT a design flaw (migrations are a schema program, not a data program), but it's surprising to users coming from tools like Prisma/Rails which encourage seed data in migrations.

## Acceptance criteria

- [x] `sqlfu check` fails when `definitions.sql` contains `insert`/`update`/`delete`/`pragma` statements (anything that doesn't mutate the schema). _covered by tests in `packages/sqlfu/test/migrations/spurious-definitions.test.ts`_
- [x] The failure message lists which statements were spurious. _statements trimmed to a single line; line numbers deferred — trimmed statement text is usually enough to grep_
- [x] `sqlfu check` passes with a pure DDL `definitions.sql` containing `create table`, `create index`, `create view`, `create trigger`, `alter table add column`, `drop table` (when there's a matching create). _covered_
- [x] An `alter table` that modifies a table created by an earlier statement is NOT flagged. _covered_
- [x] A `drop table`/`drop index` that matches an earlier `create` is NOT flagged. _covered — leave-one-out proves the drop is load-bearing_
- [x] A statement that errors when isolated is NOT flagged. _covered implicitly via `materializeDefinitionsSchemaTolerant` returning null_
- [x] Existing `sqlfu check` behaviors still pass. _full sqlfu test run green except pre-existing better-sqlite3 native-binding env issue unrelated to this change_
- [x] A short docs note is added warning about `insert`s in migrations being wiped by `goto`. _added to `packages/sqlfu/docs/migration-model.md` under the `sqlfu goto` section_

## Checklist

- [x] Write an integration test for the check — multiple scenarios as a table-driven / parametrized test in `packages/sqlfu/test/migrations/`. _went with separate tests rather than parametrized since the assertions differ enough to warrant it; readable top-first_
- [x] Implement the `spuriousDefinitions` detector in `packages/sqlfu/src/api.ts` (or extract into a helper module if the function becomes too big). _kept inline in `api.ts` next to `materializeDefinitionsSchema`_
- [x] Wire the detector into `analyzeDatabase`, adding to the `CheckMismatch` union. _done; placed as the most-upstream mismatch_
- [x] Update `formatCheckFailure` to render statement fragments in the message body. _details already render line-by-line; just added the strings with `- ` prefix_
- [x] Add docs callout about data-mutating statements in migrations (`migration-model.md` or `README.md`). _added under the `sqlfu goto` docs and to the Authority Mismatches table_
- [x] Update UI `SchemaCheckCard` surface so the new mismatch kind appears in the UI cards too. _added `spuriousDefinitions` to the card list and to `SchemaCheckCard['key']`_
- [ ] Rename task file to `tasks/complete/2026-04-18-detect-spurious-definitions.md` when done. _do this last_

## Non-goals

- No auto-fix / auto-remove.
- No UI surface changes beyond what `sqlfu check` already shows.
- No change to how `definitions.sql` is *executed* — only how it's validated.
- No equivalent check for migrations. Migrations can legitimately have data statements (seed data for the schema they create in the same migration).

## Open questions to revisit after implementation

- Should pragmas be special-cased? (Probably not — but if the dev-project happens to have a pragma in definitions.sql, we'll know.)
- Should we report line numbers? Depends on what's easy to extract from `splitSqlStatements`.

## Implementation notes

### Where the detector lives

`findSpuriousDefinitionStatements` in `packages/sqlfu/src/api.ts`. Called from `analyzeDatabase` before any other mismatch is computed. Produces a `spuriousDefinitions` entry in the `mismatches` array.

### Algorithm

For a definitions.sql with N statements:

1. Apply all N statements to a fresh scratch db, extract schema (baseline).
2. For each statement i (0-indexed), apply the remaining N-1 statements to another fresh scratch db. If apply fails, treat the statement as load-bearing and move on. Otherwise extract the schema and compare to the baseline.
3. Flag any statement for which the N-1 schema equals the baseline schema.

Extraction uses the existing `extractSchema` function and the same `schemaDriftExcludedTables` list used everywhere else. This means the detector is consistent with what `sqlfu` treats as the declared schema — including ignoring `sqlfu_migrations`.

### Why leave-one-out (not sequential diff)

Sequential diff would break for legitimate DDL sequences like `create table scratch(x int); drop table scratch;` — the drop looks like it makes no schema change at that step (it reverses the create). Leave-one-out correctly recognizes that removing the drop leaves `scratch` in the schema, so the drop is load-bearing.

### Conservative error handling

If removing a statement causes subsequent statements to fail (e.g. removing `create table posts` would make the following `insert into posts` fail), we treat that statement as load-bearing. Rationale: we'd rather miss a rare false-negative than surface a confusing false-positive for a statement whose removal isn't a clean counterfactual.

### Display format

Spurious statements are rendered into the `details` array as `- <statement>`, with internal whitespace collapsed so a multi-line `insert` fits on one line. That keeps the error message compact and greppable.

### UI

`SchemaCheckCard` now has `spuriousDefinitions` in its key union, and `buildSchemaCheckCards` emits a matching card at the top of the list. UI users see the same information as the CLI check.

### Why no recommendation

There's no mechanical fix. Moving the statement to a migration changes the schema semantics; deleting it is a judgement call. We report and leave the action to the user.

### Per-statement scratch db cost

N+1 scratch databases for a definitions.sql with N statements. `definitions.sql` is usually small (tens of statements at most) so this is fine for a `check`-time operation. If it ever becomes a hotspot, we can short-circuit: if `baselineSchema` and the leave-one-out schema for a DDL statement like `create table` differ, skip ahead to the next statement without constructing every leave-one-out. Not worth it today.

