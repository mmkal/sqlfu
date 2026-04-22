# SQLite Schemainspect/Migra Port Task

This file is a handoff for an agent working independently on replacing the current `sqlite3def`-based schema diffing path with a `schemainspect`/`migra`-style SQLite implementation inside `sqlfu`.

Update this file as you work:
- tick checkboxes when complete
- add short notes under `Work Log`
- if you change the plan materially, edit this file first so the next reader can follow what happened. you can add new checkboxes, change overall instructions etc.

## Goal

Build a SQLite-native inspected-schema + diff engine for `sqlfu`, taking architectural inspiration and test-shape inspiration from `../pgkit/packages/schemainspect` and `../pgkit/packages/migra`.

The important thing is not to preserve the Python-port structure exactly. The important thing is:
- port the useful test cases and fixture style
- make the SQLite behavior correct
- eventually stop depending on `sqlite3def` for correctness-critical schema diffs

## Current Problem

`sqlite3def` is currently missing real semantic diffs, for example:

```sql
create table a(b text);
create table a(b text not null unique);
```

`schemadiff` currently returns no diff for that case. `sqlfu check` has a workaround for detection, but `draft`/`sync`/`goto` still fundamentally depend on `schemadiff` behavior. That is not good enough.

## Constraints

- prefer lowercase SQL keywords
- use TDD for nontrivial work
- write readable integration/spec tests first
- do not preserve legacy baggage if the new design makes it unnecessary
- do not fake SQLite support for PostgreSQL-only features
- if a PostgreSQL fixture has no meaningful SQLite analogue, record that explicitly here rather than inventing nonsense

## Source Material To Read First

Read these before changing anything substantial:

- `../pgkit/packages/schemainspect/src/index.ts`
- `../pgkit/packages/schemainspect/src/inspected.ts`
- `../pgkit/packages/schemainspect/src/inspector.ts`
- `../pgkit/packages/migra/src/index.ts`
- `../pgkit/packages/migra/src/changes.ts`
- `../pgkit/packages/migra/src/statements.ts`
- `../pgkit/packages/migra/test/fixtures.ts`
- `../pgkit/packages/migra/test/FIXTURES/*`

Also inspect these in this repo:

- `packages/sqlfu/src/schemadiff/index.ts`
- `packages/sqlfu/src/schemadiff/sqlite3def.ts`
- `packages/sqlfu/src/core/sqlite.ts`
- `packages/sqlfu/src/api.ts`
- `packages/sqlfu/test/schemadiff.test.ts`
- `packages/sqlfu/test/migrations/*.test.ts`

## Desired End State

At the end of this project:

- `sqlfu` has a SQLite inspected-schema layer
- `sqlfu` has a SQLite diff layer that works from inspected schema, not raw SQL text
- the API surface for the schemadiff submodule is the same: `function diffSchemaSql(input: {projectRoot: string; baselineSql: string; desiredSql: string; allowDestructive: boolean;}): Promise<string[]>`
- there is a fixture-driven test suite inspired by `pgkit` migra fixtures
- `sqlfu check`, `draft`, `sync`, and `goto` use the new engine for SQLite
- `sqlite3def` is either deleted or reduced to a temporary fallback with very explicit boundaries

## Recommended Implementation Order

Do not start by trying to port everything from Postgres. Start with the smallest SQLite slice that can replace real behavior in `sqlfu`.

### Phase 0: Harness And Vocabulary

- [x] Read the `pgkit` source files listed above
- [x] Write down a short terminology section in this file after reading:
  - inspected schema
  - relation
  - column
  - index
  - constraint
  - change
  - statement plan
- [x] Decide the minimal SQLite object model for v1 and write it in this file before implementing it

### Phase 1: SQLite Inspector

Build a SQLite equivalent of a small `schemainspect`.

Start with only these object types:

- [x] tables
- [x] columns
- [x] primary keys
- [x] unique constraints / unique indexes
- [x] non-unique indexes
- [x] foreign keys
- [x] views

Do not start with:

