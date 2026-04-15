-- default config: {"dialect":"mariadb"}

-- #region: prettier-plugin-sql-cst / test / canonical_syntax.test: converts MariaDB && and || operators to AND and OR
-- input:
SELECT a && b || c
-- output:
select a && b || c
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / limiting.test: formats LIMIT ... ROWS EXAMINED
-- config: {"expressionWidth":20}
-- input:
SELECT *
FROM tbl
LIMIT
  25, 100
  ROWS EXAMINED 1000
-- output:
select *
from tbl
limit 25, 100 rows examined 1000
-- #endregion
