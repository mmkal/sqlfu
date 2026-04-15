drop trigger "trigger_on_view";
drop view "view_on_table";
alter table my_table rename to __sqlfu_old_my_table;
create table my_table(
some_text text,
some_date text,
some_count int
);
insert into my_table("some_text", "some_count") select "some_text", "some_count" from __sqlfu_old_my_table;
drop table __sqlfu_old_my_table;
create view view_on_table as
select some_text, some_date, some_count from my_table;
create trigger trigger_on_view instead of insert on view_on_table begin
insert into my_table(some_text, some_date) values (new.some_text, new.some_date);
end;