- [x] triggers - added later once the fixture port proved they are a meaningful SQLite schema object for this engine
- [x] collations - added later for column-level `collate ...` support; SQLite collation objects are still not modeled separately
- [x] generated columns unless SQLite makes them unavoidable - added later because the fixture port made them unavoidable
- [x] virtual tables / FTS - intentionally left unsupported, with an explicit native-engine error instead of fake diff support

For each inspected object, prefer explicit normalized fields over raw SQL string comparison.

Suggested shape:

- database
  - tables by name
  - views by name
- table
  - name
  - columns by name
  - primary key
  - indexes
  - foreign keys
- column
  - name
  - declared type
  - not null
  - default
  - primary key position
  - generated / hidden flags if relevant
- index
  - name
  - unique
  - origin
  - columns
  - where clause if partial
- view
  - name
  - normalized definition

Implementation note:
- look at `packages/schemainspect/queries/pg/sql` in `pgkit` for conceptual inspiration only
- for SQLite, use pragmas and `sqlite_schema` where possible and appropriate

### Phase 2: Equality Before Diffing

Before generating migration SQL, build confidence that inspected schemas compare correctly.

- [x] Create SQLite inspector tests for semantic equality / inequality
- [x] Keep or improve the quoted-identifier equivalence behavior
- [ ] Make sure these cases are covered:
  - [x] quoted vs unquoted simple identifiers
  - [x] `not null`
  - [x] `unique`
  - [x] composite indexes
  - [x] view definition changes
  - [x] foreign key changes

### Phase 3: Statement Planning

Build a `migra`-style diff planner for SQLite-inspected objects.

Start with changes that are easiest to express and verify:

- [x] create table
- [x] drop table
- [x] add column
- [x] create index
- [x] drop index
- [x] create view
- [x] drop view

Then handle rebuild-required table changes explicitly:

- [x] column `not null` changes
- [x] unique changes
- [x] primary key changes - handled via rebuild when values can be preserved; fails explicitly when a rebuild would need invented values for a newly introduced primary key
- [x] column drops
- [x] column type changes where SQLite requires table rebuild - handled by the same rebuild planner used for other table-core shape changes

Important:
- do not pretend these are normal `alter table` operations if they are not
- if a rebuild is required, model that directly
- it is fine if the generated SQL is SQLite-specific and operationally blunt at first, as long as it is correct

### Phase 4: Fixture-Driven Porting

Port `pgkit` migra fixture style into `sqlfu`, but filtered through SQLite reality.

Add a SQLite fixture harness similar in spirit to:

- `../pgkit/packages/migra/test/fixtures.ts`

For each fixture family below, do this loop:

1. add a SQLite equivalent fixture or an explicit documented skip
2. add the failing test
3. implement the behavior
4. get it passing
5. update the checklist in this file

#### Fixture Order

Work in this order.

Core SQLite-relevant fixtures:

- [x] `generated` - ported as a rebuild that moves a generated stored column from one logical column to another
- [x] `generated_added` - ported as a rebuild where a plain column becomes a generated stored column
- [x] `constraints` - ported as a table-rebuild fixture for `text` -> `text not null unique`
- [x] `multi_column_index` - ported as explicit multi-column unique index creation on an existing table
- [x] `dependencies` - ported as FK-ordered table creation from an empty baseline
- [x] `dependencies2` - ported as table-to-view replacement with a dependent view preserved across the transition
- [x] `dependencies3` - ported as dependent view recreation around an `add column` plus quoted-identifier view names
- [x] `dependencies4` - ported as chained view creation after replacing an unrelated table with a new table/view stack

SQLite-maybe fixtures, only if meaningful:

- [x] `triggers` - ported as drop/recreate of changed triggers plus creation/deletion of sibling triggers on the same table
- [x] `triggers2` - ported as a trigger-stability fixture proving unrelated trigger order does not cause churn during a table rebuild
- [x] `triggers3` - ported as trigger recreation across a view replacement and table rebuild
- [x] `collations` - ported as a SQLite column-collation rebuild fixture using built-in collations (`nocase` -> `rtrim`)

