-- default config: {"dialect":"mysql"}

-- #region: prettier-plugin-sql-cst / test / canonical_syntax.test: converts MySQL && and || operators to AND and OR
-- input:
SELECT a && b || c
-- output:
select a && b || c
-- #endregion

-- #region: prettier-plugin-sql-cst / test / canonical_syntax.test: replaces DISTINCTROW with DISTINCT
-- input:
SELECT DISTINCTROW foo FROM tbl
-- output:
select distinctrow
  foo
from tbl
-- #endregion

-- #region: prettier-plugin-sql-cst / test / canonical_syntax.test: replaces INSERT with INSERT INTO
-- input:
INSERT foo (id) VALUES (1)
-- output:
insert
  foo (id)
values
  (1)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / canonical_syntax.test: replaces RENAME AS with RENAME TO
-- input:
ALTER TABLE foo RENAME AS bar
-- output:
alter table foo
rename as bar
-- #endregion

-- #region: prettier-plugin-sql-cst / test / canonical_syntax.test: replaces RENAME with RENAME TO
-- input:
ALTER TABLE foo RENAME bar
-- output:
alter table foo
rename bar
-- #endregion

-- #region: prettier-plugin-sql-cst / test / canonical_syntax.test: replaces REPLACE with REPLACE INTO
-- input:
REPLACE foo (id) VALUES (1)
-- output:
replace
  foo (id)
values
  (1)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / canonical_syntax.test: replaces TRUNCATE with TRUNCATE TABLE
