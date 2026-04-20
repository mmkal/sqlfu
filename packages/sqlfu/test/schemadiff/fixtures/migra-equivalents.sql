-- default config: {"allowDestructive": true}

-- #region: sqlite-migra collations
-- baseline:
create table t(
  a text,
  b text collate nocase
);
-- desired:
create table t(
  a text,
  b text collate rtrim,
  c text collate rtrim
);
-- output:
alter table t rename to __sqlfu_old_t;
create table t(
  a text,
  b text collate rtrim,
  c text collate rtrim
);
insert into t(a, b) select a, b from __sqlfu_old_t;
drop table __sqlfu_old_t;
-- #endregion

-- #region: sqlite-migra constraints
-- baseline:
create table a(b text);
-- desired:
create table a(b text not null unique);
-- output:
alter table a rename to __sqlfu_old_a;
create table a(b text not null unique);
insert into a(b) select b from __sqlfu_old_a;
drop table __sqlfu_old_a;
-- #endregion

-- #region: unchanged view depending on rebuilt table is dropped and recreated
-- baseline:
create table a(a1 int);

create view av as
select * from a;
-- desired:
create table a(a1 int not null);

create view av as
select * from a;
-- output:
drop view av;
alter table a rename to __sqlfu_old_a;
create table a(a1 int not null);
insert into a(a1) select a1 from __sqlfu_old_a;
drop table __sqlfu_old_a;
create view av as
select * from a;
-- #endregion

-- #region: unchanged trigger depending on rebuilt table is dropped and recreated
-- baseline:
create table a(a1 int);
create table audit_log(message text);

create trigger a_insert_log after insert on a begin
  insert into audit_log(message) values ('row');
end;
-- desired:
create table a(a1 int not null);
create table audit_log(message text);

create trigger a_insert_log after insert on a begin
  insert into audit_log(message) values ('row');
end;
-- output:
drop trigger a_insert_log;
alter table a rename to __sqlfu_old_a;
create table a(a1 int not null);
insert into a(a1) select a1 from __sqlfu_old_a;
drop table __sqlfu_old_a;
create trigger a_insert_log after insert on a begin
insert into audit_log(message) values ('row');
end;
-- #endregion

-- #region: nested unchanged view chain is recreated when underlying rebuilt table renames
-- baseline:
create table a(a1 int);

create view av as
select * from a;

create view av2 as
select * from av;
-- desired:
create table a(a1 int not null);

create view av as
select * from a;

create view av2 as
select * from av;
-- output:
drop view av;
drop view av2;
alter table a rename to __sqlfu_old_a;
create table a(a1 int not null);
insert into a(a1) select a1 from __sqlfu_old_a;
drop table __sqlfu_old_a;
create view av as
select * from a;
create view av2 as
select * from av;
-- #endregion

-- #region: sqlite-migra dependencies
-- baseline:

-- desired:
create table a(id int primary key not null);

create table b(
  id int primary key not null,
  a_id int not null references a(id)
);
-- output:
create table a(id int primary key not null);
create table b(
  id int primary key not null,
  a_id int not null references a(id)
);
-- #endregion

-- #region: sqlite-migra dependencies2
-- baseline:
create table data(
  id integer,
  name text
);

create view q as
select * from data;
-- desired:
create table t_data(
  id integer,
  name text
);

create view data as
select * from t_data;

create view q as
select * from data;
-- output:
create table t_data(
  id integer,
  name text
);
drop table data;
create view data as
select * from t_data;
-- #endregion

-- #region: sqlite-migra dependencies3
-- baseline:
create table t(a int);

create view abc as
select a from t;

create view switcharoo as
select 1 as a;

create table "strange_name(((yo?)))"(id text);

create view "strange_view(what)" as
select id from "strange_name(((yo?)))";
-- desired:
create table t(a int, b int);

create view abc as
select a from t;

create view switcharoo as
select 1 as a, 2 as b;

create table "strange_name(((yo?)))"(id text);

create view "strange_view(what)" as
select cast(id as int) * 2 as a from "strange_name(((yo?)))";
-- output:
drop view "strange_view(what)";
drop view switcharoo;
alter table t add column b int;
create view "strange_view(what)" as
select cast(id as int) * 2 as a from "strange_name(((yo?)))";
create view switcharoo as
select 1 as a, 2 as b;
-- #endregion

