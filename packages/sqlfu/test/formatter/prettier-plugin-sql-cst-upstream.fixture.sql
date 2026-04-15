-- default config: {"dialect":"sqlite"}

-- #region: pragma read
-- input:
PRAGMA function_list
-- output:
pragma function_list
-- #endregion

-- #region: pragma assignment
-- input:
PRAGMA encoding = 'UTF-8'
-- output:
pragma encoding = 'UTF-8'
-- #endregion

-- #region: pragma function call
-- input:
PRAGMA my_schema.wal_checkpoint(PASSIVE)
-- output:
pragma my_schema.wal_checkpoint (passive)
-- #endregion

-- #region: attach database
-- input:
ATTACH DATABASE 'my_file.sqlite' AS my_schema
-- output:
attach database 'my_file.sqlite' as my_schema
-- #endregion

-- #region: attach without database keyword
-- input:
ATTACH 'my_file.sqlite' AS my_schema
-- output:
attach 'my_file.sqlite' as my_schema
-- #endregion

-- #region: detach database
-- input:
DETACH DATABASE my_schema
-- output:
detach database my_schema
-- #endregion

-- #region: detach without database keyword
-- input:
DETACH my_schema
-- output:
detach my_schema
-- #endregion

-- #region: vacuum schema into file
-- input:
VACUUM my_schema INTO 'my_file.sqlite'
-- output:
vacuum my_schema into 'my_file.sqlite'
-- #endregion

-- #region: vacuum plain
-- input:
VACUUM
-- output:
vacuum
-- #endregion

-- #region: vacuum schema only
-- input:
VACUUM my_schema
-- output:
vacuum my_schema
-- #endregion

-- #region: vacuum into file
-- input:
VACUUM INTO 'my_file.sqlite'
-- output:
vacuum into 'my_file.sqlite'
-- #endregion

-- #region: tiny with clause from prettier suite
-- input:
WITH cte1 AS (SELECT * FROM client) SELECT * FROM cte1
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

-- #region: short select from prettier suite
-- input:
SELECT a, b, c FROM tbl WHERE x > y
-- output:
select a, b, c
from tbl
where x > y
-- #endregion
