# Getting Started

This walkthrough builds a small posts app from scratch: schema in SQL, migrations drafted automatically, typed TypeScript wrappers generated from your query files. By the end you will have a working `getPosts(client, {limit: 10})` call with full IDE types.

If you want to see the finished project running in your browser first, [open the demo](/ui?demo=1) -- same schema, same queries, no install.

## What you will have

```
.
├── db/
│   └── app.sqlite
├── definitions.sql
├── migrations/
│   └── 20260101000000_add_posts_table.sql
├── sql/
│   ├── .generated/
│   │   └── get-posts.sql.ts
│   └── get-posts.sql
└── sqlfu.config.ts
```

## Install

```sh
pnpm add sqlfu
```

Optionally install the CLI globally so `sqlfu` is on your `PATH` anywhere:

```sh
npm install -g sqlfu
```

When you run `sqlfu` inside a project that already has it as a dependency, the global binary delegates to the project-local copy (`node_modules/sqlfu`). Each project runs the version it pinned. Your global install never has to match, and upgrading globally is not required to unstick a project.

## Initialize the project

```sh
npx sqlfu init
```

(If you just run `npx sqlfu` with no config, it will prompt you to init first. `sqlfu init` makes it explicit.)

This creates `sqlfu.config.ts`, `definitions.sql`, `migrations/`, `sql/`, and `db/`. The config already points at sensible defaults:

```ts
// sqlfu.config.ts
export default {
  db: './db/app.sqlite',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
};
```

## Define your schema

Open `definitions.sql` and describe the schema you want right now:

```sql
create table posts (
  id integer primary key autoincrement,
  slug text not null unique,
  title text not null,
  body text not null,
  published integer not null default 0
);
```

`definitions.sql` is the single source of truth for your desired schema. When you change it, sqlfu computes the diff and writes the next migration for you.

## Draft a migration

```sh
npx sqlfu draft
```

sqlfu replays your migration history into a scratch database, diffs it against `definitions.sql`, and writes a new migration file under `migrations/`. Open the file and review it -- the diff engine is not psychic, so check for renames and destructive changes.

The generated file will look something like:

```sql
create table posts (
  id integer primary key autoincrement,
  slug text not null unique,
  title text not null,
  body text not null,
  published integer not null default 0
);
```

Looks right. Commit it as-is.

## Apply migrations

```sh
npx sqlfu migrate
```

This applies any pending migrations to your dev database (`db/app.sqlite`) and records each one in `sqlfu_migrations`. Run this every time you pull new migrations from the repo.

## Add a query

Create `sql/get-posts.sql`:

```sql
select id, slug, title, body, published
from posts
where published = 1
order by id desc
limit :limit
```

Query files live next to the code that calls them. The filename is the query's identity -- it shows up in generated types, observability spans, and error messages.

## Generate types

```sh
npx sqlfu generate
```

sqlfu reads your `.sql` files and emits typed wrappers into `sql/.generated/`. For `get-posts.sql` you get a `getPosts` function with typed params and a typed result row attached via a namespace (`getPosts.Params`, `getPosts.Result`). The function also carries `.sql` and `.query` (including `name: "getPosts"`) as static properties used by observability hooks.

Note: `generate` reads the live database schema, so `migrate` must have run first.

## Call the wrapper

```ts
import {DatabaseSync} from 'node:sqlite';
import {createNodeSqliteClient} from 'sqlfu';
import {getPosts} from './sql/.generated/get-posts.sql';

const db = new DatabaseSync('./db/app.sqlite');
const client = createNodeSqliteClient(db);

const posts = await getPosts(client, {limit: 10});
//    ^? Array<{id: number, slug: string, title: string, body: string, published: number}>
```

Params and result rows are fully typed. Your IDE hover shows the inferred row type directly. The `getPosts.query.name` field (`"getPosts"`) travels with every call to OpenTelemetry spans, Sentry errors, and Datadog metrics -- see [Observability](/docs/observability).

`node:sqlite` is built into Node 22+. Using a different runtime or driver? See [Adapters](/docs/adapters) for Bun, Turso, D1, Expo, and others -- the same generated wrappers work unchanged across all of them.

## Change the schema

Edit `definitions.sql` and add a column:

```sql
create table posts (
  id integer primary key autoincrement,
  slug text not null unique,
  title text not null,
  body text not null,
  excerpt text,
  published integer not null default 0
);
```

Then draft the migration:

```sh
npx sqlfu draft
```

The generated file will contain:

```sql
alter table posts add column excerpt text;
```

That is one line, not a full table rebuild. The diff engine compares the schema you have now (replayed from migration history) against the schema you declared in `definitions.sql`, and emits only the statements needed to close the gap. Adding a nullable column is a single `alter table` statement; SQLite supports it directly without recreating the table.

Review the file, commit it, then run `npx sqlfu migrate` and `npx sqlfu generate` to update the live schema and regenerate the typed wrapper.

## Where to go next

Pick the path that matches where you are:

- **Need Turso, D1, Bun, or another driver?** [Adapters](/docs/adapters) -- copy-paste snippets for every supported runtime, plus guidance on sync vs async.
- **Want to understand how migrations work?** [Migration Model](/docs/migration-model) -- the replay-based model, what `sqlfu check` verifies, and what to do when a migration fails.
- **Need validated rows for tRPC or forms?** [Runtime validation](/docs/runtime-validation) -- opt-in validation with arktype, valibot, or zod baked into the generated wrappers.
- **Need multiple queries per file or list params?** [Type generation](/docs/typegen) -- `@name`, inferred `IN (:ids)` lists, object dot paths, and inferred bulk inserts.
- **Want to see more generated type shapes?** [Generate examples](/docs/examples) -- real query fixtures showing param and result types for common patterns.
- **Want a visual interface for your database?** [UI](/docs/ui) -- run queries, inspect tables, and draft migrations in the browser.
