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

- [ ] tables
- [ ] columns
- [ ] primary keys
- [ ] unique constraints / unique indexes
- [ ] non-unique indexes
- [ ] foreign keys
- [ ] views

Do not start with:

- [ ] triggers
- [ ] collations
- [ ] generated columns unless SQLite makes them unavoidable
- [ ] virtual tables / FTS

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

- [ ] Create SQLite inspector tests for semantic equality / inequality
- [ ] Keep or improve the quoted-identifier equivalence behavior
- [ ] Make sure these cases are covered:
  - [ ] quoted vs unquoted simple identifiers
  - [ ] `not null`
  - [ ] `unique`
  - [ ] composite indexes
  - [ ] view definition changes
  - [ ] foreign key changes

### Phase 3: Statement Planning

Build a `migra`-style diff planner for SQLite-inspected objects.

Start with changes that are easiest to express and verify:

- [ ] create table
- [ ] drop table
- [ ] add column
- [ ] create index
- [ ] drop index
- [ ] create view
- [ ] drop view

Then handle rebuild-required table changes explicitly:

- [ ] column `not null` changes
- [ ] unique changes
- [ ] primary key changes
- [ ] column drops
- [ ] column type changes where SQLite requires table rebuild

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

- [ ] `generated`
- [ ] `generated_added`
- [ ] `constraints`
- [ ] `multi_column_index`
- [ ] `dependencies`
- [ ] `dependencies2`
- [ ] `dependencies3`
- [ ] `dependencies4`

SQLite-maybe fixtures, only if meaningful:

- [ ] `triggers`
- [ ] `triggers2`
- [ ] `triggers3`
- [ ] `collations`

Probably no real SQLite analogue. Do not fake them. Instead add a documented skip note in this fil explaining why it doesn't make sense to port them (or, if it *does* make sense after all, implement then move them to another section with a note explaining):

- [ ] `enumdefaults`
- [ ] `enumdeps`
- [ ] `extversions`
- [ ] `singleschema`
- [ ] `singleschema_ext`
- [ ] `excludeschema`
- [ ] `excludemultipleschemas`
- [ ] `inherit`
- [ ] `inherit2`
- [ ] `partitioning`
- [ ] `privileges`
- [ ] `rls`
- [ ] `rls2`
- [ ] `seq`
- [ ] `everything`
- [ ] `identitycols`

For each skipped fixture family, write:

- why it is not meaningful for SQLite
- whether there is a rough analogue worth testing separately

### Phase 5: Integrate Into `sqlfu`

After the new engine has enough fixture coverage:

- [ ] switch `check()` to use the new SQLite diff/equality path everywhere
- [ ] switch `draft` to use the new diff planner
- [ ] switch `sync` to use the new diff planner
- [ ] switch `goto` to use the new diff planner
- [ ] remove now-redundant workaround logic in `api.ts`
- [ ] delete `sqlite3def` integration if there is no longer a good reason to keep it

Do not delete the old code before there is replacement coverage.

## What To Put In The Codebase

The likely shape is something like this. Adjust if the code suggests a better split.

- `packages/sqlfu/src/schemainspect/sqlite/*`
  - SQLite inspector types
  - introspection queries / pragma readers
  - normalization helpers
- `packages/sqlfu/src/migra/sqlite/*`
  - change detection
  - statement planning
  - dependency ordering if needed
- `packages/sqlfu/test/sqlite-migra/*`
  - fixture harness
  - fixture directories
  - readable end-to-end diff specs

If the final structure differs, update this section with the actual structure.

## Testing Strategy

Use test-first development.

Testing layers:

- [ ] unit-ish tests for SQLite inspector object extraction
- [ ] fixture-driven diff tests for inspected-schema changes
- [ ] integration tests proving `check`, `draft`, `sync`, and `goto` use the new engine correctly

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

- [ ] the new SQLite inspector exists
- [ ] there is a fixture-driven SQLite diff suite
- [ ] the known `sqlite3def` misses are covered by tests and fixed in the new engine
- [ ] `sqlfu check` does not need special workaround logic for SQLite equality
- [ ] `sqlfu draft` and `sqlfu sync` no longer rely on `sqlite3def` for supported SQLite features
- [ ] unsupported SQLite schema mutations are either implemented or fail explicitly and honestly

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

- None yet.

## Work Log

Append short dated notes here as you work.

- 2026-04-15: Task file created.
- 2026-04-15: Read the referenced `pgkit` schemainspect/migra files and the current `sqlfu` sqlite schemadiff path. Confirmed `diffSchemaSql` is still a thin `sqlite3def` wrapper and `check()` has a separate fingerprint fallback.
- 2026-04-15: Chose a SQLite-native plan: inspect two scratch databases semantically, then emit direct SQLite migration SQL with explicit table rebuild sequences where needed.