-- #region: sqlite-migra dependencies4
-- baseline:
create table t2(a int);
-- desired:
create table t(
  id integer not null primary key,
  a text,
  b integer
);

create view v as
select id, a, max(b) as max_b
from t
group by id;

create view mv as
select id from v;
-- output:
create table t(
  id integer not null primary key,
  a text,
  b integer
);
drop table t2;
create view mv as
select id from v;
create view v as
select id, a, max(b) as max_b
from t
group by id;
-- #endregion

-- #region: nested view dependencies are recreated in dependency order
-- baseline:
create table t(x int, y int);

create view v1 as
select x, y from t;

create view v2 as
select x from v1;
-- desired:
create table t(x int);

create view v1 as
select x from t;

create view v2 as
select x from v1;
-- output:
drop view v2;
drop view v1;
alter table t drop column y;
create view v1 as
select x from t;
create view v2 as
select x from v1;
-- #endregion

-- #region: trigger on dependent view is dropped before the view chain and recreated after it
-- baseline:
create table t(x int, y int);

create view v1 as
select x, y from t;

create view v2 as
select x from v1;

create trigger trg instead of insert on v2 begin
  select new.x;
end;
-- desired:
create table t(x int);

create view v1 as
select x from t;

create view v2 as
select x from v1;

create trigger trg instead of insert on v2 begin
  select new.x;
end;
-- output:
drop trigger trg;
drop view v2;
drop view v1;
alter table t drop column y;
create view v1 as
select x from t;
create view v2 as
select x from v1;
create trigger trg instead of insert on v2 begin
select new.x;
end;
-- #endregion

-- #region: trigger on one dependent view can also reference another dependent view
-- baseline:
create table t(x int, y int);

create view v1 as
select x, y from t;

create view v2 as
select x from v1;

create trigger trg instead of insert on v2 begin
  select count(*) from v1;
  select new.x;
end;
-- desired:
create table t(x int);

create view v1 as
select x from t;

create view v2 as
select x from v1;

create trigger trg instead of insert on v2 begin
  select count(*) from v1;
  select new.x;
end;
-- output:
drop trigger trg;
drop view v2;
drop view v1;
alter table t drop column y;
create view v1 as
select x from t;
create view v2 as
select x from v1;
create trigger trg instead of insert on v2 begin
select count(*) from v1;
select new.x;
end;
-- #endregion

-- #region: table change with index view and trigger uses one dependency-ordered plan
-- baseline:
create table person(name text, nickname text, age int);
create index person_age_idx on person(age);
create view person_view as
select name, nickname from person;
create trigger person_view_insert instead of insert on person_view begin
  select new.name;
end;
-- desired:
create table person(name text, age int);
create index person_age_idx on person(age);
create view person_view as
select name from person;
create trigger person_view_insert instead of insert on person_view begin
  select new.name;
end;
-- output:
drop trigger person_view_insert;
drop view person_view;
alter table person drop column nickname;
create view person_view as
select name from person;
create trigger person_view_insert instead of insert on person_view begin
select new.name;
end;
-- #endregion

-- #region: unrelated view string literal mentioning table name should not be treated as a dependency
-- baseline:
create table person(name text, nickname text);

create view labels as
select 'person' as label;
-- desired:
create table person(name text);

create view labels as
select 'person' as label;
-- output:
alter table person drop column nickname;
-- #endregion

-- #region: surviving shared view should not be dropped around independent table drops
-- baseline:
create table t1(x int, y int);
create table t2(a int, b int);

create view joined as
select t1.x, t2.a
from t1
join t2;
-- desired:
create table t1(x int);
create table t2(a int);

create view joined as
select t1.x, t2.a
from t1
join t2;
-- output:
alter table t1 drop column y;
alter table t2 drop column b;
-- #endregion

-- #region: trigger depending on a surviving view should not be dropped around unrelated table drops
-- baseline:
create table person(name text, nickname text);

create view person_names as
select name from person;

create trigger person_names_log instead of insert on person_names begin
  select new.name;
end;
-- desired:
create table person(name text);

create view person_names as
select name from person;

create trigger person_names_log instead of insert on person_names begin
  select new.name;
end;
-- output:
alter table person drop column nickname;
-- #endregion

