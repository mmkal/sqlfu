-- #region: keywordCase preserve keeps original keyword casing
-- config: {"dialect":"sqlite","keywordCase":"preserve"}
-- input:
select * From tbl WHERE x > 0
-- output:
select
  *
From
  tbl
WHERE
  x > 0
-- #endregion

-- #region: keywordCase lower lowercases reserved words
-- config: {"dialect":"sqlite","keywordCase":"lower"}
-- input:
select * From tbl WHERE x > 0
-- output:
select
  *
from
  tbl
where
  x > 0
-- #endregion

-- #region: linesBetweenQueries defaults to one blank line
-- config: {"dialect":"sqlite"}
-- input:
SELECT * FROM foo; SELECT * FROM bar;
-- output:
SELECT
  *
FROM
  foo;

SELECT
  *
FROM
  bar;
-- #endregion

-- #region: linesBetweenQueries can be zero
-- config: {"dialect":"sqlite","linesBetweenQueries":0}
-- input:
SELECT * FROM foo; SELECT * FROM bar;
-- output:
SELECT
  *
FROM
  foo;
SELECT
  *
FROM
  bar;
-- #endregion

-- #region: linesBetweenQueries can be two
-- config: {"dialect":"sqlite","linesBetweenQueries":2}
-- input:
SELECT * FROM foo; SELECT * FROM bar;
-- output:
SELECT
  *
FROM
  foo;


SELECT
  *
FROM
  bar;
-- #endregion

-- #region: replace into syntax formats as sqlite dml
-- config: {"dialect":"sqlite"}
-- input:
REPLACE INTO tbl VALUES (1,'Leopard'),(2,'Dog');
-- output:
REPLACE INTO
  tbl
VALUES
  (1, 'Leopard'),
  (2, 'Dog');
-- #endregion

-- #region: on conflict do update syntax formats as sqlite dml
-- config: {"dialect":"sqlite"}
-- input:
INSERT INTO tbl VALUES (1,'Leopard') ON CONFLICT DO UPDATE SET foo=1;
-- output:
INSERT INTO
  tbl
VALUES
  (1, 'Leopard')
ON CONFLICT DO UPDATE
SET
  foo = 1;
-- #endregion

-- #region: short create table stays on one line
-- config: {"dialect":"sqlite"}
-- input:
CREATE TABLE tbl (a INT PRIMARY KEY, b TEXT);
-- output: <unchanged>
-- #endregion

-- #region: long create table breaks across lines
-- config: {"dialect":"sqlite"}
-- input:
CREATE TABLE tbl (a INT PRIMARY KEY, b TEXT, c INT NOT NULL, doggie INT NOT NULL);
-- output:
CREATE TABLE tbl (
  a INT PRIMARY KEY,
  b TEXT,
  c INT NOT NULL,
  doggie INT NOT NULL
);
-- #endregion

-- #region: tricky trailing line comments
-- config: {"dialect":"sqlite"}
-- input:
SELECT a--comment, here
FROM b--comment
-- output:
SELECT
  a --comment, here
FROM
  b --comment
-- #endregion

-- #region: first line comments in file stay intact
-- config: {"dialect":"sqlite"}
-- input:
-- comment1
-- comment2
-- output: <unchanged>
-- #endregion

-- #region: parameterized cte formatting
-- config: {"dialect":"sqlite"}
-- input:
WITH cte_1(id, parent_id) AS (
  SELECT id, parent_id
  FROM tab1
  WHERE parent_id IS NULL
)
SELECT id, parent_id FROM cte_1;
-- output:
WITH
  cte_1 (id, parent_id) AS (
    SELECT
      id,
      parent_id
    FROM
      tab1
    WHERE
      parent_id IS NULL
  )
SELECT
  id,
  parent_id
FROM
  cte_1;
-- #endregion
