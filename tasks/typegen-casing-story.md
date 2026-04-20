status: needs-grilling
size: medium

# Typegen casing story: snake_case vs camelCase across the generated output

## Why this exists

Landed PR #23 on the back of "typegen emits everything your app needs." That exposes a design question that was easier to hand-wave when typegen only emitted query wrappers: **what casing convention do TS-side identifiers follow when they derive from DB-side names?**

Today typegen preserves whatever the DB uses. Snake-cased columns come out as snake-cased TS field keys:

```ts
export type PostsRow = {
  id: number;
  slug: string;
  created_at: string;   // DB column is `created_at`
  published_at: string | null;
};

export type InsertMigrationParams = {
  name: string;
  checksum: string;
  applied_at: string;   // named placeholder was `:applied_at`
};
```

That's "honest" but not JS-idiomatic. From a code review on #23:

> hmm wondering why this is `applied_at` not `appliedAt` - this is a javascript concept rather than a literal column.

Reviewer's instinct is the JS default: camelCase in JS, snake_case at the SQL edge. Which is what drizzle, kysely, and prisma all do (by default; configurable). But sqlfu's whole thing is "SQL First, TypeScript Second" — there's a real argument for preserving column names verbatim.

This needs a deliberate answer before it proliferates through consumers.

## Surfaces affected

The decision cuts across every generated identifier that has a DB counterpart:

