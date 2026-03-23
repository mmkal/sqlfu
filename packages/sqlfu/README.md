# sqlfu

`sqlfu` is a slim SQLite toolkit experiment built around existing tools:

- `@libsql/client` for local SQLite files and remote libSQL/Turso-style connections
- `typesql-cli` for SQL-first query type generation
- `sqlite3def` from `sqldef` for declarative schema diffing from `definitions.sql`
- `trpc-cli` for a typed local CLI surface

## Current shape

- `definitions.sql` is the only schema source of truth
- checked-in `.sql` query files live in `sql/`
- generated TypeSQL outputs are written next to those `.sql` files
- schema materialization and binary downloads use `.sqlfu/`

## Commands

```sh
pnpm generate
pnpm cli migrate diff --db-path .sqlfu/dev.db
pnpm cli migrate apply --db-path .sqlfu/dev.db
pnpm cli migrate export --db-path .sqlfu/dev.db
```

## Notes

- the runtime client abstraction lives in `src/core` + `src/adapters`
- the migrator currently auto-downloads `sqlite3def` for macOS/Linux
- Windows auto-install is not implemented yet
