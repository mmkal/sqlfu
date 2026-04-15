-- default config: {"dialect":"sqlite"}

-- #region: prettier-plugin-sql-cst / test / alias.test: formats aliases
-- config: {"expressionWidth":20}
-- input:
SELECT
  1 AS a,
  2 AS b,
  3 AS c
-- output:
select 1 as a, 2 as b, 3 as c
-- #endregion

-- #region: prettier-plugin-sql-cst / test / alias.test: preserves implicit and explicit aliases as-is
-- input:
SELECT 1 AS foo, 2 bar FROM client c, tbl AS t
-- output:
select 1 as foo, 2 bar
from client c, tbl as t
-- #endregion

-- #region: prettier-plugin-sql-cst / test / analyze.test: formats ANALYZE statement
-- input:
ANALYZE my_schema.my_table
-- output:
analyze my_schema.my_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / analyze.test: formats ANALYZE TABLE statement
-- input:
ANALYZE TABLE foo
-- output:
analyze table foo
-- #endregion

-- #region: prettier-plugin-sql-cst / test / analyze.test: formats multiple tables
-- input:
ANALYZE foo, bar, baz
-- output:
analyze foo,
bar,
baz
-- #endregion

-- #region: prettier-plugin-sql-cst / test / analyze.test: formats plain ANALYZE statement
-- input:
ANALYZE
-- output:
analyze
-- #endregion

-- #region: prettier-plugin-sql-cst / test / canonical_syntax.test: converts <> comparisons to !=
-- input:
SELECT * FROM foo WHERE x <> 1 AND y <> 3
-- output:
select *
from foo
where x <> 1 and y <> 3
-- #endregion

-- #region: prettier-plugin-sql-cst / test / canonical_syntax.test: replaces TEMP with TEMPORARY
-- input:
CREATE TEMP TABLE foo (id INT)
-- output:
create temp table foo (id int)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / comments.test: allows for empty minus-minus comments
-- input:
--
--
SELECT 1;
-- output:
--
--
select 1;
-- #endregion

-- #region: prettier-plugin-sql-cst / test / comments.test: allows for empty # comments
-- input:
#
#
SELECT 1;
-- error: "Parse error: Unexpected \"#\n#\nSELECT\" at line 1 column 1.\nSQL dialect used: \"sqlite\"."
-- #endregion

-- #region: prettier-plugin-sql-cst / test / comments.test: collapses multiple empty lines between comments to one
-- input:
SELECT 1;
-- foo


-- baz
SELECT 1;
-- output:
select 1;

-- foo
-- baz
select 1;
-- #endregion

-- #region: prettier-plugin-sql-cst / test / comments.test: does not introduce empty line before comment containing an empty line
-- input:
SELECT 1;
/* */
/*

*/
SELECT 1;
-- output:
select 1;

/* */
/*

*/
select 1;
-- #endregion

-- #region: prettier-plugin-sql-cst / test / comments.test: enforces space between minus-minus and comment text
-- input:

        --My comment
        SELECT 1;
      
-- output:
--My comment
select 1;
-- #endregion

-- #region: prettier-plugin-sql-cst / test / comments.test: enforces space between # and comment text
-- input:

        #My comment
        SELECT 1;
      
-- error: "Parse error: Unexpected \"#My commen\" at line 2 column 9.\nSQL dialect used: \"sqlite\"."
-- #endregion

-- #region: prettier-plugin-sql-cst / test / comments.test: formats basic doc-comments
-- input:
/**
 * A large doc-comment comment
 * inside this block of code
 */
SELECT 1, 2, 3;
-- output:
/**
 * A large doc-comment comment
 * inside this block of code
 */
select 1, 2, 3;
-- #endregion

-- #region: prettier-plugin-sql-cst / test / comments.test: formats block comments
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

-- #region: prettier-plugin-sql-cst / test / comments.test: formats block comments between syntax elements
-- input:
CREATE /*c1*/ TABLE /*c2*/ IF /*c3*/ NOT EXISTS /*c4*/ foo (
  id /*c5*/ INT /*c6*/ NOT /*c7*/ NULL
);
-- output:
create /*c1*/ table /*c2*/ if /*c3*/ not exists /*c4*/ foo (id /*c5*/ int /*c6*/ not /*c7*/ null);
-- #endregion

-- #region: prettier-plugin-sql-cst / test / comments.test: formats comments between statements
-- input:
-- comment for 1
SELECT 1;

-- comment for 2
SELECT 2;
-- comment for 3
SELECT 3;
-- output:
-- comment for 1
select 1;

-- comment for 2
select 2;

-- comment for 3
select 3;
-- #endregion

-- #region: prettier-plugin-sql-cst / test / comments.test: formats line comments
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

-- #region: prettier-plugin-sql-cst / test / comments.test: keeps separate-line line-comments on a separate line (not moving them to line end)
-- input:
CREATE TABLE foo
-- com1
-- com2
(
  col INT
);
-- output:
create table foo
-- com1
-- com2
(col int);
-- #endregion

-- #region: prettier-plugin-sql-cst / test / comments.test: moves line comments before comma to line ends
-- input:

        SELECT
          1 -- com1
          ,2 -- com2
          ,3 -- com3
      
-- output:
select 1 -- com1
,
  2 -- com2
,
  3 -- com3
-- #endregion

-- #region: prettier-plugin-sql-cst / test / comments.test: preserves #! comments as-is
-- input:
#!/usr/bin/sqlite
SELECT 1;
-- error: "Parse error: Unexpected \"#!/usr/bin\" at line 1 column 1.\nSQL dialect used: \"sqlite\"."
-- #endregion

-- #region: prettier-plugin-sql-cst / test / comments.test: preserves empty lines between comments
-- input:
SELECT 1;
-- foo

-- bar

-- baz
SELECT 1;
-- output:
select 1;

