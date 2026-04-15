# sqlfu

`sqlfu` is a SQLite-first toolkit for projects that want:

- `definitions.sql` as the schema source of truth
- checked-in `.sql` files for queries
- generated TypeScript wrappers next to those queries
- versioned SQL migrations without building a full ORM around the database

It keeps schema design in `definitions.sql`, queries in checked-in `.sql` files, and migrations as explicit SQL files, with tooling to generate typed wrappers and check drift between repo state and a live dev database.

## Install

```sh
npm install sqlfu
```

`sqlfu` currently supports macOS and Linux.

## Project Layout

The default layout is:

```txt
.
├── definitions.sql
├── migrations/
│   └── 20260326120000_add_posts_table.sql
├── sql/
│   ├── some-query.sql
│   └── some-query.ts
└── sqlfu.config.ts
```

`sqlfu.config.ts` is required. It defines the project-level paths that the tooling uses.

## Config

Create `sqlfu.config.ts` in your project root:

```ts
import {defineConfig} from 'sqlfu';

export default defineConfig({
  db: './db/app.sqlite',
  migrationsDir: './migrations',
  definitionsPath: './definitions.sql',
  sqlDir: './sql',
});
```

Required config fields:

- `db`: path to the main dev database used by tooling commands like `sync`, `migrate`, and `generate`
- `migrationsDir`: directory containing migration files
- `definitionsPath`: schema source of truth
- `sqlDir`: directory containing checked-in `.sql` queries

`sqlfu` manages its own temporary files under `.sqlfu/`, including scratch databases used for schema diffing. These are generally safe to delete at any time, they will regenerate as needed.

## Commands

Generate query wrappers from your schema and `.sql` files:

```sh
sqlfu generate
```

Draft a migration file from the diff between replayed migrations and `definitions.sql`:

```sh
sqlfu draft
```

Apply migrations:

```sh
sqlfu migrate
```

Run all migration checks - if migrations need to be generated, applied, or fixed, this will always give a recommendation, so if you only remember one migration-related command, remember this one:

```sh
sqlfu check
```

## Migration Model

`sqlfu` uses:

- versioned SQL migration files applied in filename order
- a native inspected-schema SQLite diff engine to produce structural SQL from the difference between replayed migration state and `definitions.sql`

That means the production path is replayed versioned migrations, not direct declarative apply.

When you run:

```sh
sqlfu draft --name add_posts_table
```

`sqlfu` will:

1. replay migrations into a temporary SQLite database
2. diff that replayed state against `definitions.sql`
3. create a new migration file in `migrations/`

You should still review and edit the generated migration, especially for renames, data backfills, and destructive changes.

There is no committed `snapshot.sql` file.
If you want the guarantees a snapshot file would normally provide, run `sqlfu check`, which verifies that replayed migrations still reproduce `definitions.sql`.

## Migration Mental Model

`sqlfu` reasons about migrations using four "authorities". These are referred to often in docs, help text and error messages:

| Authority | Meaning |
| ------------------- | --------------------------------------------------------------------- |
| `Desired Schema`    | `definitions.sql`, which says what the schema should look like now    |
| `Migrations`        | the ordered transition program, usually `migrations/*.sql`            |
| `Migration History` | the `sqlfu_migrations` table in a specific database                   |
| `Live Schema`       | the schema the database actually has right now                        |

The usual chain of database changes is:

- `Desired Schema` produces `Migrations` via `sqlfu draft`
- `Migrations` produce `Migration History` and `Live Schema` via `sqlfu migrate`
- `Desired Schema` *can* mutate `Live Schema` directly via `sqlfu sync` - typically you'd only want to do this for a dev db

`sqlfu check` names the important ways those authorities can disagree:

| Mismatch | Meaning |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `Repo Drift`           | `Desired Schema` does not match `Migrations`                                                                  |
| `Pending Migrations`   | `Migration History` is behind `Migrations`                                                                    |
| `History Drift`        | `Migration History` conflicts with the known `Migrations`, for example because an applied migration was edited or deleted |
| `Schema Drift`         | `Live Schema` does not match `Migration History`                                                              |

The commands each reconcile a different part of that model. "Smart" ones use schema-diffing to produce "A to B" sql, and are generally less safe to run directly in production environments:

