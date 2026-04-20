-- sqlfu recipe: nanoid
--
-- Generates nanoid-compatible 21-char ids from the standard URL-safe alphabet.
-- Paste this entire file into your definitions.sql, then reference the view
-- from a trigger on the table that owns the id column (see "usage" below).
--
-- Attribution:
--   The id scheme is nanoid (https://github.com/ai/nanoid) by Andrey Sitnik.
--   This pure-SQL port is trivial: take 21 random bytes and index each one
--   into the 64-char URL-safe alphabet. There is a *tiny* modulo bias because
--   256 is not divisible by 64 — actually 256 % 64 == 0, so the bias is zero
--   here; the byte-to-index mapping is uniform.
--
-- Notes:
--   * Pure SQL: no extensions, no loadable modules.
--   * Requires sqlite >= 3.8.3 (for `with recursive`).
--   * Each `select id from sqlfu_nanoid` returns a fresh id. When used as a
--     scalar subquery inside a single INSERT ... SELECT, sqlite may cache the
--     result across rows; use a correlated reference or a per-row trigger
--     (see usage) if you need one id per row.
--
-- Usage (per-row trigger, the most reliable pattern):
--
--   create table things (
--     id text primary key default '',
--     name text not null
--   );
--   create trigger things_id_fill after insert on things when new.id = '' begin
--     update things set id = (select id from sqlfu_nanoid) where rowid = new.rowid;
--   end;
--
-- Then: insert into things (name) values ('hello');

create view if not exists sqlfu_nanoid as
with recursive
  raw(hx) as (select lower(hex(randomblob(21)))),
  gen(n, s) as (
    select 1, ''
    union all
    select
      n + 1,
      s || substr(
        'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict',
        (
          (
            (instr('0123456789abcdef', substr((select hx from raw), n * 2 - 1, 1)) - 1) * 16
            + (instr('0123456789abcdef', substr((select hx from raw), n * 2, 1)) - 1)
          ) % 64
        ) + 1,
        1
      )
    from gen
    where n <= 21
  )
select s as id from gen where n = 22;
