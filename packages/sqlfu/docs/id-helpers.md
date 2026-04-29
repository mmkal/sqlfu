# Pure-SQL id generators (ulid, ksuid, nanoid, cuid2)

If you want `ulid`, `ksuid`, `nanoid`, or a cuid2-shaped id as a column default in a sqlfu project, you do not need an extension, a loadable module, or application-side code. Paste a small SQL view into your `definitions.sql` and fire it from a per-row trigger.

This page is a recipe catalog. The SQL is copy-paste. The snippets live under [`packages/sqlfu/recipes/id-helpers/`](https://github.com/mmkal/sqlfu/tree/main/packages/sqlfu/recipes/id-helpers) in the repo; you can also grab them from there.

## Why this lives in `definitions.sql`

`definitions.sql` is where your SQL vocabulary lives: tables, views, triggers, and (if you want them) your own id generators. Because it is just SQL you wrote, a pasted generator participates in schema diff, migrations, and type-gen exactly like a table you authored. There is no `sqlfu.idGenerator = 'ulid'` config knob and there is not going to be one. Pick the scheme you like, paste the view, and move on.

## Pick a scheme

|  | Length | Alphabet | Sortable by time? | Collision resistance | Canonical-spec compliant? |
| --- | --- | --- | --- | --- | --- |
| `sqlfu_nanoid` | 21 | URL-safe 64 (`A-Za-z0-9_-`) | no | ~126 bits random | yes |
| `sqlfu_cuid2` | 24 | lowercase + digits, starts with letter | no | 128 bits random | **surface-only** (sqlite has no sha3) |
| `sqlfu_ulid` | 26 | Crockford base32 | yes (48-bit ms time prefix) | 80 bits random | yes (no in-ms monotonic counter) |
| `sqlfu_ksuid` | **32** | Crockford base32 | yes (32-bit sec time prefix, KSUID epoch) | 128 bits random | **encoding deviation** (canonical is 27-char base62) |

Quick picker:

- **You want a short, random, URL-safe id and don't care about ordering:** `sqlfu_nanoid`.
- **You want a cuid2-looking id for API-surface compatibility:** `sqlfu_cuid2`. Read the caveat first; it is not algorithm-compatible.
- **You want a 128-bit sortable id with ms precision:** `sqlfu_ulid`. Most general-purpose choice.
- **You specifically want the KSUID payload layout (seconds since 2014-05-13 + 16 random bytes):** `sqlfu_ksuid`. Note it is emitted in base32, not base62.

## Caveats, out loud

- **Pure SQL only.** Stock sqlite has no sha3, no hmac, no strong hashing. Recipes that would require those are either dropped or ship as "surface-compatible" (cuid2). The tradeoffs are spelled out in each file header.
- **Scalar-subquery caching in bulk inserts.** If you write `insert into t (id, ...) select (select id from sqlfu_ulid), ... from src`, sqlite may evaluate the subquery once and reuse the result. Use the trigger pattern below for per-row ids.
- **Time-prefix monotonicity.** `sqlfu_ulid` is monotonic across millisecond boundaries; within the same ms, two ulids will share a time prefix but have independent entropy. `sqlfu_ksuid` is the same but with second precision. Neither scheme maintains an in-interval counter. If you need strict monotonic ids inside the same ms, generate the id application-side.
- **SQLite version.** All recipes use `with recursive`; any sqlite from 2014 onward (3.8.3+) is fine.

## The trigger pattern

Each recipe defines a view that returns one fresh id per `select`. The cleanest way to plumb it into a table is a per-row AFTER INSERT trigger:

```sql
create table events (
  id text primary key default '',
  payload text not null
);

create trigger events_id_fill after insert on events when new.id = '' begin
  update events set id = (select id from sqlfu_ulid) where rowid = new.rowid;
end;
```

Then:

```sql
insert into events (payload) values ('hello');
-- row is written with a freshly-generated 26-char ulid as id.
```

Swap `sqlfu_ulid` for `sqlfu_ksuid`, `sqlfu_nanoid`, or `sqlfu_cuid2` as desired.

The `default ''` + `when new.id = ''` guard lets callers pass an explicit id when they want to (bulk import, replayed events) and auto-fill otherwise.

## Recipes

All snippets live in the repo under [`packages/sqlfu/recipes/id-helpers/`](https://github.com/mmkal/sqlfu/tree/main/packages/sqlfu/recipes/id-helpers). Each file is self-contained: paste the whole thing. The header comment in each file explains the scheme, the attribution, and the deviations (if any) from the upstream spec.

### `sqlfu_nanoid`: 21 chars, URL-safe

See [`recipes/id-helpers/nanoid.sql`](https://github.com/mmkal/sqlfu/blob/main/packages/sqlfu/recipes/id-helpers/nanoid.sql). Based on [nanoid](https://github.com/ai/nanoid) by Andrey Sitnik.

### `sqlfu_cuid2`: 24 chars, letter-prefixed

See [`recipes/id-helpers/cuid2.sql`](https://github.com/mmkal/sqlfu/blob/main/packages/sqlfu/recipes/id-helpers/cuid2.sql). **Shape-only**: it matches the [cuid2](https://github.com/paralleldrive/cuid2) surface (length, alphabet, letter prefix) but is plainly-random, not hash-mixed. Reach for a library-side cuid2 if you need spec fidelity.

### `sqlfu_ulid`: 26 chars, time-prefixed

See [`recipes/id-helpers/ulid.sql`](https://github.com/mmkal/sqlfu/blob/main/packages/sqlfu/recipes/id-helpers/ulid.sql). Follows the [ULID spec](https://github.com/ulid/spec): 48-bit ms timestamp + 80 bits of randomness, Crockford base32.

### `sqlfu_ksuid`: 32 chars, time-prefixed (base32 variant)

See [`recipes/id-helpers/ksuid.sql`](https://github.com/mmkal/sqlfu/blob/main/packages/sqlfu/recipes/id-helpers/ksuid.sql). Uses the [KSUID](https://github.com/segmentio/ksuid) payload layout (4-byte seconds since 2014-05-13 + 16 bytes random) but emits it as 32-char Crockford base32. Canonical KSUID is 27-char base62, which would need 160-bit divmod in pure SQL.

## Bigger SQL bundles: an open question

The recipes here are tiny (tens of lines). Copy-paste is the whole distribution. That is a deliberate design decision.

If you try to do this with a bigger bundle (a vendored full-text-search layer, a 1000-line audit-log schema, a postgres-style FDB you're porting) `definitions.sql` starts to creak. It has no import directive and no way to say "this 400 lines comes from somewhere else".

## Further reading

- [Schema diff model](./schema-diff-model.md): how `definitions.sql` becomes a diff against live schema.
- [Migration model](./migration-model.md): where a pasted generator ends up in your migration history.