| Command                    | What It Does                                                                 | Is smart? |
| -------------------------- | ---------------------------------------------------------------------------- | --------- |
| `sqlfu draft`             | uses `Desired Schema` to generate a new `Migration` so `Migrations` can catch up | yes       |
| `sqlfu migrate`           | uses `Migrations` to update `Migration History` and `Live Schema` with pending migrations | no        |
| `sqlfu baseline <target>` | uses `Migrations` to rewrite `Migration History` to an exact target without changing `Live Schema` | no        |
| `sqlfu goto <target>`     | uses `Migrations` to move `Live Schema` and `Migration History` to an exact target | yes       |
| `sqlfu sync`              | uses `Desired Schema` to update `Live Schema` directly, ignoring `Migration History` | yes       |
| `sqlfu check`             | compares the authorities, names the mismatch, and recommends the least-destructive next step when possible | no        |

For the full model and mismatch tables, see [docs/migration-model.md](./docs/migration-model.md).
For the SQLite schema diff engine itself, see [docs/schema-diff-model.md](./docs/schema-diff-model.md).

## Opinions imposed

`sqlfu` deliberately leaves out a few migration features that are common elsewhere:

**No repeatable migrations**
`definitions.sql` already plays the role of “what this object should look like now”, and normal versioned migrations capture how you got there. Adding repeatables would create another moving part for the same job.

**No down migrations**
They tend not to be exercised regularly, which means they are usually unverified when you need them most. `sqlfu goto <target>` covers the same operational space while making the danger explicit.

**No JavaScript migrations**
There are legitimate use cases, but they also make migrations harder to reason about, harder to inspect, and easier to couple to application code. `sqlfu` stays SQL-first for now. This may be revisited later if a clear use case justifies the extra complexity.

**Migration naming**
Migrations are generated with a timestamp prefix, based on the ISO-8601 format, with colons replaced by periods. The "Z" is followed by an underscore so you can easily convert to a date fairly easily in javascript if you need to: `new Date(filename.split('_').replace(/T(\d\d)\.(\d\d))\./, 'T$1:$2:')`. The suffix of the migration file can be anything path-safe. This project uses snake-case the suffixes.

The name of the migration, if created using `sqlfu draft`, will be based on the statements in the generated diff. It can be changed manually before it has been run, but there should usually be no need to.

## What `generate` Does

`sqlfu generate`:

1. exports the schema from your configured main database into a temporary SQLite database for TypeSQL
2. generates TypeScript wrappers next to those `.sql` files
3. refines generated result types for some SQLite cases that TypeSQL currently misses

Generated TypeSQL outputs stay next to your `.sql` files.

## SQL Formatter

`sqlfu` includes a SQL formatter via `formatSql()`.

It is opinionated. The default style is SQLite-first, uses lowercase keywords and types, and tries to keep simple clauses inline when they still read well. For example, it prefers:

```sql
select foo, bar
from baz
```

over the more aggressively expanded (and SHOUTY) default style from upstream `sql-formatter`:

```sql
SELECT
  foo,
  bar
FROM
  baz
```

(casing is configurable, as it is in sql-formatter, but the aggressive expansion isn't possible with sql-formatter)

The implementation started as a vendored copy of [`sql-formatter`](https://github.com/sql-formatter-org/sql-formatter). `sqlfu` diverged because upstream tends to put simple clause bodies on separate lines more often than we want. The vendored formatter still provides the parser and dialect support, but `sqlfu` adds its own wrapper and compacting pass on top.

If you want to see or change that behavior, start here:

- [src/formatter.ts](./src/formatter.ts)
- [src/vendor/sql-formatter/AGENTS.md](./src/vendor/sql-formatter/AGENTS.md)
- [test/formatter/sqlite.fixture.sql](./test/formatter/sqlite.fixture.sql)
- [test/formatter.test.ts](./test/formatter.test.ts)

## Notes

- `definitions.sql` remains the schema source of truth
- `migrations/` is the source of truth for deployment history
- runtime adapters can be imported from `sqlfu/client`, for example `createExpoSqliteClient`
- `sqlfu` uses scratch SQLite databases under `.sqlfu/` when it needs to diff one schema program against another
- SQLite view typing is still imperfect in TypeSQL, and some expressions such as `substr(...)` are not inferred directly, so `sqlfu` applies a small post-pass to improve generated result types without changing the SQL-first workflow
