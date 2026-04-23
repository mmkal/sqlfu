---
status: ready
size: medium
---

# `dumpSchema`: a replayable schema dump built on the diff engine

## Background

PR #47 fixed the surface-level ordering bug in `extractSchema` (`type → case (table=0, view=1, index=2, trigger=3), name`). That's enough for the common case of tables + indexes, which was what iterate/iterate#1278 hit. But it's still not a reliable "dump and reload" function:

- **Tables with FK references to other tables.** In SQLite, `CREATE TABLE foo(bar_id int references bar(id))` *does* succeed without `bar` existing (FK enforcement is DML-only), so this is actually harmless for the `CREATE TABLE` itself. It only bites if someone enables `foreign_keys` and replays with data, or if the downstream tool validates more strictly.
- **View → view.** `CREATE VIEW a AS SELECT * FROM z_view` is a real error at create time if `z_view` doesn't exist yet. Alphabetical within the "view" group doesn't know anything about this.
- **Trigger → view / trigger → table.** Triggers can reference views; alphabetical ordering within the "trigger" group breaks this.
- **View → view (self-chain).** Cycles are impossible here but long chains need topological order.

Meanwhile, `packages/sqlfu/src/schemadiff/` already has the real machinery for this:

- `graph-sequencer.ts` — generic topological sort with cycle detection (adapted from `@pnpm/deps.graph-sequencer`).
- `schemadiff/sqlite/plan.ts` — `topologicallySortTables` (FK graph) and `transitiveViewDependents` (view dependency closure).
- `schemadiff/CLAUDE.md` — explicitly prefers "inspected structure" over SQL text parsing.

**Key observation:** every internal call site of `extractSchema` in `src/api.ts` pipes the result straight into `diffSchemaSql` as a baseline blob for the differ to parse. None of them replay the extracted SQL. So the replay-correctness property is only needed by *external* consumers (e.g. iterate/iterate#1278 using sqlfu as a dump tool).

## Proposal

Add a new exported function `dumpSchema(client: Client, options?)` that produces a topologically-ordered, replayable SQL blob by round-tripping through the diff engine:

```ts
export async function dumpSchema(client: Client, options?: {excludedTables?: string[]}): Promise<string> {
  const liveSql = await extractSchema(client, 'main', options);
  const statements = await diffSchemaSql(host, {
    baselineSql: '',
    desiredSql: liveSql,
    allowDestructive: true,
  });
  return statements.join('\n');
}
```

The differ's planner already orders tables by FK graph, drops/recreates dependent views around rebuilds, and sequences triggers. Running it with an empty baseline asks it for "the CREATE statements to get from nothing to `liveSql`", which is exactly a replayable dump.

Live home: probably `packages/sqlfu/src/api.ts` (alongside `materializeDefinitionsSchemaForContext`), exported from `index.ts` and `browser.ts`.

## Open questions to resolve during implementation

- **Can `diffSchemaSql` handle `baselineSql: ''`?** Needs verifying — write the red test first and find out. If it can't, either patch the differ to accept empty baseline (probably a one-liner in the sqlite plan entry) or inspect directly.
- **Host argument.** `diffSchemaSql` needs a `SqlfuHost` for scratch-DB materialisation. `dumpSchema` taking only a `Client` won't work. Options:
  1. Take a `SqlfuHost` as the second argument.
  2. Create a throwaway in-memory host on the fly.
  3. Refactor the differ to not need a host (inspect the two SQLs on a scratch client directly, not via `openScratchDb`).
  Pick the smallest. Most likely (2) — if the client is already better-sqlite3 we can spin a sibling `:memory:` DB.
- **Does `extractSchema`'s role change?** For now, no — leave it as-is, keep all internal call sites the same. `dumpSchema` is a narrower higher-level helper layered on top. Later we can consider whether the "extracted as SQL blob" baseline is the right contract for the differ (vs inspected structure directly), but that's a separate refactor.
- **Should we rename `extractSchema` to something that advertises its non-replayable nature?** Maybe `readLiveSchemaSql`. Out of scope for this task — mention it in a "follow-ups" section of the PR body if the naming feels egregious during the work.

## Red test

New file `packages/sqlfu/test/dump-schema.test.ts`. Tests:

1. **Table FK chain, reverse alphabetical.** Create `create table zoo(...); create table animal(zoo_id int references zoo(id));`. Alphabetical order puts `animal` before `zoo`. Dump. Assert the dump executes cleanly on a fresh db *with `PRAGMA foreign_keys = ON`*. (Without the pragma, SQLite lets FKs dangle, so the assertion would pass spuriously.)
2. **View → view chain.** Create `create view z_src as select 1 as id; create view a_reader as select id from z_src;`. Alphabetical puts `a_reader` before `z_src`. Dump, replay on empty db, assert no error.
3. **Trigger referencing view.** Create a view + a trigger on a table that references the view in its body. Dump, replay, assert no error.
4. **Indexes still come after tables.** Regression test for PR #47's coverage — make sure `dumpSchema` doesn't reintroduce the bug `extractSchema` had.

Assertion style: replay on a fresh `:memory:` db and `expect(...).not.toThrow()`. Matches the shape of `core-sqlite.test.ts`'s `extractSchema` test.

## Implementation

1. Red tests above — verify at least one fails with the current `extractSchema`-based approach (the view→view one definitely should).
2. Wire `dumpSchema` in `api.ts` via `extractSchema` + `diffSchemaSql`.
3. Resolve the host-argument question (probably in-memory scratch).
4. Export from `src/index.ts` and `src/browser.ts`.
5. Run the full test suite; update snapshots if any capture dump output.
6. Docs: one-line mention in `packages/sqlfu/README.md` *only* if this is user-facing (see CLAUDE.md on docs surfaces). Probably a deep-dive page at `packages/sqlfu/docs/schema-dump.md` or similar is overkill; an exported function with a clear JSDoc is enough for now.

## Out of scope

- Renaming `extractSchema`.
- Refactoring the differ to work on inspected structure instead of SQL text.
- Making `dumpSchema` the internal baseline source for the differ — all 7 current call sites stay on `extractSchema`.
- Dumping data (rows). This is schema-only. A `pg_dump --schema-only` analogue, not full `pg_dump`.

## Recommendation for iterate/iterate#1278 (fill in once this PR is open)

Once this lands and a version with it is published, iterate can replace their two-step `sqlfu-seed.mjs` with a single `dumpSchema` call — no scratch-DB juggling needed. But note: their current schema (secrets table + index) is already fine with PR #47 alone, so there's no urgency. This mainly matters if their schema grows to include views or triggers.

## Checklist

- [ ] Red tests in `packages/sqlfu/test/dump-schema.test.ts`
- [ ] Verify at least one fails on main (view→view is the most likely candidate)
- [ ] Implement `dumpSchema` in `api.ts`
- [ ] Resolve host-argument question
- [ ] Export from `src/index.ts` and `src/browser.ts`
- [ ] Tests pass
- [ ] Full `pnpm --filter sqlfu test` stays at baseline failure count (the 840 pre-existing formatter failures)
- [ ] JSDoc on `dumpSchema` mentioning it as the "replayable schema dump" entry point and contrasting with `extractSchema`
