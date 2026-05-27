---
title: "introducing sqlfu"
slug: "introducing-sqlfu"
date: "2026-05-28"
description: "sqlfu is a SQLite-first toolkit for writing schema, migrations, and queries in SQL, then generating the TypeScript around them."
heroImage: "/assets/blog/friendship-regain-sqlfu.png"
heroAlt: "SQL is back with sqlfu"
---

`sqlfu` is a library which lets you write *plain SQL* for your typescript application.

>all you need is sql.

The basic idea is: SQL is a decades-old language, and it's something you need for your schema, your data layer and your migrations. So, you do need SQL, but the aim of sqlfu is to make it so you don't need an ORM, a query-builder, or anything *more* than SQL.

This is nothing against ORMs, and definitely nothing against any specific ones. The hope is that by adopting sqlfu, you can eliminate the need for them (in exchange for certain tradeoffs - there's no free lunch).

What sqlfu includes:

- a migrations system:
   - which assumes you have a single `definitions.sql` containing DDL statements expressing your "Desired Schema"
   - a smart schema-diffing tool, which calculates how to get from your current state to the desired state
   - a dead-simple migrations runner ([with no down migrations](https://sqlfu.dev/blog/down-considered-harmful))
- a typescript generation command:
   - this assumes you write your data-access layer as `.sql` files (mostly containing paramterised select, insert, udpate, delete statements)
   - creates generated typescript files which you can call using a runtime client from your application
- a runtime client:
   - razor thin adapters - *wrapper* around existing, [battle-tested clients](https://sqlfu.dev/docs/adapters)
   - these adapters are the only thing an application using sqlfu depends on in production
- a formatter:
   - opinionated vendored fork of [sql-formatter](https://npmjs.com/package/sql-formatter)
- a CLI and UI:
   - invoke the above features from the command line (`sqlfu migrate`, `sqlfu draft`, `sqlfu generate`, `sqlfu format` etc.)
   - run `npx sqlfu` to get a browser UI to poke at your local database, view/run/author your schema, migrations and queries
   - use the "partial-fetch" function to host the UI yourself and add auth for deployed admin access

All of the above is in one small package: `npm install sqlfu`

It's roughly divided into "dev-time" and "runtime".

"runtime" is the client and migrator. It's *very* lightweight - there's almost nothing to it. It wraps existing database clients in a library-agnostic interface and just... runs SQL. You can freely import this in your application code.

"dev-time" is the CLI, the UI and the API. It runs heavy-ish-weight procedures like schema inspection (which involves spawning scratch databases) and type generation.

## Why you might want this

ORMs are great. They solve real problems and I have no interest in trying to piss on them. Lots of smart people are very productive with them. I created sqlfu because I wanted to solve the same problems that ORMs do, while trying to avoid having *another thing*. The thing itself isn't bad, but fewer things can be better than more things.

Assuming you don't want an ORM (which I think is the right neutral assumption, in the same way you don't particularly want a falconry glove, unless you have a falcon), before sqlfu, you're left in a tricky situation. You have to use a hodge-podge of disparate tools which don't know about each other:

- client: `better-sqlite3`, or `libsql`, or `node:sqlite`, or `bun:sqlite`, or `drizzle` to abstract over those
- migrator/schema-diffing: `flyway`, or `dbmate`, or `atlas`, or `skeema`, or `supabase`, or `drizzle` or a long list of other perfectly-good migrators
- schema authoring: `sqlite3def` or `drizzle` (author in typescript)
- type safety: `typesql` or `pgkit` (postgres), or `pgtyped` (postgres), or `drizzle` to write queries directly in typescript
- formatting: `sql-formatter` or `drizzle` (since you don't write SQL with drizzle, so you can use prettier/oxfmt)

If you are eagle-eyed, you'll see that `drizzle` is an option in *all* of those bullet points. The same applies to `prisma`. That's because these are really great tools! They solve loads of problems really well! But, they also impose an opinion on you: that you should be using their library to write your crown-jewels - the way your application interacts with your database. `sqlfu` aims to be a one-stop shop to achieve the above, and all you need to do is write in a beautiful language for structured querying.

What about [query builders like knex, kysely (or drizzle)](/blog/what-about-query-builders).

## A todo app

Here's what a sqlfu todo app might look like. First write a `sqlfu.config.ts` (either manually or by running `sqlfu init`):

```ts
import {defineConfig} from 'sqlfu';

export default defineConfig({
   db: 'app.sqlite',
   definitions: 'db/definitions.sql',
   queries: 'db/sql',
   migrations: 'db/migrations',
});
```

Then you'd write your database schema *by hand* (or let your agent do it, if you trust them with your app's core schema):

```sql [filename=db/definitions.sql]
create table todos(
   id int primary key,
   text text not null,
   completed_at int
);
```

And the queries your app will use at runtime:

```sql [filename=db/queries.sql]
/** @name addTodo */
insert into todos (text) values (:text);

/** @name listTodos */
select * from todos limit :limit offset :offset;

/** @name findTodos */
select * from todos where text like :value;
```

You can then run `sqlfu generate` to get strongly-typed query helpers:

<details>
<summary>db/.generated/queries.sql.ts</summary>

```ts
// fill this in...
```

</details>

Which you can use in your app:

```ts
// fix up the pseudocode in this
import {DatabaseSync} from 'node:sqlite';
import {createNodeSqliteClient} from 'sqlfu';

import * as queries from '../db/.generated/queries.sql.ts';

const db = createNodeSqliteClient(new DatbaseSync('app.sqlite'));

app.get("/", async () => {
  const todos = await queries.listTodos(db, { limit: 10 });
  const bullets = todos.map(t => `- ${escapeHTML(text)}`).join('\n');
  const html = `
    <form action="post('/add-todo', m.value)">
      <input name="m" />
      <button action="submit">add</button>
    </form>
    <pre>${bullets}</pre>
  `;
  return c.text(html);
});

app.post("/add-todo", async (c) => {
   const text = await c.req.raw.text();
   await queries.addTodo(db, { text });
   return c.json({ ok: true });
});
```

To sync your dev database to match `definitions.sql`, you can run `sqlfu sync` to write to it directly or `sqlfu draft && sqlfu migrate` to generate and run a migration. The first migration will just look like the initial schema, and have a name like `00001_create-table-todos.sql`. Then let's say you add a column to the table:

```diff
create table todos(
   id int primary key,
   text text not null,
   completed_at int,
+  completion_note text
)
```

When you run `sqlfu draft` again, a new migration file `00002_alter-table-todos.sql` will be created:

```sql
alter table todos
add colummn completion_note text;
```

From then, you just... build your app. If you want to change your schema, update definitions.sql. Write/edit/delete your queries freely. sqlfu will make sure they're correct and give you strong types for them.

## More

There's lots more packed into sqlfu:

- a CLI
- a web-based admin UI (`npx sqlfu` - [demo](https://sqlfu.dev/ui?demo=1))
- an [oxlint/eslint plugin](https://sqlfu.dev/docs/lint-plugin) for validating, formatting and naming queries
- an [opinionated sql formatter](https://sqlfu.dev/docs/formatter) that produces nicer-looking sql than most others
- [opentelemetry support](https://sqlfu.dev/docs/observability)

With even more experimental and upcoming features:

- postgres support
- an outbox system
- an inline-typescript mini-app config

## Prior art and thanks

The query-codegen idea is not new. [sqlc](https://github.com/sqlc-dev/sqlc) has been doing it for Go for years. [PgTyped](https://pgtyped.dev) and [sqlc-gen-typescript](https://github.com/sqlc-dev/sqlc-gen-typescript) carry the idea into TypeScript. sqlfu's contribution is bundling that model with the SQLite pieces we kept needing around it: schema diffing, migrations, formatting, runtime adapters, observability, and a UI.

The package leans on a lot of existing work:

- [TypeSQL](https://github.com/wsporto/typesql), its parser, [antlr4](https://github.com/antlr/antlr4), and [code-block-writer](https://github.com/dsherret/code-block-writer) power most of `sqlfu generate`.
- [sql-formatter](https://github.com/sql-formatter-org/sql-formatter) and [prettier-plugin-sql-cst](https://github.com/nene/prettier-plugin-sql-cst) shaped the formatter and its test fixtures.
- [Drizzle Studio](https://orm.drizzle.team/kit-docs/overview) shaped the local-backend, hosted-frontend model for the sqlfu UI.
- [CodeMirror](https://codemirror.net/), React, TanStack Query, Radix UI, `@silevis/reactgrid`, and `sqlite-wasm` do much of the browser-side heavy lifting.
- [Atlas](https://atlasgo.io/versioned/diff), [Skeema](https://www.skeema.io), `@pgkit/schemainspect`, `@pgkit/migra`, and Robert Lechte's original `schemainspect`/`migra` projects shaped the schema-diff model.

Vendored directories in the repo include attribution notes and local-change summaries so future updates can be applied deliberately.

Try it with `npm install sqlfu`. Docs are at [sqlfu.dev](https://sqlfu.dev). Source is at [github.com/iterate/sqlfu](https://github.com/iterate/sqlfu).

---

## Migrations from the schema you want

sqlfu's [approach](https://sqlfu.dev/docs/migration-model) is closer to [Atlas](https://atlasgo.io/versioned/diff) or [Skeema](https://www.skeema.io): the desired schema is a real artifact. It's `definitions.sql`, one file, read top to bottom. It is what the database *should* look like. Migrations are the ordered record of how you got there.

When `definitions.sql` changes, `sqlfu draft` replays the existing migrations into a scratch database, compares that replayed schema with the desired schema, and writes the migration that closes the gap. You read it, edit it for renames or backfills, and commit it. The generated migration is not a decree. It is a draft in the language the database will execute.

This is the part that made sqlfu feel worth packaging. Once schema, migrations, and queries are all SQL, the same tool can answer useful questions: does the live database match the repo, what would need to change, which migration files have already run, and what TypeScript should a query return?

## What it is not for

sqlfu is pre-alpha. The runtime surface is intentionally small, but the toolchain will still change.

It is also SQLite-first. There is a thin Node Postgres runtime adapter now, and [pgkit](https://github.com/mmkal/pgkit) is the Postgres-shaped predecessor, but the broader `@sqlfu/pg` dialect/toolchain story still needs fuller docs and examples before this stops being a SQLite-first project.

You should not adopt it to avoid learning SQL. That is the opposite of the point. sqlfu is for projects where SQL is welcome, reviewable, and central.
