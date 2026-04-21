size: medium
---

port sql-formatter from npm, it's already typescript, but the output is hideous.
we want the output to look more like the output from https://github.com/nene/prettier-plugin-sql-cst that prettier-plugin-sql-cst has a decent number of tests. you can go through all the tests and look for the inputs. maybe we can come up with some kind of format for dumping loads of tests in a giant fixture file. format:

```sql
-- #region: simple create table
-- input:
create table foo (       a int);
-- output:
create table foo(
  a int
);
-- #endregion
```

maybe a shortcut like `--output: <unchanged>` for when the formatter has no effect on it. Maybe also need a `--config: {"keywordCase":"lower"}` or something, above `--input:`.

you can write a little parser for such files, and turn each file into a `describe(...)`, and each `#region` into a `test(...)`, and maybe add some custom assertion that writes the output to the file directly when some env var is set (or even `-u` passed if that's possible, since this is a kind of snapshot test).

---

you can also do something simlar with the sql-formatter tests i guess

primary focus is sqlite, but no reason to go out of our way to *not* support other dialects here.

---

we have some precedent for how to vendor in library already, so follow existing patterns where helpful. diverge where it's *not* helpful, but not arbitrarily.

---

progress:

- [x] vendor `sql-formatter` source into `packages/sqlfu/src/vendor/sql-formatter`
- [x] add a thin public `formatSql()` wrapper with `dialect` support and `sqlite` default
- [x] add fixture-driven formatter tests with `#region` blocks and `-- output: <unchanged>`
- [x] add initial sqlite fixture coverage
- [x] import a broad set of fixture cases from `sql-formatter`
- [x] import a broad set of fixture cases from `prettier-plugin-sql-cst`
- [x] add update/writeback support for fixture outputs
- [x] start applying sqlfu-specific printer preferences on top of upstream behavior

notes:

- keeping the first slice close to upstream `sql-formatter` behavior on purpose; house-style changes can come later once the fixture corpus is in place
- vendoring is still the right shape because we expect local printer changes, especially around over-eager newline insertion
- current `pnpm --filter sqlfu test --run test/formatter.test.ts` passes
- current package `typecheck` / `build` are still blocked by an unrelated existing error in `packages/sqlfu/src/vendor/small-utils.ts`
- imported fixture cases are now split by upstream source so later divergence is easier to reason about
- imported coverage now includes sqlite-specific statements, option cases, comments, CTEs, and simple select/DDL shapes
- fixture files now support `-- default config: {...}` to reduce repetition during bulk imports
- generated baseline corpus now includes 1,452 passing fixture cases across sqlite, postgresql, bigquery, mysql, mariadb, and tsql
- fixture harness now supports error baselines as well as formatted-output baselines, so unsupported syntax is captured instead of silently skipped
- fixture updates can be written in place with `SQLFU_FORMATTER_UPDATE=1 pnpm --filter sqlfu test --run test/formatter.test.ts`
- current sqlfu formatter defaults now diverge from upstream on purpose, mainly to keep simple clause bodies inline instead of forcing newline-heavy layouts