Probably no real SQLite analogue. Do not fake them. Instead add a documented skip note in this fil explaining why it doesn't make sense to port them (or, if it *does* make sense after all, implement then move them to another section with a note explaining):

- [x] `enumdefaults` - skipped: SQLite has no first-class enum type/default dependency model; rough analogue is plain `check (...)` constraints, already covered elsewhere
- [x] `enumdeps` - skipped: SQLite has no enum objects with dependency ordering; rough analogue is generated-column / FK dependency fixtures
- [x] `extversions` - skipped: SQLite has no extension version management comparable to PostgreSQL; rough analogue would be loadable-extension smoke tests outside schema diffing
- [x] `singleschema` - skipped: SQLite does not use PostgreSQL-style named schemas as a core diff unit; rough analogue would be `main`/`temp`/attached-db scope, which `sqlfu` does not model
- [x] `singleschema_ext` - skipped: same reason as `singleschema`, plus SQLite has no extension DDL analogue here
- [x] `excludeschema` - skipped: SQLite has no schema-qualified filtering model worth porting in this engine
- [x] `excludemultipleschemas` - skipped: same as `excludeschema`
- [x] `inherit` - skipped: SQLite table inheritance does not exist; rough analogue is table rebuild / view layering, already covered separately
- [x] `inherit2` - skipped: same as `inherit`
- [x] `partitioning` - skipped: SQLite has no built-in table partitioning feature analogous to PostgreSQL partitions; rough analogue would be trigger/view sharding, which is application-level
- [x] `privileges` - skipped: SQLite has no GRANT/REVOKE object privilege model inside the schema
- [x] `rls` - skipped: SQLite has no row-level security feature
- [x] `rls2` - skipped: same as `rls`
- [x] `seq` - skipped: SQLite has no standalone sequence objects; rough analogue is `rowid` / `autoincrement`, which is table-local
- [x] `everything` - skipped: this is a PostgreSQL omnibus fixture with many non-SQLite feature classes; the SQLite approach should stay split into targeted fixtures
- [x] `identitycols` - skipped: SQLite has no PostgreSQL identity-column DDL; rough analogue is integer primary key / rowid behavior, not a separate schema object

For each skipped fixture family, write:

- why it is not meaningful for SQLite
- whether there is a rough analogue worth testing separately

### Phase 5: Integrate Into `sqlfu`

After the new engine has enough fixture coverage:

- [x] switch `check()` to use the new SQLite diff/equality path everywhere
- [x] switch `draft` to use the new diff planner
- [x] switch `sync` to use the new diff planner
- [x] switch `goto` to use the new diff planner
- [x] remove now-redundant workaround logic in `api.ts`
- [x] delete `sqlite3def` integration if there is no longer a good reason to keep it

Do not delete the old code before there is replacement coverage.

## What To Put In The Codebase

The likely shape is something like this. Adjust if the code suggests a better split.

- `packages/sqlfu/src/schemadiff/sqlite-native.ts`
  - SQLite inspector types
  - pragma / `sqlite_schema` introspection
  - normalization helpers
  - semantic equality
  - change detection
  - statement planning
- `packages/sqlfu/src/core/sqlite.ts`
  - shared SQLite SQL splitting/extraction helpers
  - trigger-aware statement splitting used by both execution and diffing paths
- `packages/sqlfu/src/schemadiff/index.ts`
  - stable public `diffSchemaSql(...)` entrypoint
- `packages/sqlfu/src/api.ts`
  - `check`, `draft`, `sync`, and `goto` integration points using the native inspector/diff planner
- `packages/sqlfu/test/sqlite-migra/*`
  - fixture harness
  - fixture directories
  - readable end-to-end diff specs

If the final structure differs, update this section with the actual structure.

## Testing Strategy

Use test-first development.

Testing layers:

- [x] unit-ish tests for SQLite inspector object extraction - covered through semantic `schemadiff` specs and direct inspected-schema equality checks rather than a large separate inspector-only suite
- [x] fixture-driven diff tests for inspected-schema changes
- [x] integration tests proving `check`, `draft`, `sync`, and `goto` use the new engine correctly

