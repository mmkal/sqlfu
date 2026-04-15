-- default config: {"dialect":"postgresql"}

-- #region: prettier-plugin-sql-cst / test / canonical_syntax.test: converts old PostgreSQL := syntax to standard => syntax for named arguments
-- input:
SELECT my_func(foo := 'Hello', bar := 'World')
-- output:
select my_func (foo := 'Hello', bar := 'World')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / alter_default_privileges.test: format short FOR ROLE clause on single line
-- input:
ALTER DEFAULT PRIVILEGES FOR ROLE admin GRANT SELECT ON TYPES TO abc
-- output:
alter default privileges for role admin
grant
select on types to abc
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / alter_default_privileges.test: formats even longer REVOKE to even more lines
-- input:
ALTER DEFAULT PRIVILEGES
REVOKE GRANT OPTION FOR
  SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, MAINTAIN
  ON TABLES
FROM johnny_monny, alice_malice, sigmund_freud, elvis_presley CASCADE
-- output:
alter default privileges
revoke
grant option for
select
,
  insert,
update,
delete,
truncate,
references,
maintain on tables
from johnny_monny, alice_malice, sigmund_freud, elvis_presley cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / alter_default_privileges.test: formats long clauses to multiple lines
-- input:
ALTER DEFAULT PRIVILEGES
FOR ROLE admin, moderator
IN SCHEMA magic, mushroom, shower
GRANT DELETE, TRUNCATE ON TABLES TO johnny
-- output:
alter default privileges for role admin,
moderator in schema magic,
mushroom,
shower
grant delete,
truncate on tables to johnny
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / alter_default_privileges.test: formats long GRANT to multiple lines
-- input:
ALTER DEFAULT PRIVILEGES
GRANT DELETE, TRUNCATE, REFERENCES, MAINTAIN ON TABLES
TO johnny WITH GRANT OPTION
-- output:
alter default privileges
grant delete,
truncate,
references,
maintain on tables to johnny
with
grant option
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / alter_default_privileges.test: formats long REVOKE to multiple lines
-- input:
ALTER DEFAULT PRIVILEGES
REVOKE GRANT OPTION FOR DELETE, TRUNCATE, REFERENCES, MAINTAIN ON TABLES
FROM johnny CASCADE
-- output:
alter default privileges
revoke
grant option for delete,
truncate,
references,
maintain on tables
from johnny cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / alter_default_privileges.test: formats short ALTER DEFAULT PRIVILEGES to multiple lines when original code is multiline
-- input:
ALTER DEFAULT PRIVILEGES
REVOKE ALL ON TABLES FROM PUBLIC
-- output:
alter default privileges
revoke all on tables
from public
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / alter_default_privileges.test: formats short GRANT on single line
-- input:
ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO john
-- output:
alter default privileges
grant all on tables to john
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / alter_default_privileges.test: formats short IN SCHEMA clause in single line
-- input:
ALTER DEFAULT PRIVILEGES IN SCHEMA foo GRANT SELECT ON TYPES TO abc
-- output:
alter default privileges in schema foo
grant
select on types to abc
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / alter_default_privileges.test: formats short REVOKE on single line
-- input:
ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM john
-- output:
alter default privileges
revoke all on tables
from john
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats ALL PRIVILEGES
-- input:
GRANT ALL ON tbl TO john
-- output:
grant all on tbl to john
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats ALL PRIVILEGES
-- input:
GRANT ALL PRIVILEGES ON tbl TO john
-- output:
grant all privileges on tbl to john
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats ALL PRIVILEGES on specific columns
-- input:
GRANT ALL PRIVILEGES (foo, bar, baz) ON tbl TO john
-- output:
grant all privileges (foo, bar, baz) on tbl to john
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats basic statement
-- input:
GRANT moderator TO john
-- output:
grant moderator to john
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats extra clauses
-- input:
GRANT moderator TO john
WITH ADMIN OPTION
GRANTED BY alice
-- output:
grant moderator to john
with
  admin option granted by alice
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats extra long lists of roles
-- input:
GRANT
  moderator,
  administrator,
  accelerator,
  composer,
  director,
  editor,
  generator
TO
  john_doe_of_london,
  mary_jane_from_singapure,
  alice_malice_from_paris_suburbs
-- output:
grant moderator,
administrator,
accelerator,
composer,
director,
editor,
generator to john_doe_of_london,
mary_jane_from_singapure,
alice_malice_from_paris_suburbs
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats GRANTED BY clause
-- input:
GRANT SELECT ON tbl TO john GRANTED BY CURRENT_USER
-- output:
grant
select on tbl to john granted by current_user
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats long GRANT to multiple lines
-- input:
GRANT SELECT
ON tbl
TO john
GRANTED BY john_doe
WITH GRANT OPTION
-- output:
grant
select on tbl to john granted by john_doe
with
grant option
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats long lists of roles
-- input:
GRANT moderator, administrator, accelerator, composer
TO john_doe, mary_jane, alice_malice
-- output:
grant moderator,
administrator,
accelerator,
composer to john_doe,
mary_jane,
alice_malice
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats multiple roles
-- input:
GRANT moderator, administrator TO john, mary, alice
-- output:
grant moderator,
administrator to john,
mary,
alice
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats privilege limited to specific columns
-- input:
GRANT UPDATE (foo, bar, baz) ON tbl TO john
-- output:
grant
update (foo, bar, baz) on tbl to john
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats short GRANT in single line
-- input:
GRANT SELECT ON schm.my_table TO john_doe
-- output:
grant
select on schm.my_table to john_doe
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / grant.test: formats WITH GRANT OPTION clause
-- input:
GRANT SELECT ON tbl TO john WITH GRANT OPTION
-- output:
grant
select on tbl to john
with
grant option
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / revoke.test: formats ... OPTION FOR
-- input:
REVOKE ADMIN OPTION FOR moderator FROM john
RESTRICT
-- output:
revoke admin option for moderator
from john restrict
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / revoke.test: formats basic statement
-- input:
REVOKE moderator FROM john
-- output:
revoke moderator
from john
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / revoke.test: formats extra clauses
-- input:
REVOKE moderator FROM john
GRANTED BY alice
CASCADE
-- output:
revoke moderator
from john granted by alice cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / revoke.test: formats extra long lists of roles
-- input:
REVOKE
  moderator,
  administrator,
  accelerator,
  composer,
  director,
  editor,
  generator
FROM
  john_doe_of_london,
  mary_jane_from_singapure,
  alice_malice_from_paris_suburbs
-- output:
revoke moderator,
administrator,
accelerator,
composer,
director,
editor,
generator
from
  john_doe_of_london,
  mary_jane_from_singapure,
  alice_malice_from_paris_suburbs
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / revoke.test: formats GRANT OPTION FOR clause
-- input:
REVOKE GRANT OPTION FOR INSERT ON tbl FROM john
-- output:
revoke
grant option for insert on tbl
from john
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / revoke.test: formats GRANTED BY clause
-- input:
REVOKE SELECT ON tbl FROM john GRANTED BY johnny
-- output:
revoke
select on tbl
from john granted by johnny
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / revoke.test: formats long lists of roles
-- input:
REVOKE moderator, administrator, accelerator, composer
FROM john_doe, mary_jane, alice_malice
-- output:
revoke moderator,
administrator,
accelerator,
composer
from john_doe, mary_jane, alice_malice
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / revoke.test: formats long REVOKE to multiple lines
-- input:
REVOKE GRANT OPTION FOR SELECT
ON tbl1, tbl2
FROM john, alice, mary
GRANTED BY john_doe
RESTRICT
-- output:
revoke
grant option for
select on tbl1, tbl2
from john, alice, mary granted by john_doe restrict
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / revoke.test: formats multiple roles
-- input:
REVOKE moderator, administrator FROM john, mary, alice
-- output:
revoke moderator,
administrator
from john, mary, alice
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / revoke.test: formats RESTRICT/CASCADE
-- input:
REVOKE SELECT ON tbl FROM john CASCADE
-- output:
revoke
select on tbl
from john cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / revoke.test: formats short REVOKE in single line
-- input:
REVOKE SELECT ON schm.my_table FROM john_doe
-- output:
revoke
select on schm.my_table
from john_doe
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats ALTER GROUP .. ADD USER
-- input:
ALTER GROUP director ADD USER john, jane, jimmy
-- output:
alter group director
add user john,
jane,
jimmy
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats ALTER GROUP .. DROP USER
-- input:
ALTER GROUP director DROP USER alice, bob
-- output:
alter group director
drop user alice,
bob
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats ALTER ROLE .. IN DATABASE db {RESET | SET}
-- input:
ALTER ROLE john IN DATABASE my_db RESET ALL
-- output:
alter role john in database my_db
reset all
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats ALTER ROLE .. IN DATABASE db {RESET | SET}
-- input:
ALTER ROLE john IN DATABASE my_db SET search_path TO myschema
-- output:
alter role john in database my_db
set
  search_path to myschema
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats ALTER ROLE .. options
-- input:
ALTER ROLE john LOGIN CREATEDB CONNECTION LIMIT 15
-- output:
alter role john login createdb connection
limit 15
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats ALTER ROLE .. RENAME TO
-- input:
ALTER ROLE john RENAME TO johnny
-- output:
alter role john
rename to johnny
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats ALTER ROLE .. RESET option
-- input:
ALTER ROLE john RESET ALL
-- output:
alter role john
reset all
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats ALTER ROLE .. RESET option
-- input:
ALTER ROLE john RESET search_path
-- output:
alter role john
reset search_path
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats ALTER ROLE .. SET option FROM CURRENT
-- input:
ALTER ROLE john SET search_path FROM CURRENT
-- output:
alter role john
set
  search_path
from current
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats ALTER ROLE .. SET option TO value
-- input:
ALTER ROLE john SET search_path = DEFAULT
-- output:
alter role john
set
  search_path = default
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats ALTER ROLE .. SET option TO value
-- input:
ALTER ROLE john SET search_path TO myschema
-- output:
alter role john
set
  search_path to myschema
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats ALTER ROLE .. WITH options
-- input:
ALTER ROLE john WITH LOGIN CREATEDB CONNECTION LIMIT 15
-- output:
alter role john
with
  login createdb connection
limit 15
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats ALTER ROLE on multiple lines if user prefers
-- input:
ALTER ROLE john
WITH LOGIN CREATEDB CONNECTION LIMIT 15
-- output:
alter role john
with
  login createdb connection
