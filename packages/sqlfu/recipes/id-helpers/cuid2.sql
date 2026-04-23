-- sqlfu recipe: cuid2-shaped
--
-- Generates 24-char ids with the cuid2 surface: starts with a lowercase
-- letter, followed by 23 lowercase alphanumerics. **This is shape-compatible,
-- not algorithm-compatible** — true cuid2 (paralleldrive/cuid2) uses a sha3
-- hash over a machine fingerprint, a monotonic counter, entropy, and time;
-- stock sqlite ships no sha3, so we emit a plainly-random id with the same
-- alphabet and length.
--
-- When you want: "an id that looks like a cuid2 so downstream systems don't
-- complain, but pure-SQL is the whole dependency."
-- When you do NOT want: strict cuid2 compliance (collision-resistance across
-- machines, hash-based entropy mixing). Reach for an application-side id
-- generator in that case, or a server-side extension.
--
-- Attribution:
--   Surface derived from paralleldrive/cuid2
--   (https://github.com/paralleldrive/cuid2). Deviations called out above.
--
-- Usage (trigger pattern, per-row):
--
--   create table things (
--     id text primary key default '',
--     name text not null
--   );
--   create trigger things_id_fill after insert on things when new.id = '' begin
--     update things set id = (select id from sqlfu_cuid2) where rowid = new.rowid;
--   end;

create view if not exists sqlfu_cuid2 as
with recursive
  raw(hx) as (select lower(hex(randomblob(24)))),
  -- first char: letter-only alphabet (26)
  first_char(c) as (
    select substr(
      'abcdefghijklmnopqrstuvwxyz',
      (
        (
          (instr('0123456789abcdef', substr((select hx from raw), 1, 1)) - 1) * 16
          + (instr('0123456789abcdef', substr((select hx from raw), 2, 1)) - 1)
        ) % 26
      ) + 1,
      1
    )
  ),
  gen(n, s) as (
    select 1, (select c from first_char)
    union all
    select
      n + 1,
      s || substr(
        'abcdefghijklmnopqrstuvwxyz0123456789',
        (
          (
            (instr('0123456789abcdef', substr((select hx from raw), n * 2 + 1, 1)) - 1) * 16
            + (instr('0123456789abcdef', substr((select hx from raw), n * 2 + 2, 1)) - 1)
          ) % 36
        ) + 1,
        1
      )
    from gen
    where n < 24
  )
select s as id from gen where n = 24;