| Surface                              | Today (snake-preserving)         | Alternative (camel-conventional) |
| ------------------------------------ | -------------------------------- | -------------------------------- |
| Table row type fields                | `applied_at: string`             | `appliedAt: string`              |
| View row type fields                 | `published_at: string \| null`   | `publishedAt: string \| null`    |
| Query result columns (select list)   | `post_id: number`                | `postId: number`                 |
| Query param names (from `:ident`)    | `applied_at: string`             | `appliedAt: string`              |
| Query data names (for insert/update) | `post_id: number`                | `postId: number`                 |
| Function names                       | Already camelCase (from filename) | —                               |
| Row type names                       | Already PascalCase (from table name) | —                             |
| SQL string constants                 | Not affected (it's a string)     | —                                |

If casing flips, the runtime argument-building in the wrapper changes too: today `args: [params.applied_at, ...]`; after flip, `args: [params.appliedAt, ...]`. That's a codegen change, not just a type change.

## Options

### A. Preserve DB casing (today's behavior, status quo)

TS identifiers match DB verbatim. snake_case in = snake_case out.

- **Pro**: truthful. Opening a file and comparing the generated type to the SQL is a visual identity — no mental mapping. Matches sqlfu's "SQL First" framing.
- **Pro**: no configuration needed; no ambiguity for `snake_case_with_numbers_2`, mixed-case table names, etc.
- **Pro**: interop with raw SQL results (when users go around the wrapper and hit the client directly) is free — the row shapes line up.
- **Con**: looks un-idiomatic in TS code. Linters with `camelcase` rules complain.
- **Con**: a consumer who uses the row type in a React component ends up with JSX attributes named `applied_at`, which looks odd.

### B. Always camelCase (drizzle/kysely default)

Snake-cased columns come out as camelCased TS. `applied_at` → `appliedAt`. Insert parameter `:applied_at` → `appliedAt` in the param type. The wrapper converts between them at the boundary.

- **Pro**: idiomatic TS. Matches what most JS devs expect.
- **Pro**: decouples TS API from DB naming. Users can rename a column from `legacy_foo` to `better_foo` without touching every caller (if the map happens at codegen time and the TS name was already aliased — but see below, this isn't automatic).
- **Con**: sqlfu loses the "what you see in SQL is what you see in TS" property. A reviewer looking at `insert into x (applied_at) values (:applied_at)` would need to know typegen silently rewrites it to `appliedAt`.
- **Con**: mapping introduces footguns. `applied_at` and `appliedAt` as two columns becomes an error. `id_1` / `id_2` casing is ambiguous. Collisions need detection.
- **Con**: breaks interop with raw SQL results — `client.all({sql: '...'})` returns `applied_at` keys, generated wrappers return `appliedAt` keys. Users who mix the two get confused.

### C. Config-level option (`generate.casing: 'preserve' | 'camel'`)

Punt the decision to the user. Default to one and let the other be opt-in.

- **Pro**: lets teams choose based on their codebase norms. Doesn't force a single answer.
- **Con**: two code paths in typegen to maintain (wrapper generation, row types, arg-mapping, catalog). Matrix of permutations: `casing × validator × sync × pretty-errors` gets wide.
- **Con**: public API surface area grows. Every new typegen feature has to declare how it interacts with casing.
- **Con**: a sqlfu project that imports a second sqlfu project as a dependency needs them to agree on casing or renames get fun.

### D. Per-column alias in config or SQL (like drizzle's `.mapsTo()`)

Let users name columns in TS independently of the DB:

```ts
// sqlfu.config.ts
export default {
  columnAliases: {
    'sqlfu_migrations.applied_at': 'appliedAt',
  },
};
```

or a comment directive in SQL:

```sql
select name, applied_at /* as appliedAt */ from sqlfu_migrations;
```

- **Pro**: surgical. A team can camelCase the 5% of columns that matter in UI code and leave the rest.
- **Pro**: works alongside option A (preserve) as the default.
- **Con**: each alias is another place for drift. Adding a column without updating the alias list silently falls back to snake.
- **Con**: config format grows. Globbing (`sqlfu_migrations.*` → `camel`) starts to look like option C again.

## Open questions — to grill on before implementing

1. **Which option reflects sqlfu's identity?** "SQL First, TypeScript Second" leans toward A (preserve). But drizzle etc. lean toward B (camel), and sqlfu is differentiating on *query-filename-is-identity*, not *SQL-column-is-TS-field-name*. Is the preservation actually load-bearing for the positioning, or is it an accident of "we haven't decided yet"?
2. **What's the default?** If we pick C (configurable), what's the out-of-box behavior? Landing the feature matters less than landing the default — nobody changes defaults until they have a reason.
3. **Named-placeholder casing (`:applied_at` vs `:appliedAt`)**: is this the same question, or a different one? Users write the SQL. If casing is about "mechanical rewrite at the TS boundary," then `:applied_at` → `applied_at` in params makes sense. If it's about "TS feels like TS," then `:applied_at` in SQL becoming `appliedAt` in the param type means the SQL author had to type `:applied_at` in the SQL but callers write `.appliedAt` in TS. That's the drizzle/kysely approach, but it's surprising.
4. **Reserved words / collisions**: `default`, `new`, `delete` are legal SQL column names and illegal TS identifiers. Today we'd emit them verbatim and users get syntax errors. Does the casing story include a "sanitize reserved words" step?
5. **Interop with `client.all({sql, args})`**: when users bypass the wrapper and run raw SQL, rows come back with DB casing. If wrappers return camelCase, there are now two shapes of the same row in a codebase. Is that OK, or does the wrapper layer need to expose a "raw row type" too?
6. **Migration cost**: changing from A → B (or vice versa) mid-project is a rename across every caller. When's the right time? PR #23 already made one cross-surface rename (`appliedAt` → `applied_at` in the UI types) on the assumption that A is the default; changing to B would flip that back. Probably fine while we're pre-pre-alpha, but worth saying out loud.
7. **Is there a hybrid?** Emit snake_case as the *row* type (matches column names, matches raw `client.all` results) but camelCase as the *function signature* (what consumers type every day). The mapping happens in the wrapper. This is arguably the least-bad of both worlds — but it means row-shape types and function-argument types disagree, which is its own form of inconsistency.

## Deliberately out of scope for this task

- Naming of table row types (already PascalCase via `relationTypeName`, settled)
- Naming of wrapper functions (already camelCase from the filename, settled)
- Runtime rename of DB columns on the *query* side (that's a separate "schema migration helper" ask)

## Breadcrumb

Raised in review of #23 at comment [#3111982883](https://github.com/mmkal/sqlfu/pull/23#discussion_r3111982883) — specifically the `insert-migration.sql.ts` generated output where `applied_at` as a TS field read as un-idiomatic.

PR #23 shipped with option A (preserve). If we pick anything else here, #23's `appliedAt` → `applied_at` UI rename becomes the wrong direction and we'll revert it.
