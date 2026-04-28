---
status: done
size: small
---

# Id-generator recipes (sqlite, pure SQL)

Ship a small set of copy-pasteable pure-SQL id generators (KSUID, ULID, nanoid, cuid2-ish) as **recipes**, not as library code. They drop straight into a project's `definitions.sql` and become column defaults.

## Status summary

- Shipped all four recipes: `sqlfu_nanoid`, `sqlfu_cuid2`, `sqlfu_ulid`, `sqlfu_ksuid` (sqlite-friendly 32-char base32 variant of ksuid).
- New docs page at `packages/sqlfu/docs/id-helpers.md`, wired into `website/scripts/sync-docs.mjs`.
- One-line pointer added to the README's Core Concepts `definitions.sql` bullet.
- Test file covers length, alphabet, uniqueness, and time-prefix monotonicity per generator.
- Open question — `definitions.sql` has no `@include`/import mechanism for big external SQL bundles — captured on the docs page and at the bottom of this task file. Not in scope here.
- Caveats landed plainly: cuid2 is surface-only (no sha3 in sqlite); ksuid is base32, not base62 (no 160-bit divmod in pure SQL); bulk INSERT...SELECT with scalar-subquery may cache, so the docs push the trigger pattern.

## Framing (sqlfu's voice)

This is not "sqlfu implements KSUID". The framing is:

> `definitions.sql` is where your SQL vocabulary lives — tables, views, triggers, and, if you want them, your own id generators. Because `definitions.sql` is just SQL you wrote, you can paste a pure-SQL generator in next to your tables and it participates in schema diff, migrations, and type-gen exactly like anything else.

That means the feature isn't a new API surface — it's a recipe page that shows users their existing `definitions.sql` is already the right home for this.

## Importance

Useful-to-some. Warrants a docs recipe page and a pointer from the schema docs. Does **not** warrant a landing-page panel or a README tentpole slot.

## Scope

