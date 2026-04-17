For targets without filesystems, it might be beneficial to pickle migrations to a json file looking like

```json
{
    "migrations/2020-01-01T00:00:00.000Z_create_table_posts.sql": "create table posts(id int, slug text, title text, body text)",
    "migrations/2020-01-01T00:00:00.001Z_create_table_user.sql": "create table users(id int, name text)",
    "migrations/2020-01-01T00:00:00.002Z_post_author.sql": "alter table posts add column author_id int references users(id)"
}
```

or for max compatibility a typescript file

```ts
export default {
    "migrations/2020-01-01T00:00:00.000Z_create_table_posts.sql": "create table posts(id int, slug text, title text, body text)",
    "migrations/2020-01-01T00:00:00.001Z_create_table_user.sql": "create table users(id int, name text)",
    "migrations/2020-01-01T00:00:00.002Z_post_author.sql": "alter table posts add column author_id int references users(id)"
}
```

It can be imported by the runtime more easily that way and we can provide a way of running migrations on a durable object for example:

```ts
import migrations from './db/.generated/migrations.ts'
import {loadDynamic} from 'sqlfu'
import * as path from 'node:path'

export class MyDO {
  constructor() {
    const sqlfu = loadDynamic({
        db: () => ({}), // ???
        migrations: Object.entries(migrations).map(([filepath, content]) => ({name: path.parse(filepath).name, content}))
    })
    this.blockConcurrencyWhile(async () => {
        await sqlfu.migrate()
    })
  }
}
```

A few things to worry about though:

- `migrate()` currently does integrity checks, to make sure the Live Schema is indeed in the state the migrations imply it should be. Those checks are now in theory all javascript but might be impossible or difficult in things like durable objects, because they involve creating temp databases. Would need to either make those checks disable-able, or do more cleverneess so they can run in DOs too.
- `await sqlfu.migrate()`/`blockConcurrencyWhile` is annoying. everything should ideally be synchronous

We should consider emitting this by default from `generate` because it's cheap and means it's ready to go without adjusting ur setup

---

Possible alternative to the `loadDynamic` option. Something like `memfs.Vol.fromJSON(...)` - i.e. ship a minimal fs-like object that lets you pretend you have a whole filesystem.
