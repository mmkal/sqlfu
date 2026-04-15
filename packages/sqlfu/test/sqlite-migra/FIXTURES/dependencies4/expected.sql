create table t(
id integer not null primary key,
a text,
b integer
);
drop table "t2";
create view mv as
select id from v;
create view v as
select id, a, max(b) as max_b
from t
group by id;
