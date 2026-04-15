drop view "strange_view(what)";
drop view "switcharoo";
alter table "t" add column "b" int;
create view "strange_view(what)" as
select cast(id as int) * 2 as a from "strange_name(((yo?)))";
create view switcharoo as
select 1 as a, 2 as b;
