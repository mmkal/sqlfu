-- sqlfu's own internal schema — the source of truth for the `sqlfu_migrations` table
-- typegen reads against. Row type emitted as `SqlfuMigrationsRow`, imported by
-- src/migrations/index.ts. Not shipped to users — only consumed by typegen at build time.
create table sqlfu_migrations (
  name text primary key check (name not like '%.sql'),
  checksum text not null,
  applied_at text not null
);