- **Sqlite-only for now.** Postgres generators are out of scope here — they belong in the `pg` task.
- **Pure SQL only.** No loadable extensions, no `sqlean`, no C functions, no `hmac`/`sha256` (those don't exist in stock sqlite). If a generator requires anything the `sqlite3` shell can't evaluate out of the box, drop it candidly rather than faking it.
- **Copy-paste is the whole distribution.** No npm install, no sqlfu runtime code, no code generation. Each generator is one `.sql` file that a user copies into their own `definitions.sql`.

## Deliberate non-goal — "big bundles of SQL functions"

The original task prompt flagged a shortcoming: `definitions.sql` has no `@include` / import mechanism, so pasting a 5000-line FDB schema would be painful. We're **deliberately not solving that** here. These generators are each ~20 lines; copy-paste is fine. Document the open question at the bottom of the recipe page and in the task file so a future task can tackle it if/when the pain is real.

## Deliverables

1. `packages/sqlfu/recipes/id-helpers/` — new directory of copy-paste SQL snippets. One `.sql` per generator. Each file header carries:
   - one-paragraph description of the id scheme
   - upstream attribution (see "Drawing inspiration" below)
   - one-line usage example (the `default` clause you'd drop into a column)
2. `packages/sqlfu/docs/id-helpers.md` — recipe page. Leads with a side-by-side comparison table, then copy-paste blocks. Search-friendly title so `sqlfu ulid`, `sqlfu ksuid`, `sqlfu uuid alternative` all land on it.
3. Wire the docs page into `website/scripts/sync-docs.mjs` so it ships to the website.
4. One-line pointer from `packages/sqlfu/docs/schema-diff-model.md` or the README's Core Concepts section back to the recipe page. Don't over-plumb.
5. `packages/sqlfu/test/recipes/id-helpers.test.ts` — one tiny test file per the fixture pattern already in `test/adapters/better-sqlite3.test.ts`. Stand up an in-memory better-sqlite3 database, load each recipe file, run the generator, assert the shape.

## Generators to ship (candidate list)

Final list decided during implementation — a generator that needs cryptographic hashing the sqlite shell can't do gets dropped with a note in the docs page.

| Generator | Expected shape | Sortable? | Notes |
| --- | --- | --- | --- |
| `ulid` | 26-char Crockford base32 | yes (time-prefixed) | Crockford alphabet; `randomblob(10)` for entropy. No monotonic guarantee within the same millisecond — documented. |
| `ksuid` | 27-char base62 | yes (time-prefixed, 32-bit seconds since 2014-05-13 epoch) | 4-byte timestamp + 16-byte random, base62 encoded. Base62 conversion in pure SQL is awkward; if it gets ugly, fall back to a base32 KSUID-shaped variant and call that out. |
| `nanoid` | 21-char URL-safe alphabet | no | `randomblob(21)` sliced through a 64-char alphabet to keep bias trivial; document the tiny bias. |
| `cuid2` | 24-char lowercase a-z0-9, starts with letter | no | True cuid2 needs sha3 which sqlite lacks. Ship a **cuid2-shaped** generator (same alphabet, same length, letter prefix) and say plainly in the header that it's not the canonical algorithm — just a compatible surface. If even this can't be done cleanly, drop from the list. |

## Tests

One test file, flat structure. For each generator:

- load the `.sql` recipe into an in-memory sqlite
- invoke the generator N times (say 1000)
- assert length, character set, and — for time-prefixed generators — lexicographic ordering within a single second

Avoid `describe`. Use `using fixture = ...` with `Symbol.dispose` per project convention.

## Drawing inspiration

Attribute clearly in each file header:

- **ULID for sqlite** — Paul Copplestone's gist (`kiwicopple`). Reworded as a header comment; local deviations called out.
- **KSUID for sqlite** — derive from the KSUID spec (segment.io). Header states alphabet and epoch constant explicitly.
- **nanoid** — Andrey Sitnik's algorithm. Sqlite port is trivial (`randomblob` + alphabet indexing).
- **cuid2-shaped** — `paralleldrive/cuid2`. Header explicitly says "shape-compatible, not algorithm-compatible".

Where a gist URL is unknown, cite the upstream spec/repo by name; future agents can refine the attribution if/when the exact inspiration source is identified.

## Documentation cross-links

- `packages/sqlfu/docs/id-helpers.md` (new) — the recipe
- `packages/sqlfu/docs/schema-diff-model.md` — a one-line "see also" pointer where definitions.sql is introduced, if a natural spot exists
- `packages/sqlfu/README.md` — no change unless a "Recipes" subsection already exists; don't add a new subsection just for this
- `website/scripts/sync-docs.mjs` — add a `docs` entry so the page ships to the site

## Checklist

- [x] Flesh out spec (this file) and commit in isolation; open PR with `gh pr create`. _PR #25, first commit is the spec._
- [x] Failing test: `packages/sqlfu/test/recipes/id-helpers.test.ts` with one assertion per generator (length, charset, ordering where applicable). _Committed red, then made green with the recipe files._
- [x] `recipes/id-helpers/ulid.sql`. _Canonical 26-char Crockford base32, 48-bit ms + 80 bits random._
- [x] `recipes/id-helpers/ksuid.sql`. _Base32 variant (32 chars, not 27-char base62) — KSUID payload layout preserved, encoding changed. Deviation documented in the header and the docs page._
- [x] `recipes/id-helpers/nanoid.sql`. _Canonical 21-char URL-safe._
- [x] `recipes/id-helpers/cuid2.sql`. _Surface-only (cuid2 shape, not algorithm). Header says so plainly._
- [x] `docs/id-helpers.md` with comparison table + copy-paste blocks + "future: `@include` syntax" open-question section.
- [x] Wire into `website/scripts/sync-docs.mjs`.
- [x] Pointer from `docs/schema-diff-model.md` (one line). _Went with README Core Concepts instead — the README's `definitions.sql` bullet is the more natural, higher-traffic entrypoint. Schema-diff-model is about the diff mechanism, not about what belongs in definitions.sql._
- [x] `pnpm --filter sqlfu test` green. _1684 passed, 6 skipped._
- [x] `pnpm --filter sqlfu typecheck` green.

## Open question — "what about bigger SQL bundles?"

If a user wants to bring in a whole schema (full-text-search bundle, a postgres-style FDB, the supabase `auth` schema), copy-paste stops scaling. Possible future directions (not in scope here, just captured so the next agent has a starting point):

- `@sqlfu include ./external.sql` directive inside `definitions.sql`, expanded at parse time.
- A `sqlfu.config.ts` `definitions` field that accepts an array of paths, concatenated in order.
- Treat `definitions/` as a directory.

Call out in the docs page that for generator-scale snippets, copy-paste is intentional; for bigger bundles, file an issue.
