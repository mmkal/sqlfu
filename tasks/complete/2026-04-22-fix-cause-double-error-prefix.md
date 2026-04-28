---
status: done
size: small
---

# Fix `Cause: Error:` double-prefix in migration / sqlite-def errors

## Status (for humans)

Implementation complete. All 9 previously-failing tests pass; no new failures
introduced. Full sqlfu suite: 1263 passing. `pnpm lint` clean. Lint rule
removed, CLAUDE.md update **not** applied (flagged in PR body for user).

## The bug

Nine tests fail on `origin/main` with a snapshot diff of the form:

```
- Cause: automatic table rebuild for person would invent values for new primary key columns: id
+ Cause: Error: automatic table rebuild for person would invent values for new primary key columns: id
```

Two tests have the sibling variant:

```
- Migration X failed: near "this": syntax error
+ Migration X failed: Error: near "this": syntax error
```

User-facing error messages now contain a redundant `Error:` prefix. This is
product-code regression, not a test drift — the output is visibly worse, and
reverting the snapshots to accept the new output would bake ugliness in.

## Root cause

Commit `1c38c77` ("lint: autofix readonly strips and dumb error-ternary
collapses", 2026-04-22) enabled a new ESLint rule,
`repolocal/no-dumb-error-ternary`, and ran `pnpm lint --fix`. The rule's
claim is:

> Don't use `e instanceof Error ? e.message : String(e)`, it's equivalent to
> `String(e)`.

**The claim is false.** For a real Error object:

- `(new Error('x')).message` → `'x'`
- `String(new Error('x'))` → `'Error: x'` (from `Error.prototype.toString`)

The autofix silently changed 22 sites across the codebase, including at least
three user-facing error-formatting sites:

- `packages/sqlfu/src/api.ts:884` — `summarizeSqlite3defError(error)`
- `packages/sqlfu/src/core/sql-editor-diagnostic.ts:4, :19` — the inline SQL
  editor diagnostic (four failing test cases route through here)
- `packages/sqlfu/src/adapters/bun.ts` — bun-specific error wrapping (one
  failing test)

The failing tests are the canaries; other sites (OTel span status,
outbox retry `reason`, HTTP response bodies on the UI server) carry the same
extra `Error:` but either have no snapshot coverage or have acceptable
semantics for the prefix.

## Fix

1. **Delete the lint rule.** `repolocal/no-dumb-error-ternary` in
   `eslint.config.js:65-80` should go. Its premise is factually wrong — the
   two expressions produce different results for real Error objects, which is
   the whole reason the ternary exists. Leaving it in risks another autofix
   pass re-breaking things.

2. **Update `CLAUDE.md`** (`~/.claude/CLAUDE.md`, user's global). Current text:

   > If you're stringifying an error, don't do
   > `error instanceof Error ? error.message : String(error)`. You can just do
   > `String(error)` — the result is identical and it's more readable.

   Replace with wording that acknowledges the asymmetry, e.g.:

   > Prefer `String(error)` for logs / debug output where the `Error:` prefix
   > is harmless or useful. But when you're formatting an error for
   > human-readable display (CLI output, API response, `Cause:` line), use
   > `error instanceof Error ? error.message : String(error)` or a small
   > helper — `String(err)` produces `Error: <message>` on a real Error, which
   > is usually not what you want in user-facing text.

   This is a *user-level* doc, so the decision to reword (or remove the rule
   altogether) is the user's to confirm. Flag it in the PR body.

3. **Restore the ternary at the three proven-broken sites:**
   - `packages/sqlfu/src/api.ts:884`
   - `packages/sqlfu/src/core/sql-editor-diagnostic.ts:4, :19`
   - `packages/sqlfu/src/adapters/bun.ts` (whichever line the bun test exposes)

   Don't do a blanket revert of commit `1c38c77` — most of the 22 sites are
   fine as-is. The three above are provably user-facing (the failing tests
   prove it); restoring them is enough to clear the 9 failures without
   touching debug-only / OTel / outbox sites.

4. **Run the failing tests** and confirm they pass. No snapshot updates
   expected; this is a code fix, not a snapshot update.

## Scope

- [x] Delete `no-dumb-error-ternary` block in `eslint.config.js` (both the
      rule definition at ~line 65 and the activation at ~line 100).
- [x] Restore `error instanceof Error ? error.message : String(error)` at
      the four proven-broken sites. _Turned out to be four, not three:_
      - `packages/sqlfu/src/api.ts:884` — `summarizeSqlite3defError`
      - `packages/sqlfu/src/core/sql-editor-diagnostic.ts:3` —
        `toSqlEditorDiagnostic`
      - `packages/sqlfu/src/core/sql-editor-diagnostic.ts:18` —
        `isInternalUnsupportedSqlAnalysisError`
      - `packages/sqlfu/test/adapters/bun.test.ts:221, :247` — the test-side
        RPC fixture wrapping (2 sites in a `replace_all`; not product code
        but produces the double-prefix via the same mechanism).
- [x] `pnpm --filter sqlfu test` — 1263 passing, 9 skipped, 0 failed.
- [x] `pnpm lint` clean.
- [ ] CLAUDE.md update — deferred to user. See PR body.

## Out of scope

- The other ~19 sites the autofix touched. They may or may not be producing
  a double `Error:` somewhere, but without a failing test to prove it,
  changing them is speculation. If future test drifts expose more sites, fix
  them then.
- Introducing a shared `errorMessage()` helper. Tempting, but the ternary
  is three tokens; a helper is heavier than the problem warrants, especially
  at only three sites.
- Tests for the lint rule removal. The rule is going away because its
  premise is wrong; there's nothing to test.

## Assumptions

- The user wants this treated as a bug fix, not a snapshot update. That is,
  the `Cause: <message>` format (without `Error:`) is the desired behavior,
  and the new `Cause: Error: <message>` format is wrong. If the user
  disagrees — "actually I want `Error:` on the cause line because it keeps
  things unambiguous" — this whole approach inverts: update snapshots,
  don't revert the ternaries. Flag in PR body.

## Implementation log

- The bun test failure is not product-code driven. The inventory listed
  `adapters/bun.ts` as a potentially-affected file, but it has no
  `String(error)` calls; the double-prefix comes from the test-side RPC
  fixture at `bun.test.ts:221, :247`, which wraps remote errors in
  `new Error(formatFixtureFailure(String(error), …))`. Fixed both sites
  with a `replace_all`.
- `sql-editor-diagnostic.ts` had TWO sites, not one — `toSqlEditorDiagnostic`
  (line 3 after edit) and `isInternalUnsupportedSqlAnalysisError` (line 18).
  The four failing `test/sql-editor-diagnostic.test.ts` cases were actually
  all driven by the second helper (they match on message equality for
  `'traverse_Sql_stmtContext'`, `'Not supported!'`, etc.). The first helper
  didn't have failing tests but restoring it was the right call — it also
  uses the message for UI display (SQL editor squiggle positioning +
  display).
- Did not introduce a helper function; three-token ternary is fine at four
  sites.
- Did not touch the other 18 collapsed sites. They remain `String(error)`.
  If another double-prefix regression surfaces, fix it surgically like this
  one.
