create table emp(
  empname text,
  salary integer
);

create table audit_log(message text);

create trigger emp_stamp after update on emp begin
  insert into audit_log(message) values ('stamp:' || new.empname);
end;

create trigger emp_stamp_drop after insert on emp begin
  insert into audit_log(message) values ('drop:' || new.empname);
end;
