---
status: implemented-mvp
size: large
branch: better-auth-adapter-create-schema
pr: https://github.com/mmkal/sqlfu/pull/73
---

# Better Auth adapter that lets sqlfu own schema diffs

**Status:** Wrapper MVP is implemented and covered by focused integration tests. The new `sqlfu/better-auth` export wraps a passed Better Auth adapter, changes its id to `sqlfu`, and replaces a fenced Better Auth section in `definitions.sql`. Tests cover strict file validation, fenced replacement, Better Auth CLI `auth generate`, reconfiguration, and `sqlfu draft`/`migrate`. The main missing piece is deeper runtime validation with Better Auth's adapter tester or a real Kysely-backed app.

## Problem

Better Auth's `auth generate` is useful because it knows which tables and columns are required for the configured core auth features and plugins. But sqlfu wants `definitions.sql` to remain the complete desired schema for the application: Better Auth tables plus application tables. The desired workflow is:

1. `auth generate` updates the Better Auth-owned part of `definitions.sql`.
2. `sqlfu draft` computes migrations from the changed desired schema.
3. `sqlfu migrate` applies those migrations to the real database.

The Better Auth adapter is mainly valuable for `createSchema`. Runtime operations should use a passed Better Auth adapter, probably the official Kysely adapter, since that already works well. The adapter should not make Better Auth own sqlfu migrations.

## Research Notes

- Better Auth's custom adapter docs describe `createSchema` as optional. The method receives `{ file, tables }`, where `file` is the generate output path and `tables` are the Better Auth schema tables to generate.
- Better Auth's current adapter test helper is `@better-auth/test-utils/adapter` with `testAdapter` and `createTestSuite`. The docs say older `better-auth/adapters/test` exports were removed in v1.5.
- Better Auth's CLI docs now prefer `npx auth@latest generate`; `@better-auth/cli` still appears in older docs and package metadata.
- sqlfu currently treats `definitions.sql` as the desired schema source for `draft`, `sync`, `check`, and `generate.authority: 'desired_schema'`.
- Better Auth `1.6.9` has a separate `@better-auth/kysely-adapter` package. `better-auth/adapters/kysely` re-exports it.
- Better Auth's `generateSchema` checks built-in adapter ids first: `prisma`, `drizzle`, then `kysely`. If the wrapped adapter still returns `id: 'kysely'`, Better Auth uses its built-in Kysely generator and never calls custom `createSchema`.
- The built-in Kysely generator calls `getMigrations(options)` and introspects the configured database. That is intentionally a diff-style generator, so it is not the right implementation for sqlfu's `definitions.sql` ownership flow.
- A quick `auth/api` proof confirmed that `id: 'sqlfu'` calls custom `createSchema`, while `id: 'kysely'` bypasses it and tries the built-in Kysely migration path.

Sources checked:

- https://better-auth.com/docs/guides/create-a-db-adapter#createschema-optional
- https://better-auth.com/docs/guides/create-a-db-adapter#test-your-adapter
- https://better-auth.com/docs/concepts/cli

## Proposed Public Surface

The desired callsite is now a wrapper around a real Better Auth runtime adapter:

```ts
import {betterAuth} from 'better-auth';
import {kyselyAdapter} from 'better-auth/adapters/kysely';
import {sqlfuBetterAuthAdapter} from 'sqlfu/better-auth';
import sqlfuConfig from './sqlfu.config';
import {db} from './db';

export const auth = betterAuth({
  database: sqlfuBetterAuthAdapter({
    sqlfu: sqlfuConfig,
    adapter: kyselyAdapter(db, {type: 'sqlite'}),
  }),
  plugins: [
    // Better Auth plugins that affect schema.
  ],
});
```

The implementation should wrap the adapter factory, not try to spread the factory itself:

```ts
function sqlfuBetterAuthAdapter(input) {
  return (options) => {
    const base = input.adapter(options);

    return {
      ...base,
      id: 'sqlfu',
      options: {
        ...base.options,
        adapterConfig: {
          ...base.options?.adapterConfig,
          adapterId: 'sqlfu',
          adapterName: 'sqlfu Better Auth adapter',
        },
      },
      async createSchema(_options, file) {
        // render Better Auth tables and replace the managed section in definitions.sql
      },
    };
  };
}
```

The wrapper should also consider wrapping `transaction` so adapters passed into transactional callbacks do not leak `id: 'kysely'`, although that may be cosmetic for runtime behavior.

Do not build a full sqlfu CRUD adapter unless this wrapper approach fails in tests.

## Strict MVP Behavior

