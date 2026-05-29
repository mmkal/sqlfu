# Durable Objects

Planning to try sqlfu with Durable Objects? You can use either the normal
[Getting Started](../getting-started.md) workflow or a single inline TypeScript
module when one Durable Object owns one small schema.

The normal file-backed project changes two things:

1. Keep a separate `sqlfu.config.ts`, `definitions.sql`, `migrations/`, and
   `sql/` directory for each Durable Object class that owns its own storage.
2. Generate a migration bundle and run it from the Durable Object constructor
   with `createDurableObjectClient(ctx.storage)`.

That is the whole shape. You still author SQL first, draft migration files, and
generate typed wrappers from `.sql` query files.

## Inline module

For a self-contained Durable Object, keep definitions, migrations, and queries
in the Worker module and point `--config` at that module:

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
    migrations: [
      {
        name: '20260506000000_create_counters',
        content: sql`
          create table counters (
            name text primary key not null,
            value integer not null default 0
          );
        `,
      },
    ],
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

Then run:

```sh
npx sqlfu --config src/durable-objects/counter/counter.ts draft
npx sqlfu --config src/durable-objects/counter/counter.ts generate
npx sqlfu --config src/durable-objects/counter/counter.ts generate --watch
```

`draft` appends new `{name, content: sql\`...\`}` entries to the inline
`migrations` array. `generate` writes inferred query mode and type metadata into
compact tags such as `sql.one<{...}>`, `sql.many<{...}>`, or `sql.run<{...}>`;
`generate --watch` reruns that edit whenever the module changes. The source must
keep one or more parseable top-level `const name = defineConfig({...})` object
literals or static class properties such as `static db = defineConfig({...})` on
top-level named classes, with `definitions`, `migrations`, and `queries`
properties. The static class property form is preferred for Durable Objects
because the schema stays attached to the object that owns the storage.

## Project shape

One Durable Object usually wants one sqlfu project:

```txt
src/durable-objects/counter/
|-- definitions.sql
|-- migrations/
|   `-- 20260506000000_create_counter.sql
|-- sql/
|   |-- queries.sql
|   `-- .generated/
|-- sqlfu.config.ts
`-- counter.ts
```

If you have several Durable Object classes with different schemas, give each one
its own folder and pass `--config` explicitly:

```sh
npx sqlfu --config src/durable-objects/counter/sqlfu.config.ts draft
npx sqlfu --config src/durable-objects/counter/sqlfu.config.ts generate
```

## Config

Durable Object storage is not available to the Node CLI as a simple local file,
so the common Durable Object config omits `db`. sqlfu uses `.sqlfu/app.db` as a
local authoring database for commands that need one, and `draft` plus `generate`
still read from `definitions.sql` and migration files.

```ts
import {defineConfig} from 'sqlfu';

export default defineConfig({
  definitions: './definitions.sql',
  migrations: './migrations',
  queries: './sql',
  generate: {
    sync: true,
  },
});
```

`generate.sync: true` matters because Durable Object SQLite is synchronous.
Generated query wrappers accept a `SyncClient` and return rows directly instead
of promises.

## Schema and query

Author the schema in `definitions.sql`:

```sql
create table counters (
  name text primary key not null,
  value integer not null default 0
);
```

Author the runtime query in `sql/queries.sql`:

```sql
/** @name incrementCounter */
insert into counters (name, value)
values (:name, 1)
on conflict (name) do update set value = value + 1
returning name, value;
```

Then draft and generate:

```sh
npx sqlfu --config src/durable-objects/counter/sqlfu.config.ts draft
npx sqlfu --config src/durable-objects/counter/sqlfu.config.ts generate
```

Commit the reviewed `migrations/*.sql` files. Also commit the generated query
wrappers if your app checks generated files in. The generated migration bundle
under `migrations/.generated/migrations.ts` is what the Durable Object imports
at runtime.

## Durable Object runtime

Pass the full `ctx.storage` object to the adapter:

```ts
import {DurableObject} from 'cloudflare:workers';
import {createDurableObjectClient} from 'sqlfu';

import {migrate} from './migrations/.generated/migrations.ts';
import {incrementCounter} from './sql/.generated/queries.sql.ts';

type Env = {};

export class CounterObject extends DurableObject {
  client: ReturnType<typeof createDurableObjectClient>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    this.client = createDurableObjectClient(ctx.storage);
    migrate(this.client);
  }

  fetch(request: Request) {
    const url = new URL(request.url);
    const name = url.searchParams.get('name') || 'default';
    const row = incrementCounter(this.client, {name});

    return Response.json(row);
  }
}
```

Use `ctx.storage`, not `ctx.storage.sql`. The full storage object lets sqlfu use
Durable Objects' `transactionSync()` API so each migration is applied inside a
real storage transaction. If you only need ad-hoc query access and deliberately
do not want migrations, pass `{sql: ctx.storage.sql}`.

## Runtime migrations

Every Durable Object instance has its own private SQLite database. A deploy puts
new code on the Worker, but it does not automatically upgrade storage for every
existing object. Let each object call `migrate(this.client)` when it starts.

`migrate()` is idempotent. It skips migrations already recorded in that object's
`sqlfu_migrations` table and applies only the missing files from the generated
bundle. If the object has recorded a migration that is no longer in the bundle,
sqlfu treats that as migration-history drift and fails instead of guessing.

## Read next

- [Getting Started](../getting-started.md) for the base SQL -> draft -> generate
  workflow.
- [Adapters](../adapters.md#cloudflare-durable-object-per-do-sqlite) for the
  small Durable Object adapter snippet.
- [SQL migrations](../migration-model.md#durable-objects) for the migration
  model and failure modes specific to Durable Objects.