limit 15
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats basic CREATE ROLE
-- input:
CREATE ROLE john
-- output:
create role john
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats basic DROP ROLE
-- input:
DROP ROLE john
-- output:
drop role john
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats DROP ROLE IF EXISTS
-- input:
DROP ROLE IF EXISTS john
-- output:
drop role if exists john
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats DROP ROLE with multiple roles
-- input:
DROP ROLE role1, role2
-- output:
drop role role1,
role2
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats long list of options
-- input:
CREATE ROLE john WITH
  SUPERUSER
  INHERIT
  LOGIN
  CREATEDB
  CONNECTION LIMIT 15
  ENCRYPTED PASSWORD 'mypass'
  VALID UNTIL '2021-01-01'
  IN ROLE role1, role2
  ROLE role3, role4
  ADMIN role5, role6
  SYSID 123
-- output:
create role john
with
  superuser inherit login createdb connection
limit
  15 encrypted password 'mypass' valid until '2021-01-01' in role role1, role2 role role3,
  role4 admin role5,
  role6 sysid 123
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats long list of options to multiple lines
-- input:
ALTER ROLE john
  LOGIN
  CREATEDB
  ADMIN role1, role2
  CONNECTION LIMIT 15
  ENCRYPTED PASSWORD 'mypass'
-- output:
alter role john login createdb admin role1,
role2 connection
limit 15 encrypted password 'mypass'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats long list of WITH options to multiple lines
-- input:
ALTER ROLE john
WITH
  LOGIN
  CREATEDB
  ADMIN role1, role2
  CONNECTION LIMIT 15
  ENCRYPTED PASSWORD 'mypass'
-- output:
alter role john
with
  login createdb admin role1,
  role2 connection
limit 15 encrypted password 'mypass'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats options (without WITH)
-- input:
CREATE ROLE john SUPERUSER INHERIT LOGIN
-- output:
create role john superuser inherit login
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats RESET ROLE
-- input:
RESET ROLE
-- output:
reset role
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats SET ROLE
-- input:
SET LOCAL ROLE NONE
-- output:
set
  local role none
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats SET ROLE
-- input:
SET ROLE moderator
-- output:
set role moderator
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats SET ROLE
-- input:
SET SESSION ROLE moderator
-- output:
set
  session role moderator
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats shorter list of options to multiple lines when preferred
-- input:
CREATE ROLE john WITH
  SUPERUSER
  INHERIT
  LOGIN
