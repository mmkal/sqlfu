# sqlfu Schema Diff Model

This document describes what `diffSchemaSql` does today for SQLite, and how the native implementation is put together.

It is intentionally narrower than the migration model doc. The migration model explains which authorities exist and which commands mutate them. This document explains the mechanism `sqlfu` uses when it needs to answer "what SQL would move schema A to schema B?".

## What `diffSchemaSql` Does

`diffSchemaSql` is the SQLite schema-diff entrypoint used by `sqlfu`.

Current signature:

```ts
async function diffSchemaSql(input: {
  projectRoot: string;
  baselineSql: string;
  desiredSql: string;
  allowDestructive: boolean;
}): Promise<string[]>
```

It takes two schema programs:

- `baselineSql`: the schema you have now
- `desiredSql`: the schema you want

It returns an ordered list of SQLite statements that should move the baseline schema to the desired schema.

Those statements are used by the higher-level commands:

- `sqlfu draft`
  compares replayed migrations to `definitions.sql`
- `sqlfu sync`
  compares the live database schema to `definitions.sql`
- `sqlfu goto <target>`
  compares the live database schema to the schema implied by migrations through `<target>`
- `sqlfu check`
  uses the same inspected-schema machinery for semantic equality, rather than relying on raw SQL text fingerprints

## High-Level Approach

The native engine does not diff raw SQL text directly.

Instead it:

1. materializes `baselineSql` into a scratch SQLite database
2. materializes `desiredSql` into another scratch SQLite database
3. inspects both databases semantically using `pragma_*` calls and `sqlite_schema`
4. compares the inspected models
5. emits an ordered SQLite statement plan

That means the comparison is based on normalized SQLite schema state, not on formatting trivia or incidental SQL spelling differences.

This is why quoted and unquoted simple identifiers can compare equal, and why semantic changes like `text` to `text not null unique` are detected correctly even when the old `sqlite3def` path missed them.

## The Current Object Model

The inspected schema currently models:

- tables
- columns
- primary keys
- unique constraints
- explicit indexes
- foreign keys
- views
- triggers

The inspected table-column model also carries:

- declared type
- nullability
- default SQL
- primary-key position
- generated metadata
- hidden metadata
- column-level collation

The model is intentionally narrower than "everything SQLite can store in `sqlite_schema`". The goal is an honest planner for the schema features `sqlfu` actually supports, not a vague promise that every SQLite object kind is diffable.

## Planning Strategy

The planner has two broad modes.

### Direct Statements

When SQLite supports a change directly and the semantics are simple enough, the plan uses direct statements such as:

- `create table`
- `drop table`
- `alter table ... add column`
- `create index`
- `drop index`
- `create view`
- `drop view`
- `create trigger`
- `drop trigger`

### Table Rebuilds

When SQLite does not support a table-core mutation directly, the planner emits a rebuild sequence:

1. rename the old table aside
2. create the desired replacement table
3. copy compatible columns with `insert into ... select ...`
4. drop the old table
5. recreate dependent indexes and triggers as needed

This is how the native engine handles changes such as:

- column drops
- `not null` changes
- unique-constraint changes
- primary-key changes
- type changes that require rebuild
- generated-column changes
- column-collation changes

If a rebuild would require inventing data, the engine fails explicitly instead of silently generating nonsense. The current example is introducing a new primary key on existing rows when there is no honest value source to copy from.

## Dependency Ordering

SQLite still has object dependencies even without PostgreSQL-style schema graphs.

The planner therefore accounts for ordering around:

- foreign-key-related table creation
- view replacement
- trigger recreation when the underlying table or view is rebuilt or replaced

That is why some plans intentionally drop and recreate dependent views or triggers even when their own SQL text has not changed.

## Where The Code Lives

The implementation is mostly concentrated in:

- [src/schemadiff/sqlite/index.ts](../src/schemadiff/sqlite/index.ts)
  SQLite schemadiff entrypoint, scratch-database materialization, and public SQLite-facing exports
- [src/schemadiff/sqlite/inspect.ts](../src/schemadiff/sqlite/inspect.ts)
  SQLite schema inspection and normalization into inspected objects
- [src/schemadiff/sqlite/plan.ts](../src/schemadiff/sqlite/plan.ts)
  SQLite diff planning, dependency ordering, and statement rendering

Supporting pieces live in:

- [src/schemadiff/index.ts](../src/schemadiff/index.ts)
  the stable public `diffSchemaSql(...)` wrapper
- [src/core/sqlite.ts](../src/core/sqlite.ts)
  shared SQLite helpers, including trigger-aware SQL statement splitting
- [src/api.ts](../src/api.ts)
  command integration for `check`, `draft`, `sync`, and `goto`

The `src/schemadiff/sqlite/` folder is the core engine, but it leans on shared SQLite parsing/execution helpers and API-level integration points elsewhere in the tree.

## Supported And Unsupported Scope

Supported today:

- semantic equality of inspected SQLite schemas for the modeled object types
- fixture-driven diffing for constraints, generated columns, multi-column indexes, dependency ordering, triggers, and column collations
- explicit failure for unsupported virtual tables

Intentionally not supported today:

- SQLite virtual tables / FTS tables
- a broader "all possible SQLite objects" promise
- PostgreSQL-only fixture families with no real SQLite analogue

Column `collate ...` clauses are supported as part of table diffing. Separate SQLite collation-object management is not modeled as a first-class schema object.

## Prior Art

The shape of this engine - inspect both schemas into a typed model, diff the inspected models, emit an ordered plan - is taken from [`@pgkit/schemainspect`](https://github.com/mmkal/pgkit/tree/main/packages/schemainspect) and [`@pgkit/migra`](https://github.com/mmkal/pgkit/tree/main/packages/migra), which are themselves TypeScript ports of [`djrobstep/schemainspect`](https://github.com/djrobstep/schemainspect) and [`djrobstep/migra`](https://github.com/djrobstep/migra) by Robert Lechte.

Those projects are PostgreSQL-only. The sqlfu implementation is SQLite-only today and does not copy their code. See [`src/schemadiff/CLAUDE.md`](../src/schemadiff/CLAUDE.md) for more detail on what is borrowed versus sqlfu-specific.

## Why This Replaced `sqlite3def`

The old `sqlite3def` path was too weak for correctness-critical use in `sqlfu`.

The concrete failure that motivated this port was a semantic miss like:

```sql
create table a(b text);
create table a(b text not null unique);
```

That change matters to `check`, `draft`, `sync`, and `goto`. A schema-diff engine that misses it is not a good foundation.

The native inspected-schema path fixes that class of issue by comparing normalized schema meaning rather than trusting a raw textual external diff.
