drop trigger "trigger_name_2";
alter table table2 rename to __sqlfu_old_table2;
create table table2(
id integer primary key
);
insert into table2("id") select "id" from __sqlfu_old_table2;
drop table __sqlfu_old_table2;
create trigger trigger_name_2 after insert on table2 begin
insert into audit_log(message) values ('t2');
end;
