-- default config: {"allowDestructive": true}

-- #region: simple column removal uses direct drop column
-- baseline:
create table a(x int, y int);
-- desired:
create table a(x int);
-- output:
alter table a drop column y;
-- #endregion

-- #region: indexed column removal drops and recreates index blockers
-- baseline:
create table a(x int, y int);
create index a_y_idx on a(y);
-- desired:
create table a(x int);
-- output:
drop index a_y_idx;
alter table a drop column y;
-- #endregion

-- #region: foreign key column removal falls back to rebuild
-- baseline:
create table parent(id int primary key);
create table child(x int, parent_id int references parent(id));
-- desired:
create table parent(id int primary key);
create table child(x int);
-- output:
alter table child rename to __sqlfu_old_child;
create table child(x int);
insert into child(x) select x from __sqlfu_old_child;
drop table __sqlfu_old_child;
-- #endregion

-- #region: check-constrained column removal falls back to rebuild
-- baseline:
create table a(x int, y int check(y > 0));
-- desired:
create table a(x int);
-- output:
alter table a rename to __sqlfu_old_a;
create table a(x int);
insert into a(x) select x from __sqlfu_old_a;
drop table __sqlfu_old_a;
-- #endregion

-- #region: trigger reference drops blockers around direct column drop
-- baseline:
create table person(name text, nickname text);
create trigger person_log after update on person begin
  select new.nickname;
end;
-- desired:
create table person(name text);
-- output:
drop trigger person_log;
alter table person drop column nickname;
-- #endregion

-- #region: view reference drops blockers around direct column drop
-- baseline:
create table person(name text, nickname text);
create view person_names as select name, nickname from person;
-- desired:
create table person(name text);
-- output:
drop view person_names;
alter table person drop column nickname;
-- #endregion
