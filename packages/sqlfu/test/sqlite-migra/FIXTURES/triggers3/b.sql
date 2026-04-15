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
