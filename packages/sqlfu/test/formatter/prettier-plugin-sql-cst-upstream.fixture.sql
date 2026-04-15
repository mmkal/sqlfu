-- #region: pragma read
-- config: {"dialect":"sqlite"}
-- input:
PRAGMA function_list
-- output: <unchanged>
-- #endregion

-- #region: pragma assignment
-- config: {"dialect":"sqlite"}
-- input:
PRAGMA encoding = 'UTF-8'
-- output: <unchanged>
-- #endregion

-- #region: pragma function call
-- config: {"dialect":"sqlite"}
-- input:
PRAGMA my_schema.wal_checkpoint(PASSIVE)
-- output:
PRAGMA my_schema.wal_checkpoint (PASSIVE)
-- #endregion

-- #region: attach database
-- config: {"dialect":"sqlite"}
-- input:
ATTACH DATABASE 'my_file.sqlite' AS my_schema
-- output: <unchanged>
-- #endregion

-- #region: attach without database keyword
-- config: {"dialect":"sqlite"}
-- input:
ATTACH 'my_file.sqlite' AS my_schema
-- output: <unchanged>
-- #endregion

-- #region: detach database
-- config: {"dialect":"sqlite"}
-- input:
DETACH DATABASE my_schema
-- output: <unchanged>
-- #endregion

-- #region: detach without database keyword
-- config: {"dialect":"sqlite"}
-- input:
DETACH my_schema
-- output: <unchanged>
-- #endregion

-- #region: vacuum schema into file
-- config: {"dialect":"sqlite"}
-- input:
VACUUM my_schema INTO 'my_file.sqlite'
-- output: <unchanged>
-- #endregion

-- #region: vacuum plain
-- config: {"dialect":"sqlite"}
-- input:
VACUUM
-- output: <unchanged>
-- #endregion

-- #region: vacuum schema only
-- config: {"dialect":"sqlite"}
-- input:
VACUUM my_schema
-- output: <unchanged>
-- #endregion

-- #region: vacuum into file
-- config: {"dialect":"sqlite"}
-- input:
VACUUM INTO 'my_file.sqlite'
-- output: <unchanged>
-- #endregion

-- #region: tiny with clause from prettier suite
-- config: {"dialect":"sqlite"}
-- input:
WITH cte1 AS (SELECT * FROM client) SELECT * FROM cte1
-- output:
WITH
  cte1 AS (
    SELECT
      *
    FROM
      client
  )
SELECT
  *
FROM
  cte1
-- #endregion

-- #region: short select from prettier suite
-- config: {"dialect":"sqlite"}
-- input:
SELECT a, b, c FROM tbl WHERE x > y
-- output:
SELECT
  a,
  b,
  c
FROM
  tbl
WHERE
  x > y
-- #endregion
