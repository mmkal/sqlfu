# sqlfu

`sqlfu` is a SQLite-first toolkit for projects that want:

- `definitions.sql` as the schema source of truth
- checked-in `.sql` files for queries
- generated TypeScript wrappers next to those queries
- versioned SQL migrations without building a full ORM around the database

It is built around `@libsql/client`, `typesql-cli`, and `sqlite3def`.

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
  dbPath: './db/app.sqlite',
  migrationsDir: './migrations',
  definitionsPath: './definitions.sql',
  sqlDir: './sql',
});
```

Required config fields:

- `dbPath`: default database path for `sqlfu sync` and migration commands
- `migrationsDir`: directory containing finalized and draft migration files
- `definitionsPath`: schema source of truth
- `sqlDir`: directory containing checked-in `.sql` queries

`sqlfu` manages its own temporary files under `.sqlfu/` and uses a fixed bundled `sqlite3def` version internally.

## Commands

Generate query wrappers from your schema and `.sql` files:

```sh
sqlfu generate
```

Create or update the draft migration:

```sh
sqlfu draft --name add_posts_table
```

Apply finalized migrations only:

```sh
sqlfu migrate
```

Apply finalized migrations plus the draft in a disposable or explicitly in-progress environment:

```sh
sqlfu migrate --include-draft
```

Finalize the current draft after validation:

```sh
sqlfu finalize
```

Run all migration checks:

```sh
sqlfu check
```

Run a single named check:

```sh
sqlfu check no-draft
```

## Migration Model

`sqlfu` uses:

- versioned SQL migration files with explicit `draft`/`final` metadata
- `sqlite3def` to draft structural SQL from the difference between replayed migration state and `definitions.sql`

That means the production path is replayed versioned migrations, not direct declarative apply.

When you run:

```sh
sqlfu draft --name add_posts_table
```

`sqlfu` will:

1. replay finalized migrations into a temporary SQLite database
2. if a draft already exists, replay that too
3. diff that effective migration state against `definitions.sql`
4. create or update the single draft migration in `migrations/`

You should still review and edit the generated migration, especially for renames, data backfills, and destructive changes.

There is no committed `snapshot.sql` file.
If you want the guarantees a snapshot file would normally provide, run `sqlfu check`, which verifies that replayed migrations still reproduce `definitions.sql`.

## What `generate` Does

`sqlfu generate`:

1. materializes `definitions.sql` into a temporary SQLite database
2. writes `typesql.json`
3. runs `typesql compile`
4. refines generated result types for some SQLite cases that TypeSQL currently misses

Generated TypeSQL outputs stay next to your `.sql` files.

## Notes

- `definitions.sql` remains the schema source of truth
- `migrations/` is the source of truth for deployment history
- runtime adapters can be imported from `sqlfu/client`, for example `createExpoSqliteClient`
- `sqlfu` auto-downloads `sqlite3def` for macOS and Linux into `.sqlfu/`
- SQLite view typing is still imperfect in TypeSQL, and some expressions such as `substr(...)` are not inferred directly, so `sqlfu` applies a small post-pass to improve generated result types without changing the SQL-first workflow
