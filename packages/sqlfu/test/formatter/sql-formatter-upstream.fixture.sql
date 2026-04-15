-- default config: {"dialect":"sqlite"}

-- #region: keywordCase preserve keeps original keyword casing
-- config: {"keywordCase":"preserve"}
-- input:
select * From tbl WHERE x > 0
-- output:
select *
From tbl
WHERE x > 0
-- #endregion

-- #region: keywordCase lower lowercases reserved words
-- config: {"keywordCase":"lower"}
-- input:
select * From tbl WHERE x > 0
-- output:
select *
from tbl
where x > 0
-- #endregion

-- #region: linesBetweenQueries defaults to one blank line
-- input:
SELECT * FROM foo; SELECT * FROM bar;
-- output:
select *
from foo;

select *
from bar;
-- #endregion

-- #region: linesBetweenQueries can be zero
-- config: {"linesBetweenQueries":0}
-- input:
SELECT * FROM foo; SELECT * FROM bar;
-- output:
select *
from foo;
select *
from bar;
-- #endregion

-- #region: linesBetweenQueries can be two
-- config: {"linesBetweenQueries":2}
-- input:
SELECT * FROM foo; SELECT * FROM bar;
-- output:
select *
from foo;


select *
from bar;
-- #endregion

-- #region: replace into syntax formats as sqlite dml
-- input:
REPLACE INTO tbl VALUES (1,'Leopard'),(2,'Dog');
-- output:
replace into
  tbl
values
  (1, 'Leopard'),
  (2, 'Dog');
-- #endregion

-- #region: on conflict do update syntax formats as sqlite dml
-- input:
INSERT INTO tbl VALUES (1,'Leopard') ON CONFLICT DO UPDATE SET foo=1;
-- output:
insert into
  tbl
values
  (1, 'Leopard')
on conflict do update
set
  foo = 1;
-- #endregion

-- #region: short create table stays on one line
-- input:
CREATE TABLE tbl (a INT PRIMARY KEY, b TEXT);
-- output:
create table tbl (a int primary key, b text);
-- #endregion

-- #region: long create table breaks across lines
-- input:
CREATE TABLE tbl (a INT PRIMARY KEY, b TEXT, c INT NOT NULL, doggie INT NOT NULL);
-- output:
create table tbl (
  a int primary key,
  b text,
  c int not null,
  doggie int not null
);
-- #endregion

-- #region: tricky trailing line comments
-- input:
SELECT a--comment, here
FROM b--comment
-- output:
select a --comment, here
from b --comment
-- #endregion

-- #region: first line comments in file stay intact
-- input:
-- comment1
-- comment2
-- output: <unchanged>
-- #endregion

-- #region: parameterized cte formatting
-- input:
WITH cte_1(id, parent_id) AS (
  SELECT id, parent_id
  FROM tab1
  WHERE parent_id IS NULL
)
SELECT id, parent_id FROM cte_1;
-- output:
with
  cte_1 (id, parent_id) as (
    select
      id,
      parent_id
    from
      tab1
    where
      parent_id is null
  )
select id, parent_id
from cte_1;
-- #endregion
