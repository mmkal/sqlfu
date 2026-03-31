# sqlfu

`sqlfu` is a SQLite-first toolkit for projects that want:

- `definitions.sql` as the schema source of truth
- checked-in `.sql` files for queries
- generated TypeScript wrappers next to those queries
- versioned SQL migrations without building a full ORM around the database

It is built around `@libsql/client`, `typesql-cli`, `sqlite3def`, and `dbmate`.

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
├── snapshot.sql
├── sql/
│   ├── some-query.sql
│   └── some-query.ts
└── sqlfu.config.ts
```

You can keep the defaults or point `sqlfu` somewhere else with `sqlfu.config.ts`.

## Config

Create `sqlfu.config.ts` in your project root:

```ts
import {defineConfig} from 'sqlfu';

export default defineConfig({
  dbPath: './db/app.sqlite',
  migrationsDir: './migrations',
  snapshotFile: './snapshot.sql',
  definitionsPath: './definitions.sql',
  sqlDir: './sql',
});
```

Useful config fields:

- `dbPath`: default database path for `sqlfu migrate ...`
- `migrationsDir`: versioned SQL migrations managed by dbmate
- `snapshotFile`: dbmate schema dump used as the migration baseline snapshot
- `definitionsPath`: schema source of truth
- `sqlDir`: directory containing checked-in `.sql` queries
- `tempDir`: working directory for downloaded binaries and generated temp databases
- `tempDbPath`: schema-materialized database used during `sqlfu generate`
- `typesqlConfigPath`: generated TypeSQL config path
- `sqlite3defBinaryPath`: custom `sqlite3def` binary location
- `sqlite3defVersion`: `sqlite3def` release to auto-download

## Commands

Generate query wrappers from your schema and `.sql` files:

```sh
sqlfu generate
```

Create a new migration draft from `snapshot.sql` to `definitions.sql`:

```sh
sqlfu migrate new --name add_posts_table
```

Apply pending migrations with dbmate:

```sh
sqlfu migrate up
```

Show migration status:

```sh
sqlfu migrate status
```

Refresh `snapshot.sql` from the configured database:

```sh
sqlfu migrate dump-schema
```

Inspect drift between the configured database and `definitions.sql`:

```sh
sqlfu migrate diff
```

Fail if the configured database does not match `definitions.sql`:

```sh
sqlfu migrate check
```

If you need to override config for one command, flags still work:

```sh
sqlfu migrate diff --db-path ./tmp/scratch.db
sqlfu generate --sql-dir ./src/sql
```

## Migration Model

`sqlfu` uses:

- `dbmate` for versioned migration files, apply/status, and `snapshot.sql`
- `sqlite3def` only to draft the `migrate:up` section of a new migration from the difference between `snapshot.sql` and `definitions.sql`

That means the production path is versioned migrations, not direct declarative apply.

When you run:

```sh
sqlfu migrate new --name add_posts_table
```

`sqlfu` will:

1. materialize `snapshot.sql` into a temporary SQLite database
2. diff that baseline against `definitions.sql`
3. create a dbmate migration file in `migrations/`
4. prefill the `-- migrate:up` section with the generated SQL draft

You should still review and edit the generated migration, especially for renames, data backfills, and destructive changes.

## What `generate` Does

`sqlfu generate`:

1. materializes `definitions.sql` into a temporary SQLite database
2. writes `typesql.json`
3. runs `typesql compile`
4. refines generated result types for some SQLite cases that TypeSQL currently misses

Generated TypeSQL outputs stay next to your `.sql` files.

## Notes

- `definitions.sql` remains the schema source of truth
- `snapshot.sql` is the committed snapshot of the last applied migration state
- `migrations/` is the source of truth for deployment history
- `sqlfu` auto-downloads `sqlite3def` for macOS and Linux into `.sqlfu/`
- `dbmate` manages the `schema_migrations` table and writes `snapshot.sql`
- SQLite view typing is still imperfect in TypeSQL, and some expressions such as `substr(...)` are not inferred directly, so `sqlfu` applies a small post-pass to improve generated result types without changing the SQL-first workflow
