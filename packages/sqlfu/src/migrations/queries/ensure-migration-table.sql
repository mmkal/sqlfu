create table if not exists sqlfu_migrations(
  name text primary key check(name not like '%.sql'),
  checksum text not null,
  applied_at text not null
);
