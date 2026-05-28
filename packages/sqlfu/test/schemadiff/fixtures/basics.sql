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

-- #region: camelCase columns are quoted when creating a table
-- baseline:

-- desired:
create table events(createdAt text not null);
-- output:
create table events("createdAt" text not null);
-- #endregion

-- #region: string literals are preserved when creating a table
-- baseline:

-- desired:
create table events(createdAt text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
-- output:
create table events("createdAt" text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
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

-- #region: view string literal case changes are semantic
-- baseline:
create view event_days as select strftime('%Y-%m-%dT%H:%M:%fZ', 'now') as ts;
-- desired:
create view event_days as select strftime('%y-%m-%dt%h:%m:%fz', 'now') as ts;
-- output:
drop view event_days;
create view event_days as select strftime('%y-%m-%dt%h:%m:%fz', 'now') as ts;
-- #endregion

-- #region: column collation changes rebuild the table
-- baseline:
create table person(name text collate nocase);
-- desired:
create table person(name text collate rtrim, nickname text collate rtrim);
-- output:
-- rebuilding table "person": column "name" collation changed from nocase to rtrim
alter table person rename to __sqlfu_old_person;
create table person(name text collate rtrim, nickname text collate rtrim);
insert into person(name) select name from __sqlfu_old_person;
drop table __sqlfu_old_person;
-- #endregion

-- #region: inserting a column in the middle rebuilds with a reordered reason
-- baseline:
create table a(low int, high int);
-- desired:
create table a(low int, mid int, high int);
-- output:
-- rebuilding table "a": columns reordered
alter table a rename to __sqlfu_old_a;
create table a(low int, mid int, high int);
insert into a(low, high) select low, high from __sqlfu_old_a;
drop table __sqlfu_old_a;
-- #endregion

-- #region: column type change rebuilds with type-change reason
-- baseline:
create table a(x int);
-- desired:
create table a(x text);
-- output:
-- rebuilding table "a": column "x" type changed from int to text
alter table a rename to __sqlfu_old_a;
create table a(x text);
insert into a(x) select x from __sqlfu_old_a;
drop table __sqlfu_old_a;
-- #endregion

-- #region: column default change rebuilds with default-change reason
-- baseline:
create table a(x int default 0);
-- desired:
create table a(x int default 1);
-- output:
-- rebuilding table "a": column "x" default changed
alter table a rename to __sqlfu_old_a;
create table a(x int default 1);
insert into a(x) select x from __sqlfu_old_a;
drop table __sqlfu_old_a;
-- #endregion

-- #region: user-modified view cascades its unchanged trigger with "changing" reason
-- baseline:
create table t(x int, y int);
create view v as select x, y from t;
create trigger trg instead of insert on v begin select new.x; end;
-- desired:
create table t(x int, y int);
create view v as select x from t;
create trigger trg instead of insert on v begin select new.x; end;
-- output:
-- dropping trigger "trg": view "v" changing
drop trigger trg;
drop view v;
create view v as select x from t;
-- recreating trigger "trg": view "v" changing
create trigger trg instead of insert on v begin select new.x; end;
-- #endregion

-- #region: cascade-recreated view cascades its unchanged trigger with "recreating" reason
-- baseline:
create table t(x int);
create view v as select x from t;
create trigger trg instead of insert on v begin select new.x; end;
-- desired:
create table t(x int primary key);
create view v as select x from t;
create trigger trg instead of insert on v begin select new.x; end;
-- output:
-- dropping trigger "trg": view "v" recreating
drop trigger trg;
-- dropping view "v": table "t" needs rebuild
drop view v;
-- rebuilding table "t": primary key changed
alter table t rename to __sqlfu_old_t;
create table t(x int primary key);
insert into t(x) select x from __sqlfu_old_t;
drop table __sqlfu_old_t;
-- recreating view "v": table "t" needs rebuild
create view v as select x from t;
-- recreating trigger "trg": view "v" recreating
create trigger trg instead of insert on v begin select new.x; end;
-- #endregion
