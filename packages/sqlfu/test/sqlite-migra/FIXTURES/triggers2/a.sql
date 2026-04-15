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
