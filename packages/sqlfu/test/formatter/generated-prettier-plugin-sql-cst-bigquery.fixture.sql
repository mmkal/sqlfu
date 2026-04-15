-- default config: {"dialect":"bigquery"}

-- #region: prettier-plugin-sql-cst / test / bigquery / bigquery.test: formats ALTER ORGANIZATION
-- input:
ALTER ORGANIZATION
SET OPTIONS (default_time_zone = 'America/Los_Angeles')
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / bigquery.test: formats ASSERT
-- input:
ASSERT x > 10
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / bigquery.test: formats ASSERT with message
-- input:
ASSERT x > 10 AS 'x must be greater than 10'
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / export_and_load.test: formats EXPORT DATA
-- input:
EXPORT DATA
OPTIONS (uri = 'gs://bucket/folder/*.csv', format = 'CSV')
AS
  SELECT field1, field2 FROM mydataset.table1
-- output:
EXPORT DATA OPTIONS(uri = 'gs://bucket/folder/*.csv', format = 'CSV') AS
SELECT
  field1,
  field2
FROM
  mydataset.table1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / export_and_load.test: formats EXPORT DATA with CONNECTION
-- input:
EXPORT DATA
WITH CONNECTION myproject.us.myconnection
OPTIONS (uri = 'gs://bucket/folder/*.csv', format = 'CSV')
AS
  SELECT field1, field2 FROM mydataset.table1
-- output:
EXPORT DATA
WITH CONNECTION
  myproject.us.myconnection OPTIONS(uri = 'gs://bucket/folder/*.csv', format = 'CSV') AS
SELECT
  field1,
  field2
FROM
  mydataset.table1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / export_and_load.test: formats LOAD DATA
