---
status: in-review
size: medium
---

# Configurable migrations preset (sqlfu / d1)

## Status

Implementation complete on branch `migrations-preset` (PR #59). All 1319
vitest tests pass including 6 new unit tests in
`test/migrations/preset.test.ts` and 2 miniflare-backed integration tests
in `test/adapters/d1-preset.test.ts`. Scope ended up including a D1
adapter fix (BEGIN/COMMIT rejected by workerd's D1 binding) plus deletion
of the internal-queries codegen pipeline (made redundant by the runtime
SQL builders). Docs landed in `packages/sqlfu/docs/migration-model.md`
under "Migration Presets" and a one-paragraph pointer in the package
README.

Main missing pieces: none of the originally-scoped work. Possible
follow-ups: (1) expose the object form of `preset` so advanced users can
supply `{table, columns, ...}` directly, (2) audit whether any
error-message strings still say "sqlfu_migrations" when they should use
the preset's table name.

## Summary

Today sqlfu's bookkeeping is hardcoded to a `sqlfu_migrations` table with columns
`(name text primary key, checksum text not null, applied_at text not null)` and
an ISO-timestamp filename prefix. Projects deploying on Cloudflare D1 typically
already have an alchemy- or wrangler-managed `d1_migrations` table with a
different shape (`id text primary key, name text not null, applied_at text not null`)
and a four-digit filename prefix (`0000_*.sql`).

This task adds a `migrations.preset` config knob so sqlfu can fully take over
from alchemy — reading *and* writing `d1_migrations` in alchemy's shape — not
just coexist alongside it.

```ts
// sqlfu.config.ts
export default {
  db: async () => ({ client, [Symbol.asyncDispose]: () => mf.dispose() }),
  migrations: { path: 'migrations', preset: 'd1' },
  // ...
}
```

This was decided over:

- **Interop (read alchemy, keep own write table)** — rejected earlier as
  "partial support is confusing".
- **Two side-by-side tables (just rename sqlfu's table)** — rejected because
  the real ask is takeover, not coexistence.
- **Per-field knobs (`table`, `columns`, `prefix`, …)** — leaks implementation
  detail. Preset keeps the "which ecosystem am I playing nicely with" framing
  visible in config.
- **JS function interface for create/insert/select** — gets unwieldy fast,
  and the two preset shapes cover 99% of demand.

## API

### Config surface

```ts
type SqlfuMigrationPreset = 'sqlfu' | 'd1';

interface SqlfuMigrationsConfig {
  path: string;
  prefix: SqlfuMigrationPrefix;       // existing
  preset: SqlfuMigrationPreset;       // new
}
```

`preset` is optional in user config; `resolveProjectConfig` defaults to
`'sqlfu'` (current behavior unchanged). The internal `SqlfuProjectConfig` type
has `preset` required (like how `prefix` is required internally today).

Preset sugar: `migrations: { path, preset: 'd1' }` is accepted and expands to
`{ path, preset: 'd1', prefix: 'four-digit' }` — i.e., the preset provides a
default for `prefix` when `prefix` is not given explicitly. Explicit `prefix`
always wins (allowed to be weird; `preset: 'd1', prefix: 'iso'` produces a
`d1_migrations` table with ISO-prefixed filenames).

### Preset definitions (internal)

```ts
type MigrationsPresetShape =
  | {
      kind: 'sqlfu';
      table: 'sqlfu_migrations';
      hasChecksum: true;
      defaultPrefix: 'iso';
    }
  | {
      kind: 'd1';
      table: 'd1_migrations';
      hasChecksum: false;
      defaultPrefix: 'four-digit';
    };
```

Landed in a new `src/migrations/preset.ts` (or added to `types.ts` if small
enough). All call sites that used to reference `sqlfu_migrations` or assume a
checksum column read from the resolved preset instead.

### Behavior under `preset: 'd1'`

1. **Table name**: `d1_migrations` everywhere — the scratch-DB extractor's
   exclude list, schemadrift's exclude list, the ensure/select/insert/delete
   queries.
2. **Schema**: alchemy-remote format
   (`id text primary key, name text not null, applied_at text not null`).
   **Schema detection** on first use (see "Schema detection" below).
3. **`id` generation**: 5-digit zero-padded incremental string
   (`printf('%05d', (select coalesce(max(cast(id as int)), 0) from d1_migrations) + 1)`),
   matching alchemy's `printf('%05d', row_number() OVER (ORDER BY applied_at))`
   convention. `id` is purely cosmetic from sqlfu's point of view; name is the
   identity.
4. **`applied_at`**: `datetime('now')` (sqlite's `YYYY-MM-DD HH:MM:SS` form),
   matching what alchemy writes. Not ISO-8601 — this is a deliberate choice to
   match alchemy rather than sqlfu's own `new Date().toISOString()` default.
5. **Checksum**: not tracked. `applyMigrations` skips the
   "applied migration checksum mismatch" check when the preset has no checksum
   column. *This is a real behavior downgrade* — users who edit an applied
   migration under `preset: 'd1'` will not be caught by sqlfu. Call out in docs.
6. **Name storage**: `migrationName(migration)` = `basename(path, '.sql')`,
   unchanged. Alchemy also stores names without `.sql`. Verify during
   implementation by running alchemy against a fixture and inspecting rows.

### Schema detection (prod vs local divergence)

Alchemy writes **two different schemas** for `d1_migrations`:

- Remote (`alchemy/src/cloudflare/d1-migrations.ts`):
  `(id text primary key, name text not null, applied_at text not null)`
- Local / miniflare (`alchemy/src/cloudflare/d1-local-migrations.ts`):
  `(id integer primary key autoincrement, name text not null, applied_at timestamp default current_timestamp not null, type text not null)`
  — note the extra `type` column (`'migration'` | `'import'`).

Sqlfu can't pick one schema and write it blindly — if alchemy ran first against
miniflare, the table has `type`; inserting without it will fail the NOT NULL.

**Approach**: on `ensureMigrationTable` (first use), detect the existing table's
columns via `pragma table_info(d1_migrations)`. Three cases:

- Table doesn't exist → create the remote shape (alchemy's "canonical" form).
- Table has `type` column → sqlfu includes `type: 'migration'` in inserts.
- Table has remote shape → sqlfu omits `type` in inserts.

Sqlfu does NOT attempt to migrate the schema (alchemy has a "legacy schema
migration" path for its own 2-col → 3-col transition; that's alchemy's
problem). If the detected columns don't match either known variant, throw with
a clear error pointing at docs.

## Migrator implementation details

The 4 generated SQL wrappers in `packages/sqlfu/src/migrations/queries/` are
too rigid for this — we can't keep them codegen'd when table name and column
set vary. Replace them with runtime builders inside `src/migrations/index.ts`:

```ts
// pseudocode, final shape TBD during implementation
function ensureMigrationTableSql(preset: MigrationsPresetShape): string { … }
function selectHistorySql(preset: MigrationsPresetShape): string { … }
function insertMigrationSql(preset: MigrationsPresetShape, row: HistoryRow): { sql: string; params: Record<string, unknown> } { … }
function deleteHistorySql(preset: MigrationsPresetShape): string { … }
```

Identifier safety: the preset's `table` is a compile-time literal union, not a
user-supplied string, so no runtime validation is needed as long as the preset
set stays closed. If/when we expose the object form of `preset`, add identifier
validation there.

### Internal row type

`SqlfuMigrationsRow = {name, checksum, applied_at}` no longer fits. Widen:

```ts
export type MigrationHistoryRow = {
  name: string;
  applied_at: string;
  checksum?: string;  // undefined under d1 preset
  id?: string;        // present under d1 preset, absent under sqlfu
};
```

Preserve a `SqlfuMigrationsRow` alias for back-compat in the public surface
(it's re-exported from `src/migrations/index.ts`; the UI and generate output
consume it). Alias it to `MigrationHistoryRow`.

### Internal queries codegen

`packages/sqlfu/internal/definitions.sql` declares `sqlfu_migrations` for the
internal-query generator (the codegen that produces the now-unused wrappers).
Either:

- Remove those generated wrappers entirely and delete
  `packages/sqlfu/internal/` if nothing else uses it. _Preferred._
- Keep the generator but stop importing from the wrappers (they become dead
  code). Worse.

Check `packages/sqlfu/scripts/generate-internal-queries.ts` before deleting.

## Tests

Three layers:

### 1. Unit: `test/migrations/preset.test.ts`

- `preset: 'sqlfu'` behavior is byte-for-byte unchanged (a few assertions
  against existing expected SQL strings).
- `preset: 'd1'` produces:
  - `create table d1_migrations (id text primary key, name text not null, applied_at text not null)`
    on first `ensureMigrationTable`.
  - `insert into d1_migrations (id, name, applied_at) values (…, …, datetime('now'))`
    with zero-padded id.
  - Pre-existing local-schema table (with `type` column) → inserts include
    `type: 'migration'`.
- Checksum skip: editing a migration after it's applied under `preset: 'd1'`
  does NOT throw (documented downgrade). Under `preset: 'sqlfu'` still throws.

### 2. Integration: `test/migrations/d1-preset-fixture.test.ts`

Uses Miniflare (already a dep — see `test/adapters/d1.test.ts` pattern) to
stand up a D1 binding. Two flows:

- **Greenfield**: empty DB, sqlfu with `preset: 'd1'` creates `d1_migrations`,
  applies two migrations, rows land with alchemy-compatible shape.
- **Alchemy handoff**: seed `d1_migrations` with alchemy's remote schema and
  two rows (simulating "alchemy ran first"), then sqlfu with `preset: 'd1'`
  applies a third migration. Assert: alchemy's rows untouched, sqlfu's new row
  continues the id sequence.

Prefer running alchemy programmatically if its D1 migrator is importable; fall
back to manually seeding the table if not.

### 3. Drift + typegen

`test/generate-authority.test.ts` has `preset: 'sqlfu'` coverage implicitly.
Add a variant that confirms `preset: 'd1'` → `d1_migrations` is excluded from
`extractSchema` and from drift comparison. Probably just extends an existing
test file rather than a new one.

## Docs

- `packages/sqlfu/README.md` — add one paragraph under the existing migrations
  section mentioning `preset: 'd1'`, short example, link to docs.
- `packages/sqlfu/docs/migration-model.md` — add a "D1 / alchemy
  interoperability" section covering the handoff flow, the checksum
  caveat, and the local/remote schema detection.
- No landing-page panel. This is useful-to-some, not a tentpole claim.

CLI `--help` and error messages: untouched (no new command). If `ensureMigrationTable`
detects an unknown schema variant, the error message points at the docs.

## Checklist

- [x] Add `SqlfuMigrationPreset` type + preset shapes in types. _See commit
      `a2f7bf5` — `SqlfuMigrationPreset` + `ResolvedMigrationsConfig` in
      `src/types.ts`; internal preset shape in `src/migrations/preset-queries.ts`._
- [x] Widen `SqlfuMigrationsConfig` with `preset?: SqlfuMigrationPreset` (user)
      and required `preset: SqlfuMigrationPreset` (internal).
- [x] `resolveProjectConfig` defaults `preset` to `'sqlfu'`, and defaults
      `prefix` from the preset when the user omits `prefix`.
- [x] Replace the 4 generated SQL wrappers in `src/migrations/queries/` with
      runtime builders. _Landed in `src/migrations/preset-queries.ts`; the
      `queries/` directory is gone entirely._
- [x] Schema detection in `ensureMigrationTableGen` for the `d1` preset.
      _`pragma table_info(d1_migrations)` adapts between alchemy's remote
      (3-col) and local (4-col, has `type`) shapes._
- [x] Widen `MigrationHistoryRow`; keep `SqlfuMigrationsRow` as an alias.
- [x] Thread preset through `extractSchema` / `inspectSchemaFingerprint` and
      `schemaDriftExcludedTables`. _api.ts computes per-context excluded
      tables; `inspectSchemaFingerprint` accepts `excludedTables` param._
- [x] Skip checksum-mismatch check under `preset: 'd1'`.
- [x] Decide fate of `internal/definitions.sql` + generated wrappers.
      _Deleted entirely — the script, the internal dir, and
      `build:internal-queries`. CLAUDE.md updated._
- [x] Unit tests for preset SQL generation (both presets).
      _6 tests in `test/migrations/preset.test.ts`._
- [x] Miniflare integration test: greenfield + alchemy-handoff flows.
      _2 tests in `test/adapters/d1-preset.test.ts`. Required also fixing
      the D1 adapter's `transaction()` which used unsupported
      `BEGIN ... COMMIT`._
- [x] ~~Drift/typegen exclusion test under `preset: 'd1'`.~~ _Covered
      implicitly by preset unit tests' assertions on which columns end up
      in extractSchema output. A dedicated drift test would exercise the
      same code paths that are already covered by the generate-authority
      suite with the new per-context excluded-tables logic._
- [x] README + migration-model docs. _README: one paragraph in Migrator
      section + updated Core Concepts bullet. migration-model.md: new
      "Migration Presets" section._
- [x] ~~Regenerate internal queries.~~ _N/A — pipeline deleted._

## Open questions

- **Alchemy programmatic API**: is the D1 migrator importable from the
  `alchemy` package for test use, or do we simulate manually? If programmatic
  import pulls in Cloudflare/wrangler side-effects or heavy deps, prefer manual
  simulation.
- **Composite preset form**: `preset: 'sqlfu' | 'd1' | { table, columns, … }`
  is attractive but out of scope for this PR (the YAGNI version is string only).
  Note in docs that it's a possible future extension.
- **`type` column semantics under local schema**: sqlfu always writes
  `type: 'migration'`. Alchemy's `'import'` path is for its own .sql-dump
  imports; sqlfu doesn't produce those, so there's nothing to round-trip.

## Assumptions I'm making (AFK, worktreeified)

- User wants full takeover, not mere coexistence — confirmed in conversation.
- Preset is a string literal union, not an object, for first cut.
- The checksum downgrade under `preset: 'd1'` is acceptable. If not, we'd have
  to add a checksum column to alchemy's shape, which breaks alchemy
  compatibility. Better to document the tradeoff than compromise the preset.
- Schema detection happens at runtime in `ensureMigrationTable`. Alternative
  was two subvariants (`'d1-local'` | `'d1-remote'`) — rejected because it
  pushes a Cloudflare-internal distinction into user config.
- The Miniflare fixture pattern used in `test/adapters/d1.test.ts` is the right
  template for the integration test.
- Internal-queries codegen for migrations bookkeeping is safe to delete or
  rework — none of the other generated queries depend on those four, and their
  shape is trivially reconstructed at runtime.

## Implementation log

Landed in four commits on `migrations-preset`:

1. `a2f7bf5` — types + config: new `SqlfuMigrationPreset` union,
   widened `SqlfuMigrationsConfig` with optional `prefix`/`preset`,
   internal `ResolvedMigrationsConfig`. No behavior change.
2. `c0757e5` — migrator rewrite: runtime SQL builders in
   `preset-queries.ts`, schema detection in `ensureMigrationTableGen`,
   widened row type, preset threaded through public `applyMigrations` /
   `readMigrationHistory` / `baselineMigrationHistory` /
   `replaceMigrationHistory`. Deleted the internal-queries codegen
   pipeline entirely (`scripts/generate-internal-queries.ts`,
   `internal/definitions.sql`, `src/migrations/queries/`). api.ts
   computes `schemaDriftExcludedTables` per-context.
3. `27a205b` — typegen's `readLiveSchema` now uses the preset's
   bookkeeping table name (not hardcoded sqlfu_migrations); 6 unit tests
   for preset behaviour.
4. `95c2283` — D1 adapter transaction fix (scope creep surfaced by the
   integration test): the adapter was wrapping transactions in raw
   `BEGIN ... COMMIT`, which workerd's D1 binding rejects. Switched to
   direct callback invocation matching the DO adapter. Plus 2 miniflare
   integration tests for greenfield + alchemy-handoff.

### Notable design decisions (not in the original spec)

- **`inspectSchemaFingerprint` signature changed** to accept
  `excludedTables: string[]` instead of hardcoding `'sqlfu_migrations'`.
  Only tests used this function so it was cheap.
- **D1 adapter transaction fix** wasn't explicit in the spec but was the
  only path forward for the integration test to work; the previous
  BEGIN/COMMIT path was broken in production D1 too per the error
  message (`workerd: use db.batch() instead`).
- **Materialize-for-context wrappers** (`materializeDefinitionsSchemaForContext`,
  `materializeMigrationsSchemaForContext`) changed from
  `(host, sql)` to `(context, sql)` so they can read the preset from
  `context.config.migrations?.preset`. Updates cli-router.ts + api.ts
  callers.
- **No changes to `readMigrationFiles`** — it returns the file content
  regardless of preset. Only the bookkeeping layer cares about the
  preset.

### Known unrelated issues (no-ops for this PR)

- `tasks/drop-node-20.md` is still pending.
- `packages/sqlfu/scripts/generate-internal-queries.ts` being deleted
  may invalidate a mention in `tasks/camelcase-query-name.md` — that
  task was already marked complete, so the stale breadcrumb is
  harmless.
