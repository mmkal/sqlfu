---
status: in-progress
size: large
---

# `config.db` should be pluggable (a callback, not just a path)

## High-level status

Scope expanded after a mid-PR grill: shipping just the factory form
without the typegen fix would expose a new slow path — every
`sqlfu generate` spinning up Miniflare / opening the live DB just to
read a schema that's already on disk in `definitions.sql`. So this PR
now folds in `tasks/generate-self-contained.md` and ships both halves:

1. **Pluggable `db`.** `config.db` accepts `string | SqlfuDbFactory |
   undefined`. Commands that need the DB flow through
   `openConfigDb(config.db)`; undefined throws a clear error only at
   call time, so projects whose `generate` doesn't need a live DB can
   omit `db` entirely.
2. **`generate.authority` knob.** New `authority` option on the
   `generate` config block, default `desired_schema`. Four values:
   `desired_schema` (read `definitions.sql` directly), `migrations`
   (replay `migrations/*.sql`), `migration_history` (read
   `sqlfu_migrations` from the live DB, replay the matching files —
   throws on dangling pointers), `live_schema` (old behaviour; extract
   from live DB).

Both halves done. Tests, README, cleanup landed. Pending review.

## The problem

A user integrating sqlfu on Cloudflare D1 noticed: `pnpm dev` and `npx sqlfu`
operate on **different physical databases**. `pnpm dev` talks to miniflare's
D1 (a sqlite file under `.alchemy/miniflare/v3/d1/…`). `npx sqlfu` talks to
`./.sqlfu/dev.sqlite`. Both happen to have the same schema — because the
same migrations ran through two different code paths — but they will drift
the moment anything writes to one without the other, and they never share
data.

`SqlfuConfig.db: string` is doing two jobs today:

1. **Typegen schema source** — `sqlfu generate` reads schema from it.
2. **Dev database** — `sqlfu migrate` writes to it, `sqlfu check` compares
   against it, the UI browses its rows.

For adapter-mediated DBs (D1, Turso, libsql remote, miniflare bindings),
those two jobs are never the same thing. `config.db` ends up being a scratch
file the app never reads.

## Shape of the fix

Make `db` **pluggable** — accept either the existing string path (sugar for
opening a local sqlite file) or a factory that returns a
`DisposableAsyncClient`. Same disposable shape sqlfu already uses inside
`SqlfuHost.openDb`.

```ts
// sqlfu.config.ts
import {defineConfig, createD1Client} from 'sqlfu';
import {Miniflare} from 'miniflare';

export default defineConfig({
  db: async () => {
    const mf = new Miniflare({
      script: '', modules: true,
      defaultPersistRoot: '.alchemy/miniflare/v3',
      d1Persist: true,
      d1Databases: {DB: '<dev-db-id>'},
    });
    await mf.ready;
    const d1 = await mf.getD1Database('DB');
    return {
      client: createD1Client(d1),
      async [Symbol.asyncDispose]() { await mf.dispose(); },
    };
  },
  // ...
});
```

Classic local case stays: `db: './app.sqlite'` is equivalent to a factory
that opens that file via `node:sqlite`.

## Decisions (previously grilling questions)

These are now locked in for this task. Grilling-question framing in the
original task is preserved in git history; the ones relevant to scope are
resolved below.

- **Field name.** Keep `db` — it now means "the DB sqlfu talks to,"
  whatever the user says that is. No new field (`typegenSchemaSource`
  etc.); the typegen-doesn't-need-the-DB half is deferred to
  `generate-self-contained`.
- **Backward compat.** Zero users; this is pre-alpha. String form stays as
  sugar because it's a useful UX, *not* as a compat shim. No legacy
  fallback code.
- **Memoization.** The factory is invoked on every `host.openDb(config)`
  call. Users who need to share an expensive resource (e.g. a miniflare
  instance) memoize inside their factory. sqlfu does not auto-memoize,
  which keeps the `await using` dispose contract honest (each disposable
  is independent).
- **Typegen DB.** Typegen still reads schema from `config.db` (calling the
  factory if present) and then materialises a scratch sqlite file at
  `.sqlfu/typegen.db` for the TypeSQL analyser. Deferring the
  "typegen shouldn't need the DB" story to `generate-self-contained`.
- **Dispose lifecycle.** All commands already use `await using database =
  await context.host.openDb(context.config);` — that continues to work,
  and the factory's returned `[Symbol.asyncDispose]` is what runs on scope
  exit.
- **UI + remote / guardrails / concurrency tests.** Out of scope here.
  Those are follow-ups — this task ships the primitive; the guardrails
  and multi-process-sqlite stress tests come later.
- **Env switching.** Out of scope. Users handle that inside their factory
  (`process.env.SQLFU_ENV`, etc.).