- [x] Validate the configured output file. `createSchema(_, file)` should throw if `file` does not resolve to `config.definitions`, so `auth generate --output definitions.sql` cannot accidentally update some other schema artifact. _Implemented in `createSqlfuBetterAuthSchema`; wrong output paths are rejected in `better-auth-adapter.test.ts`._
- [x] Accept an empty or whitespace-only definitions file. In that case, write a deterministic fenced Better Auth section. _Covered by the wrapper/createSchema tests; empty files produce a full fenced Better Auth schema._
- [x] Accept a nonempty definitions file only if it contains exactly one Better Auth-managed fenced section. If the file is nonempty and unfenced, throw with a clear message showing the expected fence markers. _Implemented by `replaceBetterAuthManagedSection`; nonempty unfenced files throw._
- [x] Preserve all application SQL outside the Better Auth fence byte-for-byte. _Covered by the application SQL preservation test._
- [x] Replace the entire fenced Better Auth section on every `auth generate` run. Plugin additions, plugin removals, renamed tables, and column changes should all be represented by the new section contents. _Covered by the CLI reconfigure test using Better Auth additional user fields._
- [x] Make the fence markers explicit and boring. _The generated section uses the planned begin/end markers._

  ```sql
  -- sqlfu:better-auth begin
  -- generated by Better Auth through sqlfuBetterAuthAdapter; edit Better Auth config instead
  ...
  -- sqlfu:better-auth end
  ```

- [x] Throw if there are multiple begin/end markers, dangling markers, or nested markers. _Malformed fence cases are covered in `better-auth-adapter.test.ts`._
- [x] Normalize only the managed section. Do not format or reorder application-level SQL outside the fence. _Replacement slices around the markers and only rewrites the managed section._
- [x] Leave actual migrations to `sqlfu draft` and `sqlfu migrate`. The adapter's `createSchema` should not write migration files or touch the live database. _`createSchema` only returns Better Auth CLI output; a separate test runs `sqlfu draft`/`migrate` afterward._
- [x] Set the returned Better Auth adapter `id` to `sqlfu` or another non-built-in id, so Better Auth calls custom `createSchema` instead of the built-in Kysely generator. _The wrapper returns `id: 'sqlfu'` and updates `adapterConfig.adapterId`._
- [x] Do not delegate sqlfu's `createSchema` to Better Auth's built-in Kysely generator, because that generator introspects a database and produces a diff. _The schema renderer uses `getAuthTables` and returns a full definitions file replacement._

## TDD Plan

Build this in vertical slices:

- [x] Add a focused unit/integration test for the fenced-section replacement primitive before wiring Better Auth. Start with: empty file -> fenced section with generated SQL. _Covered through `createSchema` against an empty `definitions.sql`._
- [x] Add the second replacement test: app tables before and after an existing fence stay unchanged while the Better Auth section is replaced. _Covered by the preservation test._
- [x] Add strict rejection tests for wrong output file, nonempty unfenced definitions, multiple fences, and malformed fences. _Covered in `better-auth-adapter.test.ts`._
- [x] Add `createBetterAuthFixture` only once the text replacement primitive is green, so the fixture grows in response to a real integration need. _Added as a test-local disposable fixture with `exec` and `reconfigure`._
- [x] Add a Better Auth CLI integration test proving `auth generate --output definitions.sql --yes` updates `definitions.sql`. _Covered by the fixture CLI test._
- [x] Add a reconfiguration test proving `fixture.reconfigure(...)` rewrites `auth.ts`, reruns `auth generate`, and updates the fenced section when a plugin adds or removes Better Auth schema. _Covered with Better Auth additional user fields as the schema-changing input._
- [x] Add a sqlfu workflow test: `auth generate` changes `definitions.sql`; `sqlfu draft` creates the SQL migration; `sqlfu migrate` applies it. _Covered by `generated Better Auth definitions can feed sqlfu draft and migrate`._
- [ ] Add runtime adapter coverage only after the schema flow is working. The expectation is that the wrapper can pass Better Auth's adapter tester by delegating all CRUD to the passed Kysely adapter. _Still a follow-up; current coverage asserts runtime methods and transaction adapters are preserved._

## Fixture Shape

The intended test helper:

```ts
await using fixture = await createBetterAuthFixture(() => {
  return betterAuth({
    database: sqlfuBetterAuthAdapter({
      sqlfu: sqlfuConfig,
      adapter: kyselyAdapter(db, {type: 'sqlite'}),
    }),
    plugins: [],
  });
});

await fixture.exec('auth generate --output definitions.sql --yes');

await fixture.reconfigure(() => {
  return betterAuth({
    database: sqlfuBetterAuthAdapter({
      sqlfu: sqlfuConfig,
      adapter: kyselyAdapter(db, {type: 'sqlite'}),
    }),
    plugins: [
      // plugin that changes schema
    ],
  });
});

await fixture.exec('auth generate --output definitions.sql --yes');
```

`createBetterAuthFixture` should:

- [ ] Create an isolated temp project with `package.json`, `auth.ts`, `sqlfu.config.ts`, `definitions.sql`, `sql/`, and `migrations/`. _Partially done test-locally: the Better Auth fixture creates `package.json`, `auth.ts`, `definitions.sql`, and `sql/`; the sqlfu workflow test uses the existing migrations fixture._
- [x] Write `auth.ts` by embedding the callback's source with `.toString()`. _Implemented in the test-local `writeAuthConfig` helper._

  ```ts
  const getAuth = ${fn.toString()};

  export const auth = getAuth();
  ```

