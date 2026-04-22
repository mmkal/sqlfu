# sqlfu

`sqlfu` is a SQLite-first toolkit for teams that want their data layer to stay close to SQL.

It is built around a simple idea: SQL should be the source language for schema, migrations, queries, formatting, and diffing. TypeScript comes second. You should still get good generated types and wrappers, but without having to push the whole project through an ORM-shaped API.

**New to sqlfu?** Start with the [Getting Started](https://sqlfu.dev/docs/getting-started) walkthrough.

![i know sqlfu](packages/sqlfu/docs/i-know-sqlfu.gif)

- [What Is sqlfu?](#what-is-sqlfu)
- [Philosophy](#philosophy)
  - [SQL First](#sql-first)
  - [TypeScript Second](#typescript-second)
- [Core Concepts](#core-concepts)
- [Capabilities](#capabilities)
  - [Client](#client)
  - [Migrator](#migrator)
  - [Type Generator](#type-generator)
  - [Formatter](#formatter)
  - [Observability](#observability)
  - [Outbox](#outbox)
  - [UI](#ui)
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
- a UI for inspecting and working with the project

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

- `definitions.sql`
  The desired schema now.
- `migrations/`
  The ordered history of schema changes.
- `sql/`
  A flat directory of checked-in query files.
- generated query wrappers
  TypeScript code generated into `sql/.generated/` as `<name>.sql.ts`.
- `sqlfu_migrations`
  The table that records applied migrations in a real database.
- live schema
  The schema the database actually has right now.

Those pieces give `sqlfu` enough information to answer the important questions:

- what should the schema be?
- how did it get here?
- what queries exist in the repo?
- do the repo and the database agree?

## Capabilities

### Client

`sqlfu` includes a lightweight client layer for executing SQL directly. It works with checked-in SQL rather than replacing it with a query builder.

sqlfu doesn't ship its own database driver. Instead, `sqlfu/client` exports a thin adapter for each SQLite-compatible driver, so you can bring whichever one fits your runtime and get the same typed client surface on top. One thing sqlfu goes out of its way to preserve: **sync stays sync**. A client built on a synchronous driver (`better-sqlite3`, `node:sqlite`, Durable Objects) is itself synchronous -- no spurious `async` creeping up your call stack.

See [Adapters](https://sqlfu.dev/docs/adapters) for the full driver table, copy-paste snippets, and guidance on which to pick.

### Migrator

The migrator is SQL-only. Migrations are applied in filename order, recorded in `sqlfu_migrations`, and treated as explicit history. The production path is replayed migrations, not direct declarative apply.

The diff engine powers `draft`, `goto`, and `sync` by comparing replayed migration state against `definitions.sql` and producing the SQL statements that describe the difference. See [Migration Model](https://sqlfu.dev/docs/migration-model) for the full model.

### Type Generator

`sqlfu generate` reads checked-in `.sql` files and generates TypeScript wrappers into a `.generated/` subdirectory. The implementation uses vendored TypeSQL analysis, with a small sqlfu post-pass to improve some SQLite result types.

Note: `generate` reads the live database schema, so migrations must be applied first.

Opt in to runtime validation by setting `generate.validator` to `'arktype'`, `'valibot'`, `'zod'`, or `'zod-mini'`. Wrappers then validate params on the way in and rows on the way out, and derive types via the validator's native inference. See [Runtime validation](https://sqlfu.dev/docs/runtime-validation).

### Formatter

`sqlfu` includes a SQL formatter via `formatSql()`. It started from a vendored copy of [`sql-formatter`](https://github.com/sql-formatter-org/sql-formatter), then diverged because upstream formatting is more newline-heavy than we want. The current sqlfu defaults are intentionally opinionated: SQLite-first, lowercase by default, and biased toward keeping simple clause bodies inline when they still read well.

### Observability

Generated queries carry their filename to runtime as a `name` field on the emitted `SqlQuery`. That name reaches OpenTelemetry spans, Sentry errors, PostHog events, and Datadog metrics through a single `instrument()` call:

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

### Outbox

A small transactional-outbox / job-queue sits at `sqlfu/outbox`. Emit events in the same transaction as your domain writes; register consumers with retry, delay, `when` filter, and visibility timeout; drive a worker loop by calling `tick()` on a timer. Fan-out, crash recovery, and causation chains all work the way you'd expect, built on the fact that SQLite serialises writers so the queue doesn't need row-locks. See [Outbox](https://sqlfu.dev/docs/outbox).

### UI

`sqlfu` also has a UI package for working with the project interactively. It sits on top of the same SQL-first model rather than inventing a separate one. See [UI](https://sqlfu.dev/docs/ui).

### Lint Plugin

`sqlfu` ships a lint plugin as a sub-export (`sqlfu/lint-plugin`). It runs under ESLint (flat config) on both TS/JS source (inline SQL templates) and standalone `.sql` files (via an ESLint processor):

- **`sqlfu/query-naming`** -- flags inline SQL that duplicates a checked-in `.sql` file. Your filename is your query's identity; an inline duplicate loses the name, generated types, and observability metadata.
- **`sqlfu/format-sql`** -- flags SQL that does not match sqlfu's formatter output. `eslint --fix '**/*.sql'` reformats files in place.

See [Lint Plugin](https://sqlfu.dev/docs/lint-plugin) for setup and configuration.

### Agent Skill

`sqlfu` ships an agent skill at [`skills/using-sqlfu`](skills/using-sqlfu/SKILL.md). It teaches an agent the project's source-of-truth files, the schema-change workflow, the query workflow, and the command reference, so an agent dropped into a sqlfu repo does not hand-author migrations or invent old config field names.

Install it into a project:

```sh
npx skills@latest add mmkal/sqlfu/skills/using-sqlfu
```

The skill is self-contained: it does not depend on the `sqlfu` package itself, and the `SKILL.md` format is agent-agnostic.

## Quick Start

```sh
pnpm add sqlfu
```

For a full end-to-end walkthrough -- schema, migrations, query files, typed wrappers, and a working generated-function call -- see [Getting Started](https://sqlfu.dev/docs/getting-started).

## Configuration

Create `sqlfu.config.ts` in your project root:

```ts
export default {
  db: './db/app.sqlite',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
};
```

Required fields:

- `db` -- path to the main dev database used by `sync`, `migrate`, `generate`, and other tooling commands
- `migrations` -- directory containing migration files
- `definitions` -- schema source of truth (`definitions.sql`)
- `queries` -- directory containing checked-in `.sql` queries

`sqlfu` manages its own temporary files under `.sqlfu/`, including scratch databases used for schema diffing. These are generally safe to delete at any time.

## Command Reference

Generate query wrappers:

```sh
sqlfu generate
```

Note: `generate` reads the live database schema. Apply pending migrations first with `sqlfu migrate`.

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

## Limitations and Non-Goals

`sqlfu` deliberately leaves out a few common migration features:

- no repeatable migrations
- no down migrations
- no JavaScript migrations

Those are not accidents. The project is trying to keep schema history explicit, SQL-authored, and easy to inspect.

Current limits also matter:

- `sqlfu` is SQLite-first in important parts of the toolchain
- SQLite view typing is still imperfect in TypeSQL, and some expressions need the sqlfu post-pass to get better generated result types
- the formatter is opinionated and still evolving

## Prior Art and Acknowledgements

`sqlfu` is not built in a vacuum. Several existing projects directly shape what it looks like today, either as vendored code or as ideas we lean on.

- [TypeSQL](https://github.com/wsporto/typesql) by Wanderson Camargo (MIT). TypeSQL is vendored under [`src/vendor/typesql`](packages/sqlfu/src/vendor/typesql) and powers SQL-to-TypeScript analysis for `sqlfu generate`. sqlfu adds a small post-pass for SQLite result typing but otherwise relies on TypeSQL's query analyzer, its ANTLR4-based parser ([`typesql-parser`](https://github.com/wsporto/typesql-parser), vendored under [`src/vendor/typesql-parser`](packages/sqlfu/src/vendor/typesql-parser)), and its code generator.
- [sql-formatter](https://github.com/sql-formatter-org/sql-formatter) (MIT). The formatter is essentially vendored whole under [`src/vendor/sql-formatter`](packages/sqlfu/src/vendor/sql-formatter) and then wrapped by [`src/formatter.ts`](packages/sqlfu/src/formatter.ts) with sqlfu-specific defaults (SQLite-first, lowercase by default, biased toward keeping simple clause bodies inline).
- [prettier-plugin-sql-cst](https://github.com/nene/prettier-plugin-sql-cst) by Rene Saarsoo (MIT). The target output shape for `formatSql()` draws on this project's style, and a large set of its upstream tests are imported into sqlfu's formatter fixtures under [`test/formatter/generated-prettier-plugin-sql-cst-*.fixture.sql`](packages/sqlfu/test/formatter).
- [antlr4](https://github.com/antlr/antlr4) JavaScript runtime (BSD-3-Clause). Vendored under [`src/vendor/antlr4`](packages/sqlfu/src/vendor/antlr4) so TypeSQL's parser can run without loading from `node_modules`.
- [code-block-writer](https://github.com/dsherret/code-block-writer) by David Sherret (MIT). Vendored under [`src/vendor/code-block-writer`](packages/sqlfu/src/vendor/code-block-writer) and used by TypeSQL's code generator.
- [Drizzle](https://orm.drizzle.team/). The [`local.drizzle.studio`](https://local.drizzle.studio/) product model -- hosted UI shell talking to a local backend via a permissioned localhost API -- is the direct inspiration for `sqlfu.dev/ui` and the shape of the sqlfu UI package. More generally, Drizzle raised the bar for what modern SQL-oriented tooling should feel like, and sqlfu is trying to meet that bar for a different slice of the workflow.
- [`@pgkit/schemainspect`](https://github.com/mmkal/pgkit/tree/main/packages/schemainspect) and [`@pgkit/migra`](https://github.com/mmkal/pgkit/tree/main/packages/migra). The sqlfu schemadiff engine under [`src/schemadiff`](packages/sqlfu/src/schemadiff) is structurally inspired by these libraries: materialize both schemas into scratch databases, inspect them into a typed model, diff the inspected models, and emit an ordered statement plan. The SQLite-specific implementation does not copy their code, but the shape is taken from them. See [`src/schemadiff/CLAUDE.md`](packages/sqlfu/src/schemadiff/CLAUDE.md) for more detail.
- [`djrobstep/schemainspect`](https://github.com/djrobstep/schemainspect) and [`djrobstep/migra`](https://github.com/djrobstep/migra) by Robert Lechte. These are the Python originals that the `@pgkit/*` packages ported to TypeScript, and therefore the upstream lineage of the sqlfu diff engine.
- [pgkit](https://github.com/mmkal/pgkit) (same author). pgkit is sqlfu's Postgres-focused prior art. A lot of the mental model for sqlfu -- "SQL as the authored source, generated types next to queries, schema-diff-driven migrations, a web UI that sits on the real client" -- comes from trying that approach in pgkit first. sqlfu is the SQLite-first version of that idea, with the goal of eventually growing back to Postgres.

Vendored directories each carry a short `CLAUDE.md` that pins the upstream commit or version and lists the local modifications, so future updates from upstream can be applied intelligently.
