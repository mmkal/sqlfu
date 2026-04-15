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
