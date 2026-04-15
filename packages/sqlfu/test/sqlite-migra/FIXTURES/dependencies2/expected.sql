create table t_data(
id integer,
name text
);
drop table "data";
create view data as
select * from t_data;
