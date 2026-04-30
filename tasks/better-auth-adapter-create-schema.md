---
status: ready-for-wrapper-spike
size: large
branch: better-auth-adapter-create-schema
pr: https://github.com/mmkal/sqlfu/pull/73
---

# Better Auth adapter that lets sqlfu own schema diffs

**Status:** Spec-only worktree, but the main design direction is now clearer. The task is roughly 0% implemented. The current plan is wrapper-first: take a user-provided Better Auth runtime adapter, usually Kysely, preserve its CRUD behavior, change the adapter id so Better Auth calls sqlfu's `createSchema`, and let sqlfu replace only its Better Auth-managed section in `definitions.sql`. The main missing pieces are the schema renderer/replacement implementation, the Better Auth CLI fixture, and end-to-end workflow tests.

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

- [ ] Validate the configured output file. `createSchema(_, file)` should throw if `file` does not resolve to `config.definitions`, so `auth generate --output definitions.sql` cannot accidentally update some other schema artifact.
- [ ] Accept an empty or whitespace-only definitions file. In that case, write a deterministic fenced Better Auth section.
- [ ] Accept a nonempty definitions file only if it contains exactly one Better Auth-managed fenced section. If the file is nonempty and unfenced, throw with a clear message showing the expected fence markers.
- [ ] Preserve all application SQL outside the Better Auth fence byte-for-byte.
- [ ] Replace the entire fenced Better Auth section on every `auth generate` run. Plugin additions, plugin removals, renamed tables, and column changes should all be represented by the new section contents.
- [ ] Make the fence markers explicit and boring:

  ```sql
  -- sqlfu:better-auth begin
  -- generated by Better Auth through sqlfuBetterAuthAdapter; edit Better Auth config instead
  ...
  -- sqlfu:better-auth end
  ```

- [ ] Throw if there are multiple begin/end markers, dangling markers, or nested markers.
- [ ] Normalize only the managed section. Do not format or reorder application-level SQL outside the fence.
- [ ] Leave actual migrations to `sqlfu draft` and `sqlfu migrate`. The adapter's `createSchema` should not write migration files or touch the live database.
- [ ] Set the returned Better Auth adapter `id` to `sqlfu` or another non-built-in id, so Better Auth calls custom `createSchema` instead of the built-in Kysely generator.
- [ ] Do not delegate sqlfu's `createSchema` to Better Auth's built-in Kysely generator, because that generator introspects a database and produces a diff.

## TDD Plan

Build this in vertical slices:

- [ ] Add a focused unit/integration test for the fenced-section replacement primitive before wiring Better Auth. Start with: empty file -> fenced section with generated SQL.
- [ ] Add the second replacement test: app tables before and after an existing fence stay unchanged while the Better Auth section is replaced.
- [ ] Add strict rejection tests for wrong output file, nonempty unfenced definitions, multiple fences, and malformed fences.
- [ ] Add `createBetterAuthFixture` only once the text replacement primitive is green, so the fixture grows in response to a real integration need.
- [ ] Add a Better Auth CLI integration test proving `auth generate --output definitions.sql --yes` updates `definitions.sql`.
- [ ] Add a reconfiguration test proving `fixture.reconfigure(...)` rewrites `auth.ts`, reruns `auth generate`, and updates the fenced section when a plugin adds or removes Better Auth schema.
- [ ] Add a sqlfu workflow test: `auth generate` changes `definitions.sql`; `sqlfu draft` creates the SQL migration; `sqlfu migrate` applies it.
- [ ] Add runtime adapter coverage only after the schema flow is working. The expectation is that the wrapper can pass Better Auth's adapter tester by delegating all CRUD to the passed Kysely adapter.

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

- [ ] Create an isolated temp project with `package.json`, `auth.ts`, `sqlfu.config.ts`, `definitions.sql`, `sql/`, and `migrations/`.
- [ ] Write `auth.ts` by embedding the callback's source with `.toString()`:

  ```ts
  const getAuth = ${fn.toString()};

  export const auth = getAuth();
  ```

- [ ] Provide `exec(command: string)` for running Better Auth CLI commands and, when needed, sqlfu CLI commands in the fixture root.
- [ ] Provide `reconfigure(fn)` that rewrites `auth.ts` in-place.
- [ ] Provide small file helpers such as `readText(relativePath)` and `writeText(relativePath, contents)` only as tests need them.
- [ ] Clean up with `Symbol.asyncDispose`.

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

- [ ] A user can run Better Auth `auth generate --output definitions.sql --yes` and get a deterministic Better Auth-managed section in sqlfu's configured definitions file.
- [ ] Running Better Auth generate again after changing auth plugins replaces only the Better Auth-managed section.
- [ ] `sqlfu draft` sees the changed `definitions.sql` and produces the database migration.
- [ ] `sqlfu migrate` applies that migration successfully.
- [ ] Better Auth remains usable at runtime, either through a composed Kysely adapter or through sqlfu-owned handlers tested by Better Auth's adapter suite.

## Implementation Log

- 2026-04-30: Created the worktree/spec-only task. No product files changed yet.
- 2026-04-30: Opened draft PR https://github.com/mmkal/sqlfu/pull/73 for design review.
- 2026-04-30: Explored Better Auth `1.6.9` packages. Updated the task to prefer wrapping a passed Kysely adapter factory and overriding only `id`/`createSchema`; upstreaming schema-only adapter support is out of scope for now.
