-- default config: {"dialect":"sqlite","keywordCase":"lower"}

-- #region: simple create table
-- input:
create table foo (       a int);
-- output:
create table foo (a int);
-- #endregion

-- #region: already-formatted select is compacted under sqlfu style
-- input:
select
  foo,
  bar
from
  baz;
-- output:
select foo, bar
from baz;
-- #endregion

-- #region: compact simple select and from by default
-- input:
select foo, bar from baz
-- output:
select foo, bar
from baz
-- #endregion

-- #region: compact select star and from by default
-- input:
select * from foo
-- output:
select *
from foo
-- #endregion

-- #region: low print width expands select list but keeps short from inline
-- config: {"printWidth":12}
-- input:
select foo, bar from baz
-- output:
select
  foo,
  bar
from baz
-- #endregion

-- #region: newlineBeforeTableName forces from body onto next line
-- config: {"newlineBeforeTableName":true}
-- input:
select foo, bar from baz
-- output:
select foo, bar
from
  baz
-- #endregion

-- #region: inlineClauses false preserves upstream clause breaking
-- config: {"inlineClauses":false}
-- input:
select foo, bar from baz
-- output:
select
  foo,
  bar
from
  baz
-- #endregion
