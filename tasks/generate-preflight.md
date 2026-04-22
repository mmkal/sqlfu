---
status: needs-grilling
size: small
---

## generate-preflight: warn or error when generate runs against an empty/stale database

**Status:** Problem statement only. Needs grilling before implementation.

---

## Problem

`sqlfu generate` reads the live database schema to produce TypeScript types. If a user runs `generate` before `migrate` (easy to do -- the old README Quick Start showed this order), the live database has no schema and the generated wrappers are hollow: they compile, they import cleanly, and they are wrong.

There is no warning, no error, and no indication that anything went wrong. The user ends up with `.generated/` files that have empty or incorrect types, which only surface as TypeScript errors or runtime surprises later.

This is a real footgun for new users following the walkthrough.

## Solution space (do not prescribe in this task)

- **Preflight check**: before running `generate`, check for pending migrations or an empty live schema. Error or warn. Same machinery as `sqlfu check`.
- **Warn-only mode**: emit a warning to stderr but continue, so CI/CD pipelines that run `generate` on a clean DB (e.g., before migration) are not broken.
- **`--from` flag**: `--from=live` (current default), `--from=replay` (replay migrations into a scratch DB like `draft` does), or `--from=definitions` (derive schema from `definitions.sql` directly). The replay option would make `generate` work in a clean environment without a prior `migrate` step.
- **Something else**: the right fix may be different once the full solution space is explored.

## Correctness note

`generate` reads the live DB precisely so it reflects what the app runs against, including any post-`sync` drift. A replay-based fallback would lose that guarantee. The preflight direction (error on obvious misconfigurations) may be cleaner than adding a new mode.

## Notes for grilling

- Is this common enough to warrant an error vs. a warning?
- What does the user experience look like if we add a preflight? Does it block `generate` in CI environments that don't have a live DB?
- Is `--from=replay` a realistic option given the current generate internals?
