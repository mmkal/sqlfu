add oxfmt and oxlint to this repo

status: done

## Summary

Installed `oxlint` and `oxfmt` at the workspace root with sensible defaults. Added `lint`, `lint:fix`, `format`, and `format:check` scripts to the root `package.json`. Configured both tools to ignore vendored third-party code (`packages/sqlfu/src/vendor/**`) and build/generated output. The oxfmt config is tuned to preserve the repo's existing style (single quotes, no bracket spacing, `printWidth: 100` bumped to `120`, and markdown intentionally ignored so task files/READMEs keep their `*italic*` convention).

The repo had no prior linter/formatter (no prettier, eslint, biome configs existed), so there was nothing to replace.

Two commits:
1. tool install + config + scripts (tiny, easy to review).
2. apply `oxfmt --write` across the codebase (68 files touched, mostly quote style and long-line wrapping).

## Checklist

- [x] audit repo for existing lint/format tooling _no prettier/eslint/biome config anywhere; nothing to replace_
- [x] add `oxlint` + `oxfmt` as root devDependencies _via `pnpm add -Dw`_
- [x] write `.oxlintrc.json` _ignores vendor, enables react + vitest plugins, turns off `no-unused-expressions` in tests (false positives for `expect(x).toBe(...)` and chai-style asserts)_
- [x] write `.oxfmtrc.json` _singleQuote: true, bracketSpacing: false, printWidth: 120, ignores vendor + markdown_
- [x] add `lint` / `lint:fix` / `format` / `format:check` scripts to root `package.json`
- [x] run `pnpm lint` — confirms the tool executes; reports 18 errors (all legit, not fixing as part of this task)
- [x] run `pnpm format` — applied formatting across 68 files in a separate commit
- [x] verify `pnpm typecheck` still passes after install + formatting
- [x] move to `tasks/complete/2026-04-18-ox.md` on completion

## Implementation notes

### oxlint findings (not fixed in this task)

After scoping out vendor code, `pnpm lint` reports 18 errors. They look like real findings worth cleaning up later but are out of scope here:

- `unicorn/no-thenable` on `packages/sqlfu/src/core/sql.ts` x2 — the Sql class exposes `then` for awaitable behavior. Probably a legit pattern for this library; may want to suppress with a file-level comment once verified.
- `no-unused-vars` sprinkled across `ui/client.tsx`, `ui/server.ts`, tests, typegen.
- `no-useless-fallback-in-spread` in `ui/client.tsx` x3.
- `no-empty-pattern` in `packages/ui/test/fixture.ts` — likely a playwright fixture pattern (`async ({}, use) => ...`).
- `no-single-promise-in-promise-methods` in adapter tests x2 — genuinely unnecessary `Promise.all([single])`.
- `no-useless-escape` in `scripts/sync-root-readme.ts`.
- `no-extra-boolean-cast` in `typegen/index.ts`.

### oxfmt notes

- Defaults were way too churny for this repo (prettier-style double quotes + bracket spacing). Tuned to match the existing code style so the mass-reformat commit stays small (68 files instead of 290).
- Markdown formatting is disabled because oxfmt rewrites `*italic*` to `_italic_`, and the CLAUDE.md/AGENTS.md instructions specifically rely on `*italic*` for checklist comments. Re-enable once oxfmt exposes a knob for that (or we decide to migrate everything to underscores).
- Vendor code (`packages/sqlfu/src/vendor/**`) is not formatted — those files should stay close to their upstream sources so future updates can be merged cleanly.

### Scripts

```
pnpm lint            # oxlint, reports errors
pnpm lint:fix        # oxlint --fix, auto-fix safe lint issues
pnpm format          # oxfmt ., format in place
pnpm format:check    # oxfmt --check ., for CI
```

### Not yet wired up

- No CI step for lint/format. There's a `.github/workflows/` dir — a follow-up task could add a `lint` job. Out of scope here.
- No pre-commit hook for lint/format. The existing `simple-git-hooks` pre-commit only runs the readme sync. Could be extended.