-- output:
create role john
with
  superuser inherit login
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dcl / role.test: formats WITH options
-- input:
CREATE ROLE john WITH SUPERUSER INHERIT LOGIN
-- output:
create role john
with
  superuser inherit login
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ADD CONSTRAINT
-- input:
ALTER TABLE client
ADD CONSTRAINT price_positive CHECK (price > 0) NOT VALID
-- output:
alter table client
add constraint price_positive check (price > 0) not valid
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ADD PRIMARY KEY
-- input:
ALTER TABLE client
ADD PRIMARY KEY (price)
-- output:
alter table client
add primary key (price)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ADD UNIQUE
-- input:
ALTER TABLE client
ADD UNIQUE USING INDEX price_unique
-- output:
alter table client
add unique using index price_unique
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER COLUMN .. ADD GENERATED with (sequence options)
-- input:
ALTER TABLE client
ALTER COLUMN price
ADD GENERATED ALWAYS AS IDENTITY (START WITH 1 INCREMENT BY 1)
-- output:
alter table client
alter column price
add generated always as identity (
  start
  with
    1 increment by 1
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER COLUMN .. ADD GENERATED with long (sequence options list)
-- input:
ALTER TABLE client
ALTER COLUMN price
ADD GENERATED ALWAYS AS IDENTITY (
  START WITH 1
  INCREMENT BY 1
  MINVALUE -1000
  MAXVALUE 1000
  NO CYCLE
)
-- output:
alter table client
alter column price
add generated always as identity (
  start
  with
    1 increment by 1 minvalue -1000 maxvalue 1000 no cycle
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER COLUMN .. SET DATA TYPE
-- input:
ALTER TABLE client
ALTER COLUMN price
TYPE INT COLLATE "en_US" USING price > 0
-- output:
alter table client
alter column price type int collate "en_US" using price > 0
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER CONSTRAINT
-- input:
ALTER TABLE client
ALTER CONSTRAINT price_positive DEFERRABLE INITIALLY DEFERRED
-- output:
alter table client
alter constraint price_positive deferrable initially deferred
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE ALL IN TABLESPACE
-- input:
ALTER TABLE ALL IN TABLESPACE my_tablespace
SET TABLESPACE new_tablespace
-- output:
alter table all in tablespace my_tablespace
set
  tablespace new_tablespace
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE ALL IN TABLESPACE..OWNED BY
-- input:
ALTER TABLE ALL IN TABLESPACE my_tablespace OWNED BY
  john_doe_the_second,
  CURRENT_USER
SET TABLESPACE new_tablespace NOWAIT
-- output:
alter table all in tablespace my_tablespace owned by john_doe_the_second,
current_user
set
  tablespace new_tablespace nowait
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE ALL IN TABLESPACE..OWNED BY
-- input:
ALTER TABLE ALL IN TABLESPACE my_ts OWNED BY user1, user2
SET TABLESPACE new_ts
-- output:
alter table all in tablespace my_ts owned by user1,
user2
set
  tablespace new_ts
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE with [NO] FORCE actions
-- input:
ALTER TABLE client
FORCE ROW LEVEL SECURITY,
NO FORCE ROW LEVEL SECURITY
-- output:
alter table client force row level security,
no force row level security
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE with clustering actions
-- input:
ALTER TABLE client
CLUSTER ON index_name,
SET WITHOUT CLUSTER
-- output:
alter table client
cluster on index_name,
set
  without
cluster
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE with ENABLE/DISABLE actions
-- input:
ALTER TABLE client
DISABLE TRIGGER ALL,
ENABLE TRIGGER my_trigger,
ENABLE REPLICA TRIGGER trigger2,
ENABLE ALWAYS TRIGGER trigger3,
ENABLE REPLICA RULE my_rule,
DISABLE RULE r2,
DISABLE ROW LEVEL SECURITY,
ENABLE ROW LEVEL SECURITY
-- output:
alter table client disable trigger all,
enable trigger my_trigger,
enable replica trigger trigger2,
enable always trigger trigger3,
enable replica rule my_rule,
disable rule r2,
disable row level security,
enable row level security
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE with inheritance actions
-- input:
ALTER TABLE client
INHERIT parent_table,
NO INHERIT grandparent_table
-- output:
alter table client inherit parent_table,
no inherit grandparent_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE with logging actions
-- input:
ALTER TABLE client
SET LOGGED,
SET UNLOGGED
-- output:
alter table client
set
  logged,
set
  unlogged
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE with OF type actions
-- input:
ALTER TABLE client
OF new_type,
NOT OF
-- output:
alter table client of new_type,
not of
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE with PostgreSQL alter-actions
-- input:
ALTER TABLE client
SET SCHEMA new_schema,
SET TABLESPACE new_tablespace NOWAIT,
SET WITHOUT OIDS,
SET ACCESS METHOD heap,
OWNER TO new_owner,
OWNER TO CURRENT_USER,
REPLICA IDENTITY DEFAULT,
REPLICA IDENTITY USING INDEX index_name
-- output:
alter table client
set schema new_schema,
set
  tablespace new_tablespace nowait,
set
  without oids,
set
  access method heap,
  owner to new_owner,
  owner to current_user,
  replica identity default,
  replica identity using index index_name
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE with SET/RESET (long storage parameters list)
-- input:
ALTER TABLE client
SET (
  fillfactor = 70,
  autovacuum_enabled,
  toast.autovacuum_enabled,
  max_rows = 100,
  visibility_map
),
RESET (
  toast.autovacuum_enabled,
  max_rows,
  autovacuum_enabled,
  fillfactor,
  parallel_workers
)
-- output:
alter table client
set
  (
    fillfactor = 70,
    autovacuum_enabled,
    toast.autovacuum_enabled,
    max_rows = 100,
    visibility_map
  ),
reset (
  toast.autovacuum_enabled,
  max_rows,
  autovacuum_enabled,
  fillfactor,
  parallel_workers
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE with SET/RESET (storage parameters)
-- input:
ALTER TABLE client
SET (fillfactor = 70, autovacuum_enabled),
RESET (toast.autovacuum_enabled, max_rows)
-- output:
alter table client
set
  (fillfactor = 70, autovacuum_enabled),
reset (toast.autovacuum_enabled, max_rows)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats ALTER TABLE..ADD COLUMN with constraints
-- input:
ALTER TABLE client
ADD COLUMN col1 INT COLLATE "en_US" NOT NULL
-- output:
alter table client
add column col1 int collate "en_US" not null
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats DROP CONSTRAINT
-- input:
ALTER TABLE client
DROP CONSTRAINT IF EXISTS price_positive CASCADE
-- output:
alter table client
drop constraint if exists price_positive cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats DROP CONSTRAINT
-- input:
ALTER TABLE client
DROP CONSTRAINT price_positive
-- output:
alter table client
drop constraint price_positive
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats identity altering actions
-- input:
ALTER TABLE client
ALTER COLUMN price
SET GENERATED ALWAYS RESTART WITH 100 SET MAXVALUE 1000
-- output:
alter table client
alter column price
set
  generated always restart
with
  100
set
  maxvalue 1000
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats long ADD CONSTRAINT
-- input:
ALTER TABLE client
ADD CONSTRAINT price_is_valid
  CHECK (client.price > 0 OR client.type = 'special')
-- output:
alter table client
add constraint price_is_valid check (
  client.price > 0
  or client.type = 'special'
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats lots of identity altering actions
-- input:
ALTER TABLE client
ALTER COLUMN price
SET GENERATED ALWAYS
RESTART WITH 100
SET MAXVALUE 1000
SET MINVALUE 0
SET NO CYCLE
-- output:
alter table client
alter column price
set
  generated always restart
with
  100
set
  maxvalue 1000
set
  minvalue 0
set
  no cycle
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats RENAME CONSTRAINT
-- input:
ALTER TABLE client
RENAME CONSTRAINT price_positive1 TO price_positive2
-- output:
alter table client
rename constraint price_positive1 to price_positive2
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / alter_table.test: formats VALIDATE CONSTRAINT
-- input:
ALTER TABLE client
VALIDATE CONSTRAINT price_positive
-- output:
alter table client validate constraint price_positive
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats additional PostgeSQL CREATE TABLE clauses
-- input:
CREATE TABLE client (
  id INT
)
INHERITS (parent_table1, parent_table2)
PARTITION BY LIST (id, name my_opclass)
USING "SP-GiST"
TABLESPACE pg_default
WITH (fillfactor = 70, autovacuum_enabled)
WITHOUT OIDS
ON COMMIT DELETE ROWS
-- output:
create table client (id int) inherits (parent_table1, parent_table2)
partition by
  list (id, name my_opclass) using "SP-GiST" tablespace pg_default
with
  (fillfactor = 70, autovacuum_enabled) without oids on
commit delete rows
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats constraints with index-parameter clauses
-- input:
CREATE TABLE client (
  id INT,
  PRIMARY KEY (id) INCLUDE (name),
  UNIQUE (id) USING INDEX TABLESPACE pg_default,
  EXCLUDE
    (id WITH =)
    WITH (fillfactor = 70, autovacuum_enabled)
    USING INDEX TABLESPACE pg_default
    WHERE (id > 0)
)
-- output:
create table client (
  id int,
  primary key (id) include (name),
  unique (id) using index tablespace pg_default,
  exclude (
    id
    with
      =
  )
  with
    (fillfactor = 70, autovacuum_enabled) using index tablespace pg_default
  where
    (id > 0)
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE GLOBAL TEMPORARY TABLE
-- input:
CREATE GLOBAL TEMPORARY TABLE foo (
  id INT
)
-- output:
create global temporary table foo (id int)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE TABLE AS with additional clauses
-- input:
CREATE TABLE foo
AS
  SELECT * FROM tbl WHERE x > 0
WITH NO DATA
-- output:
create table foo as
select *
from tbl
where x > 0
with
  no data
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats CREATE TABLE LIKE inside parenthesis
-- input:
CREATE TABLE foo (
  LIKE my_old_table INCLUDING COMMENTS EXCLUDING CONSTRAINTS
)
-- output:
create table foo (
  like my_old_table including comments excluding constraints
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats EXCLUDE constraint
-- input:
CREATE TABLE client (
  id INT,
  EXCLUDE (id WITH =, name WITH <>) WHERE (id > 0)
)
-- output:
create table client (
  id int,
  exclude (
    id
    with
      =,
      name
    with
      <>
  )
  where
    (id > 0)
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats FOREIGN KEY constraint with actions that specify columns
-- input:
CREATE TABLE client (
  id INT,
  FOREIGN KEY (org_id1) REFERENCES organization (id1)
    ON DELETE SET NULL (id1, id2)
    ON UPDATE SET DEFAULT (id1, id2)
)
-- output:
create table client (
  id int,
  foreign key (org_id1) references organization (id1) on delete set null (id1, id2) on update set default (id1, id2)
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats INTERVAL data types
-- input:
CREATE TABLE client (
  foo INTERVAL DAY TO SECOND (2)
)
-- output:
create table client (foo interval day to second (2))
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats long EXCLUDE constraint
-- input:
CREATE TABLE client (
  id INT,
  EXCLUDE
    USING gist
    (id WITH =, name opClass DESC NULLS FIRST WITH <>)
    WHERE (id > 0)
)
-- output:
create table client (
  id int,
  exclude using gist (
    id
    with
      =,
      name opclass desc nulls first
    with
      <>
  )
  where
    (id > 0)
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats PostgreSQL array data types
-- input:
CREATE TABLE client (
  arr_field INT[],
  arr_field2 INT[10][10],
  arr_field3 INT[][]
)
-- output:
create table client (
  arr_field int[],
  arr_field2 int[10] [10],
  arr_field3 int[] []
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats PostgreSQL column constraints
-- input:
CREATE TABLE client (
  id INT GENERATED BY DEFAULT AS IDENTITY,
  fname VARCHAR(100) COMPRESSION PGLZ STORAGE EXTERNAL,
  lname VARCHAR(100) UNIQUE NULLS NOT DISTINCT,
  created_at DATE DEFAULT now()
)
-- output:
create table client (
  id int generated by default as identity,
  fname varchar(100) compression pglz storage external,
  lname varchar(100) unique nulls not distinct,
  created_at date default now()
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats PostgreSQL CREATE FOREIGN TABLE
-- input:
CREATE FOREIGN TABLE film (
  title TEXT,
  ryear INT OPTIONS (column_name 'release_year')
)
SERVER film_server
OPTIONS (format 'csv', delimiter ',', header 'true')
-- output:
create foreign table film (
  title text,
  ryear int options (column_name 'release_year')
) server film_server options (format 'csv', delimiter ',', header 'true')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats PostgreSQL CREATE TABLE ... OF type & WITH OPTIONS
-- input:
CREATE TABLE client OF client_type (
  id WITH OPTIONS NOT NULL PRIMARY KEY
)
-- output:
create table client of client_type (
  id
  with
    options not null primary key
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats PostgreSQL CREATE TABLE ... PARTITION OF
-- input:
CREATE TABLE client_new PARTITION OF client
FOR VALUES FROM (2023, MINVALUE) TO (2024, MAXVALUE)
-- output:
create table client_new partition of client for
values
from (2023, minvalue) to (2024, maxvalue)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats PostgreSQL CREATE TABLE ... PARTITION OF
-- input:
CREATE TABLE client_odd PARTITION OF client
FOR VALUES WITH (MODULUS 3, REMAINDER 1)
-- output:
create table client_odd partition of client for
values
with
  (modulus 3, remainder 1)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats PostgreSQL CREATE TABLE ... PARTITION OF
-- input:
CREATE TABLE client_odd PARTITION OF client DEFAULT
-- output:
create table client_odd partition of client default
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats PostgreSQL CREATE TABLE ... PARTITION OF
-- input:
CREATE TABLE client_old PARTITION OF client FOR VALUES IN (1999, 2000, 2001)
-- output:
create table client_old partition of client for
values
  in (1999, 2000, 2001)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats PostgreSQL GENERATED AS IDENTITY with sequence options
-- input:
CREATE TABLE client (
  id INT GENERATED ALWAYS AS IDENTITY (
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    MAXVALUE 1000
    CYCLE
  )
)
-- output:
create table client (
  id int generated always as identity (
    start
    with
      1 increment by 1 minvalue 1 maxvalue 1000 cycle
  )
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats PostgreSQL GENERATED AS IDENTITY with sequence options
-- input:
CREATE TABLE client (
  id INT GENERATED ALWAYS AS IDENTITY (START WITH 1)
)
-- output:
create table client (
  id int generated always as identity (
    start
    with
      1
  )
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats PostgreSQL SETOF data types
-- input:
CREATE TABLE client (
  foo SETOF INT,
  bar SETOF CHARACTER VARYING,
  baz SETOF MY_CUSTOM_TYPE
)
-- output:
create table client (
  foo setof int,
  bar setof character varying,
  baz setof my_custom_type
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / create_table.test: formats TIME/TIMESTAMP data types
-- input:
CREATE TABLE client (
  from_date TIME WITH TIME ZONE,
  to_date TIMESTAMP(5) WITHOUT TIME ZONE
)
-- output:
create table client (
  from_date time with time zone,
  to_date timestamp(5) without time zone
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / domain.test: formats ALTER DOMAIN
-- input:
ALTER DOMAIN my_domain SET DEFAULT 0
-- output:
alter domain my_domain
set default 0
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / domain.test: formats CREATE DOMAIN
-- input:
CREATE DOMAIN my_domain INT
-- output:
create domain my_domain int
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / domain.test: formats CREATE DOMAIN with AS
-- input:
CREATE DOMAIN my_domain AS VARCHAR(255)
-- output:
create domain my_domain as varchar(255)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / domain.test: formats CREATE DOMAIN with constraints
-- input:
CREATE DOMAIN my_domain VARCHAR(255) NOT NULL CHECK (value > 0)
-- output:
create domain my_domain varchar(255) not null check (value > 0)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / domain.test: formats CREATE DOMAIN with constraints to multiple lines if user prefers
-- input:
CREATE DOMAIN my_domain VARCHAR(255)
  NOT NULL
  CHECK (value > 0)
-- output:
create domain my_domain varchar(255) not null check (value > 0)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / domain.test: formats CREATE DOMAIN with named constraints
-- input:
CREATE DOMAIN my_domain VARCHAR(255)
  CONSTRAINT my_const1 NULL
  CONSTRAINT my_const2 CHECK (value > 0)
-- output:
create domain my_domain varchar(255) constraint my_const1 null constraint my_const2 check (value > 0)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / domain.test: formats DROP DOMAIN
-- input:
DROP DOMAIN my_domain
-- output:
drop domain my_domain
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / domain.test: formats DROP DOMAIN .. IF EXISTS ... CASCADE
-- input:
DROP DOMAIN IF EXISTS my_domain CASCADE
-- output:
drop domain if exists my_domain cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / domain.test: formats DROP DOMAIN with multiple domain names
-- input:
DROP DOMAIN my_domain1, my_domain2, my_domain3
-- output:
drop domain my_domain1,
my_domain2,
my_domain3
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / drop_table.test: formats CASCADE|RESTRICT
-- input:
DROP TABLE foo CASCADE
-- output:
drop table foo cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / drop_table.test: formats multiple table names
-- input:
DROP TABLE foo, bar, baz
-- output:
drop table foo,
bar,
baz
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: converts single-quoted SQL function to dollar-quoted SQL function
-- input:
CREATE FUNCTION my_func()
RETURNS TEXT
LANGUAGE sql
AS 'SELECT ''foo'''
-- output:
create function my_func () returns text language sql as 'SELECT ''foo'''
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: does not reformat E'quoted' strings
-- input:
CREATE FUNCTION my_func()
RETURNS INT
LANGUAGE sql
AS E'SELECT 1'
-- output:
create function my_func () returns int language sql as E'SELECT 1'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: does not reformat single-quoted SQL function when its source contains $$-quotes
-- input:
CREATE FUNCTION my_func()
RETURNS TEXT
LANGUAGE sql
AS 'SELECT $$foo$$'
-- output:
create function my_func () returns text language sql as 'SELECT $$foo$$'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats dollar-quoted SQL function
-- input:
CREATE FUNCTION my_func()
RETURNS INT64
LANGUAGE sql
AS $$
  SELECT 1;
$$
-- output:
create function my_func () returns int64 language sql as $$
  SELECT 1;
$$
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats long parameter list and CASCADE|RESTRICT
-- input:
DROP FUNCTION is_user_allowed_to_enter(
  user_id INT,
  event_id INT,
  OUT event_date DATE
) CASCADE
-- output:
drop function is_user_allowed_to_enter (user_id int, event_id int, out event_date date) cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats long parameter list to multiple lines
-- input:
CREATE FUNCTION my_func(
  IN first_name TEXT,
  OUT last_name TEXT,
  year_of_birth INT DEFAULT 2000,
  INOUT age INT = 0,
  VARIADIC other_names TEXT[]
) AS 'SELECT 1'
-- output:
create function my_func (
  in first_name text,
  out last_name text,
  year_of_birth int default 2000,
  inout age int = 0,
  variadic other_names text[]
) as 'SELECT 1'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats multiple function names
-- input:
DROP FUNCTION func1(user_id INT), func2(user_id INT) CASCADE
-- output:
drop function func1 (user_id int),
func2 (user_id int) cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats parameter list
-- input:
DROP FUNCTION my_func(foo INT, bar TEXT)
-- output:
drop function my_func (foo int, bar text)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats PostgreSQL-specific clauses
-- input:
CREATE FUNCTION my_func()
RETURNS INT
LANGUAGE SQL
IMMUTABLE
NOT LEAKPROOF
CALLED ON NULL INPUT
EXTERNAL SECURITY DEFINER
PARALLEL UNSAFE
COST 100
ROWS 1000
SUPPORT schm.foo
TRANSFORM FOR TYPE INT, FOR TYPE VARCHAR(100)
RETURN 5 + 5
-- output:
create function my_func () returns int language sql immutable not leakproof called on null input external security definer parallel unsafe cost 100 rows 1000 support schm.foo transform for type int,
for type varchar(100) return 5 + 5
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats RETURNS TABLE
-- input:
CREATE FUNCTION foo()
RETURNS TABLE (id INT, name TEXT)
AS 'SELECT 1'
-- output:
create function foo () returns table (id int, name text) as 'SELECT 1'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats SET config variables
-- input:
CREATE FUNCTION my_func()
SET search_path TO my_schema, my_other_schema
SET check_function_bodies = DEFAULT
SET client_min_messages FROM CURRENT
BEGIN ATOMIC
  RETURN 1;
END
-- output:
create function my_func ()
set
  search_path to my_schema,
  my_other_schema
set
  check_function_bodies = default
set
  client_min_messages
from current
begin atomic return 1;

end
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: formats WINDOW function loaded from object file
-- input:
CREATE FUNCTION my_func()
RETURNS INT
AS 'my_lib.so', 'my_func'
LANGUAGE C
WINDOW
STRICT
-- output:
create function my_func () returns int as 'my_lib.so',
'my_func' language c
window
  strict
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: handles SQL language identifier case-insensitively
-- input:
CREATE FUNCTION my_func()
RETURNS INT64
LANGUAGE Sql
AS 'SELECT 1'
-- output:
create function my_func () returns int64 language sql as 'SELECT 1'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / function.test: reformats SQL in dollar-quoted SQL function
-- input:
CREATE FUNCTION my_func()
RETURNS INT64
LANGUAGE sql
AS $body$SELECT 1;
select 2$body$
-- output:
create function my_func () returns int64 language sql as $body$SELECT 1;
select 2$body$
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats [NO] DEPENDS ON EXTENSION
-- input:
ALTER INDEX my_index DEPENDS ON EXTENSION my_extension
-- output:
alter index my_index depends on extension my_extension
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats [NO] DEPENDS ON EXTENSION
-- input:
ALTER INDEX my_index NO DEPENDS ON EXTENSION my_extension
-- output:
alter index my_index no depends on extension my_extension
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats ALTER COLUMN SET STATISTICS
-- input:
ALTER INDEX my_index ALTER COLUMN col SET STATISTICS 100
-- output:
alter index my_index
alter column col
set
  statistics 100
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats ALTER INDEX ALL IN TABLESPACE
-- input:
ALTER INDEX ALL IN TABLESPACE my_tablespace OWNED BY my_user, CURRENT_USER
SET TABLESPACE another_tablespace NOWAIT
-- output:
alter index all in tablespace my_tablespace owned by my_user,
current_user
set
  tablespace another_tablespace nowait
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats ATTACH PARTITION
-- input:
ALTER INDEX my_index ATTACH PARTITION my_partition
-- output:
alter index my_index attach partition my_partition
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats CASCADE|RESTRICT
-- input:
DROP INDEX my_index CASCADE
-- output:
drop index my_index cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats column list with various index parameters
-- input:
CREATE INDEX my_index ON my_table (
  column_name_one COLLATE "C" ASC NULLS FIRST,
  column_name_two DESC NULLS LAST,
  (col3 + col4) my_opclass (foo = 'bar', baz = 'qux') ASC
)
-- output:
create index my_index on my_table (
  column_name_one collate "C" asc nulls first,
  column_name_two desc nulls last,
  (col3 + col4) my_opclass (foo = 'bar', baz = 'qux') asc
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats CONCURRENTLY
-- input:
CREATE INDEX CONCURRENTLY IF NOT EXISTS my_index ON my_table (col)
-- output:
create index concurrently if not exists my_index on my_table (col)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats CONCURRENTLY
-- input:
CREATE INDEX CONCURRENTLY my_index ON my_table (col)
-- output:
create index concurrently my_index on my_table (col)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats CONCURRENTLY
-- input:
DROP INDEX CONCURRENTLY IF EXISTS my_index
-- output:
drop index concurrently if exists my_index
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats CONCURRENTLY
-- input:
DROP INDEX CONCURRENTLY my_index
-- output:
drop index concurrently my_index
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats CONCURRENTLY
-- input:
REINDEX DATABASE CONCURRENTLY
-- output:
reindex database concurrently
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats CONCURRENTLY
-- input:
REINDEX TABLE CONCURRENTLY my_schema.my_table
-- output:
reindex table concurrently my_schema.my_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats CREATE INDEX with PostgreSQL clauses
-- input:
CREATE INDEX my_index ON my_table (col1)
INCLUDE (col2, col3)
NULLS NOT DISTINCT
NULLS DISTINCT
WITH (fillfactor = 70)
TABLESPACE my_tablespace
WHERE col4 > 10
-- output:
create index my_index on my_table (col1) include (col2, col3) nulls not distinct nulls distinct
with
  (fillfactor = 70) tablespace my_tablespace
where col4 > 10
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats IF EXISTS
-- input:
ALTER INDEX IF EXISTS my_index RENAME TO new_index
-- output:
alter index if exists my_index
rename to new_index
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats multiple indexes
-- input:
DROP INDEX my_index1, my_index2
-- output:
drop index my_index1,
my_index2
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats options
-- input:
REINDEX (
  CONCURRENTLY TRUE,
  TABLESPACE another_tablespace,
  VERBOSE FALSE
) TABLE my_table
-- output:
reindex (
  concurrently true,
  tablespace another_tablespace,
  verbose false
) table my_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats options
-- input:
REINDEX (CONCURRENTLY TRUE, TABLESPACE my_tbs) TABLE my_table
-- output:
reindex (concurrently true, tablespace my_tbs) table my_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats REINDEX type
-- input:
REINDEX INDEX my_index
-- output:
reindex index my_index
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats REINDEX type
-- input:
REINDEX SYSTEM
-- output:
reindex system
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats REINDEX type
-- input:
REINDEX TABLE my_schema.my_table
-- output:
reindex table my_schema.my_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats RENAME TO
-- input:
ALTER INDEX my_index RENAME TO new_index
-- output:
alter index my_index
rename to new_index
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats RESET
-- input:
ALTER INDEX my_index RESET (fillfactor)
-- output:
alter index my_index
reset (fillfactor)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats SET
-- input:
ALTER INDEX my_index SET (fillfactor = 70)
-- output:
alter index my_index
set
  (fillfactor = 70)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats SET TABLESPACE
-- input:
ALTER INDEX my_index SET TABLESPACE my_tablespace
-- output:
alter index my_index
set
  tablespace my_tablespace
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats to multiple lines if user prefers
-- input:
ALTER INDEX my_index
RENAME TO new_index
-- output:
alter index my_index
rename to new_index
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / index.test: formats USING clause
-- input:
CREATE INDEX my_index ON my_table USING "btree" (col)
-- output:
create index my_index on my_table using "btree" (col)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / policy.test: formats ALTER POLICY .. altering of various clauses
-- input:
ALTER POLICY be_kind ON users
TO johnny, sally
USING (kind = 'public')
WITH CHECK (kind = 'public')
-- output:
alter policy be_kind on users to johnny,
sally using (kind = 'public')
with
  check (kind = 'public')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / policy.test: formats ALTER POLICY .. RENAME
-- input:
ALTER POLICY be_kind ON users RENAME TO be_evil
-- output:
alter policy be_kind on users
rename to be_evil
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / policy.test: formats basic DROP POLICY
-- input:
DROP POLICY be_kind ON admin
-- output:
drop policy be_kind on admin
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / policy.test: formats CREATE POLICY with all possible clauses
-- input:
CREATE POLICY be_kind_policy ON permissions
AS RESTRICTIVE
FOR SELECT
TO johnny, sally
USING (kind = 'public')
WITH CHECK (kind = 'public')
-- output:
create policy be_kind_policy on permissions as restrictive for
select to johnny, sally using (kind = 'public')
with
  check (kind = 'public')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / policy.test: formats IF EXISTS and CASCADE/RESTRICT
-- input:
DROP POLICY IF EXISTS be_kind ON admin CASCADE
-- output:
drop policy if exists be_kind on admin cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / policy.test: formats minimal CREATE POLICY
-- input:
CREATE POLICY be_kind_policy ON permissions
-- output:
create policy be_kind_policy on permissions
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / policy.test: formats multi-line short CREATE POLICY (if user prefers)
-- input:
CREATE POLICY be_kind_policy ON permissions
AS PERMISSIVE
FOR SELECT
-- output:
create policy be_kind_policy on permissions as permissive for
select
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / policy.test: formats single-line short CREATE POLICY
-- input:
CREATE POLICY be_kind_policy ON permissions AS PERMISSIVE FOR SELECT
-- output:
create policy be_kind_policy on permissions as permissive for
select
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: converts single-quoted SQL procedures to dollar-quoted SQL procedures
-- input:
CREATE PROCEDURE my_proc()
LANGUAGE sql
AS 'SELECT ''foo'''
-- output:
create procedure my_proc () language sql as 'SELECT ''foo'''
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: does not reformat E'quoted' strings
-- input:
CREATE PROCEDURE foo()
LANGUAGE sql
AS E'SELECT 1'
-- output:
create procedure foo () language sql as E'SELECT 1'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: does not reformat single-quoted SQL procedure when its source contains $$-quotes
-- input:
CREATE PROCEDURE my_proc()
LANGUAGE sql
AS 'SELECT $$foo$$'
-- output:
create procedure my_proc () language sql as 'SELECT $$foo$$'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: formats default parameter values
-- input:
CREATE PROCEDURE eliminate_tbl(id INT = 1, TEXT DEFAULT 'foo')
BEGIN ATOMIC
  DROP TABLE my_table;
END
-- output:
create procedure eliminate_tbl (id int = 1, text default 'foo')
begin atomic
drop table my_table;

end
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: formats dollar-quoted SQL procedure
-- input:
CREATE PROCEDURE my_proc()
LANGUAGE sql
AS $$
  SELECT 1;
$$
-- output:
create procedure my_proc () language sql as $$
  SELECT 1;
$$
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: formats long parameter list and CASCADE|RESTRICT
-- input:
DROP PROCEDURE is_user_allowed_to_enter(
  user_id INT,
  event_id INT,
  OUT event_date DATE
) RESTRICT
-- output:
drop procedure is_user_allowed_to_enter (user_id int, event_id int, out event_date date) restrict
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: formats multiple procedure names
-- input:
DROP PROCEDURE proc1(user_id INT), proc2(user_id INT) CASCADE
-- output:
drop procedure proc1 (user_id int),
proc2 (user_id int) cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: formats parameter list
-- input:
DROP PROCEDURE my_func(foo INT, bar TEXT)
-- output:
drop procedure my_func (foo int, bar text)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: handles SQL language identifier case-insensitively
-- input:
CREATE PROCEDURE my_proc()
LANGUAGE Sql
AS 'SELECT 1'
-- output:
create procedure my_proc () language sql as 'SELECT 1'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / procedure.test: reformats SQL in dollar-quoted SQL procedure
-- input:
CREATE PROCEDURE my_proc()
LANGUAGE sql
AS $body$SELECT 1;
select 2$body$
-- output:
create procedure my_proc () language sql as $body$SELECT 1;
select 2$body$
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats ALTER SCHEMA .. OWNER TO
-- input:
ALTER SCHEMA my_schema OWNER TO CURRENT_USER
-- output:
alter schema my_schema owner to current_user
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats ALTER SCHEMA .. RENAME TO
-- input:
ALTER SCHEMA my_schema RENAME TO new_schema
-- output:
alter schema my_schema
rename to new_schema
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats AUTHORIZATION
-- input:
CREATE SCHEMA schema_name
AUTHORIZATION CURRENT_USER
-- output:
create schema schema_name authorization current_user
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats CREATE SCHEMA without schema name
-- input:
CREATE SCHEMA AUTHORIZATION my_user
-- output:
create schema authorization my_user
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / schema.test: formats nested statements
-- input:
CREATE SCHEMA inventory
AUTHORIZATION my_user
  CREATE TABLE product (
    name TEXT,
    price DECIMAL(5, 2)
  )
  CREATE VIEW all_products AS
    SELECT * FROM product
-- output:
create schema inventory authorization my_user
create table product (name text, price decimal(5, 2))
create view all_products as
select *
from product
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / sequence.test: formats all possible sequence options
-- input:
ALTER SEQUENCE IF EXISTS my_seq
  SEQUENCE NAME my_sequence
  UNLOGGED
  RESTART WITH 100
  INCREMENT BY 2
  MINVALUE 0
  MAXVALUE 1000
  NO MINVALUE
  NO MAXVALUE
  START WITH 10
  RESTART WITH 100
  CACHE 10
  CYCLE
  NO CYCLE
  OWNED BY my_table.my_column
  OWNED BY NONE
-- output:
alter sequence if exists my_seq sequence name my_sequence unlogged restart
with
  100 increment by 2 minvalue 0 maxvalue 1000 no minvalue no maxvalue start
with
  10 restart
with
  100 cache 10 cycle no cycle owned by my_table.my_column owned by none
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / sequence.test: formats all possible sequence options
-- input:
CREATE SEQUENCE my_seq
  SEQUENCE NAME my_sequence
  LOGGED
  AS INTEGER
  INCREMENT BY -2
  MINVALUE -1000
  MAXVALUE 1000
  NO MINVALUE
  NO MAXVALUE
  START WITH 10
  RESTART WITH 100
  CACHE 10
  NO CYCLE
  CYCLE
  OWNED BY my_table.my_column
  OWNED BY NONE
-- output:
create sequence my_seq sequence name my_sequence logged as integer increment by -2 minvalue -1000 maxvalue 1000 no minvalue no maxvalue start
with
  10 restart
with
  100 cache 10 no cycle cycle owned by my_table.my_column owned by none
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / sequence.test: formats ALTER SEQUENCE
-- input:
ALTER SEQUENCE my_seq
  RESTART WITH 100
-- output:
alter sequence my_seq restart
with
  100
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / sequence.test: formats CASCADE/RESTRICT
-- input:
DROP SEQUENCE my_seq CASCADE
-- output:
drop sequence my_seq cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / sequence.test: formats CREATE SEQUENCE on a single line
-- input:
CREATE SEQUENCE my_seq START WITH 10 NO CYCLE MAXVALUE 1000
-- output:
create sequence my_seq start
with
  10 no cycle maxvalue 1000
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / sequence.test: formats CREATE SEQUENCE on multiple lines when user prefers
-- input:
CREATE SEQUENCE my_seq
  START WITH 10
  NO CYCLE
  MAXVALUE 1000
-- output:
create sequence my_seq start
with
  10 no cycle maxvalue 1000
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / sequence.test: formats DROP SEQUENCE
-- input:
DROP SEQUENCE seq1, seq2
-- output:
drop sequence seq1,
seq2
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / sequence.test: formats IF EXISTS
-- input:
ALTER SEQUENCE IF EXISTS my_seq
  RESTART WITH 100
-- output:
alter sequence if exists my_seq restart
with
  100
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / sequence.test: formats IF EXISTS
-- input:
DROP SEQUENCE IF EXISTS my_seq
-- output:
drop sequence if exists my_seq
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / sequence.test: formats IF NOT EXISTS
-- input:
CREATE SEQUENCE IF NOT EXISTS my_seq START WITH 1
-- output:
create sequence if not exists my_seq start
with
  1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / sequence.test: formats minimal CREATE SEQUENCE
-- input:
CREATE SEQUENCE my_seq
-- output:
create sequence my_seq
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / sequence.test: formats TEMPORARY/UNLOGGED sequence
-- input:
CREATE TEMP SEQUENCE my_seq START WITH 1
-- output:
create temp sequence my_seq start
with
  1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / sequence.test: formats TEMPORARY/UNLOGGED sequence
-- input:
CREATE UNLOGGED SEQUENCE my_seq START WITH 1
-- output:
create unlogged sequence my_seq start
with
  1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats ALTER TRIGGER .. [NO] DEPENDS ON EXTENSION
-- input:
ALTER TRIGGER my_trigger ON my_table
DEPENDS ON EXTENSION ext_name
-- output:
alter trigger my_trigger on my_table depends on extension ext_name
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats ALTER TRIGGER .. [NO] DEPENDS ON EXTENSION
-- input:
ALTER TRIGGER my_trigger ON my_table
NO DEPENDS ON EXTENSION ext_name
-- output:
alter trigger my_trigger on my_table no depends on extension ext_name
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats ALTER TRIGGER .. RENAME TO on multiple lines (if user prefers)
-- input:
ALTER TRIGGER my_trigger ON my_table
RENAME TO new_name
-- output:
alter trigger my_trigger on my_table
rename to new_name
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats ALTER TRIGGER .. RENAME TO on single line
-- input:
ALTER TRIGGER my_trigger ON my_table RENAME TO new_name
-- output:
alter trigger my_trigger on my_table
rename to new_name
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats CASCADE/RESTRICT
-- input:
DROP TRIGGER my_trigger ON my_table CASCADE
-- output:
drop trigger my_trigger on my_table cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats FROM clause
-- input:
CREATE CONSTRAINT TRIGGER my_trig
AFTER INSERT ON my_tbl
FROM schm.my_tbl
EXECUTE FUNCTION my_func()
-- output:
create constraint trigger my_trig
after insert on my_tbl
from schm.my_tbl
execute function my_func ()
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats long PostgreSQL EXECUTE FUNCTION syntax
-- input:
CREATE TRIGGER my_trig
AFTER TRUNCATE ON my_tbl
EXECUTE FUNCTION my_funtion_name(
  'first argument',
  'second argument',
  'third argument',
  'fourth argument'
)
-- output:
create trigger my_trig
after
truncate on my_tbl
execute function my_funtion_name (
  'first argument',
  'second argument',
  'third argument',
  'fourth argument'
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats long referencing clause
-- input:
CREATE TRIGGER my_trig
AFTER INSERT ON my_tbl
REFERENCING
  OLD TABLE AS very_long_old_table,
  NEW ROW AS especially_long_new_row_name
EXECUTE FUNCTION my_func()
-- output:
create trigger my_trig
after insert on my_tbl referencing old table as very_long_old_table,
new row as especially_long_new_row_name
execute function my_func ()
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats multiple events
-- input:
CREATE TRIGGER my_trig
AFTER INSERT OR UPDATE OF col1, col2 OR DELETE ON my_tbl
EXECUTE FUNCTION my_func()
-- output:
create trigger my_trig
after insert
or
update of col1,
col2
or delete on my_tbl
execute function my_func ()
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats OR REPLACE CONSTRAINT TRIGGER
-- input:
CREATE OR REPLACE CONSTRAINT TRIGGER my_trig
INSTEAD OF UPDATE ON my_tbl
EXECUTE FUNCTION fn()
-- output:
create or replace constraint trigger my_trig instead of
update on my_tbl
execute function fn ()
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats PostgreSQL EXECUTE FUNCTION syntax
-- input:
CREATE TRIGGER my_trig
AFTER TRUNCATE ON my_tbl
EXECUTE FUNCTION my_func(1, 2, 3, 'Hello')
-- output:
create trigger my_trig
after
truncate on my_tbl
execute function my_func (1, 2, 3, 'Hello')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats referencing clause
-- input:
CREATE TRIGGER my_trig
AFTER INSERT ON my_tbl
REFERENCING OLD TABLE AS old_table, NEW ROW AS ref_tbl_new
EXECUTE FUNCTION my_func()
-- output:
create trigger my_trig
after insert on my_tbl referencing old table as old_table,
new row as ref_tbl_new
execute function my_func ()
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / trigger.test: formats timing clause
-- input:
CREATE TRIGGER my_trig
AFTER INSERT ON my_tbl
DEFERRABLE INITIALLY DEFERRED
EXECUTE FUNCTION my_func()
-- output:
create trigger my_trig
after insert on my_tbl deferrable initially deferred
execute function my_func ()
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / type.test: formats ALTER TYPE with multiple attribute actions
-- input:
ALTER TYPE vec3
ADD ATTRIBUTE x FLOAT,
ADD ATTRIBUTE y FLOAT COLLATE "C" CASCADE,
DROP ATTRIBUTE z,
DROP ATTRIBUTE IF EXISTS w RESTRICT,
ALTER ATTRIBUTE a SET DATA TYPE TEXT COLLATE "C" CASCADE
-- output:
alter type vec3
add attribute x float,
add attribute y float collate "C" cascade,
drop attribute z,
drop attribute if exists w restrict,
alter attribute a
set data type text collate "C" cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / type.test: formats CREATE TYPE ... AS (...)
-- input:
CREATE TYPE vec3 AS (x FLOAT, y FLOAT, z FLOAT)
-- output:
create type vec3 as (x float, y float, z float)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / type.test: formats CREATE TYPE ... AS (...) to multiple lines
-- input:
CREATE TYPE name AS (
  first_name TEXT COLLATE "C",
  middle_name TEXT COLLATE "C",
  last_name TEXT COLLATE "C"
)
-- output:
create type name as (
  first_name text collate "C",
  middle_name text collate "C",
  last_name text collate "C"
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / type.test: formats CREATE TYPE ... AS (...) with collations
-- input:
CREATE TYPE name AS (first_name TEXT COLLATE "C", last_name TEXT COLLATE "C")
-- output:
create type name as (
  first_name text collate "C",
  last_name text collate "C"
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / type.test: formats CREATE TYPE ... AS ENUM
-- input:
CREATE TYPE color AS ENUM ('red', 'green', 'blue')
-- output:
create type color as enum('red', 'green', 'blue')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / type.test: formats CREATE TYPE ... AS ENUM to multiple lines
-- input:
CREATE TYPE color AS ENUM (
  'red',
  'green',
  'blue',
  'yellow',
  'purple',
  'orange',
  'black',
  'white'
)
-- output:
create type color as enum(
  'red',
  'green',
  'blue',
  'yellow',
  'purple',
  'orange',
  'black',
  'white'
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / type.test: formats CREATE TYPE name;
-- input:
CREATE TYPE foo
-- output:
create type foo
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / type.test: formats DROP TYPE
-- input:
DROP TYPE foo
-- output:
drop type foo
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / type.test: formats DROP TYPE ... IF EXISTS ... CASCADE
-- input:
DROP TYPE IF EXISTS foo CASCADE
-- output:
drop type if exists foo cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / type.test: formats DROP TYPE with multiple names
-- input:
DROP TYPE foo, bar, baz
-- output:
drop type foo,
bar,
baz
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats CONCURRENTLY
-- input:
REFRESH MATERIALIZED VIEW CONCURRENTLY my_view
-- output:
refresh materialized view concurrently my_view
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats CREATE MATERIALIZED VIEW with extra PostgreSQL clauses
-- input:
CREATE MATERIALIZED VIEW foo
USING "SP-GiST"
WITH (fillfactor = 70)
TABLESPACE pg_default
AS
  SELECT 1
WITH NO DATA
-- output:
create materialized view foo using "SP-GiST"
with
  (fillfactor = 70) tablespace pg_default as
select 1
with
  no data
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats CREATE TEMPORARY RECURSIVE VIEW IF NOT EXISTS
-- input:
CREATE TEMPORARY RECURSIVE VIEW IF NOT EXISTS active_client_id AS
  SELECT 1
-- output:
create temporary recursive view if not exists active_client_id as
select 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats CREATE VIEW with PostgreSQL options
-- input:
CREATE VIEW foo
WITH (security_barrier = TRUE, check_option = local)
AS
  SELECT 1
WITH CASCADED CHECK OPTION
-- output:
create view foo
with
  (security_barrier = true, check_option = local) as
select 1
with
  cascaded check option
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats multiple actions
-- input:
ALTER MATERIALIZED VIEW my_view
CLUSTER ON my_index,
SET WITHOUT CLUSTER,
OWNER TO my_role,
ALTER COLUMN foo SET STATISTICS 100,
ALTER COLUMN foo SET (n_distinct = 100),
ALTER COLUMN foo RESET (n_distinct),
ALTER COLUMN foo SET STORAGE PLAIN,
ALTER COLUMN foo SET COMPRESSION my_method
-- output:
alter materialized view my_view
cluster on my_index,
set
  without
cluster,
owner to my_role,
alter column foo
set
  statistics 100,
alter column foo
set
  (n_distinct = 100),
alter column foo
reset (n_distinct),
alter column foo
set
  storage plain,
alter column foo
set
  compression my_method
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats REFRESH MATERIALIZED VIEW
-- input:
REFRESH MATERIALIZED VIEW my_view
-- output:
refresh materialized view my_view
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats WITH [NO] DATA ... on one or multiple lines
-- input:
REFRESH MATERIALIZED VIEW my_view
WITH NO DATA
-- output:
refresh materialized view my_view
with
  no data
-- #endregion

-- #region: prettier-plugin-sql-cst / test / ddl / view.test: formats WITH [NO] DATA ... on one or multiple lines
-- input:
REFRESH MATERIALIZED VIEW my_view WITH DATA
-- output:
refresh materialized view my_view
with
  data
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats INSERT with OVERRIDING clause
-- input:
INSERT INTO client
OVERRIDING SYSTEM VALUE
VALUES (1, 'John')
-- output:
insert into
  client
overriding system value
values
  (1, 'John')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / insert.test: formats upsert clause with ON CONSTRAINT
-- input:
INSERT INTO client
VALUES (1, 2, 3)
ON CONFLICT ON CONSTRAINT client_pkey DO NOTHING
-- output:
insert into
  client
values
  (1, 2, 3)
on conflict on constraint client_pkey do nothing
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / merge.test: formats INSERT .. OVERRIDING clause
-- input:
MERGE INTO target
USING source
ON target.id = source.id
WHEN NOT MATCHED THEN
  INSERT
    (col1, col2, col3)
  OVERRIDING USER VALUE
  VALUES
    (1000, 2000, 3000)
-- output:
merge into target using source on target.id = source.id when not matched then insert (col1, col2, col3) overriding user value
values
  (1000, 2000, 3000)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / merge.test: formats MERGE .. DO NOTHING
-- input:
MERGE INTO target
USING source
ON target.id = source.id
WHEN NOT MATCHED THEN
  DO NOTHING
-- output:
merge into target using source on target.id = source.id when not matched then do nothing
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / truncate.test: formats {CASCADE | RESTRICT}
-- input:
TRUNCATE TABLE dataset.employee CASCADE
-- output:
truncate table dataset.employee cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / truncate.test: formats {RESTART | CONTINUE} IDENTITY
-- input:
TRUNCATE TABLE dataset.employee RESTART IDENTITY
-- output:
truncate table dataset.employee restart identity
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / truncate.test: formats multi-table truncate with modifiers
-- input:
TRUNCATE TABLE
  dataset.employee,
  dataset.manager,
  dataset.department,
  dataset.company
  CONTINUE IDENTITY
  RESTRICT
-- output:
truncate table dataset.employee,
dataset.manager,
dataset.department,
dataset.company continue identity restrict
-- #endregion

-- #region: prettier-plugin-sql-cst / test / dml / update.test: formats UPDATE with WHERE CURRENT OF clause
-- input:
UPDATE client
SET status = 2
WHERE CURRENT OF cursor_name
-- output:
update client
set
  status = 2
where current of cursor_name
-- #endregion

-- #region: prettier-plugin-sql-cst / test / explain.test: formats EXPLAIN ANALYZE statement
-- input:
EXPLAIN ANALYZE SELECT 1
-- output:
explain
analyze
select 1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats :: cast operator without spaces
-- input:
SELECT 256::INTEGER
-- output:
select 256::integer
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats array constructors
-- input:
SELECT ARRAY(SELECT x FROM tbl)
-- output:
select
  array(
    select
      x
    from
      tbl
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats array slice
-- input:
SELECT my_arr[5:10], my_arr[:8], my_arr[3:], my_arr[:]
-- output:
select my_arr[5:10], my_arr[:8], my_arr[3:], my_arr[:]
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats array subscript
-- input:
SELECT my_arr[1][2]
-- output:
select my_arr[1] [2]
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats OPERATOR()
-- input:
SELECT 5 OPERATOR(+) 6
-- output:
select 5 OPERATOR(+) 6
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats OPERATOR()
-- input:
SELECT x OPERATOR(my_schema.>>) y FROM tbl
-- output:
select x OPERATOR(my_schema.>>) y
from tbl
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats quantifier expressions
-- input:
SELECT x > ALL (SELECT y FROM tbl)
-- output:
select
  x > all (
    select
      y
    from
      tbl
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / expr.test: formats row constructors
-- input:
SELECT ROW(1, 2, 3)
-- output:
select row (1, 2, 3)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: formats JSONB literal using Prettier JSONB formatter
-- input:
SELECT JSONB '{"fname":"John","lname":"Doe","valid":true}'
-- output:
select jsonb '{"fname":"John","lname":"Doe","valid":true}'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / json.test: formats JSONB literals
-- input:
SELECT JSONB '{ "foo": true }'
-- output:
select jsonb '{ "foo": true }'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / literal.test: formats PostgreSQL array literals
-- input:
SELECT
  ARRAY[1, 2, 3],
  ARRAY[
    'a somewhat large array',
    'containing some strings',
    'which themselves',
    'are somewhat long.'
  ]
-- output:
select
  array[1, 2, 3],
  array[
    'a somewhat large array',
    'containing some strings',
    'which themselves',
    'are somewhat long.'
  ]
-- #endregion

-- #region: prettier-plugin-sql-cst / test / expr / literal.test: formats PostgreSQL INTERVAL literals
-- input:
SELECT
  INTERVAL '1 day',
  INTERVAL (3) '25 second',
  INTERVAL '25' SECOND (15),
  INTERVAL '30:25' MINUTE TO SECOND (15),
  INTERVAL '30:25' MINUTE TO SECOND
-- output:
select
  interval '1 day',
  interval(3) '25 second',
  interval '25' second (15),
  interval '30:25' minute to second (15),
  interval '30:25' minute to second
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / functionCase.test: changes case of function name in CREATE TRIGGER
-- input:

        CREATE TRIGGER my_trig
        AFTER TRUNCATE ON my_tbl
        EXECUTE FUNCTION my_func(1, 2, 3)
      
-- output:
create trigger my_trig
after
truncate on my_tbl
execute function my_func (1, 2, 3)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / functionCase.test: changes case of qualified function name in CREATE TRIGGER
-- input:

        CREATE TRIGGER my_trig
        AFTER TRUNCATE ON my_tbl
        EXECUTE FUNCTION schm.my_func(1, 2, 3)
      
-- output:
create trigger my_trig
after
truncate on my_tbl
execute function schm.my_func (1, 2, 3)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / literalCase.test: sqlLiteralCase effects ON/OFF values in PostgreSQL SET statements
-- config: {"keywordCase":"upper"}
-- input:
set log_statement = OFF
-- output:
SET
  log_statement = off
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / literalCase.test: sqlLiteralCase effects ON/OFF values in PostgreSQL SET statements
-- config: {"keywordCase":"lower"}
-- input:
set log_statement = on
-- output:
set
  log_statement = on
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / typeCase.test: applies to INTERVAL data type
-- input:
CREATE TABLE t (x INTERVAL DAY TO MINUTE)
-- output:
create table t (x interval day to minute)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / typeCase.test: applies to TIME data type
-- input:
CREATE TABLE t (x TIMESTAMP WITH TIME ZONE)
-- output:
create table t (x timestamp with time zone)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / typeCase.test: does not apply to ARRAY[] literals in PostgreSQL
-- input:
SELECT ARRAY[1, 2, 3]
-- output:
select array[1, 2, 3]
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / typeCase.test: does not apply to SETOF data types
-- input:
CREATE TABLE t (x SETOF INT)
-- output:
create table t (x setof int)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / options / typeCase.test: does not apply to TABLE data type
-- input:
CREATE FUNCTION foo() RETURNS TABLE (id INT) AS ''
-- output:
create function foo () returns table (id int) as ''
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / comment.test: formats long COMMENT ON
-- input:
COMMENT ON CONSTRAINT constraint_name ON DOMAIN domain_name IS
  'This is a really nice comment here.'
-- output:
comment on constraint constraint_name on domain domain_name is 'This is a really nice comment here.'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / comment.test: formats long comment target
-- input:
COMMENT ON FUNCTION my_absolutely_fantastic_function(
  IN whoopsie CHARACTER VARYING,
  OUT doopsie TEXT
) IS
  'This is a really nice comment here.'
-- output:
comment on function my_absolutely_fantastic_function (in whoopsie character varying, out doopsie text) is 'This is a really nice comment here.'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / comment.test: formats multi-line comment
-- input:
COMMENT ON TABLE foo IS
  'This is a multi-line comment,
  that spans several lines.
  In here.'
-- output:
comment on table foo is 'This is a multi-line comment,
  that spans several lines.
  In here.'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / comment.test: formats short COMMENT ON
-- input:
COMMENT ON TABLE revenue IS 'Hello, world!'
-- output:
comment on table revenue is 'Hello, world!'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / do.test: formats DO [LANGUAGE <language>]
-- input:
DO LANGUAGE plpgsql 'SELECT 1;'
-- output:
do language plpgsql 'SELECT 1;'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / do.test: formats DO statement
-- input:
DO $$
  BEGIN
    PERFORM proc_name(arg1, arg2, arg3);
  END
$$
-- output:
do $$
  BEGIN
    PERFORM proc_name(arg1, arg2, arg3);
  END
$$
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / extension.test: formats CREATE EXTENSION
-- input:
CREATE EXTENSION my_extension
-- output:
create extension my_extension
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / extension.test: formats DROP EXTENSION
-- input:
DROP EXTENSION IF EXISTS ext1, ext2 CASCADE
-- output:
drop extension if exists ext1,
ext2 cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / extension.test: formats long CREATE EXTENSION
-- input:
CREATE EXTENSION IF NOT EXISTS my_extension
  WITH SCHEMA my_schema VERSION '1.0' CASCADE
-- output:
create extension if not exists my_extension
with
  schema my_schema version '1.0' cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / extension.test: formats long CREATE EXTENSION on single line
-- input:
CREATE EXTENSION IF NOT EXISTS my_extension SCHEMA my_schema
-- output:
create extension if not exists my_extension schema my_schema
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / parameter.test: formats RESET ALL
-- input:
RESET ALL
-- output:
reset all
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / parameter.test: formats RESET statement
-- input:
RESET work_mem
-- output:
reset work_mem
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / parameter.test: formats SET [LOCAL] statement
-- input:
SET LOCAL max_connections = 200
-- output:
set
  local max_connections = 200
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / parameter.test: formats SET [SESSION] TIME ZONE LOCAL
-- input:
SET SESSION TIME ZONE LOCAL
-- output:
set
  session time zone local
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / parameter.test: formats SET statement
-- input:
SET work_mem TO '64MB'
-- output:
set
  work_mem to '64MB'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / parameter.test: formats SET TIME ZONE statement
-- input:
SET TIME ZONE 'UTC'
-- output:
set
  time zone 'UTC'
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / parameter.test: formats SET with ON/OFF values
-- input:
SET log_statement = OFF
-- output:
set
  log_statement = off
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / parameter.test: formats SET with ON/OFF values
-- input:
SET log_statement TO ON
-- output:
set
  log_statement to on
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / parameter.test: formats SHOW ALL
-- input:
SHOW ALL
-- output:
show all
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / parameter.test: formats SHOW statement
-- input:
SHOW work_mem
-- output:
show work_mem
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats ADD publication_object, ...
-- input:
ALTER PUBLICATION my_publication ADD TABLE foo, TABLES IN SCHEMA bar
-- output:
alter publication my_publication
add table foo,
tables in schema bar
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats CREATE PUBLICATION
-- input:
CREATE PUBLICATION my_publication
-- output:
create publication my_publication
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats DROP PUBLICATION
-- input:
DROP PUBLICATION IF EXISTS my_publication1, my_publication2 CASCADE
-- output:
drop publication if exists my_publication1,
my_publication2 cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats DROP PUBLICATION
-- input:
DROP PUBLICATION my_publication
-- output:
drop publication my_publication
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats DROP publication_object, ...
-- input:
ALTER PUBLICATION my_publication DROP TABLE foo, TABLES IN SCHEMA bar
-- output:
alter publication my_publication
drop table foo,
tables in schema bar
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats FOR ALL TABLES/SEQUENCES
-- input:
CREATE PUBLICATION my_publication FOR ALL SEQUENCES
-- output:
create publication my_publication for all sequences
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats FOR ALL TABLES/SEQUENCES
-- input:
CREATE PUBLICATION my_publication FOR ALL TABLES
-- output:
create publication my_publication for all tables
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats FOR ALL TABLES/SEQUENCES
-- input:
CREATE PUBLICATION my_publication_name_that_is_extra_long FOR
  ALL TABLES,
  ALL SEQUENCES
-- output:
create publication my_publication_name_that_is_extra_long for all tables,
all sequences
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats FOR TABLE
-- input:
CREATE PUBLICATION my_publication FOR
  TABLE foo (column1, column2) WHERE (id > 10)
-- output:
create publication my_publication for table foo (column1, column2)
where (id > 10)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats FOR TABLE
-- input:
CREATE PUBLICATION my_publication FOR TABLE foo
-- output:
create publication my_publication for table foo
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats FOR TABLE
-- input:
CREATE PUBLICATION my_publication FOR TABLE foo (column1, column2)
-- output:
create publication my_publication for table foo (column1, column2)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats FOR TABLES IN SCHEMA
-- input:
CREATE PUBLICATION my_publication FOR
  TABLES IN SCHEMA my_long_schema_name_in_here
-- output:
create publication my_publication for tables in schema my_long_schema_name_in_here
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats FOR TABLES IN SCHEMA
-- input:
CREATE PUBLICATION my_publication FOR TABLES IN SCHEMA my_schema
-- output:
create publication my_publication for tables in schema my_schema
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats multiple FOR clauses
-- input:
CREATE PUBLICATION my_publication FOR
  TABLES IN SCHEMA my_long_schema_name_in_here,
  TABLE foo (column1, column2) WHERE (id > 10)
-- output:
create publication my_publication for tables in schema my_long_schema_name_in_here,
table foo (column1, column2)
where (id > 10)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats multiple publication objects to multiple lines
-- input:
ALTER PUBLICATION my_long_publication_name
DROP
  TABLE first_table_name,
  TABLES IN SCHEMA my_schema_name,
  TABLE second_table_name
-- output:
alter publication my_long_publication_name
drop table first_table_name,
tables in schema my_schema_name,
table second_table_name
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats OWNER TO
-- input:
ALTER PUBLICATION my_publication OWNER TO new_owner
-- output:
alter publication my_publication owner to new_owner
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats RENAME TO
-- input:
ALTER PUBLICATION my_publication RENAME TO new_name
-- output:
alter publication my_publication
rename to new_name
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats SET (...)
-- input:
ALTER PUBLICATION my_publication SET (param = 'value')
-- output:
alter publication my_publication
set
  (param = 'value')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats SET publication_object, ...
-- input:
ALTER PUBLICATION my_publication SET TABLE foo, TABLES IN SCHEMA bar
-- output:
alter publication my_publication
set
  table foo,
  tables in schema bar
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats to multiple lines when long
-- input:
ALTER PUBLICATION my_publication
DROP TABLE foo, TABLES IN SCHEMA bar, TABLE baz
-- output:
alter publication my_publication
drop table foo,
tables in schema bar,
table baz
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats to multiple lines when user prefers
-- input:
ALTER PUBLICATION my_pub
ADD TABLE foo
-- output:
alter publication my_pub
add table foo
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats WITH clause
-- input:
CREATE PUBLICATION my_publication FOR
  TABLES IN SCHEMA my_long_schema_name_in_here
WITH (publish = 'insert, update')
-- output:
create publication my_publication for tables in schema my_long_schema_name_in_here
with
  (publish = 'insert, update')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / publication.test: formats WITH clause
-- input:
CREATE PUBLICATION my_publication FOR ALL TABLES WITH (publish = '')
-- output:
create publication my_publication for all tables
with
  (publish = '')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / subscription.test: formats CREATE SUBSCRIPTION to multiple lines
-- input:
CREATE SUBSCRIPTION my_subscription
CONNECTION 'host=192.168.1.50 port=5432 user=foo dbname=foodb'
PUBLICATION my_publication
-- output:
create subscription my_subscription connection 'host=192.168.1.50 port=5432 user=foo dbname=foodb' publication my_publication
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / subscription.test: formats CREATE SUBSCRIPTION to single line if fits
-- input:
CREATE SUBSCRIPTION my_sub CONNECTION 'con' PUBLICATION my_pub
-- output:
create subscription my_sub connection 'con' publication my_pub
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / subscription.test: formats DROP SUBSCRIPTION
-- input:
DROP SUBSCRIPTION IF EXISTS my_sub CASCADE
-- output:
drop subscription if exists my_sub cascade
-- #endregion

-- #region: prettier-plugin-sql-cst / test / postgresql / subscription.test: formats WITH clause
-- input:
CREATE SUBSCRIPTION my_subscription
CONNECTION 'host=192.168.1.50 port=5432 user=foo dbname=foodb'
PUBLICATION my_publication
WITH (param1 = 1, param2 = 2)
-- output:
create subscription my_subscription connection 'host=192.168.1.50 port=5432 user=foo dbname=foodb' publication my_publication
with
  (param1 = 1, param2 = 2)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / prepared_statements.test: formats DEALLOCATE ALL
-- input:
DEALLOCATE ALL
-- output:
deallocate all
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / prepared_statements.test: formats DEALLOCATE PREPARE name
-- input:
DEALLOCATE PREPARE my_statement
-- output:
deallocate
prepare my_statement
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / prepared_statements.test: formats EXECUTE name
-- input:
EXECUTE my_prepared_stmt
-- output:
execute my_prepared_stmt
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / prepared_statements.test: formats EXECUTE name(...long argument list)
-- input:
EXECUTE my_prepared_stmt(
  1,
  'some text',
  3.14,
  TRUE,
  NULL,
  'another text',
  42,
  FALSE
)
-- output:
execute my_prepared_stmt (
  1,
  'some text',
  3.14,
  true,
  null,
  'another text',
  42,
  false
)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / prepared_statements.test: formats EXECUTE name(args)
-- input:
EXECUTE my_prepared_stmt(1, 'some text')
-- output:
execute my_prepared_stmt (1, 'some text')
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / prepared_statements.test: formats PREPARE name (...long parameter list)
-- input:
PREPARE my_statement(
  INTEGER,
  VARCHAR(200),
  BOOLEAN,
  TIMESTAMP WITH TIME ZONE
) AS
  SELECT $1, $2, $3, $4
-- output:
prepare my_statement (
  integer,
  varchar(200),
  boolean,
  timestamp with time zone
) as
select $1, $2, $3, $4
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / prepared_statements.test: formats PREPARE name (...params)
-- input:
PREPARE my_statement(INT, TEXT, TIMESTAMP) AS
  SELECT $1, $2, $3
-- output:
prepare my_statement (int, text, timestamp) as
select $1, $2, $3
-- #endregion

-- #region: prettier-plugin-sql-cst / test / proc / prepared_statements.test: formats PREPARE name AS statement
-- input:
PREPARE my_statement AS
  SELECT 1, 2, 3
-- output:
prepare my_statement as
select 1, 2, 3
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / for.test: formats basic FOR clause
-- input:
SELECT 1 FOR NO KEY UPDATE
-- output:
select 1
for no key update
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / for.test: formats basic FOR clause
-- input:
SELECT 1 FOR UPDATE
-- output:
select 1
for update
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / for.test: formats FOR clause with long list of tables
-- input:
SELECT 1
FOR SHARE OF
  very_long_table_name1,
  very_long_table_name2,
  very_long_table_name3
  NOWAIT
-- output:
select 1
for share of
  very_long_table_name1,
  very_long_table_name2,
  very_long_table_name3 nowait
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / for.test: formats FOR clause with tables and modifiers
-- input:
SELECT 1
FOR SHARE OF table1, table2 SKIP LOCKED
-- output:
select 1
for share of
  table1,
  table2 skip locked
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats LATERAL table function
-- input:
SELECT *
FROM LATERAL schm.foo(1, 2, 3) AS t
-- output:
select *
from lateral schm.foo (1, 2, 3) as t
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats ONLY table
-- input:
SELECT * FROM ONLY my_table
-- output:
select *
from only my_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats ROWS FROM
-- input:
SELECT * FROM ROWS FROM (fn1(), fn2())
-- output:
select *
from rows
from (fn1 (), fn2 ())
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats ROWS FROM with column definitions
-- input:
SELECT *
FROM
  ROWS FROM (
    table_function1(foo, bar) AS (a INT, b TEXT),
    table_function2(foo, bar, baz) AS (a INT, b TEXT, c TEXT)
  )
-- output:
select *
from rows
from
  (
    table_function1 (foo, bar) as (a int, b text),
    table_function2 (foo, bar, baz) as (a int, b text, c text)
  )
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats table *
-- input:
SELECT * FROM my_table *
-- output:
select *
from my_table *
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats table alias with column aliases
-- input:
SELECT *
FROM
  standard_client AS client (id, name)
  JOIN standard_client_sale AS sale (client_id, sale_id)
    ON sale.client_id = client.id
-- output:
select *
from
  standard_client as client (id, name)
  join standard_client_sale as sale (client_id, sale_id) on sale.client_id = client.id
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats table functions WITH ORDINALITY
-- input:
SELECT *
FROM
  table_func1() WITH ORDINALITY
  JOIN ROWS FROM (table_func2(), table_func3()) WITH ORDINALITY
-- output:
select *
from table_func1 () with ordinality join rows
from (table_func2 (), table_func3 ()) with ordinality
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats TABLESPAMPLE with custom sampling function and multiple parameters
-- input:
SELECT * FROM my_table TABLESAMPLE my_sampler (10, 20)
-- output:
select *
from my_table tablesample my_sampler (10, 20)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / from.test: formats TABLESPAMPLE with REPEATABLE clause
-- input:
SELECT * FROM my_table TABLESAMPLE BERNOULLI (5) REPEATABLE (123)
-- output:
select *
from my_table tablesample bernoulli (5) repeatable (123)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / into.test: formats INTO TABLE clause
-- input:
SELECT * FROM tbl INTO my_table
-- output:
select *
from tbl into my_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / into.test: formats INTO TABLE clause
-- input:
SELECT 1
INTO TEMPORARY TABLE my_table
-- output:
select 1 into temporary table my_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / into.test: formats INTO TABLE clause
-- input:
SELECT 1
INTO UNLOGGED TABLE my_table
-- output:
select 1 into unlogged table my_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / limiting.test: formats LIMIT ALL
-- input:
SELECT * FROM tbl LIMIT ALL
-- output:
select *
from tbl
limit all
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / limiting.test: formats OFFSET and FETCH clauses
-- input:
SELECT *
FROM tbl
OFFSET 1000 ROWS
FETCH FIRST 100 ROWS ONLY
-- output:
select *
from tbl
offset
  1000 rows
fetch first
  100 rows only
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / limiting.test: formats OFFSET clause
-- input:
SELECT * FROM tbl OFFSET 1000
-- output:
select *
from tbl
offset
  1000
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / limiting.test: formats OFFSET with long expressions
-- config: {"expressionWidth":30}
-- input:
SELECT *
FROM tbl
OFFSET
  (20500 + 5200 / 82) ROWS
-- output:
select *
from tbl
offset
  (20500 + 5200 / 82) rows
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / limiting.test: formats single-line OFFSET and FETCH clauses
-- input:
SELECT *
FROM tbl
OFFSET 1 ROW
FETCH NEXT ROW WITH TIES
-- output:
select *
from tbl
offset
  1 row
fetch next
  row
with
  ties
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats empty SELECT
-- input:
SELECT
-- output:
select
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats empty SELECT
-- input:
SELECT FROM tbl
-- output:
select
from tbl
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats GROUP BY CUBE()
-- input:
SELECT * FROM tbl GROUP BY CUBE(a)
-- output:
select *
from tbl
group by cube (a)
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats GROUP BY DISTINCT
-- input:
SELECT * FROM tbl GROUP BY DISTINCT a, b
-- output:
select *
from tbl
group by distinct
  a,
  b
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats GROUP BY GROUPING SETS ()
-- input:
SELECT * FROM tbl GROUP BY GROUPING SETS (foo, CUBE(bar), ())
-- output:
select *
from tbl
group by grouping sets (foo, cube (bar), ())
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats ORDER BY col USING operator
-- input:
SELECT * FROM tbl ORDER BY col USING >
-- output:
select *
from tbl
order by col using >
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / select.test: formats PostgreSQL SELECT DISTINCT ON ()
-- input:
SELECT DISTINCT ON (col1, col2)
  col1,
  col2,
  col3
FROM tbl
-- output:
select distinct
  on (col1, col2) col1,
  col2,
  col3
from tbl
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / table.test: formats TABLE statement (syntax sugar for SELECT)
-- input:
TABLE my_table
-- output:
table my_table
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / table.test: formats TABLE statement (syntax sugar for SELECT)
-- input:
WITH my_table AS (SELECT 1 AS col1)
TABLE my_table
ORDER BY col1
-- output:
with
  my_table as (
    select
      1 as col1
  ) table my_table
order by col1
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / with.test: formats CYCLE and SEARCH clauses in WITH
-- input:
WITH RECURSIVE
  cte1 AS (SELECT * FROM my_table WHERE x > 0)
    CYCLE a, b SET a TO 1 DEFAULT 0 USING pathcol,
  cte2 AS (
    SELECT *
    FROM client
    WHERE age > 100
  ) SEARCH BREADTH FIRST BY a, b SET target_col
SELECT *
FROM
  cte1,
  cte2
-- output:
with recursive
  cte1 as (
    select
      *
    from
      my_table
    where
      x > 0
  ) cycle a,
  b
set
  a to 1 default 0 using pathcol,
  cte2 as (
    select
      *
    from
      client
    where
      age > 100
  ) search breadth first by a,
  b
set
  target_col
select *
from cte1, cte2
-- #endregion

-- #region: prettier-plugin-sql-cst / test / select / with.test: formats long CYCLE and SEARCH clauses in WITH
-- input:
WITH RECURSIVE
  cte1 AS (SELECT * FROM tbl)
    CYCLE
      first_long_column_name,
      second_really_long_column_name,
      third_column_name_as_well
    SET target_column_name
    USING path_column_name,
  cte2 AS (SELECT * FROM tbl)
    CYCLE col1, col2
    SET target_column_name
    TO 'Found it here in the cycle'
    DEFAULT 'No cycle found'
    USING path_column_name,
  cte3 AS (SELECT * FROM tbl)
    SEARCH DEPTH FIRST BY
      first_long_column_name,
      second_really_long_column_name,
      third_column_name_as_well
    SET target_column_name
SELECT *
FROM
  cte1,
  cte2,
  cte3
-- output:
with recursive
  cte1 as (
    select
      *
    from
      tbl
  ) cycle first_long_column_name,
  second_really_long_column_name,
  third_column_name_as_well
set
  target_column_name using path_column_name,
  cte2 as (
    select
      *
    from
      tbl
  ) cycle col1,
  col2
set
  target_column_name to 'Found it here in the cycle' default 'No cycle found' using path_column_name,
  cte3 as (
    select
      *
    from
      tbl
  ) search depth first by first_long_column_name,
  second_really_long_column_name,
  third_column_name_as_well
set
  target_column_name
select *
from cte1, cte2, cte3
-- #endregion

-- #region: prettier-plugin-sql-cst / test / transaction.test: formats AND [NO] CHAIN clauses
-- input:
START TRANSACTION;

ROLLBACK AND NO CHAIN;

COMMIT AND CHAIN
-- output:
start transaction;

rollback
and no chain;

commit
and chain
-- #endregion

-- #region: prettier-plugin-sql-cst / test / transaction.test: formats BEGIN TRANSACTION .. END TRANSACTION
-- input:
BEGIN TRANSACTION;

END TRANSACTION
-- output:
begin transaction;

end transaction
-- #endregion

-- #region: prettier-plugin-sql-cst / test / transaction.test: formats BEGIN WORK .. END WORK
-- input:
BEGIN WORK;

END WORK
-- output:
begin work;

end work
-- #endregion

-- #region: prettier-plugin-sql-cst / test / transaction.test: formats transaction modes
-- input:
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE, READ ONLY, DEFERRABLE;

COMMIT
-- output:
begin transaction isolation level serializable,
read only,
deferrable;

commit
-- #endregion

-- #region: prettier-plugin-sql-cst / test / transaction.test: formats transaction modes on multiple lines
-- input:
BEGIN TRANSACTION
  ISOLATION LEVEL READ COMMITTED,
  READ WRITE,
  NOT DEFERRABLE,
  ISOLATION LEVEL REPEATABLE READ;

COMMIT
-- output:
begin transaction isolation level read committed,
read write,
not deferrable,
isolation level repeatable read;

commit
-- #endregion
