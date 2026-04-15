alter table demo rename to __sqlfu_old_demo;
create table demo(
id integer primary key,
the_column text,
the_column2 text generated always as ('the original generated value') stored
);
insert into demo("id") select "id" from __sqlfu_old_demo;
drop table __sqlfu_old_demo;
