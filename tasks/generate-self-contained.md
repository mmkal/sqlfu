---
status: needs-grilling
size: medium
---

`sqlfu generate` currently requires `config.db` to be a pre-populated SQLite file at the correct schema. It opens `config.db`, extracts the live schema via `extractSchema`, re-materializes it into a typegen scratch db, and only then runs query analysis. That means any user of sqlfu who isn't also running their app against a local SQLite file (e.g. sqlfu consumers on D1, Postgres-via-some-shim, or anything where the "real" database is remote/ephemeral) has to hand-roll a seed step just to keep `config.db` up to date for typegen.

Concretely: in [iterate/iterate#1278](https://github.com/iterate/iterate/pull/1278) we ended up with a `scripts/sqlfu-seed.mjs` that manually replays every migration against a throwaway `node:sqlite` file and writes matching `sqlfu_migrations` rows. This exists only because `sqlfu generate` won't do it itself. Making `generate` self-contained would delete that script entirely.

## Direction (not final)

Introduce an `authority` option that lets the user pick the schema source of truth for `sqlfu generate` (and probably for other schema-derived operations — `check`, typegen, etc):

```ts
// sqlfu.config.ts
export default {
  // ...
  authority: 'desired_schema', // the default
};
```

Proposed values:

- `desired_schema` — read `definitions.sql` directly. Zero dependency on the state of the live/dev db. Fastest and most deterministic. Good default.
- `migrations` — replay `migrations/*.sql` into a scratch db, extract from there. Useful when you want typegen to reflect exactly what migrations produce (catches drift from `definitions.sql` implicitly).
- `migration_history` — use only migrations already recorded in `sqlfu_migrations` on the live db. Weird but possibly useful for production-parity scenarios.
- `live_schema` — current behavior. Extract from `config.db`. Requires the user to keep the dev db populated.

## Grilling questions

- Is `desired_schema` actually the right default? It means a user whose `definitions.sql` has drifted from migrations gets typegen that reflects the drift. That's arguably a feature (typegen follows intent), but `sqlfu check` should already catch the drift loudly.
- Should `authority` apply to just `generate`, or to everything schema-shaped (check, sync, diff engine)? Probably just generate for now — the others have their own well-defined semantics.
- How does this interact with the `db` config field? Options: keep `db` required and just not use it for generate when authority ≠ live_schema; make `db` optional when authority is schema-based; split the config (`db` for live ops, `authority` for schema-derived ops).
- Migration from current behavior: do we silently switch defaults or gate the new behavior behind explicit `authority: 'desired_schema'` and leave the default as `live_schema` for one release?
- Naming: `authority` vs `schemaSource` vs `typegenSource`. `authority` is broader if we eventually want it to influence more than generate.

## Shortcut path

If the full `authority` design takes a while, a smaller shippable change that unblocks most of the pain: make `sqlfu generate` *fall back* to replaying migrations when `config.db` doesn't exist or is empty. No config option, just a convention. User provides `migrations/` and `definitions.sql`, generate does the rest.

## Prior art

- [`iterate/iterate#1278`](https://github.com/iterate/iterate/pull/1278) `scripts/sqlfu-seed.mjs` — the workaround that motivates this task.
- [`mmkal/sqlfu#52`](https://github.com/mmkal/sqlfu/pull/52) adds `sqlfu migrate --yes` / non-TTY auto-accept, which was the stopgap so that `sqlfu migrate && sqlfu generate` could run scripted. With this task done, even that composition becomes optional for the typegen path.
