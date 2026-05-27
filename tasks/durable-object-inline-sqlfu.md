---
status: ready
size: medium
---

# Durable Objects full inlinable

## Status

Not started. Task is to make durable objects full "inlinable".

## Checklist

- [ ] Durable Objects should be able to define definitions, queries, and migrations purely inline, so a durable object can be a self contained single module.

## Example

```ts
import {inlineSqlfu, sql} from 'sqlfu/api';

const db = inlineSqlfu({
  definitions: sql`
    create table posts(slug text, body text);
  `,
  migrations: [
    { name: 'create-table-posts', content: sql`create table posts(slug text)` },
  ],
  queries: {
    listPosts: sql`select * from posts limit :limit`,
  }
});

class MyDO extends DurableObject {
  private db: typeof db.$type
  constructor(state) {
    this.db = db(createDurableObjectClient(state.storage))
    this.db.migrate() // or even `this.db.sync()` should work
  }

  listPosts() {
    return this.db.listPosts({ limit: 10 });
  }
}
```

Reason: durable objects are often essentially "standalone". It's prohibitively painful to write a dedicated `sqlfu.config.ts`, `definitions.sql` and `queries.sql` for them - which also then necessitates their own folder etc.

The above would let you do it all in one file.

How it'd work. You write the above manually, then you run

```bash
sqlfu --config ./path/to/my-durable-object.ts generate
```

And it will "add types" to the `inlineSqlfu(...)` "queries" prop:


```ts
  queries: {
    listPosts: sql<{ parameters: { limit: number }; result: { slug: string; body: string } }>`
      select * from posts limit :limit
    `,
  }
```

Similarly migrations are added inline. Running:

```bash
sqlfu --config ./path/to/my-durable-object.ts draft
```

Will add a new migration inline:

```ts
  migrations: [
    { name: 'create-table-posts', content: sql`create table posts(slug text)` },
    { name: 'alter-table-posts', content: sql`alter table posts add column body text` },
  ]
```

To do this it requires a fair amount of constraints on the source code. Maybe the rules could be:

- `const db = inlineSqlfu(...)` at the top level of the module (doesn't need to be exported)
- perfectly balances parens and curly braces so is nice and parseable
- no usage of variables or functions or antying other than `` sql`...` ``
- we will only insert migrations into an array and generic types into `` sql<...>`...` `` expressions

Make sure you follow existing testing conventions. End to end behaviour - not useless unit tests. It's also important that we see what happens when a durable object evolves its schema, generates migrations, and then gets re-awoken - so you'll need to find how to exercise that path with miniflare.