- **Durable Objects.** Out of scope — DO storage is only addressable from
  inside a worker runtime.

## Implementation plan

- [x] Move `DisposableAsyncClient` from `src/host.ts` to `src/types.ts`
  _so the factory type can live alongside the rest of the config shape.
  `src/host.ts` re-exports it so the existing `import ... from './host.js'`
  callers keep working._
- [x] Add `SqlfuDbFactory` to `src/types.ts`:
  `() => DisposableAsyncClient | Promise<DisposableAsyncClient>`.
- [x] Change `SqlfuConfig.db` and `SqlfuProjectConfig.db` to
  `string | SqlfuDbFactory`.
- [x] Update `assertConfigShape` in `src/config.ts` to accept a function
  as well as a string for `db`. _Dedicated error message: "db must be a
  filesystem path or a factory function returning a DisposableAsyncClient"._
- [x] Update `resolveProjectConfig`: string → resolved absolute path;
  function → passthrough.
- [x] Extract `openLocalSqliteFile(dbPath)` from `openNodeDb` inside
  `createNodeHost`. _Exported from `src/node/host.ts` as a reusable
  helper. Also added `openConfigDb(db)` — the dispatcher for
  `string | factory` — so `SqlfuHost.openDb` is a thin wrapper._
- [x] `createNodeHost.openDb(config)` now dispatches through
  `openConfigDb(config.db)`.
- [x] `src/typegen/index.ts` `materializeTypegenDatabase(config)`: reads
  schema from the real DB via a new `readSchemaFromConfigDb(db)` that
  handles both shapes, then materialises into `.sqlfu/typegen.db` as
  before.
- [x] Export `SqlfuDbFactory` from `src/index.ts`. _Re-exported
  transitively via `export * from './types.js'`._
- [x] Integration test at `packages/sqlfu/test/config-db-factory.test.ts`:
  defines a config whose `db` is a factory wrapping a file-backed
  better-sqlite3, runs `applyMigrateSql` + `getCheckMismatches`,
  asserts factory invocations/disposals and post-migrate DB state.
- [x] Existing test suite still passes (`pnpm test:node` — 1305 passed,
  9 skipped). UI Playwright suite had one known-flaky grid test
  (`appended rows focus the clicked cell`) that passed on retry;
  unrelated to this change.
- [x] Update `packages/sqlfu/README.md` with a "Pluggable `db`" section
  and a miniflare/D1 example.

### Part 2 — `generate.authority`

- [x] Add `SqlfuAuthority` union type to `src/types.ts`.
- [x] Add optional `authority?: SqlfuAuthority` to
  `SqlfuGenerateConfig`; resolves to `'desired_schema'` by default in
  `SqlfuProjectConfig.generate.authority`.
- [x] Make `SqlfuConfig.db` / `SqlfuProjectConfig.db` optional.
  `assertConfigShape` / `resolveProjectConfig` updated.
- [x] `openConfigDb` throws a named, actionable error when `db` is
  missing: _"this command needs a database, but `db` is not set in
  sqlfu.config.ts. Add `db: …` and rerun."_
- [x] Refactor typegen: `materializeTypegenDatabase` dispatches through
  `readSchemaForAuthority(config)` which fans out to
  `readDefinitionsAsSchemaSql`, `replayMigrationFilesAsSchemaSql`,
  `replayMigrationHistoryAsSchemaSql`, or `readLiveSchema`. All paths
  exclude `sqlfu_migrations` from the extracted schema (pre-existing
  mini-bug: typegen used to leak the bookkeeping table into generated
  types if the user had run `sqlfu migrate` first).
- [x] `describeConfigDb` renders `"(not configured)"` for undefined.
- [x] New `test/generate-authority.test.ts`: one test per authority,
  plus a "dangling migration_history pointer throws" test, plus an
  "omitting db with `desired_schema` is fine" test, plus a
  "`live_schema` without db throws at generate time" test. 5 tests, all
  passing.
- [x] README updated: optional-field split, new "`generate.authority`"
  section, command-reference note ("generate reads definitions.sql by
  default").
- [x] Deleted `tasks/generate-self-contained.md` (superseded).

## Out of scope (explicit non-goals for this PR)

- UI readonly / confirm-before-destructive guardrails when `db` points at
  a remote.
- Concurrency / multi-process sqlite stress tests (miniflare + sqlfu
  sharing a persisted file).
- A built-in factory memoization layer.
- Durable Object factories (runtime-only, cannot be driven from config).

## Prior art / links

- `tasks/generate-self-contained.md` — the typegen-schema-source half.
- `tasks/real-db-testing.md` — adapter-level remote testing.
- [`iterate/iterate#1278`](https://github.com/iterate/iterate/pull/1278) —
  the D1 integration that first exposed the two-databases divergence.

---

## Implementation notes

(Populated as the work progresses.)
