---
status: ready
size: small
---

# SQL runner named-parameter binding (and doc the contract)

## Status

Not started. This file is the spec; implementation commits follow on the same branch.

## What's broken

In demo mode (`?demo=1`), running a SQL-runner query that uses a named
parameter throws:

```
SQLite3Error: Invalid bind() parameter name: limitt
```

Reproduction: open the SQL runner, enter `select * from posts limit :limitt;`,
fill in the generated form field labeled `limitt` with `123`, click Run.

## Why

SQLite's `sqlite3_bind_parameter_name()` stores the parameter name **with its
prefix character included** (`:limitt`, not `limitt`) — see
https://www.sqlite.org/c3ref/bind_parameter_name.html. `@sqlite.org/sqlite-wasm`'s
`Stmt.bind({key: value})` therefore calls `sqlite3_bind_parameter_index(stmt, key)`
which returns 0 for the bare name `limitt`, and the wrapper throws
`Invalid bind() parameter name: limitt` (see `dist/index.mjs:10542` in
`@sqlite.org/sqlite-wasm@3.51.2-build9`).

Live/node mode doesn't hit this because `node:sqlite` accepts bare keys.

The UI however *always* passes bare keys:
- `detectNamedParameters` (`packages/ui/src/client.tsx:2444`) strips the prefix
  when building the RJSF schema, so the form field's name — and thus the body
  of the `sql.run` mutation — is the bare identifier.
- This is consistent with how the saved-query test
  (`packages/ui/test/studio.spec.ts:811 "sql runner executes a named-parameter
  query and saves it to disk"`) exercises live mode.

So the product already committed to "named params keyed by bare name". The
demo-mode host just doesn't honor that contract.

## What "supported" means (the contract to document)

SQLite accepts three named-parameter prefixes (https://www.sqlite.org/lang_expr.html#varparam):

- `:name`
- `@name`
- `$name` (plus Tcl-ish `::`/`(...)` suffixes — we don't promise those)

Plus positional `?` / `?NNN`.

sqlfu's public contract, confirmed by this task:

1. **Supported in SQL**: `:name`, `@name`, `$name`. All three.
2. **Supported in the params object**: keys are the **bare identifier**
   (no prefix). This matches the RJSF form-field names the UI generates and
   is what users have in their heads.
3. **Positional `?` params**: bind via an array value passed as `params`.
4. **Mixed named+positional**: undefined / unsupported (matches SQLite's own
   guidance — "best to avoid mixing named and numbered parameters"). Not our
   job to error; we just don't guarantee behavior.
5. **The host adapter's job** is to translate (1) + (2) into whatever the
   underlying driver needs. node:sqlite: bare keys work as-is. sqlite-wasm:
   prefix each key with `:` before binding.

## Plan

- [ ] Red test covering the bug as a fast unit test (not a playwright spec)
  that can run in `pnpm test:node` within `packages/ui`.
- [ ] Fix `normalizeAdHocParams` in `packages/ui/src/demo/browser-host.ts` to
  prefix bare keys with `:` before handing to sqlite-wasm. Leave array params
  untouched. Leave already-prefixed keys (`:foo` / `@foo` / `$foo`) untouched
  so we're forgiving of future callers.
- [ ] Extend the test to cover `@name` and `$name` so the fix isn't accidentally
  colon-only.
- [ ] Wire the new test file into `packages/ui`'s `test:node` script (it
  currently lists specific files).
- [ ] Add one short JSDoc comment on `sql.run`'s input schema in
  `packages/sqlfu/src/ui/router.ts` stating the contract above.
- [ ] Add a docs page under `packages/sqlfu/docs/` — search-term-friendly
  title, something like `query-parameters.md` ("sqlfu named parameters", "sqlfu
  :name"). Cover: supported prefixes, bare-key passing, positional arrays,
  link to SQLite's lang reference for exhaustive syntax. Keep it short; this
  is useful-to-some, not tentpole.
- [ ] No README or landing-page change. Named-param support isn't a
  differentiator; every SQL tool has it.

## Non-goals

- Warning/erroring on mixed named+positional usage.
- Accepting already-prefixed keys from the UI (the UI uses bare keys; the
  forgiveness in the host is for programmatic callers, not a feature).
- Changing the live/node-host path. It works; don't touch it.
- `?NNN` explicit numbering. The UI doesn't expose it; if users type it
  directly into the SQL runner it'll just work via node:sqlite and probably
  via sqlite-wasm too — out of scope to audit.

## Open questions (decided, logged here for later)

- *Should the params body accept prefixed keys too, for robustness?* Yes —
  the normalizer leaves `:foo`/`@foo`/`$foo` alone. Costs nothing, saves a
  support headache.
- *Should we add a host-layer test (not just sqlite-wasm)?* The test goes
  through `normalizeAdHocParams` (exported for this purpose) + a live
  sqlite-wasm instance, which is as close to end-to-end as a unit test gets
  without spinning up playwright.
