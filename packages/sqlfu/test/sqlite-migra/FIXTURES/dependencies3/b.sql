create table t(a int, b int);

create view abc as
select a from t;

create view switcharoo as
select 1 as a, 2 as b;

create table "strange_name(((yo?)))"(id text);

create view "strange_view(what)" as
select cast(id as int) * 2 as a from "strange_name(((yo?)))";