-- foo
-- bar
-- baz
select 1;
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE..ADD COLUMN
-- input:
ALTER TABLE client
ADD col1 INT
-- output:
alter table client
add col1 int
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE..ADD COLUMN
-- input:
ALTER TABLE client
ADD COLUMN col1 INT
-- output:
alter table client
add column col1 int
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE..DROP COLUMN
-- input:
ALTER TABLE client
DROP col1
-- output:
alter table client
drop col1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE..DROP COLUMN
-- input:
ALTER TABLE client
DROP COLUMN col1
-- output:
alter table client
drop column col1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE..RENAME COLUMN
-- input:
ALTER TABLE client
RENAME col1 TO col2
-- output:
alter table client
rename col1 to col2
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE..RENAME COLUMN
-- input:
ALTER TABLE client
RENAME COLUMN col1 TO col2
-- output:
alter table client
rename column col1 to col2
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats short ALTER TABLE..RENAME on a single line
-- input:
ALTER TABLE client RENAME TO org_client
-- output:
alter table client
rename to org_client
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: preserves ALTER TABLE..RENAME on muliple lines
-- input:
ALTER TABLE client
RENAME TO org_client
-- output:
alter table client
rename to org_client
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats constraints with ON CONFLICT clause
-- input:
CREATE TABLE client (
  id INT,
  name VARCHAR(100) NOT NULL ON CONFLICT FAIL,
  uuid INT UNIQUE ON CONFLICT ROLLBACK,
  CONSTRAINT prim_key PRIMARY KEY (id) ON CONFLICT ABORT,
  foo INT CHECK (foo > 0) ON CONFLICT IGNORE
)
-- output:
create table client (
  id int,
  name varchar(100) not null
  on conflict fail,
  uuid int unique
  on conflict rollback,
  constraint prim_key primary key (id)
  on conflict abort,
  foo int check (foo > 0)
  on conflict ignore
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE TABLE AS
-- input:
CREATE TABLE foo AS
  SELECT * FROM tbl WHERE x > 0
-- output:
create table foo as
select *
from tbl
where x > 0
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE TABLE AS with long query
-- input:
CREATE TABLE foo AS
  SELECT column1, column2, column3
  FROM external_client
  WHERE external_client.payment > external_client.income
-- output:
create table foo as
select column1, column2, column3
from external_client
where external_client.payment > external_client.income
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE TABLE with column constraints
-- input:
CREATE TABLE client (
  id INT NOT NULL PRIMARY KEY,
  fname VARCHAR(100) NULL,
  lname VARCHAR(100) UNIQUE COLLATE RTRIM,
  age VARCHAR(6) DEFAULT 0,
  organization_id INT REFERENCES organization (id),
  byear1 INT GENERATED ALWAYS AS (today - age) VIRTUAL,
  byear2 INT AS (today - age)
)
-- output:
create table client (
  id int not null primary key,
  fname varchar(100) null,
  lname varchar(100) unique collate rtrim,
  age varchar(6) default 0,
  organization_id int references organization (id),
  byear1 int generated always as (today - age) virtual,
  byear2 int as (today - age)
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE TABLE with named column constraints
-- input:
CREATE TABLE client (
  id INT CONSTRAINT NOT NULL CONSTRAINT prim_key PRIMARY KEY
)
-- output:
create table client (
  id int constraint not null constraint prim_key primary key
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE TABLE with named table constraints
-- input:
CREATE TABLE client (
  id INT,
  CONSTRAINT prim_key PRIMARY KEY (id, name),
  CONSTRAINT org_for_key
    FOREIGN KEY (id, org_id) REFERENCES organization (id, org_id)
)
-- output:
create table client (
  id int,
  constraint prim_key primary key (id, name),
  constraint org_for_key foreign key (id, org_id) references organization (id, org_id)
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE TABLE with table constraints
-- input:
CREATE TABLE client (
  id INT,
  name VARCHAR,
  PRIMARY KEY (id, name),
  UNIQUE (name),
  CHECK (id > 0),
  FOREIGN KEY (id, org_id) REFERENCES organization (id, org_id)
)
-- output:
create table client (
  id int,
  name varchar,
  primary key (id, name),
  unique (name),
  check (id > 0),
  foreign key (id, org_id) references organization (id, org_id)
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE TABLE with various data types
-- input:
CREATE TABLE client (
  id INTEGER,
  name VARCHAR(100),
  price DECIMAL(10, 5),
  age UNSIGNED BIG INT,
  organization_name NATIVE CHARACTER (70)
)
-- output:
create table client (
  id integer,
  name varchar(100),
  price decimal(10, 5),
  age unsigned big int,
  organization_name native character(70)
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE TEMPORARY TABLE
-- input:
CREATE TEMP TABLE foo (
  id INT
)
-- output:
create temp table foo (id int)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE TEMPORARY TABLE
-- input:
CREATE TEMPORARY TABLE foo (
  id INT
)
-- output:
create temporary table foo (id int)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE VIRTUAL TABLE
-- input:
CREATE VIRTUAL TABLE my_table USING my_func(1, 2)
-- output:
create virtual table my_table using my_func (1, 2)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats deferrable FOREIGN KEY constraint
-- input:
CREATE TABLE client (
  id INT,
  CONSTRAINT fkey
    FOREIGN KEY (org_id1) REFERENCES organization (id1) DEFERRABLE,
  FOREIGN KEY (org_id2) REFERENCES organization (id2)
    NOT DEFERRABLE INITIALLY DEFERRED
)
-- output:
create table client (
  id int,
  constraint fkey foreign key (org_id1) references organization (id1) deferrable,
  foreign key (org_id2) references organization (id2) not deferrable initially deferred
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats FOREIGN KEY constraint with options
-- input:
CREATE TABLE client (
  id INT,
  FOREIGN KEY (org_id1) REFERENCES organization (id1)
    ON DELETE SET NULL
    ON UPDATE CASCADE,
  FOREIGN KEY (org_id3) REFERENCES organization (id3)
    MATCH FULL
)
-- output:
create table client (
  id int,
  foreign key (org_id1) references organization (id1) on delete set null on update cascade,
  foreign key (org_id3) references organization (id3) match full
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats IF NOT EXISTS
-- input:
CREATE TABLE IF NOT EXISTS foo (
  id INT
)
-- output:
create table if not exists foo (id int)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats short CREATE TABLE on multiple lines if user prefers
-- input:
CREATE TABLE client (
  id INT,
  name VARCHAR(100),
  org_id INT
)
-- output:
create table client (id int, name varchar(100), org_id int)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats short CREATE TABLE on single line if it fits
-- input:
CREATE TABLE client (id INT, name VARCHAR(100), org_id INT)
-- output:
create table client (id int, name varchar(100), org_id int)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats SQLite PRIMARY KEY modifiers
-- input:
CREATE TABLE client (
  id INTEGER PRIMARY KEY ASC AUTOINCREMENT
)
-- output:
create table client (id integer primary key asc autoincrement)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats SQLite table options
-- input:
CREATE TABLE foo (
  id INT
)
WITHOUT ROWID, STRICT
-- output:
create table foo (id int) without rowid,
strict
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / drop_table.test: formats DROP TABLE statement
-- input:
DROP TABLE client
-- output:
drop table client
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / drop_table.test: formats IF EXISTS
-- input:
DROP TABLE IF EXISTS schm.client
-- output:
drop table if exists schm.client
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats CREATE INDEX
-- input:
CREATE INDEX my_index ON my_table (col1, col2)
-- output:
create index my_index on my_table (col1, col2)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats CREATE UNIQUE INDEX
-- input:
CREATE UNIQUE INDEX my_index ON my_table (col)
-- output:
create unique index my_index on my_table (col)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats DROP INDEX
-- input:
DROP INDEX my_index
-- output:
drop index my_index
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats IF EXISTS
-- input:
DROP INDEX IF EXISTS my_index
-- output:
drop index if exists my_index
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats IF NOT EXISTS
-- input:
CREATE INDEX IF NOT EXISTS my_index ON my_table (col)
-- output:
create index if not exists my_index on my_table (col)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats long columns list on multiple lines
-- input:
CREATE UNIQUE INDEX IF NOT EXISTS my_index ON my_table (
  column_name_one,
  column_name_two,
  column_name_three
)
-- output:
create unique index if not exists my_index on my_table (
  column_name_one,
  column_name_two,
  column_name_three
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats plain REINDEX
-- input:
REINDEX
-- output:
reindex
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats REINDEX
-- input:
REINDEX my_schema.my_table
-- output:
reindex my_schema.my_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats WHERE clause on same line (if user prefers)
-- input:
CREATE INDEX my_index ON my_table (col) WHERE col > 10
-- output:
create index my_index on my_table (col)
where col > 10
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats WHERE clause on separate line (if user prefers)
-- input:
CREATE INDEX my_index ON my_table (col)
WHERE col > 10
-- output:
create index my_index on my_table (col)
where col > 10
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats CREATE TRIGGER .. INSTEAD OF UPDATE OF
-- input:
CREATE TRIGGER cust_addr_chng
INSTEAD OF UPDATE OF cust_addr ON customer_address
BEGIN
  UPDATE customer
  SET cust_addr = NEW.cust_addr
  WHERE cust_id = NEW.cust_id;
END
-- output:
create trigger cust_addr_chng instead of
update of cust_addr on customer_address begin
update customer
set
  cust_addr = new.cust_addr
where cust_id = new.cust_id;

end
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats DROP TRIGGER
-- input:
DROP TRIGGER my_trigger
-- output:
drop trigger my_trigger
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats FOR EACH ROW
-- input:
CREATE TRIGGER cust_addr_del
INSERT ON customer_address
FOR EACH ROW
BEGIN
  DELETE FROM customer
  WHERE cust_id = OLD.id;
END
-- output:
create trigger cust_addr_del insert on customer_address for each row begin
delete from customer
where cust_id = old.id;

end
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats IF EXISTS
-- input:
DROP TRIGGER IF EXISTS my_trigger
-- output:
drop trigger if exists my_trigger
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats long UPDATE OF column list
-- input:
CREATE TRIGGER cust_addr_chng
INSTEAD OF UPDATE OF
  cust_address,
  cust_zip_code,
  cust_country,
  super_long_column_name
ON customer_address
BEGIN
  DELETE FROM customer;
END
-- output:
create trigger cust_addr_chng instead of
update of cust_address,
cust_zip_code,
cust_country,
super_long_column_name on customer_address begin
delete from customer;

end
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats long WHEN condition
-- input:
CREATE TRIGGER cust_addr_del
INSERT ON customer_address
WHEN
  customer_address.priority > 10
  AND customer_address.id IS NOT NULL
  AND customer_address.priority < 100
BEGIN
  DELETE FROM customer;
END
-- output:
create trigger cust_addr_del insert on customer_address when customer_address.priority > 10
and customer_address.id is not null
and customer_address.priority < 100 begin
delete from customer;

end
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats TEMPORARY TRIGGER IF NOT EXISTS
-- input:
CREATE TEMPORARY TRIGGER IF NOT EXISTS cust_addr_del
DELETE ON customer_address
BEGIN
  DELETE FROM customer;
END
-- output:
create temporary trigger if not exists cust_addr_del delete on customer_address begin
delete from customer;

end
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats WHEN condition
-- input:
CREATE TRIGGER cust_addr_del
INSERT ON customer_address
FOR EACH ROW
WHEN priority > 10
BEGIN
  DELETE FROM customer;
END
-- output:
create trigger cust_addr_del insert on customer_address for each row when priority > 10 begin
delete from customer;

end
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats CREATE VIEW
-- input:
CREATE VIEW active_client_id AS
  SELECT id FROM client WHERE active = TRUE
-- output:
create view active_client_id as
select id
from client
where active = true
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats CREATE VIEW with column list
-- input:
CREATE VIEW foobar (col1, col2, col3) AS
  SELECT 1
-- output:
create view foobar (col1, col2, col3) as
select 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats CREATE VIEW with long column list
-- input:
CREATE VIEW active_client_in_queue (
  client_name,
  client_org_name,
  status,
  priority_index
) AS
  SELECT * FROM client
-- output:
create view active_client_in_queue (
  client_name,
  client_org_name,
  status,
  priority_index
) as
select *
from client
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats DROP VIEW
-- input:
DROP VIEW active_client_view, other_view, another_view
-- output:
drop view active_client_view,
other_view,
another_view
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats DROP VIEW IF EXISTS
-- input:
DROP VIEW IF EXISTS my_schema.active_client_view
-- output:
drop view if exists my_schema.active_client_view
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / delete.test: formats DELETE statement with ORDER BY and LIMIT
-- input:
DELETE FROM employee
WHERE id = 10
ORDER BY name
LIMIT 100
-- output:
delete from employee
where id = 10
order by name
limit 100
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / delete.test: formats DELETE statement with RETURNING clause
-- input:
DELETE FROM employee
WHERE id = 10
RETURNING
  id AS employee_identifier,
  name AS employee_name,
  status AS employee_status
-- output:
delete from employee
where id = 10
returning
  id as employee_identifier,
  name as employee_name,
  status as employee_status
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / delete.test: formats DELETE statement with WHERE CURRENT OF clause
-- input:
DELETE FROM employee
WHERE CURRENT OF cursor_name
-- output:
delete from employee
where current of cursor_name
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / delete.test: formats short DELETE statement on a single line
-- input:
DELETE FROM employee WHERE id = 10
-- output:
delete from employee
where id = 10
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / delete.test: preserves short DELETE statement on multiple lines
-- input:
DELETE FROM employee
WHERE id = 10
-- output:
delete from employee
where id = 10
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats INSERT statement with column names
-- input:
INSERT INTO client
  (id, fname, lname, org_id)
VALUES
  (1, 'John', 'Doe', 27)
-- output:
insert into
  client (id, fname, lname, org_id)
values
  (1, 'John', 'Doe', 27)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats INSERT statement with long column names list
-- input:
INSERT INTO client
  (id, first_name, last_name, organization_id, project_access_enabled)
VALUES
  (1, 'John', 'Doe', 27, TRUE),
  (2, 'Alice', 'Namis', 31, FALSE),
  (3, 'Peter', 'Tucker', 11, TRUE)
-- output:
insert into
  client (
    id,
    first_name,
    last_name,
    organization_id,
    project_access_enabled
  )
values
  (1, 'John', 'Doe', 27, true),
  (2, 'Alice', 'Namis', 31, false),
  (3, 'Peter', 'Tucker', 11, true)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats INSERT statement with multiple rows always to multiple lines
-- input:
INSERT INTO client
VALUES
  (1, 'John', 'Doe', 27),
  (2, 'Alice', 'Namis', 31)
-- output:
insert into
  client
values
  (1, 'John', 'Doe', 27),
  (2, 'Alice', 'Namis', 31)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats INSERT statement with very long column names and values lists
-- input:
INSERT INTO client
  (
    id,
    first_name,
    last_name,
    organization_id,
    project_access_enabled,
    delivery_status
  )
VALUES
  (
    1,
    'Johnathan Sigfried Jr.',
    'Dolittle',
    2745612,
    TRUE,
    'permanently_disabled'
  ),
  (2, 'Alicia', 'Namis', 31, FALSE, 'allows_accepting')
-- output:
insert into
  client (
    id,
    first_name,
    last_name,
    organization_id,
    project_access_enabled,
    delivery_status
  )
values
  (
    1,
    'Johnathan Sigfried Jr.',
    'Dolittle',
    2745612,
    true,
    'permanently_disabled'
  ),
  (
    2,
    'Alicia',
    'Namis',
    31,
    false,
    'allows_accepting'
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats INSERT with RETURNING clause
-- input:
INSERT INTO client
VALUES (1, 2, 3)
RETURNING id, name, status
-- output:
insert into
  client
values
  (1, 2, 3)
returning id, name, status
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats insertion of DEFAULT VALUES
-- input:
INSERT INTO employee
DEFAULT VALUES
-- output:
insert into
  employee default
values
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats insertion of query
-- input:
INSERT INTO employee
SELECT * FROM tbl
-- output:
insert into
  employee
select *
from tbl
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats OR ABORT modifier
-- input:
INSERT OR ABORT INTO employee
VALUES (1, 2, 3)
-- output:
insert or abort into
  employee
values
  (1, 2, 3)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats short DO UPDATE on a single line (if user prefers)
-- input:
INSERT INTO client
VALUES (1, 2, 3)
ON CONFLICT (id) DO UPDATE SET id = uuid + 1
-- output:
insert into
  client
values
  (1, 2, 3)
on conflict (id) do update
set
  id = uuid + 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats short INSERT statement on single line
-- input:
INSERT INTO client VALUES (1, 'John', 'Doe', 27)
-- output:
insert into
  client
values
  (1, 'John', 'Doe', 27)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats upsert clauses
-- input:
INSERT INTO client
VALUES (1, 2, 3)
ON CONFLICT DO NOTHING
ON CONFLICT (name, price) DO NOTHING
ON CONFLICT (id) WHERE id > 10 DO UPDATE
  SET id = uuid + 1
  WHERE id < 100
-- output:
insert into
  client
values
  (1, 2, 3)
on conflict do nothing
on conflict (name, price) do nothing
on conflict (id)
where id > 10 do update
set
  id = uuid + 1
where id < 100
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / update.test: formats OR ABORT modifier
-- input:
UPDATE OR ABORT employee
SET salary = 1000
-- output:
update or abort employee
set
  salary = 1000
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / update.test: formats short UPDATE statement on single line
-- input:
UPDATE employee SET salary = 1000 WHERE id = 10
-- output:
update employee
set
  salary = 1000
where id = 10
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / update.test: formats UPDATE statement with multiple assignments
-- input:
UPDATE employee
SET
  name = 'John Doe',
  salary = 1000,
  resigned = FALSE
WHERE id = 11
-- output:
update employee
set
  name = 'John Doe',
  salary = 1000,
  resigned = false
where id = 11
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / update.test: formats UPDATE with parenthesized column groups
-- input:
UPDATE employee
SET
  (name, salary) = ('John Doe', 1000),
  (resigned, status) = (FALSE, 'active')
-- output:
update employee
set
  (name, salary) = ('John Doe', 1000),
  (resigned, status) = (false, 'active')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / update.test: formats UPDATE with RETURNING clause
-- input:
UPDATE client
SET status = 2
RETURNING *
-- output:
update client
set
  status = 2
returning *
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / update.test: preserves multi-line short UPDATE statement formatting
-- input:
UPDATE employee
SET salary = 1000
WHERE id = 10
-- output:
update employee
set
  salary = 1000
where id = 10
-- #endregion

-- #region: prettier-plugin-sql-cst / test / explain.test: formats EXPLAIN QUERY PLAIN statement
-- input:
EXPLAIN QUERY PLAN SELECT 1
-- output:
explain query plan
select 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / explain.test: formats EXPLAIN statement
-- input:
EXPLAIN SELECT 1
-- output:
explain
select 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / explain.test: formats long EXPLAIN QUERY PLAN statement to multiple lines
-- input:
EXPLAIN QUERY PLAN
  SELECT id, name, item_count
  FROM inventory
  WHERE item_count > 10
-- output:
explain query plan
select id, name, item_count
from inventory
where item_count > 10
-- #endregion

-- #region: prettier-plugin-sql-cst / test / explain.test: formats long EXPLAIN statement to multiple lines
-- input:
EXPLAIN
  SELECT id, name, item_count
  FROM inventory
  WHERE item_count > 10
-- output:
explain
select id, name, item_count
from inventory
where item_count > 10
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: eliminates unnecessary (((nested))) parenthesis
-- input:
SELECT (((1 + 2))) * 3
-- output:
select (((1 + 2))) * 3
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: eliminates unnecessary parenthesis around function arguments
-- input:
SELECT my_func((id), (name))
-- output:
select my_func ((id), (name))
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats a chain of AND/OR operators to multiple lines
-- input:
SELECT *
FROM client
WHERE
  client.country = 'Nicaragua'
  AND client.expired IS NULL
  AND client.yearly_income > 20000
  AND client.monthly_income > 100
  OR client.special = TRUE
-- output:
select *
from client
where
  client.country = 'Nicaragua'
  and client.expired is null
  and client.yearly_income > 20000
  and client.monthly_income > 100
  or client.special = true
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats BETWEEN expressions
-- config: {"expressionWidth":40}
-- input:
SELECT
  x BETWEEN 1 AND 10,
  y NOT BETWEEN 2 AND 8
-- output:
select x between 1 and 10, y not between 2 and 8
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats binary expressions
-- config: {"expressionWidth":25}
-- input:
SELECT 1 + 2 / 3 * (5 - 1), TRUE OR FALSE AND TRUE
-- output:
select 1 + 2 / 3 * (5 - 1), true or false and true
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats CASE expression always on multiple lines
-- input:
SELECT
  CASE x
    WHEN 1 THEN 'A'
    ELSE 'B'
  END
-- output:
select
  case x
    when 1 then 'A'
    else 'B'
  end
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats CASE expression with base expression
-- input:
SELECT
  CASE status
    WHEN 1 THEN 'good'
    WHEN 2 THEN 'bad'
    ELSE 'unknown'
  END
-- output:
select
  case status
    when 1 then 'good'
    when 2 then 'bad'
    else 'unknown'
  end
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats CASE expression without base expression
-- input:
SELECT
  CASE
    WHEN status = 1 THEN 'good'
    WHEN status = 2 THEN 'bad'
    ELSE 'unknown'
  END
-- output:
select
  case
    when status = 1 then 'good'
    when status = 2 then 'bad'
    else 'unknown'
  end
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats EXISTS expressions
-- config: {"expressionWidth":60}
-- input:
SELECT
  EXISTS (SELECT * FROM tbl),
  NOT EXISTS (SELECT col FROM tbl2)
-- output:
select
  exists (
    select
      *
    from
      tbl
  ),
  not exists (
    select
      col
    from
      tbl2
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats IN expressions
-- input:
SELECT col1 IN (1, 2, 3), col2 NOT IN (4, 5, 6)
-- output:
select col1 in (1, 2, 3), col2 not in (4, 5, 6)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats IS expressions
-- input:
SELECT
  x IS NOT NULL,
  y IS NULL,
  z IS DISTINCT FROM NULL,
  q IS NOT DISTINCT FROM NULL
-- output:
select x is not null, y is null, z is distinct
from null, q is not distinct
from null
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats ISNULL / NOTNULL / NOT NULL expressions
-- input:
SELECT fname ISNULL, xname NOTNULL, lname NOT NULL
-- output:
select fname isnull, xname notnull, lname not null
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats LIKE expressions
-- input:
SELECT fname LIKE 'Mar%', lname NOT LIKE '%ony'
-- output:
select fname like 'Mar%', lname not like '%ony'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats negation
-- input:
SELECT -x
-- output:
select - x
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats NOT expressions
-- input:
SELECT NOT x > 10
-- output:
select not x > 10
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: preserves comments when eliminating (((nested))) parenthesis
-- input:
SELECT (/*c1*/(/*c2*/(/*c3*/ 1 + 2))) * 3
-- output:
select
  (/*c1*/ (/*c2*/ (/*c3*/ 1 + 2))) * 3
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: preserves comments when eliminating func(((arg))) parenthesis
-- input:
SELECT count(/*c1*/(/*c2*/ id))
-- output:
select
  count(/*c1*/ (/*c2*/ id))
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: preserves parenthesis around compound-SELECT inside function arguments
-- input:
SELECT
  coalesce(
    '',
    (
      SELECT x FROM xs
      UNION
      SELECT y FROM ys
    )
  )
FROM tbl
-- output:
select
  coalesce(
    '',
    (
      select
        x
      from
        xs
      union
      select
        y
      from
        ys
    )
  )
from tbl
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: preserves parenthesis around SELECT inside function arguments
-- input:
SELECT coalesce((SELECT foo FROM bar), 'default') FROM tbl
-- output:
select
  coalesce(
    (
      select
        foo
      from
        bar
    ),
    'default'
  )
from tbl
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats CAST expression
-- input:
SELECT CAST(127 AS INT)
-- output:
select cast(127 as int)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats count(*) func call
-- input:
SELECT count(*)
-- output:
select count(*)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats count(DISTINCT) func call
-- input:
SELECT count(DISTINCT id)
-- output:
select count(distinct id)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats function call to multiple lines
-- config: {"expressionWidth":10}
-- input:
SELECT sqrt(1, 2, 3)
-- output:
select sqrt(1, 2, 3)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats function call to single line
-- config: {"expressionWidth":16}
-- input:
SELECT sqrt(1, 2, 3)
-- output:
select sqrt(1, 2, 3)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats RAISE expression
-- input:
SELECT RAISE(IGNORE), RAISE(ABORT, 'Oh no!')
-- output:
select raise (ignore), raise (abort, 'Oh no!')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / literal.test: formats blob literals
-- input:
SELECT X'3132332D414243', x'FF00CC'
-- output:
select X'3132332D414243', x'FF00CC'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / finalSemicolon.test: adds semicolon to statement without a semicolon
-- input:
SELECT 1
-- output:
select 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / finalSemicolon.test: ensures semicolon after last statement
-- input:
SELECT 1; SELECT 2; SELECT 3
-- output:
select 1;

select 2;

select 3
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / functionCase.test: changes case of schema-qualified function names
-- input:
SELECT schm.foo(a, b)
-- output:
select schm.foo (a, b)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / functionCase.test: defaults to preserving the case of function names
-- input:
SELECT foo(), BAR(), Baz(), ZapZopZup()
-- output:
select foo (), bar (), baz (), zapzopzup ()
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / functionCase.test: does not change the case of quoted function names
-- input:
SELECT "foo"(), foo(), `foo`(), [foo]()
-- output:
select "foo" (), foo (), `foo` (), [foo] ()
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / identifierCase.test: changes case of bound parameters
-- input:
SELECT :foo, @bar, $baz
-- output:
select :foo, @bar, $baz
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / identifierCase.test: defaults to preserving the case of unquoted identifiers
-- input:
SELECT foo, BAR, Baz, ZapZopZup
-- output:
select foo, bar, baz, zapzopzup
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / identifierCase.test: does not change case of quoted bound parameters
-- input:
SELECT @`foo`, @foo
-- error: "Parse error: Unexpected \"@`foo`, @f\" at line 1 column 8.\nSQL dialect used: \"sqlite\"."
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / identifierCase.test: does not change the case of function names
-- input:
SELECT count(*), avg(age) FROM people
-- output:
select count(*), avg(age)
from people
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / identifierCase.test: does not change the case of quoted identifiers
-- input:
SELECT "foo", foo, `foo`, [foo]
-- output:
select "foo", foo, `foo`, [foo]
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / keywordCase.test: defaults to uppercasing of all keywords
-- input:
select * From tbl WHERE x > 0
-- output:
select *
from tbl
where x > 0
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / keywordCase.test: sqlKeywordCase: "lower" converts keywords to lowercase
-- config: {"keywordCase":"lower"}
-- input:
select * From tbl WHERE x > 0
-- output:
select *
from tbl
where x > 0
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / keywordCase.test: sqlKeywordCase: "preserve" keeps keywords case as-is
-- config: {"keywordCase":"preserve"}
-- input:
select * From tbl WHERE x > 0
-- output:
select *
From tbl
WHERE x > 0
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / keywordCase.test: sqlKeywordCase: "upper" converts keywords to uppercase
-- config: {"keywordCase":"upper"}
-- input:
select * From tbl WHERE x > 0
-- output:
SELECT *
FROM tbl
WHERE x > 0
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / literalCase.test: defaults to uppercasing of all literals
-- input:
SELECT true, false, null
-- output:
select true, false, null
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / literalCase.test: sqlLiteralCase: "preserve" keeps literals case as-is
-- input:
SELECT true, False, NULL
-- output:
select true, false, null
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / paramTypes.test: by default bound parameters are not supported
-- input:
SELECT * FROM tbl WHERE x = ?
-- output:
select *
from tbl
where x = ?
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / paramTypes.test: indexed parameters: ?nr
-- input:
SELECT * FROM tbl WHERE x = ?1 AND y = ?2
-- output:
select *
from tbl
where x = ?1 and y = ?2
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / paramTypes.test: indexed parameters: $nr
-- input:
SELECT * FROM tbl WHERE x = $1 AND y = $2
-- error: "Parse error: Unexpected \"$1 AND y =\" at line 1 column 29.\nSQL dialect used: \"sqlite\"."
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / paramTypes.test: mix of different parameter types
-- input:
SELECT * FROM tbl WHERE x = @foo AND y = $bar
-- output:
select *
from tbl
where x = @foo and y = $bar
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / paramTypes.test: named parameters: :name
-- input:
SELECT * FROM tbl WHERE x = :foo AND y = :bar
-- output:
select *
from tbl
where x = :foo and y = :bar
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / paramTypes.test: positional parameters: ?
-- input:
SELECT * FROM tbl WHERE x = ? AND y = ?
-- output:
select *
from tbl
where x = ? and y = ?
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / typeCase.test: defaults to uppercasing of all types
-- input:
CREATE TABLE t (id int, age Character Varying (100))
-- output:
create table t (id int, age character varying (100))
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / typeCase.test: sqlTypeCase: "lower" converts type names to lowercase
-- input:
CREATE TABLE t (id INT, age character Varying (100))
-- output:
create table t (id int, age character varying (100))
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats comma-operator cross-joins
-- input:
SELECT *
FROM
  client,
  inventory
-- output:
select *
from client, inventory
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats FROM joins with USING-specification
-- input:
SELECT *
FROM
  client
  LEFT JOIN client_sale USING (client_id)
  RIGHT OUTER JOIN client_attribute USING (client_attrib_id, client_id)
-- output:
select *
from
  client
  left join client_sale using (client_id)
  right outer join client_attribute using (client_attrib_id, client_id)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats FROM with a long join to multiple lines
-- input:
SELECT *
FROM
  client_relation
  LEFT JOIN client_sale ON client_sale.client_id = client_relation.id
-- output:
select *
from
  client_relation
  left join client_sale on client_sale.client_id = client_relation.id
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats FROM with multiple joins to multiple lines
-- input:
SELECT *
FROM
  client
  LEFT JOIN client_sale ON client_sale.client_id = client.id
  RIGHT OUTER JOIN client_attribute ON client_attribute.client_id = client.id
-- output:
select *
from
  client
  left join client_sale on client_sale.client_id = client.id
  right outer join client_attribute on client_attribute.client_id = client.id
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats indexing modifiers
-- input:
SELECT *
FROM
  client INDEXED BY my_idx
  NATURAL LEFT JOIN inventory NOT INDEXED
-- output:
select *
from client indexed by my_idx natural left join inventory not indexed
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats join always to multiple lines
-- input:
SELECT *
FROM
  client
  NATURAL JOIN client_sale
-- output:
select *
from client natural join client_sale
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats joins with subqueries
-- input:
SELECT *
FROM
  client
  LEFT JOIN (SELECT * FROM inventory WHERE price > 0) AS inventory
    ON inventory.client_id = client.id
-- output:
select *
from
  client
  left join (
    select
      *
    from
      inventory
    where
      price > 0
  ) as inventory on inventory.client_id = client.id
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats joins with table functions
-- input:
SELECT *
FROM
  client
  LEFT JOIN schm.gen_table(1, 2, 3) AS inventory
    ON inventory.client_id = client.id
-- output:
select *
from
  client
  left join schm.gen_table (1, 2, 3) as inventory on inventory.client_id = client.id
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats long join specifications to separate lines
-- input:
SELECT *
FROM
  client
  LEFT JOIN client_sale
    ON client_sale.client_id = client.id AND client_sale.type = 287
  RIGHT OUTER JOIN client_attribute
    USING (client_attribute_id, fabulously_long_col_name)
-- output:
select *
from
  client
  left join client_sale on client_sale.client_id = client.id
  and client_sale.type = 287
  right outer join client_attribute using (client_attribute_id, fabulously_long_col_name)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats table aliases
-- input:
SELECT *
FROM
  client AS c
  LEFT JOIN client_sale AS s ON s.client_id = c.id AND s.type = 287
-- output:
select *
from
  client as c
  left join client_sale as s on s.client_id = c.id
  and s.type = 287
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / limiting.test: formats LIMIT with just count
-- input:
SELECT * FROM tbl LIMIT 10
-- output:
select *
from tbl
limit 10
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: forces multi-line format when the original select is already multi-line
-- input:
SELECT a, b, c 
 FROM tbl WHERE x > y
-- output:
select a, b, c
from tbl
where x > y
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats each SELECT clause to separate line
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

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats each SELECT clause with indented body when it doesn't fit on a single line
-- config: {"expressionWidth":25}
-- input:
SELECT very_long_col_name, another_long_col_name
        FROM my_super_long_table_name
        WHERE my_table_name.x > my_table_name.y
        GROUP BY long_col, even_longer_col
        HAVING foo > some_long_col_name
        ORDER BY foo ASC, bar DESC NULLS FIRST
        LIMIT 250 OFFSET 100000000
        
-- output:
select very_long_col_name, another_long_col_name
from my_super_long_table_name
where my_table_name.x > my_table_name.y
group by long_col, even_longer_col
having foo > some_long_col_name
order by foo asc, bar desc nulls first
limit 250
offset
  100000000
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats SELECT *
-- input:
SELECT *
-- output:
select *
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats SELECT DISTINCT
-- config: {"expressionWidth":20}
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

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats set operations of select statements
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

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats short SELECT..FROM..WHERE on single line
-- input:
SELECT a, b, c FROM tbl WHERE x > y
-- output:
select a, b, c
from tbl
where x > y
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: preserves multiline SELECT columns (even if they would fit on a single line)
-- input:
SELECT
  col1,
  col2,
  col3
-- output:
select col1, col2, col3
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / window.test: formats basic window function calls, referencing named window
-- input:
SELECT row_number() OVER win1
FROM tbl
WINDOW win1 AS (ORDER BY x)
-- output:
select row_number() over win1
from tbl
window
  win1 as (
    order by
      x
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / window.test: formats long window definitions on multiple lines
-- input:
SELECT *
FROM tbl
WINDOW
  my_win1 AS (
    PARTITION BY col1, col2
    ORDER BY foo ASC
    RANGE CURRENT ROW
  ),
  my_win2 AS (
    my_win1
    ROWS BETWEEN 5 PRECEDING AND 3 FOLLOWING
    EXCLUDE CURRENT ROW
  ),
  my_win3 AS (
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    EXCLUDE CURRENT ROW
  )
-- output:
select *
from tbl
window
  my_win1 as (
    partition by
      col1,
      col2
    order by
      foo asc range current row
  ),
  my_win2 as (
    my_win1 rows between 5 preceding
    and 3 following exclude current row
  ),
  my_win3 as (
    rows between unbounded preceding
    and unbounded following exclude current row
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / window.test: formats longer window function calls on multiple lines
-- input:
SELECT
  row_number() OVER (
    PARTITION BY y
    ORDER BY x
  )
FROM tbl
-- output:
select
  row_number() over (
    partition by
      y
    order by
      x
  )
from tbl
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / window.test: formats multiple window definitions on separate lines
-- input:
SELECT *
FROM tbl
WINDOW
  win1 AS (PARTITION BY col1),
  win2 AS (win1)
-- output:
select *
from tbl
window
  win1 as (
    partition by
      col1
  ),
  win2 as (win1)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / window.test: formats short window clause on single lines
-- input:
SELECT *
FROM tbl
WINDOW my_win AS (PARTITION BY col1)
-- output:
select *
from tbl
window
  my_win as (
    partition by
      col1
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / window.test: formats short window function calls on single line
-- input:
SELECT row_number() OVER (ORDER BY x)
FROM tbl
-- output:
select
  row_number() over (
    order by
      x
  )
from tbl
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / window.test: formats window function call with longer FILTER and OVER clauses on multiple lines
-- input:
SELECT
  group_concat(entity_name, '.')
    FILTER (WHERE entity_type IS NOT NULL)
    OVER (ORDER BY entity_name DESC)
FROM tbl
-- output:
select
  group_concat(entity_name, '.') filter (
    where
      entity_type is not null
  ) over (
    order by
      entity_name desc
  )
from tbl
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / window.test: formats window function call with short FILTER clause on single line
-- input:
SELECT row_number() FILTER (WHERE x > 10) OVER (ORDER BY x)
FROM tbl
-- output:
select
  row_number() filter (
    where
      x > 10
  ) over (
    order by
      x
  )
from tbl
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / with.test: formats CTE with column names list
-- input:
WITH oldies(id, name) AS (SELECT * FROM client WHERE age > 100)
SELECT *
FROM oldies
-- output:
with
  oldies (id, name) as (
    select
      *
    from
      client
    where
      age > 100
  )
select *
from oldies
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / with.test: formats long WITH clause on multiple lines
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

-- #region: prettier-plugin-sql-cst / test / select / with.test: formats SELECT inside CTE on multiple lines
-- input:
WITH RECURSIVE
  cte1 AS (
    SELECT *
    FROM client
    WHERE age > 100
  )
SELECT *
FROM cte1
-- output:
with recursive
  cte1 as (
    select
      *
    from
      client
    where
      age > 100
  )
select *
from cte1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / with.test: formats short WITH clause on single line inside multiline SELECT
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

-- #region: prettier-plugin-sql-cst / test / select / with.test: formats tiny WITH on same line as the rest of SELECT
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

-- #region: prettier-plugin-sql-cst / test / select / with.test: formats WITH clause with various options
-- input:
WITH RECURSIVE
  cte1 AS MATERIALIZED (SELECT * FROM client WHERE age > 100),
  cte2 AS NOT MATERIALIZED (SELECT * FROM client WHERE age < 10)
SELECT *
FROM cte1
-- output:
with recursive
  cte1 as materialized (
    select
      *
    from
      client
    where
      age > 100
  ),
  cte2 as not materialized (
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

-- #region: prettier-plugin-sql-cst / test / sqlite / attach_detach.test: formats ATTACH DATABASE statement
-- input:
ATTACH DATABASE 'my_file.sqlite' AS my_schema
-- output:
attach database 'my_file.sqlite' as my_schema
-- #endregion

-- #region: prettier-plugin-sql-cst / test / sqlite / attach_detach.test: formats DETACH DATABASE statement
-- input:
DETACH DATABASE my_schema
-- output:
detach database my_schema
-- #endregion

-- #region: prettier-plugin-sql-cst / test / sqlite / attach_detach.test: formats plain ATTACH statement (without DATABASE keyword)
-- input:
ATTACH 'my_file.sqlite' AS my_schema
-- output:
attach 'my_file.sqlite' as my_schema
-- #endregion

-- #region: prettier-plugin-sql-cst / test / sqlite / attach_detach.test: formats plain DETACH statement (without DATABASE keyword)
-- input:
DETACH my_schema
-- output:
detach my_schema
-- #endregion

-- #region: prettier-plugin-sql-cst / test / sqlite / pragma.test: formats PRAGMA assignment
-- input:
PRAGMA encoding = 'UTF-8'
-- output:
pragma encoding = 'UTF-8'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / sqlite / pragma.test: formats PRAGMA function call
-- input:
PRAGMA my_schema.wal_checkpoint(PASSIVE)
-- output:
pragma my_schema.wal_checkpoint (passive)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / sqlite / pragma.test: formats reading of PRAGMA value
-- input:
PRAGMA function_list
-- output:
pragma function_list
-- #endregion

-- #region: prettier-plugin-sql-cst / test / sqlite / vacuum.test: formats plain VACUUM statement
-- input:
VACUUM
-- output:
vacuum
-- #endregion

-- #region: prettier-plugin-sql-cst / test / sqlite / vacuum.test: formats VACUUM schema INTO file
-- input:
VACUUM my_schema INTO 'my_file.sqlite'
-- output:
vacuum my_schema into 'my_file.sqlite'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / sqlite / vacuum.test: formats VACUUM with just INTO
-- input:
VACUUM INTO 'my_file.sqlite'
-- output:
vacuum into 'my_file.sqlite'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / sqlite / vacuum.test: formats VACUUM with just schema
-- input:
VACUUM my_schema
-- output:
vacuum my_schema
-- #endregion

-- #region: prettier-plugin-sql-cst / test / statement.test: formats multiple statements
-- input:
SELECT 1; SELECT 2; SELECT 3;
-- output:
select 1;

select 2;

select 3;
-- #endregion

-- #region: prettier-plugin-sql-cst / test / statement.test: formats statement ending with semicolon
-- input:
SELECT 1;
-- output:
select 1;
-- #endregion

-- #region: prettier-plugin-sql-cst / test / statement.test: preserves empty line between statements
-- input:
SELECT 1;

SELECT 2;
SELECT 3;

SELECT 4;
SELECT 5;
-- output:
select 1;

select 2;

select 3;

select 4;

select 5;
-- #endregion

-- #region: prettier-plugin-sql-cst / test / statement.test: replaces multiple empty lines with just one
-- input:
SELECT 1;



SELECT 2;
-- output:
select 1;

select 2;
-- #endregion

-- #region: prettier-plugin-sql-cst / test / transaction.test: formats basic BEGIN..COMMIT
-- input:
BEGIN;

SELECT 1;

COMMIT;
-- output:
begin;

select 1;

commit;
-- #endregion

-- #region: prettier-plugin-sql-cst / test / transaction.test: formats basic BEGIN..END
-- input:
BEGIN;

SELECT 1;

END;
-- output:
begin;

select 1;

end;
-- #endregion

-- #region: prettier-plugin-sql-cst / test / transaction.test: formats BEGIN DEFERRED TRANSACTION
-- input:
BEGIN DEFERRED TRANSACTION;
-- output:
begin deferred transaction;
-- #endregion

-- #region: prettier-plugin-sql-cst / test / transaction.test: formats BEGIN TRANSACTION .. COMMIT TRANSACTION
-- input:
BEGIN TRANSACTION;

SELECT 1;

COMMIT TRANSACTION;
-- output:
begin transaction;

select 1;

commit transaction;
-- #endregion

-- #region: prettier-plugin-sql-cst / test / transaction.test: formats RELEASE SAVEPOINT
-- input:
RELEASE my_savepoint;

RELEASE SAVEPOINT my_savepoint;
-- output:
release my_savepoint;

release savepoint my_savepoint;
-- #endregion

-- #region: prettier-plugin-sql-cst / test / transaction.test: formats ROLLBACK
-- input:
ROLLBACK;

ROLLBACK TRANSACTION;

ROLLBACK TO my_savepoint;

ROLLBACK TRANSACTION TO SAVEPOINT my_savepoint;
-- output:
rollback;

rollback transaction;

rollback to my_savepoint;

rollback transaction to savepoint my_savepoint;
-- #endregion

-- #region: prettier-plugin-sql-cst / test / transaction.test: formats SAVEPOINT
-- input:
SAVEPOINT my_savepoint;
-- output:
savepoint my_savepoint;
-- #endregion

-- #region: prettier-plugin-sql-cst / test / unsupported_grammar.test: continues formatting as normal after the skipped statement
-- input:
CREATE PUZZLE foo; select  1.5  as nr;drop puzzle
-- output:
create puzzle foo;

select 1.5 as nr;

drop puzzle
-- #endregion

-- #region: prettier-plugin-sql-cst / test / unsupported_grammar.test: skips formatting of unknown SQL statement
-- input:
CREATE PUZZLE foo.bar WITH SIZE 12x9
-- error: "Parse error: Unexpected \"12x9\" at line 1 column 33.\nSQL dialect used: \"sqlite\"."
-- #endregion
