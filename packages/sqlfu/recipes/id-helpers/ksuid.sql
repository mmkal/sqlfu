-- sqlfu recipe: ksuid (sqlite-friendly variant)
--
-- Generates 32-char time-sortable ids with the KSUID payload shape:
--   * 4 bytes: unix seconds since the KSUID epoch 2014-05-13 16:53:20 UTC
--     (unix time 1_400_000_000)
--   * 16 bytes: entropy
--
-- Canonical KSUID (https://github.com/segmentio/ksuid) encodes this 20-byte
-- payload in base62 → 27 chars. Base62 encoding of a 160-bit integer needs
-- repeated 160-bit divmod, which pure sqlite SQL cannot do cleanly (no
-- native big-int). So this recipe encodes the same payload in **Crockford
-- base32** → 32 chars.
--
-- What you keep:
--   * Lexicographic sort by time (the first 7 chars encode 32-bit seconds).
--   * 128 bits of entropy per id.
-- What you lose:
--   * Byte-for-byte interop with canonical KSUID libraries. If a downstream
--     system parses "real" KSUIDs, use a library-side generator instead.
--
-- Attribution:
--   KSUID spec and payload layout are by Segment (segment.io / segmentio).
--   This pure-SQL sqlite port is written from scratch; it reuses the
--   bit-walking approach from the sqlfu ULID recipe.
--
-- Notes:
--   * Pure SQL: no extensions, no loadable modules.
--   * Requires sqlite >= 3.8.3 (for `with recursive`).
--   * In an INSERT ... SELECT across many rows, a scalar subquery to this
--     view may be cached. Use the per-row trigger pattern below for bulk
--     inserts.
--
-- Usage (per-row trigger):
--
--   create table events (
--     id text primary key default '',
--     payload text not null
--   );
--   create trigger events_id_fill after insert on events when new.id = '' begin
--     update events set id = (select id from sqlfu_ksuid) where rowid = new.rowid;
--   end;

create view if not exists sqlfu_ksuid as
with recursive
  -- 4 bytes of unix seconds since KSUID epoch.
  ts(t) as (
    select cast(strftime('%s', 'now') as integer) - 1400000000
  ),
  -- 8-char time hex (32 bits) + 32-char random hex (128 bits) = 40 hex chars.
  hexstr(hx) as (
    select printf('%08x', (select t from ts)) || lower(hex(randomblob(16)))
  ),
  -- Turn 40 hex chars into a 160-bit binary string. 160 is not a multiple
  -- of 5, so we pad 3 leading zero bits to reach 160 -> we pad to 160 + 3 = 163
  -- Wait: 160 / 5 = 32 exactly, so we only need 32 chunks and no padding.
  bit_gen(n, b) as (
    select 0, ''
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
    where n < 40
  ),
  bits160(b) as (select b from bit_gen where n = 40),
  gen(n, s) as (
    select 1, ''
    union all
    select
      n + 1,
      s || substr(
        '0123456789ABCDEFGHJKMNPQRSTVWXYZ',
        1
          + (case substr((select b from bits160), 5 * (n - 1) + 1, 1) when '1' then 16 else 0 end)
          + (case substr((select b from bits160), 5 * (n - 1) + 2, 1) when '1' then 8 else 0 end)
          + (case substr((select b from bits160), 5 * (n - 1) + 3, 1) when '1' then 4 else 0 end)
          + (case substr((select b from bits160), 5 * (n - 1) + 4, 1) when '1' then 2 else 0 end)
          + (case substr((select b from bits160), 5 * (n - 1) + 5, 1) when '1' then 1 else 0 end),
        1
      )
    from gen
    where n <= 32
  )
select s as id from gen where n = 33;
