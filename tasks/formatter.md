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