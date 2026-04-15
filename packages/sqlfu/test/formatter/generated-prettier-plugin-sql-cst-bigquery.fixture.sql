-- default config: {"dialect":"bigquery"}

-- #region: prettier-plugin-sql-cst / test / bigquery / bigquery.test: formats ALTER ORGANIZATION
-- input:
ALTER ORGANIZATION
SET OPTIONS (default_time_zone = 'America/Los_Angeles')
-- output:
alter organization
set options (default_time_zone = 'America/Los_Angeles')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / bigquery.test: formats ASSERT
-- input:
ASSERT x > 10
-- output:
assert x > 10
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / bigquery.test: formats ASSERT with message
-- input:
ASSERT x > 10 AS 'x must be greater than 10'
-- output:
assert x > 10 as 'x must be greater than 10'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / export_and_load.test: formats EXPORT DATA
-- input:
EXPORT DATA
OPTIONS (uri = 'gs://bucket/folder/*.csv', format = 'CSV')
AS
  SELECT field1, field2 FROM mydataset.table1
-- output:
export data options(uri = 'gs://bucket/folder/*.csv', format = 'CSV') as
select field1, field2
from mydataset.table1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / export_and_load.test: formats EXPORT DATA with CONNECTION
-- input:
EXPORT DATA
WITH CONNECTION myproject.us.myconnection
OPTIONS (uri = 'gs://bucket/folder/*.csv', format = 'CSV')
AS
  SELECT field1, field2 FROM mydataset.table1
-- output:
export data
with connection
  myproject.us.myconnection options(uri = 'gs://bucket/folder/*.csv', format = 'CSV') as