Important test rule:
- when a test exposes a limitation in the current engine, add a failing spec for desired behavior
- only add “documents current limitation” tests where the limitation is intentional and temporary

## Porting Guidance From `pgkit`

Use `pgkit` for:

- conceptual model
- fixture style
- diff/test discipline
- ordering ideas

Do not copy Postgres-specific assumptions:

- schemas / schema-qualified naming as the core unit
- enums
- extensions
- roles/privileges
- RLS
- partitioning
- function overloading

It is acceptable to diverge sharply from `pgkit` implementation details if SQLite wants a simpler model.

## Definition Of Done

This task is done when:

- [x] the new SQLite inspector exists
- [x] there is a fixture-driven SQLite diff suite
- [x] the known `sqlite3def` misses are covered by tests and fixed in the new engine
- [x] `sqlfu check` does not need special workaround logic for SQLite equality
- [x] `sqlfu draft` and `sqlfu sync` no longer rely on `sqlite3def` for supported SQLite features
- [x] unsupported SQLite schema mutations are either implemented or fail explicitly and honestly

## Decisions

Use this section as you work.

- 2026-04-15: v1 diffing will materialize `baselineSql` and `desiredSql` into scratch SQLite databases, inspect both semantically, then plan SQL from inspected objects. This keeps quoted-identifier equivalence and SQLite normalization working in our favor.
- 2026-04-15: v1 planner will treat table core changes in two buckets:
  - additive `alter table ... add column`
  - rebuild-required changes for column drops, `not null`, `unique`, primary key, foreign key, and type changes
- 2026-04-15: explicit indexes will be planned separately from table core changes. Inline unique constraints remain part of the table model and table rebuild path.

## Terminology

- inspected schema: a normalized in-memory model of a SQLite database produced from `sqlite_schema` and `pragma_*` introspection, not from raw string comparison
- relation: a named schema object that participates in diff planning; for v1 this means tables and views
- column: a normalized table column including name, declared type, nullability, default expression, primary-key position, and generated/hidden metadata when SQLite exposes it
- index: a normalized explicit or implicit SQLite index including uniqueness, origin, ordered key parts, and partial predicate when available
- constraint: a semantic table rule represented explicitly in the inspected model rather than inferred from raw SQL text; for v1 this mainly means primary keys, unique constraints, and foreign keys
- change: a semantic difference between inspected source and target objects, later lowered into SQL statements
- statement plan: the ordered SQLite SQL emitted from a set of changes, including direct `create/drop` statements and table rebuild sequences where SQLite lacks a real `alter`

## Minimal SQLite Object Model For v1

This is the minimum model the implementation should target. Expand only when tests require it.

- database
  - `tables: Record<string, table>`
  - `views: Record<string, view>`
- table
  - `name`
  - `createSql`
  - `columns: column[]`
  - `primaryKey: {columns: string[]} | null`
  - `uniqueConstraints: Array<{name: string | null; columns: string[]}>`
  - `indexes: Record<string, index>`
    - explicit indexes only for statement planning
    - implicit `pk` / inline `unique` indexes still inform equality through `primaryKey` and `uniqueConstraints`
  - `foreignKeys: foreignKey[]`
- column
  - `name`
  - `declaredType`
  - `notNull`
  - `defaultSql`
  - `primaryKeyPosition`
  - `hidden`
  - `generated`
- index
  - `name`
  - `createSql`
  - `unique`
  - `origin`
  - `columns`
  - `where`
- foreignKey
  - `columns`
  - `referencedTable`
  - `referencedColumns`
  - `onUpdate`
  - `onDelete`
  - `match`
- view
  - `name`
  - `createSql`
  - `definition`

## SQLite Fixture Mapping Notes

Use this section to record fixture-family decisions as you go.

