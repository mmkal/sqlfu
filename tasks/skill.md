---
status: ready
size: small
---

# using-sqlfu skill

Ship a Claude Code agent skill that teaches an agent how to work inside a sqlfu project. Install via `npx skills add mmkal/sqlfu`.

## Status

Ready to implement. Plan settled below.

## Plan

### Distribution

- Co-locate the skill in this repo at `skills/using-sqlfu/SKILL.md`.
- `npx skills add mmkal/sqlfu` (or `-s using-sqlfu`) will pick it up — the skills CLI walks subdirectories looking for `SKILL.md`.
- Document the install command in the sqlfu README once the skill exists (separate follow-up; not required for this task).

### Format

Follow Anthropic's skill format: directory with `SKILL.md` containing YAML frontmatter (`name`, `description`) and a short instruction body.

Reference style from `/Users/mmkal/.claude/skills/writing-well/SKILL.md` and `/Users/mmkal/.claude/skills/write-a-skill/SKILL.md`: concise prose, bulleted lists, triggers stated in the description, under ~100 lines.

### Scope / triggers

The description should trigger the skill when an agent sees:

- a `sqlfu.config.ts` in the project
- a `definitions.sql` file
- a `migrations/` directory with timestamped `.sql` files
- keywords: "sqlfu", "definitions.sql", "sqlfu generate", "sqlfu draft", "sqlfu goto"

### What the skill teaches

- The project uses sqlfu. SQL is the source language; TypeScript is generated.
- Three source-of-truth locations:
  - `definitions.sql` — the desired schema right now. Edit this when you want to change the schema.
  - `migrations/*.sql` — ordered history. **Do not hand-author.** Generate with `sqlfu draft` / advance with `sqlfu goto`.
  - `sql/*.sql` — checked-in queries. Typed wrappers are emitted to `sql/.generated/<name>.sql.ts`.
- Workflow: edit `definitions.sql` → `sqlfu draft --name <slug>` → review the emitted migration → `sqlfu migrate` (or `sqlfu goto <target>`) → `sqlfu generate` to refresh wrappers.
- After editing `sql/*.sql`, run `sqlfu generate` so wrappers stay in sync.
- Use `sqlfu check` before committing schema changes.
- Config field names (post-rename): `db`, `migrations`, `definitions`, `queries`. Do not use the old names `migrationsDir`, `definitionsPath`, `sqlDir`.

### Generate as a hook?

Include an optional, copy-pasteable Claude Code settings.json snippet at the bottom of the skill that runs `sqlfu generate` automatically after edits to `definitions.sql` or any file under `sql/`. Users opt in by adding it to their own settings.

## Checklist

- [ ] Flesh out this task file and commit alone as `task: flesh out skill plan`
- [ ] Create `skills/using-sqlfu/SKILL.md`
- [ ] Verify the body is under ~100 lines and matches the style of existing skills
- [ ] Move this file to `tasks/complete/2026-04-19-skill.md`
- [ ] Push branch `skill` and open a PR
