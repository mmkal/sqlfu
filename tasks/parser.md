---
status: ready
size: medium
---

# SQL Parser For Sqlfu

## Status Summary

- Close to done: `not started`
- Main reason to consider this:
  - `sqlfu` already owns other SQL-aware subsystems like formatting and schemadiff, so a parser is not obviously out of scope
  - the remaining schemadiff precision gap is mostly “token-aware heuristics vs real syntax/AST understanding”
- Main caution:
  - this should start as a targeted capability decision, not as a blanket rewrite of every SQL feature around a parser

## Goal

Evaluate and, if justified, introduce a real SQL parser capability to support higher-precision analysis in parts of `sqlfu` such as:

- SQLite schemadiff dependency analysis
- view / trigger / `check(...)` expression reference analysis
- other future SQL-aware tooling where token scanning stops being robust enough

This is not automatically a “replace everything with parser ASTs” task.

## Why This Exists

Current schemadiff is much better than it was:

- it ignores strings/comments
- it handles alias-shadowing cases that used to produce false positives
- it has typed dependency/blocker facts rather than purely ad hoc planner logic

But it is still fundamentally token/heuristic-driven rather than AST-driven.

Important nuance: only some parts of schemadiff are token-based today.

Already metadata-driven from SQLite inspection:

- table existence / removal / creation
- column lists and column order
- primary keys
- foreign keys
- index lists and indexed columns
- trigger/view object existence
- generated/hidden column detection

Those come from SQLite catalog tables and PRAGMA inspection, not from token scanning.

Still token/heuristic-driven today:

- whether a `check(...)` clause actually references a removed column
- whether a partial-index `where` clause actually references a removed column
- which tables/views a view definition really depends on
- which tables/views/columns a trigger body really depends on
- alias-shadowing / qualified-name / expression-position edge cases in those SQL bodies

So the parser question is not “should schemadiff stop using SQLite metadata?” It is “should the SQL-body analysis parts stop relying on token-aware heuristics?”

A parser would fill the gap around things like:

- exact column references instead of token presence
- aliases and qualified names with stronger confidence
- subqueries / CTEs / more complex trigger bodies
- fewer false positives and false negatives in weird but valid SQL

That gap is real, but it is not yet proven large enough to justify parser complexity by default.

## Checklist

- [ ] Survey existing parser options that could plausibly fit `sqlfu`.
  Consider:
  1. SQLite-specific parsers
  2. general SQL parsers with usable SQLite support
  3. whether we can reuse an existing parser already in the ecosystem instead of inventing one
- [ ] Decide whether parser adoption should be:
  1. a runtime dependency
  2. a vendored/parser-submodule approach
  3. a tightly scoped optional internal tool used only for certain analyses
- [ ] Define the first narrow success case.
  Recommended first target:
  - parser-backed dependency analysis for SQLite views / triggers / `check(...)` expressions in schemadiff
- [ ] Write fixtures that current token-aware analysis cannot handle cleanly, and use them as the acceptance bar.
  The parser task should be justified by concrete failing cases, not by architecture aesthetics alone.
- [ ] Decide what the parser should produce for `sqlfu`.
  Prefer a narrow internal representation such as:
  - referenced tables/views
  - referenced columns
  - aliases / scopes where needed
  rather than leaking raw third-party ASTs everywhere.
- [ ] Keep parser integration incremental.
  The first parser-backed consumer should be one analysis path, not a repo-wide forced migration.
- [ ] Document the maintenance tradeoffs.
  This should include:
  - supported dialect scope
  - update strategy if the parser is vendored or wrapped
  - what still intentionally stays heuristic if not worth parsing

## Recommended Scope

Good first scope:

- parser-backed SQLite dependency analysis for schemadiff

Bad first scope:

- rewrite formatter, schemadiff, and every other SQL-aware subsystem at once
- invent a brand-new SQL parser unless existing options are clearly inadequate

## SQLite Built-In Investigation

Before committing to parser work, it is worth checking whether SQLite itself can provide enough analysis for some of the current gaps.

Promising avenues:

- `sqlite3_set_authorizer()`
  This is the most interesting built-in lead. SQLite calls the authorizer during statement compilation, including for column reads/writes, so it may be able to report table/column usage for ordinary statements without needing a full parser in `sqlfu`.
- `sqlite3_column_origin_name()`
  Potentially useful for understanding where result columns came from, though it is narrower than full dependency analysis.
- `EXPLAIN` / `EXPLAIN QUERY PLAN`
  Probably more useful for execution planning than semantic dependency extraction, but still worth confirming.
- `sqlite3_stmt_scanstatus()`
  Likely runtime/scan-oriented rather than semantic, but worth ruling in or out explicitly.

This does not automatically replace parser work:

- these APIs may help for ordinary statements compiled by SQLite
- they may be less helpful for stored SQL text analysis such as view definitions, trigger bodies, and `check(...)` clauses where `sqlfu` still needs structured dependency understanding

So a good first step in this task is:

- determine whether SQLite built-ins can cover enough of the dependency-analysis problem to sidestep or narrow the parser scope

## Notes

- The justification here came out of the SQLite schemadiff dependency-model work:
  - we closed the obvious correctness gaps with token-aware structured analysis and fixtures
  - the main remaining caveat is parser-grade precision for more exotic SQL
- This is a “someday if justified by real cases” task, not an emergency follow-up.
