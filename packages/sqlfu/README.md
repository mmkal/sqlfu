# sqlfu

<img src="./docs/logo.png" alt="" align="right" width="96" />

`sqlfu` is a SQLite-first toolkit for teams that want their data layer to stay close to SQL.

It is built around a simple idea: SQL should be the source language for schema, migrations, queries, formatting, and diffing. TypeScript comes second. You should still get good generated types and wrappers, but without having to push the whole project through an ORM-shaped API.

**New to sqlfu?** Start with the [Getting Started](https://sqlfu.dev/docs/getting-started) walkthrough.

![i know sqlfu](./docs/i-know-sqlfu.gif)

- [What Is sqlfu?](#what-is-sqlfu)
- [Philosophy](#philosophy)
  - [SQL First](#sql-first)
  - [TypeScript Second](#typescript-second)
- [Core Concepts](#core-concepts)
- [Capabilities](#capabilities)
  - [Runtime Client](#runtime-client)
  - [SQL Migrations](#sql-migrations)
  - [Type Generation from SQL](#type-generation-from-sql)
  - [Formatter](#formatter)
  - [Observability](#observability)
  - [Typed Errors](#typed-errors)
  - [Outbox (experimental)](#outbox-experimental)
  - [Admin UI](#admin-ui)
  - [Lint Plugin](#lint-plugin)
  - [Agent Skill](#agent-skill)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Command Reference](#command-reference)
- [Limitations and Non-Goals](#limitations-and-non-goals)
- [Prior Art and Acknowledgements](#prior-art-and-acknowledgements)

## What Is sqlfu?

`sqlfu` is a set of SQL-first tools that are meant to work together:

- a client for executing checked-in SQL
- a migrator built around SQL files, not JavaScript migration code
- a SQLite schema diff engine
- a type generator for `.sql` queries
- a SQL formatter
- an Admin UI for inspecting and working with the project

The intended shape is simple:

- your desired schema lives in `definitions.sql`
- your migration history lives in `migrations/`
- your queries live in a flat `sql/` directory
- generated TypeScript wrappers live in `sql/.generated/`

## Philosophy

### SQL First

Humans have been writing SQL for decades. Agents are excellent at generating and editing it. SQL is *deep* "in the weights". `sqlfu` tries to keep that advantage instead of hiding it behind another abstraction layer.

That is why the project leans so heavily on SQL artifacts:

- schema in `definitions.sql`
- migrations as SQL files
- checked-in `.sql` queries
- a SQL formatter
- a SQL diff engine

The goal is not to make SQL disappear. The goal is to make SQL a better source language for the rest of the toolchain.

### TypeScript Second

TypeScript is the second language in `sqlfu`, not the first one.

You should still get strong TypeScript output from SQL: generated wrappers, typed params, typed result rows, and a client surface that feels natural in an application. That is why `sqlfu` includes query type generation and why it borrows from vendored TypeSQL analysis instead of asking you to rewrite queries in a TypeScript DSL.

## Core Concepts

- **Runtime client.**
  The lightweight `Client` interface is usually the only sqlfu runtime surface
  your app depends on. Adapter factories create it from the SQLite driver you
  already use.
- **SQL migrations.**
  Schema history is a sequence of reviewed SQL files, with `sqlfu draft`
  helping turn `definitions.sql` changes into best-effort migration drafts.
- **Type generation from SQL.**
  Checked-in `.sql` query files become TypeScript wrappers with inferred params
  and result rows.
- **Admin UI.**
  The browser interface gives you a view of schema, migrations, queries,
  generated metadata, and live data.

The main repo artifacts behind those concepts are:

- `definitions.sql`
  The desired schema now. Tables, views, triggers, and (if you want them) copy-paste id generators (ULID, KSUID, nanoid, cuid2-shaped) live here alongside your schema. See [docs/id-helpers.md](./docs/id-helpers.md).
- `migrations/`
  The ordered history of schema changes.
- `sql/`
  A flat directory of checked-in query files.
- generated query wrappers
  TypeScript code generated into `sql/.generated/` as `<name>.sql.ts`.
- `sqlfu_migrations`
  The table that records applied migrations in a real database. Configurable via `migrations.preset`: set `preset: 'd1'` to use Cloudflare D1's `d1_migrations` table instead, for projects taking over from alchemy/wrangler.
- live schema
  The schema the database actually has right now.

Those pieces give `sqlfu` enough information to answer the important questions:

- what should the schema be?
- how did it get here?
- what queries exist in the repo?
- do the repo and the database agree?

## Capabilities

### Runtime Client

`sqlfu` includes a lightweight client layer for executing SQL directly. It works with checked-in SQL rather than replacing it with a query builder.

sqlfu doesn't ship its own database driver. Instead, `sqlfu` exports a thin adapter for each SQLite-compatible driver, so you can bring whichever one fits your runtime and get the same typed client surface on top. One thing sqlfu goes out of its way to preserve: **sync stays sync**. A client built on a synchronous driver (`better-sqlite3`, `node:sqlite`, Durable Objects) is itself synchronous -- no spurious `async` creeping up your call stack.

That sync/async distinction carries through generated query wrappers and the migrator. Sync-backed generated functions return rows directly, and `applyMigrations()` runs synchronously on a `SyncClient`. Async-backed clients get the same API shape, but with promises where the underlying driver actually needs them.

When you need to run SQL outside a generated wrapper, the same client surface gives you `client.all(...)`, `client.run(...)`, `client.iterate(...)`, and `client.prepare(sql)`. Prepared statements are the low-level path for reusable ad-hoc SQL and named parameters without reaching through to `client.driver`. See [Prepared statements](https://sqlfu.dev/docs/adapters#prepared-statements).

See [Runtime client](https://sqlfu.dev/docs/client) for the shared interface and [Adapters](https://sqlfu.dev/docs/adapters) for the full driver table, copy-paste snippets, and guidance on which to pick.

### SQL Migrations

The migrator is SQL-only. Migrations are applied in filename order, recorded in `sqlfu_migrations`, and treated as explicit history. The production path is replayed migrations, not direct declarative apply.

The diff engine powers `draft`, `goto`, and `sync` by comparing replayed migration state against `definitions.sql` and producing the SQL statements that describe the difference. See [SQL migrations](https://sqlfu.dev/docs/migration-model) for the full model.

For Cloudflare D1 projects already using alchemy or wrangler, set `migrations.preset: 'd1'` and sqlfu reads and writes the same `d1_migrations` table alchemy does. See [Migration Presets](https://sqlfu.dev/docs/migration-model#migration-presets) for the schema detection and checksum tradeoff.

### Type Generation from SQL

`sqlfu generate` reads checked-in `.sql` files and generates TypeScript wrappers into a `.generated/` subdirectory. The implementation uses vendored TypeSQL analysis, with a small sqlfu post-pass to improve some SQLite result types.

By default, `generate` reads `definitions.sql`, so no live database is required.
Switch `generate.authority` when generated types should follow replayed
migrations, migration history, or live schema instead.

Use `/** @name listPosts */` comments when one `.sql` file contains multiple queries.
Parameter placeholders can also describe the runtime SQL shape directly:

```sql
/** @name insertPosts */
insert into posts (slug, title)
values :posts;

/** @name listPostsByIds */
select id, slug, title
from posts
where id in (:ids);
```

Scalar params stay `:id`; scalar lists are inferred from `IN (:ids)` / `NOT IN (:ids)`;
row-value lists from `(slug, title) in (:keys)`; INSERT objects from `values :posts`;
object fields use dot paths like `:post.slug`; and empty runtime-expanded arrays throw before SQLite sees the query. See [Type generation from SQL](https://sqlfu.dev/docs/typegen).

Opt in to runtime validation by setting `generate.validator` to `'arktype'`, `'valibot'`, `'zod'`, or `'zod-mini'`. Wrappers then validate params on the way in and rows on the way out, and derive types via the validator's native inference. See [Runtime validation](https://sqlfu.dev/docs/runtime-validation).

Set `generate.runtime` when generated wrappers should target an existing runtime
instead of the sqlfu client. `effect-v3` / `effect-v4-unstable` return Effect
values, while `node:sqlite`, `better-sqlite3`, `bun:sqlite`, `libsql`, and
`@libsql/client` call those drivers directly and do not import `sqlfu` from the
generated query module.

### Formatter

`sqlfu` includes a SQL formatter. It started from a vendored copy of [`sql-formatter`](https://github.com/sql-formatter-org/sql-formatter), then diverged because upstream formatting is more newline-heavy than we want. The current sqlfu defaults are intentionally opinionated: SQLite-first, lowercase by default, and biased toward keeping simple clause bodies inline when they still read well.

How to use:

- `npx sqlfu format 'queries/**/*.sql'`: rewrite files in place
- `import {format} from 'sqlfu/api'`: programmatically format a sql string
- `sqlfu/format-sql` eslint rule: have your editor/CI enforce formatting

[Formatter docs](https://sqlfu.dev/docs/formatter).

### Observability

Generated queries carry their identity to runtime as a `name` field on the emitted `SqlQuery` (the camelCase function name, matching the symbol you import, e.g. `insertMigration`). That name reaches OpenTelemetry spans, Sentry errors, PostHog events, and Datadog metrics through a single `instrument()` call:

```ts
import {instrument} from 'sqlfu';

const client = instrument(baseClient,
  instrument.otel({tracer}),
  instrument.onError(({context, error}) => Sentry.captureException(error, {
    tags: {'db.query.summary': context.query.name || 'sql'},
  })),
);
```

No peer dependencies on OpenTelemetry or Sentry. `TracerLike` is structural; hook consumers bring their own SDK. Copy-pasteable recipes live in [Observability](https://sqlfu.dev/docs/observability).

### Typed errors

Every adapter throws `SqlfuError` with a normalized `.kind` discriminator (`'unique_violation'`, `'missing_table'`, `'syntax'`, `'transient'`, and so on), so application code branches on the outcome instead of string-matching the driver's message.

```ts
import {SqlfuError} from 'sqlfu';

try {
  await client.run(createUser);
} catch (error) {
  if (error instanceof SqlfuError && error.kind === 'unique_violation') {
    return response.status(409).json({error: 'email already taken'});
  }
  throw error;
}
```

The driver error is preserved byte-identical on `.cause`; `.query` and `.system` come along so error reporters can tag events without a parallel `QueryExecutionContext`. Kind names are SQLSTATE-aligned so the existing Postgres runtime adapter and the broader `@sqlfu/pg` work can share one error vocabulary as SQLSTATE-specific classification fills in. Full kind list, handler recipes, Sentry-tagging example: [Errors](https://sqlfu.dev/docs/errors).

### Outbox (experimental)

> ⚠️ The shape of this module is still in flux. The basic principle of events + consumers will stay, but expect breaking changes between releases.

A small transactional-outbox / job-queue sits at `sqlfu/outbox`. Emit events in the same transaction as your domain writes; register consumers with retry, delay, `when` filter, and visibility timeout; drive a worker loop by calling `tick()` on a timer. Fan-out, crash recovery, and causation chains all work the way you'd expect, built on the fact that SQLite serialises writers so the queue doesn't need row-locks. See [Outbox](https://sqlfu.dev/docs/outbox).

### Admin UI

`sqlfu` also has an Admin UI package for working with the project interactively. To use it with your DB, run: `npx sqlfu`. This will start a server on your machine, and print a link to the hosted UI at `sqlfu.dev/ui`. The hosted UI talks to the backend running on your dev machine.

The same UI can be embedded in a fetch server with `@sqlfu/ui` when you want your own auth, route prefix, or Worker/Durable Object database binding. See [Admin UI](https://sqlfu.dev/docs/ui).

### Lint Plugin

`sqlfu` ships a lint plugin as a sub-export (`sqlfu/lint-plugin`). It runs under ESLint (flat config) on both TS/JS source (inline SQL templates) and standalone `.sql` files (via an ESLint processor):

- **`sqlfu/query-naming`** -- flags inline SQL that duplicates a checked-in `.sql` file. Your filename is your query's identity; an inline duplicate loses the name, generated types, and observability metadata.
- **`sqlfu/format-sql`** -- flags SQL that does not match sqlfu's formatter output. `eslint --fix '**/*.sql'` reformats files in place.

See [Lint Plugin](https://sqlfu.dev/docs/lint-plugin) for setup and configuration.

### Agent Skill

`sqlfu` ships an agent skill at [`skills/using-sqlfu`](../../skills/using-sqlfu/SKILL.md). It gives an agent the few sqlfu-specific facts it needs before editing a project: find `sqlfu.config.ts`, treat SQL as the authored source, draft migrations instead of inventing them, and regenerate TypeScript outputs from query files.

Install it into a project:

```sh
npx skills add mmkal/sqlfu/skills/using-sqlfu
```

The skill is self-contained: it does not depend on the `sqlfu` package itself, and the `SKILL.md` format is agent-agnostic.

If your coding agent can fetch URLs, point it at the agent docs index before it starts:

```text
You are a sqlfu assistant. Read https://sqlfu.dev/llms.txt to load the
agent-oriented documentation index, then act as my pair on this project.
Keep SQL as the authored source, inspect sqlfu.config.ts before changing
behavior, and regenerate TypeScript wrappers instead of hand-editing generated
files.
```

## Quick Start

```sh
pnpm add sqlfu
```

For a full end-to-end walkthrough -- schema, migrations, query files, typed wrappers, and a working generated-function call -- see [Getting Started](https://sqlfu.dev/docs/getting-started).

## Configuration

Create `sqlfu.config.ts` in your project root:

```ts
export default {
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
};
```

Required fields:

- `definitions` -- schema source of truth (`definitions.sql`)
- `queries` -- directory containing checked-in `.sql` queries

Optional fields:

- `db` -- the database sqlfu talks to for `migrate`, `check`, `sync`, `goto`, `baseline`, and the UI. Either a filesystem path (opens a local sqlite file) or a factory returning a `DisposableAsyncClient`. If omitted, commands that need a database use `.sqlfu/app.db`; this is useful for authoring migrations and generated types before wiring a runtime database. See [Pluggable `db`](#pluggable-db).
- `migrations` -- directory containing migration files. Omit if you don't use migrations (library-author projects).
- `generate.authority` -- where `sqlfu generate` reads the schema from. See [`generate.authority`](#generateauthority). Default `'desired_schema'`.
- `generate.casing` -- generated SQL-derived property casing, either `'camel'` or `'preserve'`. Default `'camel'`.
- `generate.experimentalJsonTypes` -- opt into experimental JSON logical-type handling. Today this covers SQLite columns declared exactly as `json`; the same flag is reserved for typed JSON metadata/schema support.

`sqlfu` manages its own temporary files under `.sqlfu/`, including scratch databases used for schema diffing. These are generally safe to delete at any time. `sqlfu init` adds `.sqlfu/` to `.gitignore`.

If a repo has more than one sqlfu project, pass the config file explicitly:

```sh
sqlfu --config ./durable-objects/counter/sqlfu.config.ts generate
sqlfu --config ./durable-objects/session/sqlfu.config.ts draft
```

Relative paths inside that config are resolved from the config file's directory, so each Durable Object can keep its own `definitions.sql`, `migrations/`, and `sql/` directories alongside the config.

### Inline Durable Object configs

For a self-contained Durable Object, the config can live on a static class
property in the Worker module instead of a separate `sqlfu.config.ts` project:

```ts
import {DurableObject} from 'cloudflare:workers';
import {createDurableObjectClient, defineConfig, sql} from 'sqlfu';

export class CounterObject extends DurableObject {
  static db = defineConfig({
    definitions: sql`
      create table counters (
        name text primary key not null,
        value integer not null default 0
      );
    `,
    migrations: [],
    queries: {
      incrementCounter: sql.one<{ parameters: { name: string }; result: { name: string; value: number } }>`
        insert into counters (name, value)
        values (:name, 1)
        on conflict (name) do update set value = value + 1
        returning name, value
      `,
    },
  });

  db: typeof CounterObject.db.$type;

  constructor(ctx: DurableObjectState, env: {}) {
    super(ctx, env);
    this.db = CounterObject.db(createDurableObjectClient(ctx.storage));
    this.db.migrate();
  }
}
```

Point `--config` at the module itself:

```sh
sqlfu --config src/durable-objects/counter.ts draft
sqlfu --config src/durable-objects/counter.ts generate
sqlfu --config src/durable-objects/counter.ts generate --watch
```

`draft` appends inline migration entries, and `generate` writes each query's
inferred mode and type into compact tags such as `sql.one<{...}>`,
`sql.many<{...}>`, or `sql.run<{...}>`. `generate --watch` watches that one
Worker module and updates it as the inline SQL changes. See [Durable
Objects](./docs/guides/durable-objects.md) for the full guide.

### Pluggable `db`

When your app talks to an adapter-mediated database (Cloudflare D1, Turso, libsql, a miniflare binding), point sqlfu at the same client your app uses by giving `db` a factory instead of a path. Every sqlfu command that touches the DB -- `migrate`, `check`, `sync`, `goto`, `baseline`, the UI, and `generate` when its authority needs a DB -- will then operate on the *real* database, not a scratch file.

You can also leave `db` out while you are still authoring SQL. sqlfu will use
`.sqlfu/app.db` as a local dev database for commands that need one. Add a
factory when you want those commands to operate on the deployed or
adapter-managed database instead.

```ts
import {defineConfig, createD1Client} from 'sqlfu';
import {Miniflare} from 'miniflare';

export default defineConfig({
  db: async () => {
    const mf = new Miniflare({
      script: '', modules: true,
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
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
});
```

The factory is invoked on every `openDb` call; sqlfu calls `[Symbol.asyncDispose]` when the command scope exits. Memoize inside the factory if the setup is expensive (e.g. spinning up miniflare once per process).

For an Alchemy-managed local D1 database, sqlfu can talk directly to Alchemy's persisted Miniflare sqlite file:

```ts
import {defineConfig} from 'sqlfu';
import {findMiniflareD1Path} from 'sqlfu/cloudflare';

export default defineConfig({
  db: findMiniflareD1Path('my-dev-app-slug'),
  migrations: {path: './src/server/db/migrations', preset: 'd1'},
  definitions: './src/server/db/definitions.sql',
  queries: './src/server/db/queries',
});
```

`findMiniflareD1Path()` walks up from `process.cwd()` until it finds a supported Miniflare v3 persist root. Today that means Alchemy's `.alchemy/miniflare/v3` layout. It then derives the same D1 object sqlite filename Miniflare uses for the slug. Pass `{miniflareV3Root}` as the second argument if your config runs outside that project tree.

For deployed cloud D1, including [Alchemy v2](https://alchemy.run), which connects `alchemy dev` directly to real D1 instead of a local Miniflare sqlite, point sqlfu at the cloud database over HTTP using `sqlfu/cloudflare`:

```ts
import {defineConfig} from 'sqlfu';
import {createAlchemyD1Client} from 'sqlfu/cloudflare';

export default defineConfig({
  db: () => createAlchemyD1Client({stack: 'my-app', stage: 'dev', fqn: 'database'}),
  migrations: {path: './migrations', preset: 'd1'},
});
```

`createAlchemyD1Client` reads alchemy's local state to discover the deployed `databaseId` and `accountId`, falls back to `process.env.CLOUDFLARE_API_TOKEN` for auth, and produces a sqlfu client that talks to Cloudflare's HTTP D1 query API. Lower-level helpers (`createD1HttpClient`, `readAlchemyD1State`, `findCloudflareD1ByName`) are exported for composing your own factory. See [Cloudflare D1](./docs/cloudflare-d1.md) for the full guide.

### `generate.authority`

`sqlfu generate` needs to know your schema to produce typed query wrappers. The `generate.authority` option controls where it reads the schema from:

- `'desired_schema'` (default) -- read `definitions.sql` directly. No DB required. Fastest, most deterministic. Drift between `definitions.sql` and migrations is surfaced by `sqlfu check`, not silently hidden here.
- `'migrations'` -- replay `migrations/*.sql` into a scratch DB and extract the resulting schema. No DB required. Types follow what the migrator would actually produce.
- `'migration_history'` -- read `sqlfu_migrations` from `config.db`, then replay the matching migration files. Requires `db`. Throws if a recorded migration is missing from `migrations/`. Use when types should match what's actually deployed.
- `'live_schema'` -- extract schema directly from `config.db`. Requires `db` to be populated up-front. This was the default before the factory form of `db` landed; now opt-in.

```ts
export default defineConfig({
  // db optional for desired_schema / migrations authority
  definitions: './definitions.sql',
  queries: './sql',
  migrations: './migrations',
  generate: {authority: 'migrations'},
});
```

## Command Reference

Start the local backend used by the hosted Admin UI:

```sh
sqlfu
```

Generate query wrappers:

```sh
sqlfu generate
```

By default `generate` reads from `definitions.sql` (no DB needed). Switch `generate.authority` if you want types to reflect the live schema or the applied migration history -- see [`generate.authority`](#generateauthority).

Draft a migration:

```sh
sqlfu draft
```

Apply migrations:

```sh
sqlfu migrate
```

Stop the local backend process on the default port:

```sh
sqlfu kill
```

Move the database and migration history to an exact target:

```sh
sqlfu goto <target>
```

Rewrite migration history to an exact target without changing live schema:

```sh
sqlfu baseline <target>
```

Update live schema directly from `definitions.sql`:

```sh
sqlfu sync
```

Check the important repo/database mismatches:

```sh
sqlfu check
```

Format SQL files in place:

```sh
sqlfu format "sql/**/*.sql"
```

## Limitations and Non-Goals

`sqlfu` deliberately leaves out a few common migration features:

- no repeatable migrations
- no down migrations
- no JavaScript migrations

Those are not accidents. The project is trying to keep schema history explicit, SQL-authored, and easy to inspect.

Current limits also matter:

- `sqlfu` is SQLite-first in important parts of the toolchain
- Postgres has a runtime adapter today, but the broader `@sqlfu/pg` dialect/toolchain docs and examples are still in progress
- result-type inference is imperfect on some SQLite expressions and views; the sqlfu post-pass that fills gaps in the vendored TypeSQL output is still evolving
- the formatter is opinionated and still evolving

## Prior Art and Acknowledgements

`sqlfu` is not built in a vacuum. Several existing projects directly shape what it looks like today, either as vendored code or as ideas we lean on.

- [TypeSQL](https://github.com/wsporto/typesql) by Wanderson Camargo (MIT). TypeSQL is vendored under [`src/vendor/typesql`](./src/vendor/typesql) and powers SQL-to-TypeScript analysis for `sqlfu generate`. sqlfu adds a small post-pass for SQLite result typing but otherwise relies on TypeSQL's query analyzer, its ANTLR4-based parser ([`typesql-parser`](https://github.com/wsporto/typesql-parser), vendored under [`src/vendor/typesql-parser`](./src/vendor/typesql-parser)), and its code generator.
- [sql-formatter](https://github.com/sql-formatter-org/sql-formatter) (MIT). The formatter is essentially vendored whole under [`src/vendor/sql-formatter`](./src/vendor/sql-formatter) and then wrapped by [`src/formatter.ts`](./src/formatter.ts) with sqlfu-specific defaults (SQLite-first, lowercase by default, biased toward keeping simple clause bodies inline).
- [prettier-plugin-sql-cst](https://github.com/nene/prettier-plugin-sql-cst) by Rene Saarsoo (MIT). The target output shape for `formatSql()` draws on this project's style, and a large set of its upstream tests are imported into sqlfu's formatter fixtures under [`test/formatter/generated-prettier-plugin-sql-cst-*.fixture.sql`](./test/formatter/).
- [antlr4](https://github.com/antlr/antlr4) JavaScript runtime (BSD-3-Clause). Vendored under [`src/vendor/antlr4`](./src/vendor/antlr4) so TypeSQL's parser can run without loading from `node_modules`.
- [code-block-writer](https://github.com/dsherret/code-block-writer) by David Sherret (MIT). Vendored under [`src/vendor/code-block-writer`](./src/vendor/code-block-writer) and used by TypeSQL's code generator.
- [Drizzle](https://orm.drizzle.team/). The [`local.drizzle.studio`](https://local.drizzle.studio/) product model -- hosted UI shell talking to a local backend via a permissioned localhost API -- is the direct inspiration for `sqlfu.dev/ui` and the shape of the sqlfu UI package.
- [`@pgkit/schemainspect`](https://github.com/mmkal/pgkit/tree/main/packages/schemainspect) and [`@pgkit/migra`](https://github.com/mmkal/pgkit/tree/main/packages/migra). The sqlfu schemadiff engine under [`src/schemadiff`](./src/schemadiff) is structurally inspired by these libraries: materialize both schemas into scratch databases, inspect them into a typed model, diff the inspected models, and emit an ordered statement plan. The SQLite-specific implementation does not copy their code, but the shape is taken from them. See [`src/schemadiff/CLAUDE.md`](./src/schemadiff/CLAUDE.md) for more detail.
- [`djrobstep/schemainspect`](https://github.com/djrobstep/schemainspect) and [`djrobstep/migra`](https://github.com/djrobstep/migra) by Robert Lechte. These are the Python originals that the `@pgkit/*` packages ported to TypeScript, and therefore the upstream lineage of the sqlfu diff engine.
- [pgkit](https://github.com/mmkal/pgkit) (same author). pgkit is sqlfu's Postgres-focused prior art. A lot of the mental model for sqlfu -- "SQL as the authored source, generated types next to queries, schema-diff-driven migrations, a web UI that sits on the real client" -- comes from trying that approach in pgkit first. sqlfu is growing back to Postgres in stages: the runtime adapter lives in `sqlfu`, while the broader dialect/toolchain story belongs to `@sqlfu/pg`.

Vendored directories each carry a short `CLAUDE.md` that pins the upstream commit or version and lists the local modifications, so future updates from upstream can be applied intelligently.
