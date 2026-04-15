alter table t rename to __sqlfu_old_t;
create table t(
a text,
b text collate rtrim,
c text collate rtrim
);
insert into t("a", "b") select "a", "b" from __sqlfu_old_t;
drop table __sqlfu_old_t;
