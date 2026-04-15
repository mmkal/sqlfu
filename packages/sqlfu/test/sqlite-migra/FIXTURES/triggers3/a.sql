create table my_table(
  some_text text,
  some_count int
);

create view view_on_table as
select some_text, some_count from my_table;

create trigger trigger_on_view instead of insert on view_on_table begin
  insert into my_table(some_text) values (new.some_text);
end;
