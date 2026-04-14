alter table a rename to __sqlfu_old_a;
create table a(b text not null unique);
insert into a("b") select "b" from __sqlfu_old_a;
drop table __sqlfu_old_a;
