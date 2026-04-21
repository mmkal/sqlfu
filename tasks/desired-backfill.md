---
status: needs-grilling
size: medium
---

maybe impossible/not advisable, but it would be interesting to see if we can think of a way to define a backfill in the desired schema itself. i still dont like how the backfill of `create table person(name text not null)` -> `create table person(firstname text not null, lastname text not null)` is hidden away in a migration that people have to manually edit. let us think ont
