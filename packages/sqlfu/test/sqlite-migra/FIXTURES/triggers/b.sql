create table emp(
  empname text,
  salary integer
);

create table audit_log(message text);

create trigger emp_stamp after update on emp begin
  insert into audit_log(message) values ('updated:' || new.empname);
end;

create trigger emp_stamp_create after insert on emp begin
  insert into audit_log(message) values ('create:' || new.empname);
end;