-- #region: sqlite-migra generated
-- baseline:
create table demo(
  id integer primary key,
  the_column text generated always as ('the original generated value') stored,
  the_column2 text
);
-- desired:
create table demo(
  id integer primary key,
  the_column text,
  the_column2 text generated always as ('the original generated value') stored
);
-- output:
alter table demo rename to __sqlfu_old_demo;
create table demo(
  id integer primary key,
  the_column text,
  the_column2 text generated always as ('the original generated value') stored
);
insert into demo(id) select id from __sqlfu_old_demo;
drop table __sqlfu_old_demo;
-- #endregion

-- #region: sqlite-migra generated_added
-- baseline:
create table demo(
  id integer primary key,
  the_column text
);
-- desired:
create table demo(
  id integer primary key,
  the_column text generated always as ('the original generated value') stored
);
-- output:
alter table demo rename to __sqlfu_old_demo;
create table demo(
  id integer primary key,
  the_column text generated always as ('the original generated value') stored
);
insert into demo(id) select id from __sqlfu_old_demo;
drop table __sqlfu_old_demo;
-- #endregion

-- #region: sqlite-migra multi_column_index
-- baseline:
create table a(id int primary key not null);

create table b(id int primary key not null);

create table ab(
  id int primary key not null,
  a_id int not null,
  b_id int not null
);
-- desired:
create table a(id int primary key not null);

create table b(id int primary key not null);

create table ab(
  id int primary key not null,
  a_id int not null,
  b_id int not null
);

create unique index ab_a_id_b_id on ab(a_id, b_id);
-- output:
create unique index ab_a_id_b_id on ab(a_id, b_id);
-- #endregion

-- #region: sqlite-migra triggers
-- baseline:
create table emp(
  empname text,
  salary integer
);

create table audit_log(message text);

create trigger emp_stamp after update on emp begin
  insert into audit_log(message) values ('stamp:' || new.empname);
end;

create trigger emp_stamp_drop after insert on emp begin
  insert into audit_log(message) values ('drop:' || new.empname);
end;
-- desired:
create table emp(
  empname text,
  salary integer
);

create table audit_log(message text);

create trigger emp_stamp after update on emp begin
  insert into audit_log(message) values ('updated:' || new.empname);
end;

create trigger emp_stamp_create after insert on emp begin
  insert into audit_log(message) values ('create:' || new.empname);
end;
-- output:
drop trigger emp_stamp;
drop trigger emp_stamp_drop;
create trigger emp_stamp after update on emp begin
insert into audit_log(message) values ('updated:' || new.empname);
end;
create trigger emp_stamp_create after insert on emp begin
insert into audit_log(message) values ('create:' || new.empname);
end;
-- #endregion

-- #region: sqlite-migra triggers2
-- baseline:
create table table1(
  id integer primary key
);

create table table2(
  id integer primary key,
  t text
);

create table audit_log(message text);

create trigger trigger_name_1 after insert on table1 begin
  insert into audit_log(message) values ('t1');
end;

create trigger trigger_name_2 after insert on table2 begin
  insert into audit_log(message) values ('t2');
end;
-- desired:
create table table1(
  id integer primary key
);

create table table2(
  id integer primary key
);

create table audit_log(message text);

create trigger trigger_name_2 after insert on table2 begin
  insert into audit_log(message) values ('t2');
end;

create trigger trigger_name_1 after insert on table1 begin
  insert into audit_log(message) values ('t1');
end;
-- output:
alter table table2 drop column t;
-- #endregion

-- #region: sqlite-migra triggers3
-- baseline:
create table my_table(
  some_text text,
  some_count int
);

create view view_on_table as
select some_text, some_count from my_table;

create trigger trigger_on_view instead of insert on view_on_table begin
  insert into my_table(some_text) values (new.some_text);
end;
-- desired:
create table my_table(
  some_text text,
  some_date text,
  some_count int
);

create view view_on_table as
select some_text, some_date, some_count from my_table;

create trigger trigger_on_view instead of insert on view_on_table begin
  insert into my_table(some_text, some_date) values (new.some_text, new.some_date);
end;
-- output:
drop trigger trigger_on_view;
drop view view_on_table;
alter table my_table rename to __sqlfu_old_my_table;
create table my_table(
  some_text text,
  some_date text,
  some_count int
);
insert into my_table(some_text, some_count) select some_text, some_count from __sqlfu_old_my_table;
drop table __sqlfu_old_my_table;
create view view_on_table as
select some_text, some_date, some_count from my_table;
create trigger trigger_on_view instead of insert on view_on_table begin
insert into my_table(some_text, some_date) values (new.some_text, new.some_date);
end;
-- #endregion
