select name, type
from sqlite_schema
where name not like 'sqlite_%'
order by type, name;

in "SQL runner" shows: "no such column: name" even though it works fine
(i guess we're excluding sqlite_ tables or some such?)