- [x] Provide `exec(command: string)` for running Better Auth CLI commands and, when needed, sqlfu CLI commands in the fixture root. _Implemented for Better Auth CLI commands with `execaCommand`._
- [x] Provide `reconfigure(fn)` that rewrites `auth.ts` in-place. _Implemented and covered by the CLI reconfiguration test._
- [x] Provide small file helpers such as `readText(relativePath)` and `writeText(relativePath, contents)` only as tests need them. _Added `readText` and `writeText`._
- [x] Clean up with `Symbol.asyncDispose`. _Fixture deletes its temp root on async disposal._

## Open Questions

- [x] Is the public API actually `database: sqlfuBetterAuthAdapter(...)`, or does Better Auth expect custom adapters in a different option slot for current versions? _Resolved by source inspection: Better Auth accepts `database` as an adapter factory function, so `sqlfuBetterAuthAdapter({adapter, sqlfu})` should return an adapter factory._
- [x] Can sqlfu compose the Kysely adapter and override only `createSchema`, or does `createAdapterFactory` force every method to be implemented in one adapter object? _Resolved for the next spike: wrap the returned `DBAdapter` from the passed adapter factory, preserve CRUD methods, replace `id` and `createSchema`._
- [x] Should this live under the root export, a new `sqlfu/better-auth` export, or `sqlfu/api`? _Current recommendation: use a dedicated `sqlfu/better-auth` entrypoint because it will have Better Auth-facing peer types and maybe CLI/schema-generation dependencies._
- [ ] Should the adapter accept unresolved `SqlfuConfig`, resolved `SqlfuProjectConfig`, or a config path? The strict `file === config.definitions` rule is easier and safer with resolved paths.
- [ ] Which Better Auth plugin should the reconfiguration test use to produce a small, stable schema change?
- [ ] Should `auth generate` be allowed to create a missing `definitions.sql`, or should the strict MVP require the file to exist and be empty/fenced?
- [ ] Should the managed section include only tables, or also Better Auth-owned indexes/constraints/triggers if the Better Auth table model exposes them?
- [ ] Does Better Auth's generated SQLite SQL match the subset sqlfu's schemadiff/materializer already understands?
- [ ] Should schema SQL be rendered directly from `better-auth/db`'s resolved schema, or by running Better Auth's migration compiler against an empty scratch SQLite database? Direct rendering is simpler to reason about; the scratch compiler may better match Better Auth's SQL choices but pulls in more machinery.
- [ ] Should `createSchema` return a path relative to the Better Auth CLI cwd? Better Auth's current generate action joins `cwd` with `schema.fileName`, so returning an absolute path may produce the wrong destination.

## Non-goals

- Do not make Better Auth write sqlfu migration files.
- Do not run Better Auth `migrate` as part of the sqlfu flow.
- Do not invent a general "managed sections" feature for arbitrary tools unless this adapter proves the abstraction is useful.
- Do not reimplement all runtime CRUD handlers if the Kysely adapter can be safely reused.
- Do not pursue upstream Better Auth changes in this task.

## Success Criteria

- [x] A user can run Better Auth `auth generate --output definitions.sql --yes` and get a deterministic Better Auth-managed section in sqlfu's configured definitions file. _Covered by the Better Auth CLI fixture test._
- [x] Running Better Auth generate again after changing auth plugins replaces only the Better Auth-managed section. _Covered with a schema-changing reconfigure flow; plugin-specific coverage remains a possible follow-up._
- [x] `sqlfu draft` sees the changed `definitions.sql` and produces the database migration. _Covered by the sqlfu workflow test._
- [x] `sqlfu migrate` applies that migration successfully. _Covered by the sqlfu workflow test._
- [ ] Better Auth remains usable at runtime, either through a composed Kysely adapter or through sqlfu-owned handlers tested by Better Auth's adapter suite. _Not fully done; the wrapper preserves methods/transaction behavior, but adapter-tester or real app coverage is still pending._

## Implementation Log

- 2026-04-30: Created the worktree/spec-only task. No product files changed yet.
- 2026-04-30: Opened draft PR https://github.com/mmkal/sqlfu/pull/73 for design review.
- 2026-04-30: Explored Better Auth `1.6.9` packages. Updated the task to prefer wrapping a passed Kysely adapter factory and overriding only `id`/`createSchema`; upstreaming schema-only adapter support is out of scope for now.
- 2026-04-30: Implemented `sqlfu/better-auth` as a wrapper adapter. Added tests for fenced replacement, strict errors, Better Auth CLI generation/reconfiguration, plural table names, serial ids, and the `auth generate` -> `sqlfu draft` -> `sqlfu migrate` workflow. Also fixed `resolveSqlfuUi` to prefer the built workspace UI package when the optional peer is linked.
