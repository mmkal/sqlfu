-- default config: {"allowDestructive": true}

-- #region: destructive table removal emits drop table
-- baseline:
create table a(x int);
create table b(x int);
-- desired:
create table a(x int);
-- output:
drop table b;
-- #endregion

-- #region: destructive table removal still includes sqlfu_migrations creation
-- baseline:
create table person(name text not null);
create table pet(name text not null);
create table toy(name text not null);
-- desired:
create table person(name text not null);
create table sqlfu_migrations(
  name text primary key check(name not like '%.sql'),
  checksum text not null,
  applied_at text not null
);
-- output:
create table sqlfu_migrations(
  name text primary key check(name not like '%.sql'),
  checksum text not null,
  applied_at text not null
);
drop table pet;
drop table toy;
-- #endregion

-- #region: simple removed column drops directly
-- baseline:
create table a(x int, y int);
-- desired:
create table a(x int);
-- output:
alter table a drop column y;
-- #endregion

-- #region: adding a trigger creates it directly
-- baseline:
create table person(name text);
create table audit_log(name text);
-- desired:
create table person(name text);
create table audit_log(name text);
create trigger person_insert_log after insert on person begin
  insert into audit_log(name) values (new.name);
end;
-- output:
create trigger person_insert_log after insert on person begin
insert into audit_log(name) values (new.name);
end;
-- #endregion

-- #region: changing a trigger body recreates it
-- baseline:
create table person(name text);
create table audit_log(name text);
create trigger person_insert_log after insert on person begin
  insert into audit_log(name) values (new.name);
end;
-- desired:
create table person(name text);
create table audit_log(name text);
create trigger person_insert_log after insert on person begin
  insert into audit_log(name) values ('prefix:' || new.name);
end;
-- output:
drop trigger person_insert_log;
create trigger person_insert_log after insert on person begin
insert into audit_log(name) values ('prefix:' || new.name);
end;
-- #endregion

-- #region: column collation changes rebuild the table
-- baseline:
create table person(name text collate nocase);
-- desired:
create table person(name text collate rtrim, nickname text collate rtrim);
-- output:
alter table person rename to __sqlfu_old_person;
create table person(name text collate rtrim, nickname text collate rtrim);
insert into person(name) select name from __sqlfu_old_person;
drop table __sqlfu_old_person;
-- #endregion
