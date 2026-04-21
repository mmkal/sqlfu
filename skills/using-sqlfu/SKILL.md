---
name: using-sqlfu
description: Guides an agent working in a sqlfu project — how to change the schema, author queries, and regenerate TypeScript wrappers. Use when the repo contains a `sqlfu.config.ts`, a `definitions.sql` file, a `migrations/` directory of timestamped `.sql` files, or when the user mentions sqlfu, `sqlfu generate`, `sqlfu draft`, or `sqlfu goto`.
---

# Using sqlfu

This project uses [sqlfu](https://github.com/mmkal/sqlfu). SQL is the source language. TypeScript is generated from it.

## The three source-of-truth files

- `definitions.sql` — the desired schema right now. Edit this when you want to change the schema.
- `migrations/*.sql` — the ordered history of schema changes. **Do not hand-author these.** Use `sqlfu draft` or `sqlfu goto`.
- `sql/*.sql` — checked-in queries. Each one gets a typed TypeScript wrapper emitted to `sql/.generated/<name>.sql.ts`. Import and call wrappers from application code; do not hand-write the `.sql.ts` files.

The config file is `sqlfu.config.ts` at the repo root. The fields are `db`, `migrations`, `definitions`, `queries`. (Older names `migrationsDir`, `definitionsPath`, `sqlDir` are gone — do not use them.)

## Schema change workflow

1. Edit `definitions.sql` to reflect the new desired schema.
2. Run `sqlfu draft --name <snake_case_slug>`. This diffs replayed migrations against `definitions.sql` and writes a new file under `migrations/`.
3. Open the drafted migration and review it. The diff engine is not psychic — check for renames, data backfills, and destructive changes and edit the SQL if needed.
4. Apply it: `sqlfu migrate`. In a dev project you can also use `sqlfu goto <target>` to jump the database and history to an exact target migration.
5. If the change affects query shapes, run `sqlfu generate` to refresh wrappers in `sql/.generated/`.
6. Run `sqlfu check` before committing. It verifies replayed migrations still produce `definitions.sql` and that the live database agrees.

Never write a migration file by hand. If `sqlfu draft` produces the wrong SQL, fix `definitions.sql` or edit the drafted file — do not create one from scratch.

## Query workflow

1. Add or edit a `.sql` file under the `queries` directory (default `sql/`). Use lowercase SQL keywords.
2. Run `sqlfu generate`. A wrapper appears at `sql/.generated/<name>.sql.ts`.
3. Import the wrapper in application code. Params and result rows are typed.

If a generated wrapper looks wrong, the fix is almost always in the `.sql` source, not the `.sql.ts` output.

## Command reference

- `sqlfu init` — scaffold a new project.
- `sqlfu draft --name <slug>` — create a migration from the `definitions.sql` diff.
- `sqlfu migrate` — apply pending migrations.
- `sqlfu goto <target>` — move the database and history to an exact migration.
- `sqlfu baseline <target>` — rewrite history to a target without touching live schema.
- `sqlfu sync` — push `definitions.sql` straight into the live database. Dev only; fails on semantic changes.
- `sqlfu generate` — regenerate TypeScript wrappers for `sql/*.sql`.
- `sqlfu check` — run all repo/database consistency checks.
- `sqlfu` (no args) — start the local UI backend on `localhost:56081`, reachable at `https://sqlfu.dev/ui`.

## Optional: auto-run `sqlfu generate` on edits

If an agent edits `definitions.sql` or files under `sql/`, the generated wrappers can drift until `sqlfu generate` runs. Users who want that to happen automatically can add this to `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path' | grep -q '\\.sql$' && pnpm sqlfu generate >/dev/null 2>&1 || true"
          }
        ]
      }
    ]
  }
}
```

Adjust the command to match your package manager (`npx sqlfu generate`, `bun sqlfu generate`, etc.). The snippet silently no-ops on edits to unrelated files.
