-- sqlfu recipe: ulid
--
-- Generates canonical 26-char Crockford-base32 ULIDs
-- (https://github.com/ulid/spec):
--   * first 10 chars: 48-bit unix-ms timestamp (padded with 2 leading zero
--     bits), sortable lexicographically
--   * last 16 chars: 80 bits of entropy
--
-- Paste the whole file into your definitions.sql, then reference the view
-- from a trigger on each table that owns a ULID column (see "usage" below).
--
-- Attribution:
--   Inspired by the sqlite ULID gists in the wild (including variants
--   attributed to Paul Copplestone). This implementation is written from
--   scratch against the ULID spec, using a recursive CTE to walk the
--   128-bit payload one 5-bit chunk at a time.
--
-- Deviations from spec:
--   * No monotonic guarantee within the same millisecond. Two ULIDs created
--     in the same ms will have the same time prefix but independent entropy.
--     Collision is astronomically unlikely (80 bits), but strict monotonic
--     ordering within a ms is not provided.
--   * The "set high bit on overflow" rule for monotonic ULIDs is not
--     implemented (no counter kept).
--
-- Notes:
--   * Pure SQL: no extensions, no loadable modules.
--   * Requires sqlite >= 3.8.3 (for `with recursive`).
--   * In an INSERT ... SELECT across many rows, a scalar subquery to this
--     view may be cached. Use the per-row trigger pattern below for bulk
--     inserts.
--
-- Usage (per-row trigger, the most reliable pattern):
--
--   create table events (
--     id text primary key default '',
--     payload text not null
--   );
--   create trigger events_id_fill after insert on events when new.id = '' begin
--     update events set id = (select id from sqlfu_ulid) where rowid = new.rowid;
--   end;

create view if not exists sqlfu_ulid as
with recursive
  -- Unix ms timestamp. julianday-based derivation avoids needing strftime('%f')
  -- arithmetic.
  ts(t) as (
    select cast(round((julianday('now') - 2440587.5) * 86400.0 * 1000) as integer)
  ),
  -- 12-char time hex (48 bits) + 20-char random hex (80 bits) = 32 hex chars.
  hexstr(hx) as (
    select printf('%012x', (select t from ts)) || lower(hex(randomblob(10)))
  ),
  -- Turn those 32 hex chars into a 128-bit binary string via recursive
  -- concat (order is guaranteed by recursion). Prepend 2 zero bits to reach
  -- 130 bits = 26 * 5.
  bit_gen(n, b) as (
    select 0, '00'
    union all
    select
      n + 1,
      b || case substr((select hx from hexstr), n + 1, 1)
        when '0' then '0000' when '1' then '0001' when '2' then '0010' when '3' then '0011'
        when '4' then '0100' when '5' then '0101' when '6' then '0110' when '7' then '0111'
        when '8' then '1000' when '9' then '1001' when 'a' then '1010' when 'b' then '1011'
        when 'c' then '1100' when 'd' then '1101' when 'e' then '1110' when 'f' then '1111'
      end
    from bit_gen
    where n < 32
  ),
  bits130(b) as (select b from bit_gen where n = 32),
  -- Walk 26 five-bit chunks and map each to a Crockford base32 char.
  gen(n, s) as (
    select 1, ''
    union all
    select
      n + 1,
      s || substr(
        '0123456789ABCDEFGHJKMNPQRSTVWXYZ',
        1
          + (case substr((select b from bits130), 5 * (n - 1) + 1, 1) when '1' then 16 else 0 end)
          + (case substr((select b from bits130), 5 * (n - 1) + 2, 1) when '1' then 8 else 0 end)
          + (case substr((select b from bits130), 5 * (n - 1) + 3, 1) when '1' then 4 else 0 end)
          + (case substr((select b from bits130), 5 * (n - 1) + 4, 1) when '1' then 2 else 0 end)
          + (case substr((select b from bits130), 5 * (n - 1) + 5, 1) when '1' then 1 else 0 end),
        1
      )
    from gen
    where n <= 26
  )
select s as id from gen where n = 27;
