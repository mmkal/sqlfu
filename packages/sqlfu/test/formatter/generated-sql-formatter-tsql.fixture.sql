-- default config: {"dialect":"tsql"}

-- #region: sql-formatter / test / transactsql.test: supports language:tsql alias
-- input:
SELECT [my column] FROM [my table];
-- output:
select [my column]
from [my table];
-- #endregion