- `constraints`: meaningful for SQLite. Ported as a stricter-column-shape rebuild fixture (`text` -> `text not null unique`).
- `multi_column_index`: meaningful for SQLite. Ported as explicit multi-column unique index creation on an existing table.
- `dependencies`: meaningful for SQLite. Ported as topologically ordered table creation via a foreign-key dependency.
- `generated`: meaningful for SQLite because generated stored columns are real schema state. Ported as rebuild fixtures.
- `generated_added`: meaningful for SQLite for the same reason as `generated`. Ported as a plain-column -> generated-column rebuild.
- `dependencies2`: meaningful for SQLite. Ported as a table-to-view replacement while keeping a dependent view alive.
- `dependencies3`: meaningful for SQLite. Ported as dependent view recreation around a table shape change plus awkward quoted identifiers.
- `dependencies4`: partially meaningful for SQLite. Ported as a chained view stack without PostgreSQL materialized views or indexes-on-views.
- `triggers`: meaningful for SQLite. Ported with real SQLite trigger bodies and `instead of` view triggers.
- `triggers2`: meaningful for SQLite. Ported to prove stable triggers do not cause false diffs when table shape changes elsewhere.
- `triggers3`: meaningful for SQLite. Ported as a view-trigger recreation case.
- `collations`: meaningful in a narrower SQLite sense. Ported as column `collate` clauses using built-in SQLite collations rather than PostgreSQL collation objects.
- `enumdefaults`, `enumdeps`, `extversions`, `singleschema`, `singleschema_ext`, `excludeschema`, `excludemultipleschemas`, `inherit`, `inherit2`, `partitioning`, `privileges`, `rls`, `rls2`, `seq`, `everything`, `identitycols`: documented skips because the underlying PostgreSQL feature class does not exist in SQLite in a meaningful like-for-like way.

## Work Log

Append short dated notes here as you work.

- 2026-04-15: Task file created.
- 2026-04-15: Read the referenced `pgkit` schemainspect/migra files and the current `sqlfu` sqlite schemadiff path. Confirmed `diffSchemaSql` is still a thin `sqlite3def` wrapper and `check()` has a separate fingerprint fallback.
- 2026-04-15: Chose a SQLite-native plan: inspect two scratch databases semantically, then emit direct SQLite migration SQL with explicit table rebuild sequences where needed.
- 2026-04-15: Replaced `diffSchemaSql` with a SQLite-native inspected-schema planner in `packages/sqlfu/src/schemadiff/sqlite-native.ts`.
- 2026-04-15: `check()` now compares inspected SQLite schemas directly and no longer falls back to the old schema fingerprint workaround.
- 2026-04-15: Added end-to-end regression coverage for semantic rebuilds in `schemadiff` and migration tests, including preserved-data rebuilds and explicit failure for unsupported automatic primary-key introduction.
- 2026-04-15: Added a pgkit-inspired SQLite fixture harness with initial `constraints`, `multi_column_index`, and `dependencies` fixtures.
- 2026-04-15: Expanded the SQLite fixture harness with `generated`, `generated_added`, `dependencies2`, `dependencies3`, and `dependencies4`.
- 2026-04-15: Documented explicit skip reasons for PostgreSQL-only fixture families so the remaining unchecked Phase 4 items are the genuinely SQLite-meaningful ones.
- 2026-04-15: Added explicit unsupported-feature failures for triggers, collations, and virtual tables so unsupported SQLite features fail honestly instead of diffing silently.
- 2026-04-15: Deleted the remaining `sqlite3def` wrapper and binary-downloader files after confirming nothing still imported them.
- 2026-04-15: Implemented SQLite trigger support in the SQL splitter, inspector, and diff planner, then ported `triggers`, `triggers2`, and `triggers3` fixture families.
- 2026-04-15: Implemented SQLite column-collation support in the inspected table model and ported a SQLite-specific `collations` fixture.
- 2026-04-15: Marked the remaining Phase 1 / Phase 3 / testing / done checklist items with short notes so the task file reflects the final native-engine scope instead of the initial starting constraints.
- 2026-04-15: Added permanent documentation next to `migration-model.md` describing what `diffSchemaSql` does, where the implementation lives, and which SQLite features are intentionally unsupported today.