select field1, field2
from mydataset.table1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / export_and_load.test: formats LOAD DATA
-- input:
LOAD DATA INTO mydataset.table1
FROM FILES (format = 'AVRO', uris = ['gs://bucket/path/file.avro'])
-- output:
load data into mydataset.table1
from
  files (
    format = 'AVRO',
    uris = ['gs://bucket/path/file.avro']
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / export_and_load.test: formats LOAD DATA with columns
-- input:
LOAD DATA INTO mydataset.table1 (x INT64, y STRING)
OPTIONS (description = "my table")
FROM FILES (format = 'AVRO', uris = ['gs://bucket/path/file.avro'])
-- output:
load data into mydataset.table1 (x int64, y string) options(description = "my table")
from
  files (
    format = 'AVRO',
    uris = ['gs://bucket/path/file.avro']
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / export_and_load.test: formats LOAD DATA with long column list
-- input:
LOAD DATA INTO mydataset.table1 (
  first_field INT64,
  second_field STRING,
  field_1 STRING,
  field_2 INT64
)
FROM FILES (uris = ['gs://bucket/path/file.avro'])
-- output:
load data into mydataset.table1 (
  first_field int64,
  second_field string,
  field_1 string,
  field_2 int64
)
from files (uris = ['gs://bucket/path/file.avro'])
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / export_and_load.test: formats LOAD DATA with PARTITION/CLUSTER BY & WITH PARTITION COLUMNS & CONNECTION
-- input:
LOAD DATA INTO mydataset.table1
PARTITION BY transaction_date
CLUSTER BY customer_id
FROM FILES (
  format = 'AVRO',
  uris = ['gs://bucket/path/file.avro'],
  hive_partition_uri_prefix = 'gs://bucket/path'
)
WITH PARTITION COLUMNS (field_1 STRING, field_2 INT64)
WITH CONNECTION myproject.us.myconnection
-- output:
load data into mydataset.table1
partition by
  transaction_date
cluster by
  customer_id
from
  files (
    format = 'AVRO',
    uris = ['gs://bucket/path/file.avro'],
    hive_partition_uri_prefix = 'gs://bucket/path'
  )
with partition columns
  (field_1 string, field_2 int64)
with connection
  myproject.us.myconnection
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / row_access_policy.test: formats CREATE ROW ACCESS POLICY
-- input:
CREATE ROW ACCESS POLICY policy_name ON my_table
FILTER USING (x > 10)
-- output:
create row access policy policy_name on my_table
filter using (x > 10)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / row_access_policy.test: formats DROP ALL ROW ACCESS POLICIES
-- input:
DROP ALL ROW ACCESS POLICIES ON my_table
-- output:
drop all row access policies on my_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / row_access_policy.test: formats DROP ROW ACCESS POLICY
-- input:
DROP ROW ACCESS POLICY policy_name ON my_table
-- output:
drop row access policy policy_name on my_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / row_access_policy.test: formats GRANT TO
-- input:
CREATE ROW ACCESS POLICY policy_name ON my_table
GRANT TO ('user:alice@example.com', 'domain:example.com')
FILTER USING (x > 10)
-- output:
create row access policy policy_name on my_table
grant to ('user:alice@example.com', 'domain:example.com')
filter using (x > 10)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / row_access_policy.test: formats IF EXISTS
-- input:
DROP ROW ACCESS POLICY IF EXISTS policy_name ON my_table
-- output:
drop row access policy if exists policy_name on my_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / row_access_policy.test: formats OR REPLACE / IF NOT EXISTS
-- input:
CREATE OR REPLACE ROW ACCESS POLICY IF NOT EXISTS policy_name ON my_table
FILTER USING (x > 10)
-- output:
create or replace row access policy if not exists policy_name on my_table
filter using (x > 10)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / canonical_syntax.test: replaces DELETE with DELETE FROM
-- input:
DELETE client WHERE id = 10
-- output:
delete client
where id = 10
-- #endregion

-- #region: prettier-plugin-sql-cst / test / canonical_syntax.test: replaces MERGE with MERGE INTO
-- input:
MERGE foo USING bar ON x = y WHEN MATCHED THEN DELETE
-- output:
merge
  foo using bar on x = y
when matched then
delete
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats GRANT (multiline list of privileges and users)
-- input:
GRANT
  `roles/bigquery.dataViewer`,
  `roles/bigquery.admin`,
  `roles/bigquery.rowAccessPolicies.create`
ON SCHEMA myCompany
TO
  'user:tom@example.com',
  'user:sara@example.com',
  'specialGroup:allAuthenticatedUsers'
-- output:
grant `roles/bigquery.dataViewer`,
`roles/bigquery.admin`,
`roles/bigquery.rowAccessPolicies.create` on schema mycompany to 'user:tom@example.com',
'user:sara@example.com',
'specialGroup:allAuthenticatedUsers'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats GRANT (multiple privileges, multiple users)
-- input:
GRANT `roles/bigquery.dataViewer`, `roles/bigquery.admin`
ON SCHEMA myCompany
TO 'user:tom@example.com', 'user:sara@example.com'
-- output:
grant `roles/bigquery.dataViewer`,
`roles/bigquery.admin` on schema mycompany to 'user:tom@example.com',
'user:sara@example.com'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats GRANT (single privilege, single user)
-- input:
GRANT `roles/bigquery.dataViewer`
ON TABLE myCompany.revenue
TO 'user:tom@example.com'
-- output:
grant `roles/bigquery.dataViewer` on table mycompany.revenue to 'user:tom@example.com'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats short GRANT in multiple lines if user prefers
-- input:
GRANT `roles/x`
ON TABLE revenue
TO 'user:tom'
-- output:
grant `roles/x` on table revenue to 'user:tom'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats short GRANT in single line
-- input:
GRANT `roles/x` ON TABLE revenue TO 'user:tom'
-- output:
grant `roles/x` on table revenue to 'user:tom'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / revoke.test: formats REVOKE (multiline list of privileges and users)
-- input:
REVOKE
  `roles/bigquery.dataViewer`,
  `roles/bigquery.admin`,
  `roles/bigquery.rowAccessPolicies.create`
ON EXTERNAL TABLE myCompany
FROM
  'user:tom@example.com',
  'user:sara@example.com',
  'specialGroup:allAuthenticatedUsers'
-- output:
revoke `roles/bigquery.dataViewer`,
`roles/bigquery.admin`,
`roles/bigquery.rowAccessPolicies.create` on external table mycompany
from
  'user:tom@example.com',
  'user:sara@example.com',
  'specialGroup:allAuthenticatedUsers'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / revoke.test: formats REVOKE (multiple privileges, multiple users)
-- input:
REVOKE `roles/bigquery.dataViewer`, `roles/bigquery.admin`
ON SCHEMA myCompany
FROM 'user:tom@example.com', 'user:sara@example.com'
-- output:
revoke `roles/bigquery.dataViewer`,
`roles/bigquery.admin` on schema mycompany
from 'user:tom@example.com', 'user:sara@example.com'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / revoke.test: formats REVOKE (single privilege, single user)
-- input:
REVOKE `roles/bigquery.dataViewer`
ON VIEW myCompany.revenue
FROM 'user:tom@example.com'
-- output:
revoke `roles/bigquery.dataViewer` on view mycompany.revenue
from 'user:tom@example.com'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / revoke.test: formats short REVOKE in multiple lines if user prefers
-- input:
REVOKE `roles/x`
ON VIEW revenue
FROM 'user:tom'
-- output:
revoke `roles/x` on view revenue
from 'user:tom'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / revoke.test: formats short REVOKE in single line
-- input:
REVOKE `roles/x` ON VIEW revenue FROM 'user:tom'
-- output:
revoke `roles/x` on view revenue
from 'user:tom'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ADD CONSTRAINT
-- input:
ALTER TABLE client
ADD CONSTRAINT IF NOT EXISTS pk PRIMARY KEY (id) NOT ENFORCED
-- output:
alter table client add constraint if not exists pk primary key (id) not enforced
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER COLUMN .. SET DATA TYPE
-- input:
ALTER TABLE client
ALTER COLUMN price
SET DATA TYPE INT64
-- output:
alter table client
alter column price
set data type int64
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER COLUMN .. SET OPTIONS
-- input:
ALTER TABLE client
ALTER COLUMN price
SET OPTIONS (description = 'Price per unit')
-- output:
alter table client
alter column price
set options (description = 'Price per unit')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER COLUMN [IF EXISTS]
-- input:
ALTER TABLE client
ALTER COLUMN IF EXISTS price
DROP DEFAULT
-- output:
alter table client
alter column if exists price
drop default
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE IF EXISTS
-- input:
ALTER TABLE IF EXISTS client
RENAME TO org_client
-- output:
alter table if exists client
rename to org_client
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE..ADD COLUMN IF NOT EXISTS
-- input:
ALTER TABLE client
ADD COLUMN IF NOT EXISTS col1 INT
-- output:
alter table client
add column if not exists col1 int
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE..DROP COLUMN IF EXISTS
-- input:
ALTER TABLE client
DROP COLUMN IF EXISTS col1
-- output:
alter table client
drop column if exists col1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE..DROP COLUMN RESTRICT|CASCADE
-- input:
ALTER TABLE client
DROP COLUMN col1 RESTRICT,
DROP COLUMN col2 CASCADE
-- output:
alter table client
drop column col1 restrict,
drop column col2 cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE..RENAME COLUMN IF EXISTS
-- input:
ALTER TABLE client
RENAME COLUMN IF EXISTS col1 TO col2
-- output:
alter table client rename column if exists col1 to col2
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE..SET DEFAULT COLLATE
-- input:
ALTER TABLE client
SET DEFAULT COLLATE 'und:ci'
-- output:
alter table client
set default collate 'und:ci'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE..SET OPTIONS
-- input:
ALTER TABLE client
SET OPTIONS (description = 'Table that expires seven days from now')
-- output:
alter table client
set options (
  description = 'Table that expires seven days from now'
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats DROP PRIMARY KEY
-- input:
ALTER TABLE client
DROP PRIMARY KEY
-- output:
alter table client
drop primary key
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats DROP PRIMARY KEY
-- input:
ALTER TABLE client
DROP PRIMARY KEY IF EXISTS
-- output:
alter table client
drop primary key if exists
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats only the ALTER COLUMN-part on single line (if user prefers)
-- input:
ALTER TABLE client
ALTER COLUMN price DROP DEFAULT
-- output:
alter table client
alter column price
drop default
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats short ALTER COLUMN on a single line (if user prefers)
-- input:
ALTER TABLE client ALTER COLUMN price DROP DEFAULT
-- output:
alter table client
alter column price
drop default
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats additional BigQuery CREATE TABLE clauses
-- input:
CREATE TABLE client (
  id INT64
)
DEFAULT COLLATE 'und:ci'
PARTITION BY _PARTITIONDATE
CLUSTER BY customer_id
OPTIONS (friendly_name = 'Clientele')
-- output:
create table client (id int64)
default collate 'und:ci'
partition by
  _partitiondate
cluster by
  customer_id options(friendly_name = 'Clientele')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats BigQuery data types with internal constraints
-- input:
CREATE TABLE client (
  arr_field ARRAY<INT64 NOT NULL>,
  struct_field STRUCT<name STRING NOT NULL, age INT64 DEFAULT 0>,
  meta OPTIONS (description = 'Metadata in here')
)
-- output:
create table client (
  arr_field array<int64notnull>,
  struct_field struct<name stringnotnull, age int64default0>,
  meta options(description = 'Metadata in here')
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE EXTERNAL TABLE
-- input:
CREATE EXTERNAL TABLE dataset.CustomTable (
  id INT64
)
WITH CONNECTION myproj.dataset.connectionId
WITH PARTITION COLUMNS (field_1 STRING, field_2 INT64)
OPTIONS (format = 'PARQUET')
-- output:
create external table dataset.customtable (id int64)
with connection
  myproj.dataset.connectionid
with partition columns
  (field_1 string, field_2 int64) options(format = 'PARQUET')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE EXTERNAL TABLE with long PARTITION COLUMNS list
-- input:
CREATE EXTERNAL TABLE dataset.CustomTable
WITH PARTITION COLUMNS (
  first_name STRING,
  last_name STRING,
  average_income INT64,
  waist_height INT64
)
-- output:
create external table dataset.customtable
with partition columns
  (
    first_name string,
    last_name string,
    average_income int64,
    waist_height int64
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE SNAPSHOT TABLE CLONE
-- input:
CREATE SNAPSHOT TABLE foo CLONE my_old_table
-- output:
create snapshot table foo clone my_old_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE TABLE COPY
-- input:
CREATE TABLE foo COPY my_old_table
-- output:
create table foo copy my_old_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE TABLE LIKE
-- input:
CREATE TABLE foo LIKE my_old_table
-- output:
create table foo like my_old_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats FOR SYSTEM_TIME AS OF
-- input:
CREATE SNAPSHOT TABLE foo
CLONE my_old_table FOR SYSTEM_TIME AS OF '2017-01-01 10:00:00-07:00'
-- output:
create snapshot table foo clone my_old_table
for system_time as of
  '2017-01-01 10:00:00-07:00'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats long BigQuery OPTIONS ()
-- input:
CREATE TABLE client (
  id INT64
)
OPTIONS (
  expiration_timestamp = TIMESTAMP "2025-01-01 00:00:00 UTC",
  partition_expiration_days = 1,
  description = "a table that expires in 2025, with each partition living for 24 hours",
  labels = [("org_unit", "development")]
)
-- output:
create table client (id int64) options(
  expiration_timestamp = timestamp "2025-01-01 00:00:00 UTC",
  partition_expiration_days = 1,
  description = "a table that expires in 2025, with each partition living for 24 hours",
  labels = [("org_unit", "development")]
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats long BigQuery struct definition to multiple lines
-- input:
CREATE TABLE client (
  struct_field STRUCT<
    first_name STRING,
    last_name STRING,
    email STRING,
    address STRING,
    phone_number STRING
  >
)
-- output:
create table client (
  struct_field struct<first_name string, last_name string, email string, address string, phone_number string>
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats OR REPLACE
-- input:
CREATE OR REPLACE TABLE foo (
  id INT
)
-- output:
create or replace table foo (id int)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats single short BigQuery extra CREATE TABLE clause
-- input:
CREATE TABLE client (
  id INT64
)
DEFAULT COLLATE 'und:ci'
-- output:
create table client (id int64)
default collate 'und:ci'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / drop_table.test: formats DROP EXTERNAL table
-- input:
DROP EXTERNAL TABLE foo
-- output:
drop external table foo
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / drop_table.test: formats DROP SNAPSHOT table
-- input:
DROP SNAPSHOT TABLE foo
-- output:
drop snapshot table foo
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: does not reformat JavaScript when neither ''' or """ can be easily used for quoting
-- input:
CREATE FUNCTION contains_quotes(x STRING)
RETURNS FLOAT64
LANGUAGE js
AS " return /'''|\"\"\"/.test(x) "
-- output:
create function contains_quotes (x string) returns float64 language js as " return /'''|\"\"\"/.test(x) "
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats CREATE FUNCTION
-- input:
CREATE FUNCTION my_func(arg1 INT64, arg2 STRING, arg3 ANY TYPE) AS
  (SELECT * FROM client)
-- output:
create function my_func (arg1 int64, arg2 string, arg3 any type) as (
  select
    *
  from
    client
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats CREATE TABLE FUNCTION
-- input:
CREATE TABLE FUNCTION my_func()
RETURNS TABLE<id INT, name STRING>
AS
  (SELECT 1, 'John')
-- output:
create table function my_func () returns table < id int,
name string > as (
  select
    1,
    'John'
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats CREATE TEMP FUNCTION
-- input:
CREATE TEMPORARY FUNCTION my_func() AS
  (SELECT 1)
-- output:
create temporary function my_func () as (
  select
    1
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats creation of remote function
-- input:
CREATE FUNCTION my_func()
RETURNS INT64
REMOTE WITH CONNECTION us.myconnection
OPTIONS (endpoint = 'https://us-central1-myproject.cloudfunctions.net/multi')
-- output:
create function my_func () returns int64
remote with connection
  us.myconnection options(
    endpoint = 'https://us-central1-myproject.cloudfunctions.net/multi'
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats DROP FUNCTION
-- input:
DROP FUNCTION my_schema.my_func
-- output:
drop function my_schema.my_func
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats DROP TABLE FUNCTION
-- input:
DROP TABLE FUNCTION my_func
-- output:
drop table function my_func
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats IF EXISTS
-- input:
DROP FUNCTION IF EXISTS my_func
-- output:
drop function if exists my_func
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats IF NOT EXISTS
-- input:
CREATE FUNCTION IF NOT EXISTS my_func() AS
  (SELECT 1)
-- output:
create function if not exists my_func () as (
  select
    1
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats JavaScript FUNCTION
-- input:
CREATE FUNCTION gen_random()
RETURNS FLOAT64
NOT DETERMINISTIC
LANGUAGE js
AS r'''
  return Math.random();
'''
-- output:
create function gen_random () returns float64 not deterministic language js as r'''
  return Math.random();
'''
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats OPTIONS (...)
-- input:
CREATE FUNCTION my_func()
AS
  (SELECT 1)
OPTIONS (description = 'constant-value function')
-- output:
create function my_func () as (
  select
    1
) options(description = 'constant-value function')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats OR REPLACE
-- input:
CREATE OR REPLACE FUNCTION my_func() AS
  (SELECT 1)
-- output:
create or replace function my_func () as (
  select
    1
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats RETURNS clause
-- input:
CREATE FUNCTION my_func()
RETURNS INT64
AS
  (SELECT 1)
-- output:
create function my_func () returns int64 as (
  select
    1
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: quotes JavaScript in double-quotes when single-quotes can't be used
-- input:
CREATE FUNCTION contains_quotes(x STRING)
RETURNS FLOAT64
LANGUAGE js
AS " return /'''/.test(x) "
-- output:
create function contains_quotes (x string) returns float64 language js as " return /'''/.test(x) "
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: reformats JavaScript in JS function
-- input:
CREATE FUNCTION gen_random()
RETURNS FLOAT64
LANGUAGE js
AS ' if(true) {return Math.random () *2}'
-- output:
create function gen_random () returns float64 language js as ' if(true) {return Math.random () *2}'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats BigQuery CREATE SEARCH INDEX with ALL COLUMNS
-- input:
CREATE SEARCH INDEX my_index ON my_table (ALL COLUMNS)
-- output:
create search index my_index on my_table (all columns)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats BigQuery CREATE SEARCH INDEX with OPTIONS ()
-- input:
CREATE SEARCH INDEX my_index ON my_table (col)
OPTIONS (analyzer = 'LOG_ANALYZER')
-- output:
create search index my_index on my_table (col) options(analyzer = 'LOG_ANALYZER')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats DROP SEARCH INDEX
-- input:
DROP SEARCH INDEX my_index ON my_table
-- output:
drop search index my_index on my_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats OR REPLACE
-- input:
CREATE OR REPLACE INDEX my_index ON my_table (col)
-- output:
create
or replace index my_index on my_table (col)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: formats CREATE PROCEDURE
-- input:
CREATE PROCEDURE drop_my_table(arg1 INT64, OUT arg2 STRING)
BEGIN
  DROP TABLE my_table;
END
-- output:
create procedure drop_my_table (arg1 int64, out arg2 string)
begin
drop table my_table;

end
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: formats DROP PROCEDURE
-- input:
DROP PROCEDURE mydataset.myProcedure
-- output:
drop procedure mydataset.myprocedure
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: formats IF EXISTS
-- input:
DROP PROCEDURE IF EXISTS foo
-- output:
drop procedure if exists foo
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: formats inline python procedure
-- input:
CREATE PROCEDURE spark_proc()
WITH CONNECTION my_connection
OPTIONS (engine = "SPARK")
LANGUAGE PYTHON
AS r'''
  from pyspark.sql import SparkSession
  spark = SparkSession.builder.appName("spark-bigquery-demo").getOrCreate()
  # Load data from BigQuery.
  words = spark.read.format("bigquery")
'''
-- output:
create procedure spark_proc ()
with connection
  my_connection options(engine = "SPARK") language python as r'''
  from pyspark.sql import SparkSession
  spark = SparkSession.builder.appName("spark-bigquery-demo").getOrCreate()
  # Load data from BigQuery.
  words = spark.read.format("bigquery")
'''
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: formats long parameter list
-- input:
CREATE PROCEDURE my_schema.my_long_procedure_name(
  IN first_parameter INT64,
  INOUT second_parameter STRING,
  OUT third_parameter INT64
)
BEGIN
  DROP TABLE my_table;
END
-- output:
create procedure my_schema.my_long_procedure_name (
  in first_parameter int64,
  inout second_parameter string,
  out third_parameter int64
)
begin
drop table my_table;

end
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: formats OPTIONS (..)
-- input:
CREATE PROCEDURE foo()
OPTIONS (strict_mode = TRUE)
BEGIN
  DROP TABLE my_table;
END
-- output:
create procedure foo () options(strict_mode = true)
begin
drop table my_table;

end
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: formats OR REPLACE / IF NOT EXISTS
-- input:
CREATE OR REPLACE PROCEDURE IF NOT EXISTS drop_my_table()
BEGIN
  DROP TABLE my_table;
END
-- output:
create or replace procedure if not exists drop_my_table ()
begin
drop table my_table;

end
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: formats remote python procedure
-- input:
CREATE PROCEDURE my_bq_project.my_dataset.spark_proc()
WITH CONNECTION `my-project-id.us.my-connection`
OPTIONS (engine = "SPARK", main_file_uri = "gs://my-bucket/my-pyspark-main.py")
LANGUAGE PYTHON
-- output:
create procedure my_bq_project.my_dataset.spark_proc ()
with connection
  `my-project-id.us.my-connection` options(
    engine = "SPARK",
    main_file_uri = "gs://my-bucket/my-pyspark-main.py"
  ) language python
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats ALTER SCHEMA .. SET DEFAULT COLLATE
-- input:
ALTER SCHEMA my_schema
SET DEFAULT COLLATE 'und:ci'
-- output:
alter schema my_schema
set default collate 'und:ci'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats ALTER SCHEMA .. SET OPTIONS
-- input:
ALTER SCHEMA IF EXISTS my_schema
SET OPTIONS (description = 'blah')
-- output:
alter schema if exists my_schema
set options (description = 'blah')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats ALTER SCHEMA on single line if user prefers
-- input:
ALTER SCHEMA IF EXISTS my_schema SET OPTIONS (description = 'blah')
-- output:
alter schema if exists my_schema
set options (description = 'blah')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats CASCADE/RESTRICT
-- input:
DROP SCHEMA schema_name CASCADE
-- output:
drop schema schema_name cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats CREATE SCHEMA
-- input:
CREATE SCHEMA schema_name
-- output:
create schema schema_name
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats CREATE SCHEMA on single line if user prefers
-- input:
CREATE SCHEMA hello OPTIONS (friendly_name = 'Hello')
-- output:
create schema hello options(friendly_name = 'Hello')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats DEFAULT COLLATE
-- input:
CREATE SCHEMA schema_name
DEFAULT COLLATE 'und:ci'
-- output:
create schema schema_name
default collate 'und:ci'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats DROP SCHEMA
-- input:
DROP SCHEMA schema_name
-- output:
drop schema schema_name
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats IF EXISTS
-- input:
DROP SCHEMA IF EXISTS schema_name
-- output:
drop schema if exists schema_name
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats IF NOT EXISTS
-- input:
CREATE SCHEMA IF NOT EXISTS schema_name
-- output:
create schema if not exists schema_name
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats OPTIONS (..)
-- input:
CREATE SCHEMA schema_name
OPTIONS (friendly_name = 'Happy schema')
-- output:
create schema schema_name options(friendly_name = 'Happy schema')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats ALTER MATERIALIZED VIEW .. SET OPTIONS
-- input:
ALTER MATERIALIZED VIEW my_view
SET OPTIONS (description = 'blah')
-- output:
alter materialized view my_view
set options (description = 'blah')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats ALTER VIEW .. SET OPTIONS
-- input:
ALTER VIEW IF EXISTS my_view
SET OPTIONS (description = 'blah')
-- output:
alter view if exists my_view
set options (description = 'blah')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats CREATE MATERIALIZED VIEW .. AS REPLICA OF
-- input:
CREATE MATERIALIZED VIEW foo
OPTIONS (description = 'blah')
AS REPLICA OF my_other_view
-- output:
create materialized view foo options(description = 'blah') as replica of my_other_view
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats CREATE MATERIALIZED VIEW with extra clauses
-- input:
CREATE MATERIALIZED VIEW foo
PARTITION BY DATE(col_datetime)
CLUSTER BY col_int
AS
  SELECT 1
-- output:
create materialized view foo
partition by
  date(col_datetime)
cluster by
  col_int as
select 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats CREATE OR REPLACE VIEW
-- input:
CREATE OR REPLACE VIEW active_client_id AS
  SELECT 1
-- output:
create or replace view active_client_id as
select 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats CREATE VIEW with BigQuery options
-- input:
CREATE VIEW foo
OPTIONS (friendly_name = "newview")
AS
  SELECT 1
-- output:
create view foo options(friendly_name = "newview") as
select 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats CREATE VIEW with BigQuery OPTIONS() in columns list
-- input:
CREATE VIEW foobar (
  id OPTIONS (description = 'Unique identifier'),
  name OPTIONS (description = 'Name of the user')
) AS
  SELECT 1
-- output:
create view foobar (
  id options(description = 'Unique identifier'),
  name options(description = 'Name of the user')
) as
select 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats DROP MATERIALIZED VIEW
-- input:
DROP MATERIALIZED VIEW foo
-- output:
drop materialized view foo
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats simple CREATE MATERIALIZED VIEW
-- input:
CREATE MATERIALIZED VIEW foo AS
  SELECT 1
-- output:
create materialized view foo as
select 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / delete.test: formats DELETE without FROM
-- input:
DELETE employee
WHERE id = 10
-- output:
delete employee
where id = 10
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats DEFAULT values among normal values
-- input:
INSERT INTO employee
VALUES (1, 2, DEFAULT, 3)
-- output:
insert into
  employee
values
  (1, 2, default, 3)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats INSERT statement without INTO
-- input:
INSERT client VALUES (1, 2, 3)
-- output:
insert
  client
values
  (1, 2, 3)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: preserves indentation preference of column names and values
-- input:
INSERT INTO client (id, fname, lname, org_id)
VALUES (1, 'John', 'Doe', 27)
-- output:
insert into
  client (id, fname, lname, org_id)
values
  (1, 'John', 'Doe', 27)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: preserves short multi-line INSERT statement on multiple lines
-- input:
INSERT INTO client
VALUES (1, 2, 3)
-- output:
insert into
  client
values
  (1, 2, 3)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / merge.test: formats long ON-condition
-- input:
MERGE INTO target
USING source
ON
  target.id = source.id
  AND source.quantity > target.quantity
  AND quantity > 1000
WHEN MATCHED THEN
  DELETE
-- output:
merge into
  target using source on target.id = source.id
  and source.quantity > target.quantity
  and quantity > 1000
when matched then
delete
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / merge.test: formats long WHEN-condition
-- input:
MERGE INTO target
USING source
ON target.id = source.id
WHEN NOT MATCHED BY SOURCE
  AND source.quantity > target.quantity
  OR source.quantity < 0
  OR target.id = 18967
THEN
  UPDATE SET quantity = 1
-- output:
merge into
  target using source on target.id = source.id
when not matched by source
  and source.quantity > target.quantity
  or source.quantity < 0
  or target.id = 18967 then
update set
  quantity = 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / merge.test: formats MERGE .. DELETE
-- input:
MERGE INTO dataset.DetailedInventory AS target
USING dataset.Inventory AS source
ON target.product = source.product
WHEN MATCHED THEN
  DELETE
-- output:
merge into
  dataset.detailedinventory as target using dataset.inventory as source on target.product = source.product
when matched then
delete
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / merge.test: formats MERGE .. INSERT (cols) VALUES
-- input:
MERGE INTO target
USING source
ON target.id = source.id
WHEN NOT MATCHED AND quantity < 10 THEN
  INSERT
    (product, quantity, supply_constrained, comments)
  VALUES
    (product, quantity, TRUE, 'My comment')
-- output:
merge into
  target using source on target.id = source.id
when not matched
  and quantity < 10 then
insert
  (product, quantity, supply_constrained, comments)
values
  (product, quantity, true, 'My comment')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / merge.test: formats MERGE .. INSERT (columns) ROW
-- input:
MERGE INTO target
USING source
ON target.id = source.id
WHEN MATCHED THEN
  INSERT
    (col1, col2, col3)
  ROW
-- output:
merge into
  target using source on target.id = source.id
when matched then
insert
  (col1, col2, col3) row
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / merge.test: formats MERGE .. INSERT ROW
-- input:
MERGE INTO target
USING source
ON target.id = source.id
WHEN MATCHED THEN
  INSERT ROW
-- output:
merge into
  target using source on target.id = source.id
when matched then
insert
  row
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / merge.test: formats MERGE .. INSERT VALUES
-- input:
MERGE INTO target
USING source
ON target.id = source.id
WHEN MATCHED THEN
  INSERT
  VALUES
    (col1, DEFAULT, col2)
-- output:
merge into
  target using source on target.id = source.id
when matched then
insert
values
  (col1, default, col2)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / merge.test: formats MERGE .. UPDATE
-- input:
MERGE INTO target
USING source
ON target.id = source.id
WHEN NOT MATCHED BY SOURCE THEN
  UPDATE SET
    quantity = 1,
    supply_constrained = FALSE,
    comments = ''
-- output:
merge into
  target using source on target.id = source.id
when not matched by source then
update set
  quantity = 1,
  supply_constrained = false,
  comments = ''
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / merge.test: formats MERGE .. UPDATE with single-element update
-- input:
MERGE INTO target
USING source
ON target.id = source.id
WHEN NOT MATCHED BY SOURCE THEN
  UPDATE SET quantity = 1
-- output:
merge into
  target using source on target.id = source.id
when not matched by source then
update set
  quantity = 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / truncate.test: formats TRUNCATE TABLE statement
-- input:
TRUNCATE TABLE dataset.employee
-- output:
truncate table dataset.employee
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats BigQuery @@system_variables
-- input:
SELECT @@error.message
-- output:
select @@error.message
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats BigQuery array field access
-- input:
SELECT
  item_array,
  item_array[OFFSET(1)] AS item_offset,
  item_array[ORDINAL(1)] AS item_ordinal,
  item_array[SAFE_OFFSET(6)] AS item_safe_offset
FROM (SELECT ["coffee", "tea", "milk"] AS item_array)
-- output:
select
  item_array,
  item_array[offset(1)] as item_offset,
  item_array[ordinal(1)] as item_ordinal,
  item_array[safe_offset(6)] as item_safe_offset
from
  (
    select
      ["coffee", "tea", "milk"] as item_array
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats BigQuery array field access to multiple lines
-- input:
SELECT
  ["Coffee Cup", "Tea Kettle", "Milk Glass"][
    SAFE_OFFSET(some_really_long_index_number)
  ]
-- output:
select
  ["Coffee Cup", "Tea Kettle", "Milk Glass"] [safe_offset(some_really_long_index_number)]
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats BigQuery JSON field access
-- input:
SELECT json_value.class.students[0]['name']
-- output:
select json_value.class.students[0] ['name']
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats BigQuery quoted table names
-- input:
SELECT * FROM `my-project.mydataset.mytable`
-- output:
select *
from `my-project.mydataset.mytable`
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats quantifier expressions
-- input:
SELECT 'x' LIKE SOME ('X', 'Y', 'Z')
-- output:
select 'x' like some('X', 'Y', 'Z')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats ANY_VALUE() with HAVING
-- input:
SELECT any_value(fruit HAVING MAX sold)
-- output:
select
  any_value(
    fruit
    having
      max sold
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats ANY_VALUE() with HAVING
-- input:
SELECT any_value(fruit HAVING MIN sold)
-- output:
select
  any_value(
    fruit
    having
      min sold
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats ANY_VALUE() with HAVING
-- input:
SELECT any_value(fruit)
-- output:
select any_value(fruit)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats CAST() with FORMAT
-- input:
SELECT CAST('11-08' AS DATE FORMAT 'DD-MM')
-- output:
select cast('11-08' as date format 'DD-MM')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats CAST() with FORMAT
-- input:
SELECT CAST('12:35' AS TIME FORMAT 'HH:MI' AT TIME ZONE 'UTC')
-- output:
select cast('12:35' as time format 'HH:MI' at time zone 'UTC')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats combination of IGNORE NULLS, ORDER BY, LIMIT
-- input:
SELECT my_func(foo IGNORE NULLS ORDER BY id LIMIT 10)
-- output:
select
  my_func (
    foo ignore nulls
    order by
      id
    limit
      10
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats EXTRACT() expression
-- input:
SELECT EXTRACT(MONTH FROM DATE '2002-08-16')
-- output:
select
  extract(
    month
    from
      date '2002-08-16'
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats EXTRACT() expression
-- input:
SELECT EXTRACT(WEEK(SUNDAY) FROM date)
-- output:
select
  extract(
    week(sunday)
    from
      date
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats IGNORE NULLS and RESPECT NULLS
-- input:
SELECT my_func(foo IGNORE NULLS)
-- output:
select my_func (foo ignore nulls)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats IGNORE NULLS and RESPECT NULLS
-- input:
SELECT my_func(foo RESPECT NULLS)
-- output:
select my_func (foo respect nulls)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats LIMIT
-- input:
SELECT my_func(foo LIMIT 10)
-- output:
select
  my_func (
    foo
    limit
      10
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats long combo of DISTINCT, IGNORE NULLS, ORDER BY, LIMIT to multiple lines
-- input:
SELECT
  my_function_name(
    DISTINCT
    first_argument,
    second_argument
    IGNORE NULLS
    ORDER BY some_field_name, other_field_name
    LIMIT 10000, 200
  )
-- output:
select
  my_function_name (
    distinct first_argument,
    second_argument ignore nulls
    order by
      some_field_name,
      other_field_name
    limit
      10000, 200
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats long named function arguments
-- input:
SELECT
  concat_lower_or_upper(
    first_parameter =>
      another_function_call(another_function_param => 'Hohoho Hello'),
    second_parameter => 'World',
    uppercase => TRUE
  )
-- output:
select
  concat_lower_or_upper (
    first_parameter => another_function_call (another_function_param => 'Hohoho Hello'),
    second_parameter => 'World',
    uppercase => true
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats named function arguments
-- input:
SELECT concat_lower_or_upper(a => 'Hello', b => 'World', uppercase => TRUE)
-- output:
select concat_lower_or_upper (a => 'Hello', b => 'World', uppercase => true)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats ORDER BY
-- input:
SELECT my_func(foo ORDER BY id DESC)
-- output:
select
  my_func (
    foo
    order by
      id desc
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: always uses triple-quotes when JSON contains single quote character
-- input:
SELECT JSON '{"name":"It's Mr John"}'
-- error: "Parse error: Unexpected \"\"}'\" at line 1 column 35.\nSQL dialect used: \"bigquery\"."
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: converts double-quoted JSON literal to single-quoted one
-- input:
SELECT JSON "{"name":"John Doe"}"
-- output:
select json "{" name ":" john doe "}"
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: converts triple-dbl-quoted JSON literal to triple-single-quoted
-- input:
SELECT JSON """{"firstName":"John","lastName":"Doe","inventory":["Pickaxe", "Compass", "Dirt"]}"""
-- output:
select
  json """{"firstName":"John","lastName":"Doe","inventory":["Pickaxe", "Compass", "Dirt"]}"""
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: converts triple-quoted JSON literal to single-quoted one when it fits to single line
-- input:
SELECT JSON '''{"name":"John Doe"}'''
-- output:
select json '''{"name":"John Doe"}'''
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: doesn't format JSON inside raw strings
-- input:
SELECT JSON r'{"name":"John"}'
-- output:
select json r'{"name":"John"}'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: doesn't format JSON when it contains escape sequences
-- input:
SELECT JSON '{ "name": "\n" }'
-- output:
select json '{ "name": "\n" }'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: doesn't format JSON when it contains triple quotes
-- input:
SELECT JSON '{"name":"It'''s Mr John"}'
-- error: "Parse error: Unexpected \"\"}'\" at line 1 column 37.\nSQL dialect used: \"bigquery\"."
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: formats JSON literal using Prettier JSON formatter
-- input:
SELECT JSON '{"fname":"John","lname":"Doe","valid":true}'
-- output:
select json '{"fname":"John","lname":"Doe","valid":true}'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: formats JSON literals
-- input:
SELECT JSON '{ "foo": true }'
-- output:
select json '{ "foo": true }'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: formats long JSON literal using Prettier JSON formatter to multiple lines
-- input:
SELECT JSON '{"firstName":"John","lastName":"Doe","inventory":["Pickaxe", "Compass", "Dirt"]}'
-- output:
select
  json '{"firstName":"John","lastName":"Doe","inventory":["Pickaxe", "Compass", "Dirt"]}'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / literal.test: formats BigQuery array literals
-- input:
SELECT
  [1, 2, 3],
  ['x', 'y', 'xyz'],
  ARRAY[1, 2, 3],
  ARRAY<STRING>['x', 'y', 'xyz']
-- output:
select
  [1, 2, 3],
  ['x', 'y', 'xyz'],
  array[1, 2, 3],
  array<string>['x', 'y', 'xyz']
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / literal.test: formats BigQuery NUMERIC and BIGNUMERIC literals
-- input:
SELECT NUMERIC '12345', BIGNUMERIC '1.23456e05'
-- output:
select numeric '12345', bignumeric '1.23456e05'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / literal.test: formats DATE/TIME literals
-- input:
SELECT
  DATE '2014-09-27',
  TIME '12:30:00.45',
  DATETIME '2014-09-27 12:30:00.45',
  TIMESTAMP '2014-09-27 12:30:00.45-08'
-- output:
select
  date '2014-09-27',
  time '12:30:00.45',
  datetime '2014-09-27 12:30:00.45',
  timestamp '2014-09-27 12:30:00.45-08'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / literal.test: formats INTERVAL literals
-- input:
SELECT
  INTERVAL 5 DAY,
  INTERVAL -90 MINUTE,
  INTERVAL '10:20:30.52' HOUR TO SECOND,
  INTERVAL '1 5:30' DAY TO MINUTE
-- output:
select
  interval 5 day,
  interval -90 minute,
  interval '10:20:30.52' hour to second,
  interval '1 5:30' day to minute
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / literal.test: formats long BigQuery array literal to multiple lines
-- input:
SELECT
  [
    'a somewhat large array',
    'containing some strings',
    'which themselves',
    'are somewhat long.'
  ]
-- output:
select
  [
    'a somewhat large array',
    'containing some strings',
    'which themselves',
    'are somewhat long.'
  ]
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / literal.test: formats long struct literal to multiple lines
-- input:
SELECT
  STRUCT(
    22541 AS id,
    'Sherlock Holmes' AS name,
    'Baker Street' AS address,
    'Private detective' AS occupation
  )
-- output:
select
  struct(
    22541 as id,
    'Sherlock Holmes' as name,
    'Baker Street' as address,
    'Private detective' as occupation
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / literal.test: formats struct literals
-- input:
SELECT
  (1, 2, 3),
  (1, 'abc'),
  STRUCT(1 AS foo, 'abc' AS bar),
  STRUCT<INT64, FLOAT64>(128, 1.5),
  STRUCT<x INT, y INT>(1, 2)
-- output:
select
  (1, 2, 3),
  (1, 'abc'),
  struct(1 as foo, 'abc' as bar),
  struct<int64, float64> (128, 1.5),
  struct<x int, y int> (1, 2)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / identifierCase.test: changes case of BigQuery system variables
-- input:
SELECT @@foo, @@Bar_, @@foo_bar_123
-- output:
select @@foo, @@Bar_, @@foo_bar_123
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / identifierCase.test: does not change the case of BigQuery quoted table names
-- input:
SELECT * FROM `proj.schm.table`
-- output:
select *
from `proj.schm.table`
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / typeCase.test: applies to ARRAY[] literals in BigQuery
-- input:
SELECT ARRAY[1], ARRAY<INT64>[2]
-- output:
select array[1], array<int64>[2]
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / typeCase.test: applies to STRUCT() literals in BigQuery
-- input:
SELECT STRUCT(2), STRUCT<INT>(2)
-- output:
select struct(2), struct<int> (2)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / typeCase.test: applies to STRUCT<> and ARRAY<> data types
-- input:
CREATE TABLE t (x STRUCT<a ARRAY<STRING>>)
-- output:
create table t (x struct<a array<string>>)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / block.test: formats BEGIN .. END
-- input:
BEGIN
  SELECT 1;
  SELECT 2;
  SELECT 3;
END
-- output:
begin
select 1;

select 2;

select 3;

end
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / block.test: formats BEGIN .. EXCEPTION .. END
-- input:
BEGIN
  SELECT 1;
EXCEPTION WHEN ERROR THEN
  SELECT @@error.message;
END
-- output:
begin
select 1;

exception when error then
select @@error.message;

end
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / call.test: formats CALL statement
-- input:
CALL proc_name(arg1, arg2, arg3)
-- output:
call proc_name (arg1, arg2, arg3)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / case.test: formats procedural CASE
-- input:
CASE foo
  WHEN 1 THEN
    SELECT CONCAT('Product one');
  ELSE
    SELECT CONCAT('Invalid product');
END CASE
-- error: "Parse error at token: SELECT at line 3 column 5\nUnexpected RESERVED_SELECT token: {\"type\":\"RESERVED_SELECT\",\"raw\":\"SELECT\",\"text\":\"SELECT\",\"start\":27,\"precedingWhitespace\":\"\\n    \"}. Instead, I was expecting to see one of the following:\n\nA LINE_COMMENT token based on:\n    comment →  ● %LINE_COMMENT\n    _$ebnf$1 → _$ebnf$1 ● comment\n    _ →  ● _$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN ● _ expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA BLOCK_COMMENT token based on:\n    comment →  ● %BLOCK_COMMENT\n    _$ebnf$1 → _$ebnf$1 ● comment\n    _ →  ● _$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN ● _ expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA DISABLE_COMMENT token based on:\n    comment →  ● %DISABLE_COMMENT\n    _$ebnf$1 → _$ebnf$1 ● comment\n    _ →  ● _$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN ● _ expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA AND token based on:\n    logic_operator$subexpression$1 →  ● %AND\n    logic_operator →  ● logic_operator$subexpression$1\n    expression$subexpression$1 →  ● logic_operator\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA OR token based on:\n    logic_operator$subexpression$1 →  ● %OR\n    logic_operator →  ● logic_operator$subexpression$1\n    expression$subexpression$1 →  ● logic_operator\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA XOR token based on:\n    logic_operator$subexpression$1 →  ● %XOR\n    logic_operator →  ● logic_operator$subexpression$1\n    expression$subexpression$1 →  ● logic_operator\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA ASTERISK token based on:\n    asterisk$subexpression$1 →  ● %ASTERISK\n    asterisk →  ● asterisk$subexpression$1\n    andless_expression$subexpression$1 →  ● asterisk\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA BETWEEN token based on:\n    between_predicate →  ● %BETWEEN _ andless_expression_chain _ %AND _ andless_expression\n    asteriskless_andless_expression$subexpression$1 →  ● between_predicate\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA CASE token based on:\n    case_expression →  ● %CASE _ case_expression$ebnf$1 case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA ARRAY_IDENTIFIER token based on:\n    array_subscript →  ● %ARRAY_IDENTIFIER _ square_brackets\n    atomic_expression$subexpression$1 →  ● array_subscript\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA ARRAY_KEYWORD token based on:\n    array_subscript →  ● %ARRAY_KEYWORD _ square_brackets\n    atomic_expression$subexpression$1 →  ● array_subscript\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA RESERVED_FUNCTION_NAME token based on:\n    function_call →  ● %RESERVED_FUNCTION_NAME _ parenthesis\n    atomic_expression$subexpression$1 →  ● function_call\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA \"(\" based on:\n    parenthesis →  ● \"(\" expressions_or_clauses \")\"\n    atomic_expression$subexpression$1 →  ● parenthesis\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA \"{\" based on:\n    curly_braces →  ● \"{\" curly_braces$ebnf$1 \"}\"\n    atomic_expression$subexpression$1 →  ● curly_braces\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA \"[\" based on:\n    square_brackets →  ● \"[\" square_brackets$ebnf$1 \"]\"\n    atomic_expression$subexpression$1 →  ● square_brackets\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA RESERVED_PARAMETERIZED_DATA_TYPE token based on:\n    data_type →  ● %RESERVED_PARAMETERIZED_DATA_TYPE _ parenthesis\n    atomic_expression$subexpression$1 →  ● data_type\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA OPERATOR token based on:\n    operator$subexpression$1 →  ● %OPERATOR\n    operator →  ● operator$subexpression$1\n    atomic_expression$subexpression$1 →  ● operator\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA IDENTIFIER token based on:\n    identifier$subexpression$1 →  ● %IDENTIFIER\n    identifier →  ● identifier$subexpression$1\n    atomic_expression$subexpression$1 →  ● identifier\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA QUOTED_IDENTIFIER token based on:\n    identifier$subexpression$1 →  ● %QUOTED_IDENTIFIER\n    identifier →  ● identifier$subexpression$1\n    atomic_expression$subexpression$1 →  ● identifier\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA VARIABLE token based on:\n    identifier$subexpression$1 →  ● %VARIABLE\n    identifier →  ● identifier$subexpression$1\n    atomic_expression$subexpression$1 →  ● identifier\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA NAMED_PARAMETER token based on:\n    parameter$subexpression$1 →  ● %NAMED_PARAMETER\n    parameter →  ● parameter$subexpression$1\n    atomic_expression$subexpression$1 →  ● parameter\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA QUOTED_PARAMETER token based on:\n    parameter$subexpression$1 →  ● %QUOTED_PARAMETER\n    parameter →  ● parameter$subexpression$1\n    atomic_expression$subexpression$1 →  ● parameter\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA NUMBERED_PARAMETER token based on:\n    parameter$subexpression$1 →  ● %NUMBERED_PARAMETER\n    parameter →  ● parameter$subexpression$1\n    atomic_expression$subexpression$1 →  ● parameter\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA POSITIONAL_PARAMETER token based on:\n    parameter$subexpression$1 →  ● %POSITIONAL_PARAMETER\n    parameter →  ● parameter$subexpression$1\n    atomic_expression$subexpression$1 →  ● parameter\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA CUSTOM_PARAMETER token based on:\n    parameter$subexpression$1 →  ● %CUSTOM_PARAMETER\n    parameter →  ● parameter$subexpression$1\n    atomic_expression$subexpression$1 →  ● parameter\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA NUMBER token based on:\n    literal$subexpression$1 →  ● %NUMBER\n    literal →  ● literal$subexpression$1\n    atomic_expression$subexpression$1 →  ● literal\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA STRING token based on:\n    literal$subexpression$1 →  ● %STRING\n    literal →  ● literal$subexpression$1\n    atomic_expression$subexpression$1 →  ● literal\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA RESERVED_DATA_TYPE token based on:\n    data_type$subexpression$1 →  ● %RESERVED_DATA_TYPE\n    data_type →  ● data_type$subexpression$1\n    atomic_expression$subexpression$1 →  ● data_type\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA RESERVED_DATA_TYPE_PHRASE token based on:\n    data_type$subexpression$1 →  ● %RESERVED_DATA_TYPE_PHRASE\n    data_type →  ● data_type$subexpression$1\n    atomic_expression$subexpression$1 →  ● data_type\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA RESERVED_KEYWORD token based on:\n    keyword$subexpression$1 →  ● %RESERVED_KEYWORD\n    keyword →  ● keyword$subexpression$1\n    atomic_expression$subexpression$1 →  ● keyword\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA RESERVED_KEYWORD_PHRASE token based on:\n    keyword$subexpression$1 →  ● %RESERVED_KEYWORD_PHRASE\n    keyword →  ● keyword$subexpression$1\n    atomic_expression$subexpression$1 →  ● keyword\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1\nA RESERVED_JOIN token based on:\n    keyword$subexpression$1 →  ● %RESERVED_JOIN\n    keyword →  ● keyword$subexpression$1\n    atomic_expression$subexpression$1 →  ● keyword\n    atomic_expression →  ● atomic_expression$subexpression$1\n    asteriskless_andless_expression$subexpression$1 →  ● atomic_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    andless_expression$subexpression$1 →  ● asteriskless_andless_expression\n    andless_expression →  ● andless_expression$subexpression$1\n    expression$subexpression$1 →  ● andless_expression\n    expression →  ● expression$subexpression$1\n    expression_with_comments_ →  ● expression _\n    expression_chain_$ebnf$1 →  ● expression_with_comments_\n    expression_chain_ →  ● expression_chain_$ebnf$1\n    case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_\n    case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause\n    case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END\n    asteriskless_andless_expression$subexpression$1 →  ● case_expression\n    asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1\n    asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression\n    asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1\n    free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql\n    free_form_sql →  ● free_form_sql$subexpression$1\n    expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql\n    expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2\n    statement →  ● expressions_or_clauses statement$subexpression$1\n    main$ebnf$1 → main$ebnf$1 ● statement\n    main →  ● main$ebnf$1"
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / declare.test: formats basic DECLARE statement
-- input:
DECLARE x
-- output:
declare x
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / declare.test: formats DECLARE with type
-- input:
DECLARE x INT64
-- output:
declare x int64
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / declare.test: formats declaring of multiple variables
-- input:
DECLARE foo, bar, baz INT64
-- output:
declare foo,
bar,
baz int64
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / declare.test: formats DEFAULT
-- input:
DECLARE d DATE DEFAULT CURRENT_DATE()
-- output:
declare d date default current_date()
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / if.test: formats ELSE
-- input:
IF x > 10 THEN
  SELECT 1;
ELSE
  SELECT 2;
END IF
-- output:
if x > 10 then
select 1;

else
select 2;

end if
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / if.test: formats ELSEIF
-- input:
IF x > 10 THEN
  SELECT 1;
ELSEIF x > 1 THEN
  SELECT 2;
ELSEIF x < 1 THEN
  SELECT 3;
ELSE
  SELECT 4;
END IF
-- output:
if x > 10 then
select 1;

elseif x > 1 then
select 2;

elseif x < 1 then
select 3;

else
select 4;

end if
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / if.test: formats ELSEIF with long condition
-- input:
IF TRUE THEN
  SELECT 1;
ELSEIF
  EXISTS (SELECT 1 FROM schema.products WHERE product_id = target_product_id)
  AND target_product_id IS NOT NULL
THEN
  SELECT 2;
END IF
-- output:
if true then
select 1;

elseif exists (
  select
    1
  from
    schema.products
  where
    product_id = target_product_id
)
and target_product_id is not null then
select 2;

end if
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / if.test: formats IF .. THEN .. END IF
-- input:
IF x > 10 THEN
  SELECT 1;
END IF
-- output:
if x > 10 then
select 1;

end if
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / if.test: formats IF with long condition
-- input:
IF
  EXISTS (SELECT 1 FROM schema.products WHERE product_id = target_product_id)
  AND target_product_id IS NOT NULL
THEN
  SELECT 1;
END IF
-- output:
if exists (
  select
    1
  from
    schema.products
  where
    product_id = target_product_id
)
and target_product_id is not null then
select 1;

end if
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / if.test: formats IF with multiple statements inside
-- input:
IF x > 10 THEN
  SELECT 1;
  SELECT 2;
  SELECT 3;
END IF
-- output:
if x > 10 then
select 1;

select 2;

select 3;

end if
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / loops.test: formats BREAK/CONTINUE
-- input:
LOOP
  IF TRUE THEN
    BREAK;
  ELSE
    CONTINUE;
  END IF;
END LOOP
-- output:
loop if true then
break;

else
continue;

end if;

end
loop
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / loops.test: formats end labels
-- input:
outer_loop: REPEAT
  inner_loop: LOOP
    CONTINUE outer_loop;
  END LOOP inner_loop;
UNTIL TRUE END REPEAT outer_loop
-- error: "Parse error: Unexpected \": REPEAT\n \" at line 1 column 11.\nSQL dialect used: \"bigquery\"."
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / loops.test: formats FOR .. IN
-- input:
FOR record IN (SELECT * FROM tbl) DO
  SELECT record.foo, record.bar;
END FOR
-- output:
for record in (
  select
    *
  from
    tbl
) do
select record.foo, record.bar;

end
for
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / loops.test: formats labels
-- input:
outer_loop: LOOP
  inner_loop: LOOP
    BREAK outer_loop;
  END LOOP;
END LOOP
-- error: "Parse error: Unexpected \": LOOP\n  i\" at line 1 column 11.\nSQL dialect used: \"bigquery\"."
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / loops.test: formats LOOP
-- input:
LOOP
  SELECT 1;
END LOOP
-- output:
loop
select 1;

end
loop
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / loops.test: formats REPEAT
-- input:
REPEAT
  SET x = x + 1;
UNTIL x > 10 END REPEAT
-- output:
repeat
set
  x = x + 1;

until x > 10 end
repeat
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / loops.test: formats WHILE
-- input:
WHILE x < 10 DO
  SET x = x + 1;
END WHILE
-- output:
while x < 10 do
set
  x = x + 1;

end
while
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / prepared_statements.test: formats EXECUTE IMMEDIATE
-- input:
EXECUTE IMMEDIATE 'SELECT * FROM tbl'
-- output:
execute immediate 'SELECT * FROM tbl'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / prepared_statements.test: formats EXECUTE IMMEDIATE with INTO and USING
-- input:
EXECUTE IMMEDIATE 'SELECT ? + ?'
INTO sum
USING 1, 2
-- output:
execute immediate 'SELECT ? + ?' into sum using 1,
2
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / prepared_statements.test: formats EXECUTE IMMEDIATE with long query
-- input:
EXECUTE IMMEDIATE
  'SELECT count(*) FROM myschema.mytable WHERE operations > 10 AND name IS NOT NULL'
INTO cnt
-- output:
execute immediate 'SELECT count(*) FROM myschema.mytable WHERE operations > 10 AND name IS NOT NULL' into cnt
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / raise.test: formats RAISE statement
-- input:
RAISE
-- output:
raise
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / raise.test: formats RAISE with message
-- input:
RAISE USING MESSAGE = 'Serious error!'
-- output:
raise using message = 'Serious error!'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / return.test: formats RETURN statement
-- input:
RETURN
-- output:
return
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / set.test: formats basic SET statement
-- input:
SET x = 1
-- output:
set
  x = 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / set.test: formats long SET expressions
-- input:
SET (first_variable, second_variable) = (
  FORMAT('%d', word_count),
  FORMAT('%d', line_count)
)
-- output:
set
  (first_variable, second_variable) = (
    format('%d', word_count),
    format('%d', line_count)
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / set.test: formats long SET variable list
-- input:
SET (
  first_variable,
  second_variable,
  third_variable,
  fourth_variable,
  final_variable
) = (1, 2, 3, 4)
-- output:
set
  (
    first_variable,
    second_variable,
    third_variable,
    fourth_variable,
    final_variable
  ) = (1, 2, 3, 4)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / set.test: formats multi-assignment SET
-- input:
SET (x, y, z) = (1, 2, 3)
-- output:
set
  (x, y, z) = (1, 2, 3)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats FOR SYSTEM_TIME AS OF
-- input:
SELECT *
FROM tbl FOR SYSTEM_TIME AS OF '2017-01-01 10:00:00-07:00'
-- output:
select *
from tbl
for system_time as of
  '2017-01-01 10:00:00-07:00'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats long FOR SYSTEM_TIME AS OF to multiple lines
-- input:
SELECT *
FROM
  my_favorite_table AS fancy_table_name
  FOR SYSTEM_TIME AS OF '2017-01-01 10:00:00-07:00'
-- output:
select *
from my_favorite_table as fancy_table_name
for system_time as of
  '2017-01-01 10:00:00-07:00'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats long PIVOT() to multiple lines
-- input:
SELECT *
FROM
  Produce
  PIVOT(
    SUM(sales) AS total_sales, COUNT(*) AS num_records
    FOR quarter
    IN ('Q1', 'Q2')
  )
-- output:
select *
from
  produce pivot(
    sum(sales) as total_sales,
    count(*) as num_records
    for quarter in ('Q1', 'Q2')
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats long UNPIVOT() with null-handling options to multiple lines
-- input:
SELECT *
FROM
  Produce
  UNPIVOT INCLUDE NULLS (
    (first_half_sales, second_half_sales)
    FOR semesters
    IN ((Q1, Q2) AS 'semester_1', (Q3, Q4) AS 'semester_2')
  )
-- output:
select *
from
  produce unpivot include nulls (
    (first_half_sales, second_half_sales)
    for semesters in (
      (q1, q2) as 'semester_1',
      (q3, q4) as 'semester_2'
    )
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats PIVOT()
-- input:
SELECT *
FROM
  Produce
  PIVOT(SUM(sales) FOR quarter IN ('Q1', 'Q2', 'Q3', 'Q4'))
-- output:
select *
from
  produce pivot(
    sum(sales)
    for quarter in ('Q1', 'Q2', 'Q3', 'Q4')
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats TABLESPAMPLE operator
-- input:
SELECT * FROM dataset.my_table TABLESAMPLE SYSTEM (10 PERCENT)
-- output:
select *
from dataset.my_table tablesample system (10 percent)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats TABLESPAMPLE operator to multiple lines
-- input:
SELECT *
FROM
  myLongProjectName.myCustomDatasetName.my_table_name
  TABLESAMPLE SYSTEM (10 PERCENT)
-- output:
select *
from
  mylongprojectname.mycustomdatasetname.my_table_name tablesample system (10 percent)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats UNNEST()
-- input:
SELECT *
FROM UNNEST([10, 20, 30]) AS numbers WITH OFFSET
-- output:
select *
from unnest ([10, 20, 30]) as numbers
with
offset
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats UNPIVOT()
-- input:
SELECT *
FROM
  Produce
  UNPIVOT(sales FOR quarter IN (Q1, Q2, Q3, Q4))
-- output:
select *
from
  produce unpivot(
    sales
    for quarter in (q1, q2, q3, q4)
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats GROUP BY ALL
-- input:
SELECT * FROM tbl GROUP BY ALL
-- output:
select *
from tbl
group by all
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats GROUP BY ROLLUP()
-- input:
SELECT * FROM tbl GROUP BY ROLLUP(a, b, c)
-- output:
select *
from tbl
group by rollup (a, b, c)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats GROUP BY ROLLUP() to multiple lines
-- input:
SELECT *
FROM my_table_name
GROUP BY
  ROLLUP(
    my_table_name.column1,
    my_table_name.column2,
    my_table_name.column3,
    my_table_name.column4
  )
-- output:
select *
from my_table_name
group by
  rollup (
    my_table_name.column1,
    my_table_name.column2,
    my_table_name.column3,
    my_table_name.column4
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats long QUALIFY clause to multiple lines
-- input:
SELECT *
FROM my_table_name
QUALIFY
  my_table_name.some_long_column_name > my_table_name.some_long_column_name2
-- output:
select *
from my_table_name
qualify
  my_table_name.some_long_column_name > my_table_name.some_long_column_name2
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats QUALIFY clause
-- input:
SELECT * FROM tbl QUALIFY x > 10
-- output:
select *
from tbl
qualify
  x > 10
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats SELECT * EXCEPT
-- input:
SELECT * EXCEPT (order_id) FROM orders
-- output:
select
  * except (order_id)
from orders
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats SELECT * REPLACE
-- input:
SELECT * REPLACE (order_id AS id) FROM orders
-- output:
select
  * replace(order_id as id)
from orders
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats SELECT AS STRUCT
-- input:
SELECT AS STRUCT 1 AS a, 2 AS b
-- output:
select as struct
  1 as a,
  2 as b
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats SELECT AS VALUE
-- input:
SELECT AS VALUE foo()
-- output:
select as value
  foo ()
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: removes trailing commas from multiline SELECT
-- input:
SELECT
  'something long',
  'something even longer',
  'another thing that is extra long',
  'and then something even more grandiose', -- comment
FROM my_table
-- output:
select
  'something long',
  'something even longer',
  'another thing that is extra long',
  'and then something even more grandiose', -- comment
from my_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: removes trailing commas from SELECT
-- input:
SELECT 1, 2, 3,
-- output:
select 1, 2, 3,
-- #endregion
