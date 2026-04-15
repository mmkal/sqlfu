drop trigger "emp_stamp";
drop trigger "emp_stamp_drop";
create trigger emp_stamp after update on emp begin
insert into audit_log(message) values ('updated:' || new.empname);
end;
create trigger emp_stamp_create after insert on emp begin
insert into audit_log(message) values ('create:' || new.empname);
end;
