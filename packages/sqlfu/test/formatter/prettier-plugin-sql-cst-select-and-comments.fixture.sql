-- default config: {"dialect":"sqlite"}

-- #region: multiline select clauses
-- input:
SELECT *
FROM tbl
WHERE x > y
GROUP BY foo, bar
HAVING foo > bar
ORDER BY foo, bar DESC
LIMIT 100, 25
-- output:
select *
from tbl
where x > y
group by foo, bar
having foo > bar
order by foo, bar desc
limit 100, 25
-- #endregion

-- #region: multiline columns
-- input:
SELECT
  col1,
  col2,
  col3
-- output:
select col1, col2, col3
-- #endregion

-- #region: select star
-- input:
SELECT *
-- output:
select *
-- #endregion

-- #region: select distinct
-- input:
SELECT DISTINCT
  col1,
  col2,
  col3
FROM tbl
-- output:
select distinct
  col1,
  col2,
  col3
from tbl
-- #endregion

-- #region: set operations
-- input:
SELECT * FROM client WHERE status = 'inactive'
UNION ALL
SELECT * FROM disabled_client
INTERSECT
SELECT * FROM faulty_client
-- output:
select *
from client
where status = 'inactive'
union all
select *
from disabled_client
intersect
select *
from faulty_client
-- #endregion

-- #region: line comments block
-- input:
-- first line comment
-- second line comment
SELECT 1; -- third line comment
-- final comment
-- output:
-- first line comment
-- second line comment
select 1;

-- third line comment
-- final comment
-- #endregion

-- #region: block comments between syntax elements
-- input:
CREATE /*c1*/ TABLE /*c2*/ IF /*c3*/ NOT EXISTS /*c4*/ foo (
  id /*c5*/ INT /*c6*/ NOT /*c7*/ NULL
);
-- output:
create /*c1*/ table /*c2*/ if /*c3*/ not exists /*c4*/ foo (id /*c5*/ int /*c6*/ not /*c7*/ null);
-- #endregion

-- #region: leading and trailing block comments around select
-- input:
/* leading comment */
SELECT 1, /*com1*/ 2 /*com2*/;
/* trailing comment */
-- output:
/* leading comment */
select
  1,
  /*com1*/ 2 /*com2*/;

/* trailing comment */
-- #endregion

-- #region: short with clause inside multiline select
-- input:
WITH cte1 AS (SELECT * FROM client)
SELECT *
FROM cte1
-- output:
with
  cte1 as (
    select
      *
    from
      client
  )
select *
from cte1
-- #endregion

-- #region: long with clause
-- input:
WITH
  cte1 AS (SELECT * FROM client WHERE age > 100),
  cte2 AS (SELECT * FROM client WHERE age < 10)
SELECT *
FROM cte1
-- output:
with
  cte1 as (
    select
      *
    from
      client
    where
      age > 100
  ),
  cte2 as (
    select
      *
    from
      client
    where
      age < 10
  )
select *
from cte1
-- #endregion
