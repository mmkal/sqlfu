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
-- dropping index "a_y_idx": table "a" removing column "y"
drop index a_y_idx;
alter table a drop column y;
-- #endregion

-- #region: multi-column drop uses plural wording in cascade reason
-- baseline:
create table t(x int, y int, z int);
create view t_yz as select y, z from t;
-- desired:
create table t(x int);
-- output:
-- dropping view "t_yz": table "t" removing columns "y", "z"
drop view t_yz;
alter table t drop column y;
alter table t drop column z;
-- #endregion

-- #region: partial index on surviving column should not block unrelated drop
-- baseline:
create table t(x int, y int);
create index t_x_partial on t(x) where x > 0;
-- desired:
create table t(x int);
create index t_x_partial on t(x) where x > 0;
-- output:
alter table t drop column y;
-- #endregion

-- #region: partial index string literal mentioning dropped column should not block unrelated drop
-- baseline:
create table t(x int, y int);
create index t_x_partial on t(x) where 'y' <> '';
-- desired:
create table t(x int);
create index t_x_partial on t(x) where 'y' <> '';
-- output:
alter table t drop column y;
-- #endregion

-- #region: partial index function name matching dropped column should not block unrelated drop
-- baseline:
create table t(x text, lower text);
create index t_x_partial on t(x) where lower(x) = 'a';
-- desired:
create table t(x text);
create index t_x_partial on t(x) where lower(x) = 'a';
-- output:
alter table t drop column lower;
-- #endregion

-- #region: partial index collation name matching dropped column should not block unrelated drop
-- baseline:
create table t(x text, nocase text);
create index t_x_partial on t(x) where x collate nocase = 'a';
-- desired:
create table t(x text);
create index t_x_partial on t(x) where x collate nocase = 'a';
-- output:
alter table t drop column nocase;
-- #endregion

-- #region: partial index where reference to dropped column falls back to rebuild
-- baseline:
create table t(x int, y int);
create index t_x_partial on t(x) where y > 0;
-- desired:
create table t(x int);
-- output:
-- rebuilding table "t": column "y" dropped (cannot drop in place)
alter table t rename to __sqlfu_old_t;
create table t(x int);
insert into t(x) select x from __sqlfu_old_t;
drop table __sqlfu_old_t;
-- #endregion

-- #region: foreign key column removal falls back to rebuild
-- baseline:
create table parent(id int primary key);
create table child(x int, parent_id int references parent(id));
-- desired:
create table parent(id int primary key);
create table child(x int);
-- output:
-- rebuilding table "child": foreign keys changed
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
-- rebuilding table "a": column "y" dropped (cannot drop in place)
alter table a rename to __sqlfu_old_a;
create table a(x int);
insert into a(x) select x from __sqlfu_old_a;
drop table __sqlfu_old_a;
-- #endregion

-- #region: check on surviving column should not force rebuilding unrelated dropped column
-- baseline:
create table a(
  x int,
  y int,
  check(x > 0)
);
-- desired:
create table a(
  x int,
  check(x > 0)
);
-- output:
alter table a drop column y;
-- #endregion

-- #region: check string literal mentioning dropped column should not force rebuild
-- baseline:
create table a(
  x int,
  y int,
  check('y' <> '')
);
-- desired:
create table a(
  x int,
  check('y' <> '')
);
-- output:
alter table a drop column y;
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
-- dropping trigger "person_log": table "person" removing column "nickname"
drop trigger person_log;
alter table person drop column nickname;
-- #endregion

-- #region: trigger on surviving columns should not be treated as a blocker
-- baseline:
create table person(name text, nickname text);
create trigger person_log after update on person begin
  select new.name;
end;
-- desired:
create table person(name text);
create trigger person_log after update on person begin
  select new.name;
end;
-- output:
alter table person drop column nickname;
-- #endregion

-- #region: view reference drops blockers around direct column drop
-- baseline:
create table person(name text, nickname text);
create view person_names as select name, nickname from person;
-- desired:
create table person(name text);
-- output:
-- dropping view "person_names": table "person" removing column "nickname"
drop view person_names;
alter table person drop column nickname;
-- #endregion

-- #region: view on surviving columns should not be treated as a blocker
-- baseline:
create table person(name text, nickname text);
create view person_names as select name from person;
-- desired:
create table person(name text);
create view person_names as select name from person;
-- output:
alter table person drop column nickname;
-- #endregion

-- #region: qualified surviving-column view reference should not be treated as a blocker
-- baseline:
create table person(name text, nickname text);
create view person_names as
select person.name from person;
-- desired:
create table person(name text);
create view person_names as
select person.name from person;
-- output:
alter table person drop column nickname;
-- #endregion

-- #region: alias shadowing dropped column name should not be treated as a blocker
-- baseline:
create table person(name text, nickname text);
create view person_names as
select name as nickname from person;
-- desired:
create table person(name text);
create view person_names as
select name as nickname from person;
-- output:
alter table person drop column nickname;
-- #endregion

-- #region: qualified removed-column view reference should still be treated as a blocker
-- baseline:
create table person(name text, nickname text);
create view person_names as
select person.nickname from person;
-- desired:
create table person(name text);
-- output:
-- dropping view "person_names": table "person" removing column "nickname"
drop view person_names;
alter table person drop column nickname;
-- #endregion

-- #region: alias shadowing dropped column name in trigger should not be treated as a blocker
-- baseline:
create table person(name text, nickname text);
create trigger person_log after update on person begin
  select new.name as nickname;
end;
-- desired:
create table person(name text);
create trigger person_log after update on person begin
  select new.name as nickname;
end;
-- output:
alter table person drop column nickname;
-- #endregion

-- #region: cte shadowing dropped table name should not make a view a blocker
-- baseline:
create table person(name text, nickname text);
create view cte_person_names as
with person as (select 'display' as nickname)
select nickname from person;
-- desired:
create table person(name text);
create view cte_person_names as
with person as (select 'display' as nickname)
select nickname from person;
-- output:
alter table person drop column nickname;
-- #endregion

-- #region: trigger writing same-named column on another table should not block column drop
-- baseline:
create table person(name text, nickname text);
create table audit_log(nickname text);
create trigger person_log after update on person begin
  insert into audit_log(nickname) values ('changed');
end;
-- desired:
create table person(name text);
create table audit_log(nickname text);
create trigger person_log after update on person begin
  insert into audit_log(nickname) values ('changed');
end;
-- output:
alter table person drop column nickname;
-- #endregion