-- input:
LOAD DATA INTO mydataset.table1
FROM FILES (format = 'AVRO', uris = ['gs://bucket/path/file.avro'])
-- output:
LOAD DATA INTO mydataset.table1
FROM
  FILES (
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
LOAD DATA INTO mydataset.table1 (x INT64, y STRING) OPTIONS(description = "my table")
FROM
  FILES (
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
LOAD DATA INTO mydataset.table1 (
  first_field INT64,
  second_field STRING,
  field_1 STRING,
  field_2 INT64
)
FROM
  FILES (uris = ['gs://bucket/path/file.avro'])
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
LOAD DATA INTO mydataset.table1
PARTITION BY
  transaction_date
CLUSTER BY
  customer_id
FROM
  FILES (
    format = 'AVRO',
    uris = ['gs://bucket/path/file.avro'],
    hive_partition_uri_prefix = 'gs://bucket/path'
  )
WITH PARTITION COLUMNS
  (field_1 STRING, field_2 INT64)
WITH CONNECTION
  myproject.us.myconnection
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / row_access_policy.test: formats CREATE ROW ACCESS POLICY
-- input:
CREATE ROW ACCESS POLICY policy_name ON my_table
FILTER USING (x > 10)
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / row_access_policy.test: formats DROP ALL ROW ACCESS POLICIES
-- input:
DROP ALL ROW ACCESS POLICIES ON my_table
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / row_access_policy.test: formats DROP ROW ACCESS POLICY
-- input:
DROP ROW ACCESS POLICY policy_name ON my_table
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / row_access_policy.test: formats GRANT TO
-- input:
CREATE ROW ACCESS POLICY policy_name ON my_table
GRANT TO ('user:alice@example.com', 'domain:example.com')
FILTER USING (x > 10)
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / row_access_policy.test: formats IF EXISTS
-- input:
DROP ROW ACCESS POLICY IF EXISTS policy_name ON my_table
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / bigquery / row_access_policy.test: formats OR REPLACE / IF NOT EXISTS
-- input:
CREATE OR REPLACE ROW ACCESS POLICY IF NOT EXISTS policy_name ON my_table
FILTER USING (x > 10)
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / canonical_syntax.test: replaces DELETE with DELETE FROM
-- input:
DELETE client WHERE id = 10
-- output:
DELETE client
WHERE
  id = 10
-- #endregion

-- #region: prettier-plugin-sql-cst / test / canonical_syntax.test: replaces MERGE with MERGE INTO
-- input:
MERGE foo USING bar ON x = y WHEN MATCHED THEN DELETE
-- output:
MERGE
  foo USING bar ON x = y
WHEN MATCHED THEN
DELETE
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
GRANT `roles/bigquery.dataViewer`,
`roles/bigquery.admin`,
`roles/bigquery.rowAccessPolicies.create` ON SCHEMA myCompany TO 'user:tom@example.com',
'user:sara@example.com',
'specialGroup:allAuthenticatedUsers'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats GRANT (multiple privileges, multiple users)
-- input:
GRANT `roles/bigquery.dataViewer`, `roles/bigquery.admin`
ON SCHEMA myCompany
TO 'user:tom@example.com', 'user:sara@example.com'
-- output:
GRANT `roles/bigquery.dataViewer`,
`roles/bigquery.admin` ON SCHEMA myCompany TO 'user:tom@example.com',
'user:sara@example.com'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats GRANT (single privilege, single user)
-- input:
GRANT `roles/bigquery.dataViewer`
ON TABLE myCompany.revenue
TO 'user:tom@example.com'
-- output:
GRANT `roles/bigquery.dataViewer` ON TABLE myCompany.revenue TO 'user:tom@example.com'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats short GRANT in multiple lines if user prefers
-- input:
GRANT `roles/x`
ON TABLE revenue
TO 'user:tom'
-- output:
GRANT `roles/x` ON TABLE revenue TO 'user:tom'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats short GRANT in single line
-- input:
GRANT `roles/x` ON TABLE revenue TO 'user:tom'
-- output: <unchanged>
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
REVOKE `roles/bigquery.dataViewer`,
`roles/bigquery.admin`,
`roles/bigquery.rowAccessPolicies.create` ON EXTERNAL TABLE myCompany
FROM
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
REVOKE `roles/bigquery.dataViewer`,
`roles/bigquery.admin` ON SCHEMA myCompany
FROM
  'user:tom@example.com',
  'user:sara@example.com'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / revoke.test: formats REVOKE (single privilege, single user)
-- input:
REVOKE `roles/bigquery.dataViewer`
ON VIEW myCompany.revenue
FROM 'user:tom@example.com'
-- output:
REVOKE `roles/bigquery.dataViewer` ON VIEW myCompany.revenue
FROM
  'user:tom@example.com'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / revoke.test: formats short REVOKE in multiple lines if user prefers
-- input:
REVOKE `roles/x`
ON VIEW revenue
FROM 'user:tom'
-- output:
REVOKE `roles/x` ON VIEW revenue
FROM
  'user:tom'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / revoke.test: formats short REVOKE in single line
-- input:
REVOKE `roles/x` ON VIEW revenue FROM 'user:tom'
-- output:
REVOKE `roles/x` ON VIEW revenue
FROM
  'user:tom'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ADD CONSTRAINT
-- input:
ALTER TABLE client
ADD CONSTRAINT IF NOT EXISTS pk PRIMARY KEY (id) NOT ENFORCED
-- output:
ALTER TABLE client ADD CONSTRAINT IF NOT EXISTS pk PRIMARY KEY (id) NOT ENFORCED
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER COLUMN .. SET DATA TYPE
-- input:
ALTER TABLE client
ALTER COLUMN price
SET DATA TYPE INT64
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER COLUMN .. SET OPTIONS
-- input:
ALTER TABLE client
ALTER COLUMN price
SET OPTIONS (description = 'Price per unit')
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER COLUMN [IF EXISTS]
-- input:
ALTER TABLE client
ALTER COLUMN IF EXISTS price
DROP DEFAULT
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE IF EXISTS
-- input:
ALTER TABLE IF EXISTS client
RENAME TO org_client
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE..ADD COLUMN IF NOT EXISTS
-- input:
ALTER TABLE client
ADD COLUMN IF NOT EXISTS col1 INT
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE..DROP COLUMN IF EXISTS
-- input:
ALTER TABLE client
DROP COLUMN IF EXISTS col1
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE..DROP COLUMN RESTRICT|CASCADE
-- input:
ALTER TABLE client
DROP COLUMN col1 RESTRICT,
DROP COLUMN col2 CASCADE
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE..RENAME COLUMN IF EXISTS
-- input:
ALTER TABLE client
RENAME COLUMN IF EXISTS col1 TO col2
-- output:
ALTER TABLE client RENAME COLUMN IF EXISTS col1 TO col2
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE..SET DEFAULT COLLATE
-- input:
ALTER TABLE client
SET DEFAULT COLLATE 'und:ci'
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE..SET OPTIONS
-- input:
ALTER TABLE client
SET OPTIONS (description = 'Table that expires seven days from now')
-- output:
ALTER TABLE client
SET OPTIONS (
  description = 'Table that expires seven days from now'
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats DROP PRIMARY KEY
-- input:
ALTER TABLE client
DROP PRIMARY KEY
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats DROP PRIMARY KEY
-- input:
ALTER TABLE client
DROP PRIMARY KEY IF EXISTS
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats only the ALTER COLUMN-part on single line (if user prefers)
-- input:
ALTER TABLE client
ALTER COLUMN price DROP DEFAULT
-- output:
ALTER TABLE client
ALTER COLUMN price
DROP DEFAULT
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats short ALTER COLUMN on a single line (if user prefers)
-- input:
ALTER TABLE client ALTER COLUMN price DROP DEFAULT
-- output:
ALTER TABLE client
ALTER COLUMN price
DROP DEFAULT
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
CREATE TABLE client (id INT64)
DEFAULT COLLATE 'und:ci'
PARTITION BY
  _PARTITIONDATE
CLUSTER BY
  customer_id OPTIONS(friendly_name = 'Clientele')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats BigQuery data types with internal constraints
-- input:
CREATE TABLE client (
  arr_field ARRAY<INT64 NOT NULL>,
  struct_field STRUCT<name STRING NOT NULL, age INT64 DEFAULT 0>,
  meta OPTIONS (description = 'Metadata in here')
)
-- output:
CREATE TABLE client (
  arr_field ARRAY<INT64NOTNULL>,
  struct_field STRUCT<name STRINGNOTNULL, age INT64DEFAULT0>,
  meta OPTIONS(description = 'Metadata in here')
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
CREATE EXTERNAL TABLE dataset.CustomTable (id INT64)
WITH CONNECTION
  myproj.dataset.connectionId
WITH PARTITION COLUMNS
  (field_1 STRING, field_2 INT64) OPTIONS(format = 'PARQUET')
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
CREATE EXTERNAL TABLE dataset.CustomTable
WITH PARTITION COLUMNS
  (
    first_name STRING,
    last_name STRING,
    average_income INT64,
    waist_height INT64
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE SNAPSHOT TABLE CLONE
-- input:
CREATE SNAPSHOT TABLE foo CLONE my_old_table
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE TABLE COPY
-- input:
CREATE TABLE foo COPY my_old_table
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE TABLE LIKE
-- input:
CREATE TABLE foo LIKE my_old_table
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats FOR SYSTEM_TIME AS OF
-- input:
CREATE SNAPSHOT TABLE foo
CLONE my_old_table FOR SYSTEM_TIME AS OF '2017-01-01 10:00:00-07:00'
-- output:
CREATE SNAPSHOT TABLE foo CLONE my_old_table
FOR SYSTEM_TIME AS OF
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
CREATE TABLE client (id INT64) OPTIONS(
  expiration_timestamp = TIMESTAMP "2025-01-01 00:00:00 UTC",
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
CREATE TABLE client (
  struct_field STRUCT<first_name STRING, last_name STRING, email STRING, address STRING, phone_number STRING>
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats OR REPLACE
-- input:
CREATE OR REPLACE TABLE foo (
  id INT
)
-- output:
CREATE OR REPLACE TABLE foo (id INT)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats single short BigQuery extra CREATE TABLE clause
-- input:
CREATE TABLE client (
  id INT64
)
DEFAULT COLLATE 'und:ci'
-- output:
CREATE TABLE client (id INT64)
DEFAULT COLLATE 'und:ci'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / drop_table.test: formats DROP EXTERNAL table
-- input:
DROP EXTERNAL TABLE foo
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / drop_table.test: formats DROP SNAPSHOT table
-- input:
DROP SNAPSHOT TABLE foo
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: does not reformat JavaScript when neither ''' or """ can be easily used for quoting
-- input:
CREATE FUNCTION contains_quotes(x STRING)
RETURNS FLOAT64
LANGUAGE js
AS " return /'''|\"\"\"/.test(x) "
-- output:
CREATE FUNCTION contains_quotes (x STRING) RETURNS FLOAT64 LANGUAGE js AS " return /'''|\"\"\"/.test(x) "
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats CREATE FUNCTION
-- input:
CREATE FUNCTION my_func(arg1 INT64, arg2 STRING, arg3 ANY TYPE) AS
  (SELECT * FROM client)
-- output:
CREATE FUNCTION my_func (arg1 INT64, arg2 STRING, arg3 ANY TYPE) AS (
  SELECT
    *
  FROM
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
CREATE TABLE FUNCTION my_func () RETURNS TABLE < id INT,
name STRING > AS (
  SELECT
    1,
    'John'
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats CREATE TEMP FUNCTION
-- input:
CREATE TEMPORARY FUNCTION my_func() AS
  (SELECT 1)
-- output:
CREATE TEMPORARY FUNCTION my_func () AS (
  SELECT
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
CREATE FUNCTION my_func () RETURNS INT64
REMOTE WITH CONNECTION
  us.myconnection OPTIONS(
    endpoint = 'https://us-central1-myproject.cloudfunctions.net/multi'
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats DROP FUNCTION
-- input:
DROP FUNCTION my_schema.my_func
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats DROP TABLE FUNCTION
-- input:
DROP TABLE FUNCTION my_func
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats IF EXISTS
-- input:
DROP FUNCTION IF EXISTS my_func
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats IF NOT EXISTS
-- input:
CREATE FUNCTION IF NOT EXISTS my_func() AS
  (SELECT 1)
-- output:
CREATE FUNCTION IF NOT EXISTS my_func () AS (
  SELECT
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
CREATE FUNCTION gen_random () RETURNS FLOAT64 NOT DETERMINISTIC LANGUAGE js AS r'''
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
CREATE FUNCTION my_func () AS (
  SELECT
    1
) OPTIONS(description = 'constant-value function')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats OR REPLACE
-- input:
CREATE OR REPLACE FUNCTION my_func() AS
  (SELECT 1)
-- output:
CREATE OR REPLACE FUNCTION my_func () AS (
  SELECT
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
CREATE FUNCTION my_func () RETURNS INT64 AS (
  SELECT
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
CREATE FUNCTION contains_quotes (x STRING) RETURNS FLOAT64 LANGUAGE js AS " return /'''/.test(x) "
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: reformats JavaScript in JS function
-- input:
CREATE FUNCTION gen_random()
RETURNS FLOAT64
LANGUAGE js
AS ' if(true) {return Math.random () *2}'
-- output:
CREATE FUNCTION gen_random () RETURNS FLOAT64 LANGUAGE js AS ' if(true) {return Math.random () *2}'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats BigQuery CREATE SEARCH INDEX with ALL COLUMNS
-- input:
CREATE SEARCH INDEX my_index ON my_table (ALL COLUMNS)
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats BigQuery CREATE SEARCH INDEX with OPTIONS ()
-- input:
CREATE SEARCH INDEX my_index ON my_table (col)
OPTIONS (analyzer = 'LOG_ANALYZER')
-- output:
CREATE SEARCH INDEX my_index ON my_table (col) OPTIONS(analyzer = 'LOG_ANALYZER')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats DROP SEARCH INDEX
-- input:
DROP SEARCH INDEX my_index ON my_table
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats OR REPLACE
-- input:
CREATE OR REPLACE INDEX my_index ON my_table (col)
-- output:
CREATE
OR REPLACE INDEX my_index ON my_table (col)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: formats CREATE PROCEDURE
-- input:
CREATE PROCEDURE drop_my_table(arg1 INT64, OUT arg2 STRING)
BEGIN
  DROP TABLE my_table;
END
-- output:
CREATE PROCEDURE drop_my_table (arg1 INT64, OUT arg2 STRING)
BEGIN
DROP TABLE my_table;

END
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: formats DROP PROCEDURE
-- input:
DROP PROCEDURE mydataset.myProcedure
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: formats IF EXISTS
-- input:
DROP PROCEDURE IF EXISTS foo
-- output: <unchanged>
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
CREATE PROCEDURE spark_proc ()
WITH CONNECTION
  my_connection OPTIONS(engine = "SPARK") LANGUAGE PYTHON AS r'''
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
CREATE PROCEDURE my_schema.my_long_procedure_name (
  IN first_parameter INT64,
  INOUT second_parameter STRING,
  OUT third_parameter INT64
)
BEGIN
DROP TABLE my_table;

END
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: formats OPTIONS (..)
-- input:
CREATE PROCEDURE foo()
OPTIONS (strict_mode = TRUE)
BEGIN
  DROP TABLE my_table;
END
-- output:
CREATE PROCEDURE foo () OPTIONS(strict_mode = TRUE)
BEGIN
DROP TABLE my_table;

END
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: formats OR REPLACE / IF NOT EXISTS
-- input:
CREATE OR REPLACE PROCEDURE IF NOT EXISTS drop_my_table()
BEGIN
  DROP TABLE my_table;
END
-- output:
CREATE OR REPLACE PROCEDURE IF NOT EXISTS drop_my_table ()
BEGIN
DROP TABLE my_table;

END
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: formats remote python procedure
-- input:
CREATE PROCEDURE my_bq_project.my_dataset.spark_proc()
WITH CONNECTION `my-project-id.us.my-connection`
OPTIONS (engine = "SPARK", main_file_uri = "gs://my-bucket/my-pyspark-main.py")
LANGUAGE PYTHON
-- output:
CREATE PROCEDURE my_bq_project.my_dataset.spark_proc ()
WITH CONNECTION
  `my-project-id.us.my-connection` OPTIONS(
    engine = "SPARK",
    main_file_uri = "gs://my-bucket/my-pyspark-main.py"
  ) LANGUAGE PYTHON
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats ALTER SCHEMA .. SET DEFAULT COLLATE
-- input:
ALTER SCHEMA my_schema
SET DEFAULT COLLATE 'und:ci'
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats ALTER SCHEMA .. SET OPTIONS
-- input:
ALTER SCHEMA IF EXISTS my_schema
SET OPTIONS (description = 'blah')
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats ALTER SCHEMA on single line if user prefers
-- input:
ALTER SCHEMA IF EXISTS my_schema SET OPTIONS (description = 'blah')
-- output:
ALTER SCHEMA IF EXISTS my_schema
SET OPTIONS (description = 'blah')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats CASCADE/RESTRICT
-- input:
DROP SCHEMA schema_name CASCADE
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats CREATE SCHEMA
-- input:
CREATE SCHEMA schema_name
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats CREATE SCHEMA on single line if user prefers
-- input:
CREATE SCHEMA hello OPTIONS (friendly_name = 'Hello')
-- output:
CREATE SCHEMA hello OPTIONS(friendly_name = 'Hello')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats DEFAULT COLLATE
-- input:
CREATE SCHEMA schema_name
DEFAULT COLLATE 'und:ci'
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats DROP SCHEMA
-- input:
DROP SCHEMA schema_name
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats IF EXISTS
-- input:
DROP SCHEMA IF EXISTS schema_name
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats IF NOT EXISTS
-- input:
CREATE SCHEMA IF NOT EXISTS schema_name
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats OPTIONS (..)
-- input:
CREATE SCHEMA schema_name
OPTIONS (friendly_name = 'Happy schema')
-- output:
CREATE SCHEMA schema_name OPTIONS(friendly_name = 'Happy schema')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats ALTER MATERIALIZED VIEW .. SET OPTIONS
-- input:
ALTER MATERIALIZED VIEW my_view
SET OPTIONS (description = 'blah')
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats ALTER VIEW .. SET OPTIONS
-- input:
ALTER VIEW IF EXISTS my_view
SET OPTIONS (description = 'blah')
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats CREATE MATERIALIZED VIEW .. AS REPLICA OF
-- input:
CREATE MATERIALIZED VIEW foo
OPTIONS (description = 'blah')
AS REPLICA OF my_other_view
-- output:
CREATE MATERIALIZED VIEW foo OPTIONS(description = 'blah') AS REPLICA OF my_other_view
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats CREATE MATERIALIZED VIEW with extra clauses
-- input:
CREATE MATERIALIZED VIEW foo
PARTITION BY DATE(col_datetime)
CLUSTER BY col_int
AS
  SELECT 1
-- output:
CREATE MATERIALIZED VIEW foo
PARTITION BY
  DATE(col_datetime)
CLUSTER BY
  col_int AS
SELECT
  1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats CREATE OR REPLACE VIEW
-- input:
CREATE OR REPLACE VIEW active_client_id AS
  SELECT 1
-- output:
CREATE OR REPLACE VIEW active_client_id AS
SELECT
  1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats CREATE VIEW with BigQuery options
-- input:
CREATE VIEW foo
OPTIONS (friendly_name = "newview")
AS
  SELECT 1
-- output:
CREATE VIEW foo OPTIONS(friendly_name = "newview") AS
SELECT
  1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats CREATE VIEW with BigQuery OPTIONS() in columns list
-- input:
CREATE VIEW foobar (
  id OPTIONS (description = 'Unique identifier'),
  name OPTIONS (description = 'Name of the user')
) AS
  SELECT 1
-- output:
CREATE VIEW foobar (
  id OPTIONS(description = 'Unique identifier'),
  name OPTIONS(description = 'Name of the user')
) AS
SELECT
  1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats DROP MATERIALIZED VIEW
-- input:
DROP MATERIALIZED VIEW foo
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats simple CREATE MATERIALIZED VIEW
-- input:
CREATE MATERIALIZED VIEW foo AS
  SELECT 1
-- output:
CREATE MATERIALIZED VIEW foo AS
SELECT
  1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / delete.test: formats DELETE without FROM
-- input:
DELETE employee
WHERE id = 10
-- output:
DELETE employee
WHERE
  id = 10
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats DEFAULT values among normal values
-- input:
INSERT INTO employee
VALUES (1, 2, DEFAULT, 3)
-- output:
INSERT INTO
  employee
VALUES
  (1, 2, DEFAULT, 3)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats INSERT statement without INTO
-- input:
INSERT client VALUES (1, 2, 3)
-- output:
INSERT
  client
VALUES
  (1, 2, 3)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: preserves indentation preference of column names and values
-- input:
INSERT INTO client (id, fname, lname, org_id)
VALUES (1, 'John', 'Doe', 27)
-- output:
INSERT INTO
  client (id, fname, lname, org_id)
VALUES
  (1, 'John', 'Doe', 27)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: preserves short multi-line INSERT statement on multiple lines
-- input:
INSERT INTO client
VALUES (1, 2, 3)
-- output:
INSERT INTO
  client
VALUES
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
MERGE INTO
  target USING source ON target.id = source.id
  AND source.quantity > target.quantity
  AND quantity > 1000
WHEN MATCHED THEN
DELETE
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
MERGE INTO
  target USING source ON target.id = source.id
WHEN NOT MATCHED BY SOURCE
  AND source.quantity > target.quantity
  OR source.quantity < 0
  OR target.id = 18967 THEN
UPDATE SET
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
MERGE INTO
  dataset.DetailedInventory AS target USING dataset.Inventory AS source ON target.product = source.product
WHEN MATCHED THEN
DELETE
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
MERGE INTO
  target USING source ON target.id = source.id
WHEN NOT MATCHED
  AND quantity < 10 THEN
INSERT
  (product, quantity, supply_constrained, comments)
VALUES
  (product, quantity, TRUE, 'My comment')
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
MERGE INTO
  target USING source ON target.id = source.id
WHEN MATCHED THEN
INSERT
  (col1, col2, col3) ROW
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / merge.test: formats MERGE .. INSERT ROW
-- input:
MERGE INTO target
USING source
ON target.id = source.id
WHEN MATCHED THEN
  INSERT ROW
-- output:
MERGE INTO
  target USING source ON target.id = source.id
WHEN MATCHED THEN
INSERT
  ROW
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
MERGE INTO
  target USING source ON target.id = source.id
WHEN MATCHED THEN
INSERT
VALUES
  (col1, DEFAULT, col2)
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
MERGE INTO
  target USING source ON target.id = source.id
WHEN NOT MATCHED BY SOURCE THEN
UPDATE SET
  quantity = 1,
  supply_constrained = FALSE,
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
MERGE INTO
  target USING source ON target.id = source.id
WHEN NOT MATCHED BY SOURCE THEN
UPDATE SET
  quantity = 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / truncate.test: formats TRUNCATE TABLE statement
-- input:
TRUNCATE TABLE dataset.employee
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats BigQuery @@system_variables
-- input:
SELECT @@error.message
-- output:
SELECT
  @@error.message
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
SELECT
  item_array,
  item_array[OFFSET(1)] AS item_offset,
  item_array[ORDINAL(1)] AS item_ordinal,
  item_array[SAFE_OFFSET(6)] AS item_safe_offset
FROM
  (
    SELECT
      ["coffee", "tea", "milk"] AS item_array
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats BigQuery array field access to multiple lines
-- input:
SELECT
  ["Coffee Cup", "Tea Kettle", "Milk Glass"][
    SAFE_OFFSET(some_really_long_index_number)
  ]
-- output:
SELECT
  ["Coffee Cup", "Tea Kettle", "Milk Glass"] [SAFE_OFFSET(some_really_long_index_number)]
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats BigQuery JSON field access
-- input:
SELECT json_value.class.students[0]['name']
-- output:
SELECT
  json_value.class.students[0] ['name']
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats BigQuery quoted table names
-- input:
SELECT * FROM `my-project.mydataset.mytable`
-- output:
SELECT
  *
FROM
  `my-project.mydataset.mytable`
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats quantifier expressions
-- input:
SELECT 'x' LIKE SOME ('X', 'Y', 'Z')
-- output:
SELECT
  'x' LIKE SOME('X', 'Y', 'Z')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats ANY_VALUE() with HAVING
-- input:
SELECT any_value(fruit HAVING MAX sold)
-- output:
SELECT
  any_value(
    fruit
    HAVING
      MAX sold
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats ANY_VALUE() with HAVING
-- input:
SELECT any_value(fruit HAVING MIN sold)
-- output:
SELECT
  any_value(
    fruit
    HAVING
      MIN sold
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats ANY_VALUE() with HAVING
-- input:
SELECT any_value(fruit)
-- output:
SELECT
  any_value(fruit)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats CAST() with FORMAT
-- input:
SELECT CAST('11-08' AS DATE FORMAT 'DD-MM')
-- output:
SELECT
  CAST('11-08' AS DATE FORMAT 'DD-MM')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats CAST() with FORMAT
-- input:
SELECT CAST('12:35' AS TIME FORMAT 'HH:MI' AT TIME ZONE 'UTC')
-- output:
SELECT
  CAST('12:35' AS TIME FORMAT 'HH:MI' AT TIME ZONE 'UTC')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats combination of IGNORE NULLS, ORDER BY, LIMIT
-- input:
SELECT my_func(foo IGNORE NULLS ORDER BY id LIMIT 10)
-- output:
SELECT
  my_func (
    foo IGNORE NULLS
    ORDER BY
      id
    LIMIT
      10
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats EXTRACT() expression
-- input:
SELECT EXTRACT(MONTH FROM DATE '2002-08-16')
-- output:
SELECT
  EXTRACT(
    MONTH
    FROM
      DATE '2002-08-16'
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats EXTRACT() expression
-- input:
SELECT EXTRACT(WEEK(SUNDAY) FROM date)
-- output:
SELECT
  EXTRACT(
    WEEK(SUNDAY)
    FROM
      date
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats IGNORE NULLS and RESPECT NULLS
-- input:
SELECT my_func(foo IGNORE NULLS)
-- output:
SELECT
  my_func (foo IGNORE NULLS)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats IGNORE NULLS and RESPECT NULLS
-- input:
SELECT my_func(foo RESPECT NULLS)
-- output:
SELECT
  my_func (foo RESPECT NULLS)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats LIMIT
-- input:
SELECT my_func(foo LIMIT 10)
-- output:
SELECT
  my_func (
    foo
    LIMIT
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
SELECT
  my_function_name (
    DISTINCT first_argument,
    second_argument IGNORE NULLS
    ORDER BY
      some_field_name,
      other_field_name
    LIMIT
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
SELECT
  concat_lower_or_upper (
    first_parameter => another_function_call (another_function_param => 'Hohoho Hello'),
    second_parameter => 'World',
    uppercase => TRUE
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats named function arguments
-- input:
SELECT concat_lower_or_upper(a => 'Hello', b => 'World', uppercase => TRUE)
-- output:
SELECT
  concat_lower_or_upper (a => 'Hello', b => 'World', uppercase => TRUE)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / func.test: formats ORDER BY
-- input:
SELECT my_func(foo ORDER BY id DESC)
-- output:
SELECT
  my_func (
    foo
    ORDER BY
      id DESC
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: always uses triple-quotes when JSON contains single quote character
-- input:
SELECT JSON '{"name":"It's Mr John"}'
-- error:
-- Error: Parse error: Unexpected ""}'" at line 1 column 35.
-- SQL dialect used: "bigquery".
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: converts double-quoted JSON literal to single-quoted one
-- input:
SELECT JSON "{"name":"John Doe"}"
-- output:
SELECT
  JSON "{" name ":" John Doe "}"
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: converts triple-dbl-quoted JSON literal to triple-single-quoted
-- input:
SELECT JSON """{"firstName":"John","lastName":"Doe","inventory":["Pickaxe", "Compass", "Dirt"]}"""
-- output:
SELECT
  JSON """{"firstName":"John","lastName":"Doe","inventory":["Pickaxe", "Compass", "Dirt"]}"""
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: converts triple-quoted JSON literal to single-quoted one when it fits to single line
-- input:
SELECT JSON '''{"name":"John Doe"}'''
-- output:
SELECT
  JSON '''{"name":"John Doe"}'''
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: doesn't format JSON inside raw strings
-- input:
SELECT JSON r'{"name":"John"}'
-- output:
SELECT
  JSON r'{"name":"John"}'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: doesn't format JSON when it contains escape sequences
-- input:
SELECT JSON '{ "name": "\n" }'
-- output:
SELECT
  JSON '{ "name": "\n" }'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: doesn't format JSON when it contains triple quotes
-- input:
SELECT JSON '{"name":"It'''s Mr John"}'
-- error:
-- Error: Parse error: Unexpected ""}'" at line 1 column 37.
-- SQL dialect used: "bigquery".
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: formats JSON literal using Prettier JSON formatter
-- input:
SELECT JSON '{"fname":"John","lname":"Doe","valid":true}'
-- output:
SELECT
  JSON '{"fname":"John","lname":"Doe","valid":true}'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: formats JSON literals
-- input:
SELECT JSON '{ "foo": true }'
-- output:
SELECT
  JSON '{ "foo": true }'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: formats long JSON literal using Prettier JSON formatter to multiple lines
-- input:
SELECT JSON '{"firstName":"John","lastName":"Doe","inventory":["Pickaxe", "Compass", "Dirt"]}'
-- output:
SELECT
  JSON '{"firstName":"John","lastName":"Doe","inventory":["Pickaxe", "Compass", "Dirt"]}'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / literal.test: formats BigQuery array literals
-- input:
SELECT
  [1, 2, 3],
  ['x', 'y', 'xyz'],
  ARRAY[1, 2, 3],
  ARRAY<STRING>['x', 'y', 'xyz']
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / literal.test: formats BigQuery NUMERIC and BIGNUMERIC literals
-- input:
SELECT NUMERIC '12345', BIGNUMERIC '1.23456e05'
-- output:
SELECT
  NUMERIC '12345',
  BIGNUMERIC '1.23456e05'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / literal.test: formats DATE/TIME literals
-- input:
SELECT
  DATE '2014-09-27',
  TIME '12:30:00.45',
  DATETIME '2014-09-27 12:30:00.45',
  TIMESTAMP '2014-09-27 12:30:00.45-08'
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / literal.test: formats INTERVAL literals
-- input:
SELECT
  INTERVAL 5 DAY,
  INTERVAL -90 MINUTE,
  INTERVAL '10:20:30.52' HOUR TO SECOND,
  INTERVAL '1 5:30' DAY TO MINUTE
-- output: <unchanged>
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
-- output: <unchanged>
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
-- output: <unchanged>
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
SELECT
  (1, 2, 3),
  (1, 'abc'),
  STRUCT(1 AS foo, 'abc' AS bar),
  STRUCT<INT64, FLOAT64> (128, 1.5),
  STRUCT<x INT, y INT> (1, 2)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / identifierCase.test: changes case of BigQuery system variables
-- input:
SELECT @@foo, @@Bar_, @@foo_bar_123
-- output:
SELECT
  @@foo,
  @@Bar_,
  @@foo_bar_123
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / identifierCase.test: does not change the case of BigQuery quoted table names
-- input:
SELECT * FROM `proj.schm.table`
-- output:
SELECT
  *
FROM
  `proj.schm.table`
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / typeCase.test: applies to ARRAY[] literals in BigQuery
-- input:
SELECT ARRAY[1], ARRAY<INT64>[2]
-- output:
SELECT
  ARRAY[1],
  ARRAY<INT64>[2]
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / typeCase.test: applies to STRUCT() literals in BigQuery
-- input:
SELECT STRUCT(2), STRUCT<INT>(2)
-- output:
SELECT
  STRUCT(2),
  STRUCT<INT> (2)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / typeCase.test: applies to STRUCT<> and ARRAY<> data types
-- input:
CREATE TABLE t (x STRUCT<a ARRAY<STRING>>)
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / block.test: formats BEGIN .. END
-- input:
BEGIN
  SELECT 1;
  SELECT 2;
  SELECT 3;
END
-- output:
BEGIN
SELECT
  1;

SELECT
  2;

SELECT
  3;

END
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / block.test: formats BEGIN .. EXCEPTION .. END
-- input:
BEGIN
  SELECT 1;
EXCEPTION WHEN ERROR THEN
  SELECT @@error.message;
END
-- output:
BEGIN
SELECT
  1;

EXCEPTION WHEN ERROR THEN
SELECT
  @@error.message;

END
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / call.test: formats CALL statement
-- input:
CALL proc_name(arg1, arg2, arg3)
-- output:
CALL proc_name (arg1, arg2, arg3)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / case.test: formats procedural CASE
-- input:
CASE foo
  WHEN 1 THEN
    SELECT CONCAT('Product one');
  ELSE
    SELECT CONCAT('Invalid product');
END CASE
-- error:
-- Error: Parse error at token: SELECT at line 3 column 5
-- Unexpected RESERVED_SELECT token: {"type":"RESERVED_SELECT","raw":"SELECT","text":"SELECT","start":27,"precedingWhitespace":"\n    "}. Instead, I was expecting to see one of the following:
-- 
-- A LINE_COMMENT token based on:
--     comment →  ● %LINE_COMMENT
--     _$ebnf$1 → _$ebnf$1 ● comment
--     _ →  ● _$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN ● _ expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A BLOCK_COMMENT token based on:
--     comment →  ● %BLOCK_COMMENT
--     _$ebnf$1 → _$ebnf$1 ● comment
--     _ →  ● _$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN ● _ expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A DISABLE_COMMENT token based on:
--     comment →  ● %DISABLE_COMMENT
--     _$ebnf$1 → _$ebnf$1 ● comment
--     _ →  ● _$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN ● _ expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A AND token based on:
--     logic_operator$subexpression$1 →  ● %AND
--     logic_operator →  ● logic_operator$subexpression$1
--     expression$subexpression$1 →  ● logic_operator
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A OR token based on:
--     logic_operator$subexpression$1 →  ● %OR
--     logic_operator →  ● logic_operator$subexpression$1
--     expression$subexpression$1 →  ● logic_operator
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A XOR token based on:
--     logic_operator$subexpression$1 →  ● %XOR
--     logic_operator →  ● logic_operator$subexpression$1
--     expression$subexpression$1 →  ● logic_operator
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A ASTERISK token based on:
--     asterisk$subexpression$1 →  ● %ASTERISK
--     asterisk →  ● asterisk$subexpression$1
--     andless_expression$subexpression$1 →  ● asterisk
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A BETWEEN token based on:
--     between_predicate →  ● %BETWEEN _ andless_expression_chain _ %AND _ andless_expression
--     asteriskless_andless_expression$subexpression$1 →  ● between_predicate
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A CASE token based on:
--     case_expression →  ● %CASE _ case_expression$ebnf$1 case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A ARRAY_IDENTIFIER token based on:
--     array_subscript →  ● %ARRAY_IDENTIFIER _ square_brackets
--     atomic_expression$subexpression$1 →  ● array_subscript
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A ARRAY_KEYWORD token based on:
--     array_subscript →  ● %ARRAY_KEYWORD _ square_brackets
--     atomic_expression$subexpression$1 →  ● array_subscript
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A RESERVED_FUNCTION_NAME token based on:
--     function_call →  ● %RESERVED_FUNCTION_NAME _ parenthesis
--     atomic_expression$subexpression$1 →  ● function_call
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A "(" based on:
--     parenthesis →  ● "(" expressions_or_clauses ")"
--     atomic_expression$subexpression$1 →  ● parenthesis
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A "{" based on:
--     curly_braces →  ● "{" curly_braces$ebnf$1 "}"
--     atomic_expression$subexpression$1 →  ● curly_braces
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A "[" based on:
--     square_brackets →  ● "[" square_brackets$ebnf$1 "]"
--     atomic_expression$subexpression$1 →  ● square_brackets
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A RESERVED_PARAMETERIZED_DATA_TYPE token based on:
--     data_type →  ● %RESERVED_PARAMETERIZED_DATA_TYPE _ parenthesis
--     atomic_expression$subexpression$1 →  ● data_type
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A OPERATOR token based on:
--     operator$subexpression$1 →  ● %OPERATOR
--     operator →  ● operator$subexpression$1
--     atomic_expression$subexpression$1 →  ● operator
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A IDENTIFIER token based on:
--     identifier$subexpression$1 →  ● %IDENTIFIER
--     identifier →  ● identifier$subexpression$1
--     atomic_expression$subexpression$1 →  ● identifier
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A QUOTED_IDENTIFIER token based on:
--     identifier$subexpression$1 →  ● %QUOTED_IDENTIFIER
--     identifier →  ● identifier$subexpression$1
--     atomic_expression$subexpression$1 →  ● identifier
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A VARIABLE token based on:
--     identifier$subexpression$1 →  ● %VARIABLE
--     identifier →  ● identifier$subexpression$1
--     atomic_expression$subexpression$1 →  ● identifier
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A NAMED_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %NAMED_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     atomic_expression$subexpression$1 →  ● parameter
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A QUOTED_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %QUOTED_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     atomic_expression$subexpression$1 →  ● parameter
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A NUMBERED_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %NUMBERED_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     atomic_expression$subexpression$1 →  ● parameter
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A POSITIONAL_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %POSITIONAL_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     atomic_expression$subexpression$1 →  ● parameter
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A CUSTOM_PARAMETER token based on:
--     parameter$subexpression$1 →  ● %CUSTOM_PARAMETER
--     parameter →  ● parameter$subexpression$1
--     atomic_expression$subexpression$1 →  ● parameter
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A NUMBER token based on:
--     literal$subexpression$1 →  ● %NUMBER
--     literal →  ● literal$subexpression$1
--     atomic_expression$subexpression$1 →  ● literal
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A STRING token based on:
--     literal$subexpression$1 →  ● %STRING
--     literal →  ● literal$subexpression$1
--     atomic_expression$subexpression$1 →  ● literal
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A RESERVED_DATA_TYPE token based on:
--     data_type$subexpression$1 →  ● %RESERVED_DATA_TYPE
--     data_type →  ● data_type$subexpression$1
--     atomic_expression$subexpression$1 →  ● data_type
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A RESERVED_DATA_TYPE_PHRASE token based on:
--     data_type$subexpression$1 →  ● %RESERVED_DATA_TYPE_PHRASE
--     data_type →  ● data_type$subexpression$1
--     atomic_expression$subexpression$1 →  ● data_type
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A RESERVED_KEYWORD token based on:
--     keyword$subexpression$1 →  ● %RESERVED_KEYWORD
--     keyword →  ● keyword$subexpression$1
--     atomic_expression$subexpression$1 →  ● keyword
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A RESERVED_KEYWORD_PHRASE token based on:
--     keyword$subexpression$1 →  ● %RESERVED_KEYWORD_PHRASE
--     keyword →  ● keyword$subexpression$1
--     atomic_expression$subexpression$1 →  ● keyword
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- A RESERVED_JOIN token based on:
--     keyword$subexpression$1 →  ● %RESERVED_JOIN
--     keyword →  ● keyword$subexpression$1
--     atomic_expression$subexpression$1 →  ● keyword
--     atomic_expression →  ● atomic_expression$subexpression$1
--     asteriskless_andless_expression$subexpression$1 →  ● atomic_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     andless_expression$subexpression$1 →  ● asteriskless_andless_expression
--     andless_expression →  ● andless_expression$subexpression$1
--     expression$subexpression$1 →  ● andless_expression
--     expression →  ● expression$subexpression$1
--     expression_with_comments_ →  ● expression _
--     expression_chain_$ebnf$1 →  ● expression_with_comments_
--     expression_chain_ →  ● expression_chain_$ebnf$1
--     case_clause → %WHEN _ expression_chain_ %THEN _ ● expression_chain_
--     case_expression$ebnf$2 → case_expression$ebnf$2 ● case_clause
--     case_expression → %CASE _ case_expression$ebnf$1 ● case_expression$ebnf$2 %END
--     asteriskless_andless_expression$subexpression$1 →  ● case_expression
--     asteriskless_andless_expression →  ● asteriskless_andless_expression$subexpression$1
--     asteriskless_free_form_sql$subexpression$1 →  ● asteriskless_andless_expression
--     asteriskless_free_form_sql →  ● asteriskless_free_form_sql$subexpression$1
--     free_form_sql$subexpression$1 →  ● asteriskless_free_form_sql
--     free_form_sql →  ● free_form_sql$subexpression$1
--     expressions_or_clauses$ebnf$1 → expressions_or_clauses$ebnf$1 ● free_form_sql
--     expressions_or_clauses →  ● expressions_or_clauses$ebnf$1 expressions_or_clauses$ebnf$2
--     statement →  ● expressions_or_clauses statement$subexpression$1
--     main$ebnf$1 → main$ebnf$1 ● statement
--     main →  ● main$ebnf$1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / declare.test: formats basic DECLARE statement
-- input:
DECLARE x
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / declare.test: formats DECLARE with type
-- input:
DECLARE x INT64
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / declare.test: formats declaring of multiple variables
-- input:
DECLARE foo, bar, baz INT64
-- output:
DECLARE foo,
bar,
baz INT64
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / declare.test: formats DEFAULT
-- input:
DECLARE d DATE DEFAULT CURRENT_DATE()
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / if.test: formats ELSE
-- input:
IF x > 10 THEN
  SELECT 1;
ELSE
  SELECT 2;
END IF
-- output:
IF x > 10 THEN
SELECT
  1;

ELSE
SELECT
  2;

END IF
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
IF x > 10 THEN
SELECT
  1;

ELSEIF x > 1 THEN
SELECT
  2;

ELSEIF x < 1 THEN
SELECT
  3;

ELSE
SELECT
  4;

END IF
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
IF TRUE THEN
SELECT
  1;

ELSEIF EXISTS (
  SELECT
    1
  FROM
    schema.products
  WHERE
    product_id = target_product_id
)
AND target_product_id IS NOT NULL THEN
SELECT
  2;

END IF
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / if.test: formats IF .. THEN .. END IF
-- input:
IF x > 10 THEN
  SELECT 1;
END IF
-- output:
IF x > 10 THEN
SELECT
  1;

END IF
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
IF EXISTS (
  SELECT
    1
  FROM
    schema.products
  WHERE
    product_id = target_product_id
)
AND target_product_id IS NOT NULL THEN
SELECT
  1;

END IF
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / if.test: formats IF with multiple statements inside
-- input:
IF x > 10 THEN
  SELECT 1;
  SELECT 2;
  SELECT 3;
END IF
-- output:
IF x > 10 THEN
SELECT
  1;

SELECT
  2;

SELECT
  3;

END IF
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
LOOP IF TRUE THEN
BREAK;

ELSE
CONTINUE;

END IF;

END
LOOP
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / loops.test: formats end labels
-- input:
outer_loop: REPEAT
  inner_loop: LOOP
    CONTINUE outer_loop;
  END LOOP inner_loop;
UNTIL TRUE END REPEAT outer_loop
-- error:
-- Error: Parse error: Unexpected ": REPEAT
--  " at line 1 column 11.
-- SQL dialect used: "bigquery".
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / loops.test: formats FOR .. IN
-- input:
FOR record IN (SELECT * FROM tbl) DO
  SELECT record.foo, record.bar;
END FOR
-- output:
FOR record IN (
  SELECT
    *
  FROM
    tbl
) DO
SELECT
  record.foo,
  record.bar;

END
FOR
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / loops.test: formats labels
-- input:
outer_loop: LOOP
  inner_loop: LOOP
    BREAK outer_loop;
  END LOOP;
END LOOP
-- error:
-- Error: Parse error: Unexpected ": LOOP
--   i" at line 1 column 11.
-- SQL dialect used: "bigquery".
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / loops.test: formats LOOP
-- input:
LOOP
  SELECT 1;
END LOOP
-- output:
LOOP
SELECT
  1;

END
LOOP
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / loops.test: formats REPEAT
-- input:
REPEAT
  SET x = x + 1;
UNTIL x > 10 END REPEAT
-- output:
REPEAT
SET
  x = x + 1;

UNTIL x > 10 END
REPEAT
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / loops.test: formats WHILE
-- input:
WHILE x < 10 DO
  SET x = x + 1;
END WHILE
-- output:
WHILE x < 10 DO
SET
  x = x + 1;

END
WHILE
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / prepared_statements.test: formats EXECUTE IMMEDIATE
-- input:
EXECUTE IMMEDIATE 'SELECT * FROM tbl'
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / prepared_statements.test: formats EXECUTE IMMEDIATE with INTO and USING
-- input:
EXECUTE IMMEDIATE 'SELECT ? + ?'
INTO sum
USING 1, 2
-- output:
EXECUTE IMMEDIATE 'SELECT ? + ?' INTO sum USING 1,
2
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / prepared_statements.test: formats EXECUTE IMMEDIATE with long query
-- input:
EXECUTE IMMEDIATE
  'SELECT count(*) FROM myschema.mytable WHERE operations > 10 AND name IS NOT NULL'
INTO cnt
-- output:
EXECUTE IMMEDIATE 'SELECT count(*) FROM myschema.mytable WHERE operations > 10 AND name IS NOT NULL' INTO cnt
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / raise.test: formats RAISE statement
-- input:
RAISE
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / raise.test: formats RAISE with message
-- input:
RAISE USING MESSAGE = 'Serious error!'
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / return.test: formats RETURN statement
-- input:
RETURN
-- output: <unchanged>
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / set.test: formats basic SET statement
-- input:
SET x = 1
-- output:
SET
  x = 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / set.test: formats long SET expressions
-- input:
SET (first_variable, second_variable) = (
  FORMAT('%d', word_count),
  FORMAT('%d', line_count)
)
-- output:
SET
  (first_variable, second_variable) = (
    FORMAT('%d', word_count),
    FORMAT('%d', line_count)
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
SET
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
SET
  (x, y, z) = (1, 2, 3)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats FOR SYSTEM_TIME AS OF
-- input:
SELECT *
FROM tbl FOR SYSTEM_TIME AS OF '2017-01-01 10:00:00-07:00'
-- output:
SELECT
  *
FROM
  tbl
FOR SYSTEM_TIME AS OF
  '2017-01-01 10:00:00-07:00'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats long FOR SYSTEM_TIME AS OF to multiple lines
-- input:
SELECT *
FROM
  my_favorite_table AS fancy_table_name
  FOR SYSTEM_TIME AS OF '2017-01-01 10:00:00-07:00'
-- output:
SELECT
  *
FROM
  my_favorite_table AS fancy_table_name
FOR SYSTEM_TIME AS OF
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
SELECT
  *
FROM
  Produce PIVOT(
    SUM(sales) AS total_sales,
    COUNT(*) AS num_records
    FOR quarter IN ('Q1', 'Q2')
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
SELECT
  *
FROM
  Produce UNPIVOT INCLUDE NULLS (
    (first_half_sales, second_half_sales)
    FOR semesters IN (
      (Q1, Q2) AS 'semester_1',
      (Q3, Q4) AS 'semester_2'
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
SELECT
  *
FROM
  Produce PIVOT(
    SUM(sales)
    FOR quarter IN ('Q1', 'Q2', 'Q3', 'Q4')
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats TABLESPAMPLE operator
-- input:
SELECT * FROM dataset.my_table TABLESAMPLE SYSTEM (10 PERCENT)
-- output:
SELECT
  *
FROM
  dataset.my_table TABLESAMPLE SYSTEM (10 PERCENT)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats TABLESPAMPLE operator to multiple lines
-- input:
SELECT *
FROM
  myLongProjectName.myCustomDatasetName.my_table_name
  TABLESAMPLE SYSTEM (10 PERCENT)
-- output:
SELECT
  *
FROM
  myLongProjectName.myCustomDatasetName.my_table_name TABLESAMPLE SYSTEM (10 PERCENT)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats UNNEST()
-- input:
SELECT *
FROM UNNEST([10, 20, 30]) AS numbers WITH OFFSET
-- output:
SELECT
  *
FROM
  UNNEST ([10, 20, 30]) AS numbers
WITH
OFFSET
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats UNPIVOT()
-- input:
SELECT *
FROM
  Produce
  UNPIVOT(sales FOR quarter IN (Q1, Q2, Q3, Q4))
-- output:
SELECT
  *
FROM
  Produce UNPIVOT(
    sales
    FOR quarter IN (Q1, Q2, Q3, Q4)
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats GROUP BY ALL
-- input:
SELECT * FROM tbl GROUP BY ALL
-- output:
SELECT
  *
FROM
  tbl
GROUP BY
  ALL
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats GROUP BY ROLLUP()
-- input:
SELECT * FROM tbl GROUP BY ROLLUP(a, b, c)
-- output:
SELECT
  *
FROM
  tbl
GROUP BY
  ROLLUP (a, b, c)
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
SELECT
  *
FROM
  my_table_name
GROUP BY
  ROLLUP (
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
SELECT
  *
FROM
  my_table_name
QUALIFY
  my_table_name.some_long_column_name > my_table_name.some_long_column_name2
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats QUALIFY clause
-- input:
SELECT * FROM tbl QUALIFY x > 10
-- output:
SELECT
  *
FROM
  tbl
QUALIFY
  x > 10
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats SELECT * EXCEPT
-- input:
SELECT * EXCEPT (order_id) FROM orders
-- output:
SELECT
  * EXCEPT (order_id)
FROM
  orders
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats SELECT * REPLACE
-- input:
SELECT * REPLACE (order_id AS id) FROM orders
-- output:
SELECT
  * REPLACE(order_id AS id)
FROM
  orders
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats SELECT AS STRUCT
-- input:
SELECT AS STRUCT 1 AS a, 2 AS b
-- output:
SELECT AS STRUCT
  1 AS a,
  2 AS b
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats SELECT AS VALUE
-- input:
SELECT AS VALUE foo()
-- output:
SELECT AS VALUE
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
SELECT
  'something long',
  'something even longer',
  'another thing that is extra long',
  'and then something even more grandiose', -- comment
FROM
  my_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: removes trailing commas from SELECT
-- input:
SELECT 1, 2, 3,
-- output:
SELECT
  1,
  2,
  3,
-- #endregion
