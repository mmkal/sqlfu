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
import {inlineSqlfu} from 'sqlfu/api'
const db = inlineSqlfu(sql => ({
  definitions: sql`
    create table posts(slug text, body text);
  `,
  migrations: [
    { name: 'create-table-posts', content: sql`create table posts(slug text)` },
    { name: 'alter-table-posts', content: sql`alter table posts add column body text` },
  ],
  queries: {
    listPosts: sql`select * from posts limit :limit`,
  }
}));

class MyDO extends DurableObject {
  private db: typeof db.$type
  constructor(state) {
    this.db = db(createDurableObjectClient(state.storage)
  }
}
```
