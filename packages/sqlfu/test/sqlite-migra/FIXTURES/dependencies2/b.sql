create table t_data(
  id integer,
  name text
);

create view data as
select * from t_data;

create view q as
select * from data;