-- input:
TRUNCATE client
-- output:
truncate client
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER CONSTRAINT
-- input:
ALTER TABLE client
ALTER CHECK price_positive NOT ENFORCED
-- output:
alter table client
alter check price_positive not enforced
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: format MySQL column constraints
-- input:
CREATE TABLE client (
  id INT PRIMARY KEY AUTO_INCREMENT,
  fname VARCHAR(100) COMMENT 'First name',
  lname VARCHAR(100) KEY,
  age INT INVISIBLE,
  org_id INT COLUMN_FORMAT FIXED STORAGE DISK,
  content1 TEXT ENGINE_ATTRIBUTE '{ "indexing": "btree" }',
  content2 TEXT SECONDARY_ENGINE_ATTRIBUTE = '{ "indexing": "hashmap" }'
)
-- output:
create table client (
  id int primary key auto_increment,
  fname varchar(100) comment 'First name',
  lname varchar(100) key,
  age int invisible,
  org_id int column_format fixed storage disk,
  content1 text engine_attribute '{ "indexing": "btree" }',
  content2 text secondary_engine_attribute = '{ "indexing": "hashmap" }'
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE TABLE AS with column definitions
-- input:
CREATE TABLE foo (
  id INT,
  name VARCHAR(100)
) AS
  SELECT * FROM tbl WHERE x > 0
-- output:
create table foo (id int, name varchar(100)) as
select *
from tbl
where x > 0
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats FOREIGN KEY with index name
-- input:
CREATE TABLE client (
  FOREIGN KEY indexName (org_id1) REFERENCES organization (id1)
)
-- output:
create table client (
  foreign key indexname (org_id1) references organization (id1)
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats MySQL table constraints
-- input:
CREATE TABLE client (
  id INT,
  name TEXT,
  KEY (id, name),
  FULLTEXT INDEX (name),
  CHECK (id > 0) NOT ENFORCED
)
-- output:
create table client (
  id int,
  name text,
  key (id, name),
  fulltext index (name),
  check (id > 0) not enforced
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats MySQL table options
-- input:
CREATE TABLE foo (
  id INT
)
AUTOEXTEND_SIZE = 10,
AVG_ROW_LENGTH = 100,
DEFAULT CHARACTER SET latin1,
COMMENT = 'hello',
TABLESPACE ts1,
STORAGE DISK,
UNION = (foo, bar)
-- output:
create table foo (id int) autoextend_size = 10,
avg_row_length = 100,
default character set latin1,
comment = 'hello',
tablespace ts1,
storage disk,
union
= (foo, bar)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / rename_table.test: formats long list of renames
-- input:
RENAME TABLE
  my_schema.some_table TO my_schema.some_other_table,
  my_schema.some_table2 TO my_schema.some_other_table2
-- output:
rename table my_schema.some_table to my_schema.some_other_table,
my_schema.some_table2 to my_schema.some_other_table2
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / rename_table.test: formats multi-table rename
-- input:
RENAME TABLE foo TO bar, zip TO zap
-- output:
rename table foo to bar,
zip to zap
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / rename_table.test: formats RENAME TABLE statement
-- input:
RENAME TABLE foo TO bar
-- output:
rename table foo to bar
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats ALTER VIEW with columns
-- input:
ALTER VIEW my_view (foo, bar, baz)
AS
  SELECT 1, 2, 3
-- output:
alter view my_view (foo, bar, baz) as
select 1, 2, 3
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats DROP VIEW .. CASCADE|RESTRICT
-- input:
DROP VIEW my_view CASCADE
-- output:
drop view my_view cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / delete.test: formats DELETE with MySQL hints
-- input:
DELETE QUICK IGNORE FROM employee
WHERE id = 10
-- output:
delete quick ignore from employee
where id = 10
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats INSERT with MySQL hints
-- input:
INSERT LOW_PRIORITY IGNORE INTO employee
VALUES (1, 2, 3)
-- output:
insert low_priority ignore into
  employee
values
  (1, 2, 3)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats INSERT with PARTITION selection
-- input:
INSERT INTO client PARTITION (p1, p2)
VALUES (1, 2, 3)
-- output:
insert into
  client partition (p1, p2)
values
  (1, 2, 3)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats multi-line (if user prefers)
-- input:
INSERT INTO client
VALUES (1, 2, 3)
ON DUPLICATE KEY UPDATE
  col1 = 2,
  col2 = DEFAULT
-- output:
insert into
  client
values
  (1, 2, 3)
on duplicate key update
  col1 = 2,
  col2 = default
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats single-line (if user prefers)
-- input:
INSERT INTO client
VALUES (1, 2, 3)
ON DUPLICATE KEY UPDATE col1 = 2, col2 = DEFAULT
-- output:
insert into
  client
values
  (1, 2, 3)
on duplicate key update
  col1 = 2,
  col2 = default
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats with row alias + column aliases on a single line
-- input:
INSERT INTO client
VALUES (1, 'John')
AS new_row (id, fname)
ON DUPLICATE KEY UPDATE id = new_row.id + 1
-- output:
insert into
  client
values
  (1, 'John') as new_row (id, fname)
on duplicate key update
  id = new_row.id + 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats with row alias using column aliases
-- input:
INSERT INTO client
VALUES (1, 'John')
AS new_row
  (id, fname)
ON DUPLICATE KEY UPDATE
  id = new_row.id + 1
-- output:
insert into
  client
values
  (1, 'John') as new_row (id, fname)
on duplicate key update
  id = new_row.id + 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats with simple row alias
-- input:
INSERT INTO client
VALUES (1, 'John')
AS new_row
ON DUPLICATE KEY UPDATE
  id = new_row.id + 1
-- output:
insert into
  client
values
  (1, 'John') as new_row
on duplicate key update
  id = new_row.id + 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / update.test: formats MySQL hints
-- input:
UPDATE LOW_PRIORITY employee
SET salary = 1000
-- output:
update low_priority employee
set
  salary = 1000
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats MATCH .. AGAINST expressions
-- input:
SELECT MATCH (title, body) AGAINST ('some text' IN NATURAL LANGUAGE MODE)
-- output:
select match(title, body) against ('some text' in natural language mode)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats MATCH .. AGAINST expressions
-- input:
SELECT MATCH (title, body) AGAINST ('some text')
-- output:
select match(title, body) against ('some text')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats string concatenation with whitespace
-- input:
SELECT 'Hello' 'world'
-- output:
select 'Hello' 'world'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats string literals with charset
-- input:
SELECT _utf8'Hello'
-- output:
select _utf8 'Hello'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / identifierCase.test: changes case of MySQL variables
-- input:
SELECT @foo, @Bar_, @foo_bar_123
-- output:
select @foo, @Bar_, @foo_bar_123
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / identifierCase.test: does not change case of quoted MySQL variables
-- input:
SELECT @"foo", @'Bar_', @`foo_bar_123`
-- output:
select @"foo", @'Bar_', @`foo_bar_123`
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / prepared_statements.test: formats EXECUTE name USING ...args
-- input:
EXECUTE my_prepared_stmt USING 1, 'some text'
-- output:
execute my_prepared_stmt using 1,
'some text'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / prepared_statements.test: formats EXECUTE name USING ...long argument list
-- input:
EXECUTE my_prepared_stmt USING
  1,
  'some text',
  3.14,
  TRUE,
  NULL,
  'another text',
  42,
  FALSE
-- output:
execute my_prepared_stmt using 1,
'some text',
3.14,
true,
null,
'another text',
42,
false
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / prepared_statements.test: formats PREPARE name FROM 'long string'
-- input:
PREPARE my_statement FROM
  'SELECT 1 AS col1, 2 AS col2, 3 AS col3, 4 AS col4, 5 AS col5'
-- output:
prepare my_statement
from 'SELECT 1 AS col1, 2 AS col2, 3 AS col3, 4 AS col4, 5 AS col5'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / prepared_statements.test: formats PREPARE name FROM @var
-- input:
PREPARE my_statement FROM @var
-- output:
prepare my_statement
from @var
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / return.test: formats RETURN statement with value
-- input:
RETURN 5 + 6
-- output:
return 5 + 6
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats FROM DUAL
-- input:
SELECT * FROM DUAL
-- output:
select *
from dual
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats LATERAL subquery
-- input:
SELECT *
FROM
  tbl
  JOIN LATERAL (SELECT * FROM foo) AS t
-- output:
select *
from
  tbl
  join lateral (
    select
      *
    from
      foo
  ) as t
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats PARTITION selection
-- input:
SELECT * FROM tbl1 PARTITION (p1, p2)
-- output:
select *
from tbl1 partition (p1, p2)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / into.test: formats INTO @variable
-- input:
SELECT 1, 2 INTO @var1, @var2
-- output:
select 1, 2 into @var1, @var2
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / into.test: formats INTO DUMPFILE
-- input:
SELECT 1 INTO DUMPFILE 'file_name'
-- output:
select 1 into dumpfile 'file_name'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / into.test: formats INTO OUTFILE
-- input:
SELECT 1 INTO OUTFILE 'file_name'
-- output:
select 1 into outfile 'file_name'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / into.test: formats INTO OUTFILE with options
-- input:
SELECT 1
INTO OUTFILE 'file_name'
  CHARACTER SET utf8
  FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '"' ESCAPED BY '^'
  LINES STARTING BY '!' TERMINATED BY '\n'
-- output:
select
  1 into outfile 'file_name' character set utf8 fields terminated by ',' optionally enclosed by '"' escaped by '^' lines starting by '!' terminated by '\n'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / into.test: formats long INTO @variable
-- config: {"expressionWidth":10}
-- input:
SELECT
  1,
  2
INTO
  @variable1,
  @variable2
-- output:
select 1, 2 into @variable1, @variable2
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats GROUP BY .. WITH ROLLUP
-- config: {"expressionWidth":25}
-- input:
SELECT
  my_col
GROUP BY
  first_column,
  second_column
  WITH ROLLUP
-- output:
select my_col
group by first_column, second_column
with
  rollup
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats GROUP BY .. WITH ROLLUP
-- input:
SELECT * GROUP BY a, b WITH ROLLUP
-- output:
select *
group by a, b
with
  rollup
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats LOCK IN SHARE MODE
-- input:
SELECT * FROM tbl LOCK IN SHARE MODE
-- output:
select *
from tbl lock in share mode
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats MySQL hints
-- input:
SELECT HIGH_PRIORITY SQL_NO_CACHE col1, col2
FROM tbl
-- output:
select high_priority sql_no_cache col1, col2
from tbl
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats ORDER BY .. WITH ROLLUP
-- config: {"expressionWidth":25}
-- input:
SELECT
  my_col
ORDER BY
  first_column ASC,
  second_column DESC
  WITH ROLLUP
-- output:
select my_col
order by first_column asc, second_column desc
with
  rollup
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats ORDER BY .. WITH ROLLUP
-- input:
SELECT * ORDER BY a, b WITH ROLLUP
-- output:
select *
order by a, b
with
  rollup
-- #endregion
