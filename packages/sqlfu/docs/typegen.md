# Type generation

`sqlfu generate` reads checked-in `.sql` files and emits TypeScript wrappers under
`sql/.generated/`. The generated function name normally comes from the file path:
`sql/get-post.sql` becomes `getPost`.

```sql
-- sql/get-post.sql
select id, slug, title
from posts
where id = :id;
```

```ts
import {getPost} from './sql/.generated/get-post.sql';

const post = await getPost(client, {id: 123});
```

## Multiple queries in one file

Put `@name` in a block comment before each query when one `.sql` file contains more
than one query.

```sql
/** @name listPosts */
select id, slug, title
from posts
order by id;

/** @name findPostBySlug */
select id, slug, title
from posts
where slug = :slug;
```

This emits one generated module, `sql/.generated/posts.sql.ts`, with both
`listPosts` and `findPostBySlug` exports. If a file uses `@name`, every executable
statement in that file must have its own `@name`.

## Parameter forms

Plain params use sqlfu's normal `:name` placeholder syntax.

```sql
/** @name getPost */
select id, slug, title
from posts
where id = :id;
```

```ts
await getPost(client, {id: 123});
```

Use `:list` when one param should expand into a comma-separated placeholder list.
The most common shape is an `in (...)` clause.

```sql
/** @name listPostsByIds */
select id, slug, title
from posts
where id in (:ids:list)
order by id;
```

```ts
await listPostsByIds(client, {ids: [1, 2, 3]});
```

At runtime sqlfu executes `where id in (?, ?, ?)` with `[1, 2, 3]`. Empty arrays
throw before the query reaches SQLite.

Use dot paths when a query naturally accepts one object.

```sql
/** @name insertPost */
insert into posts (slug, title)
values (:post.slug, :post.title)
returning id, slug, title;
```

```ts
await insertPost(client, {
  post: {
    slug: 'hello-world',
    title: 'Hello world',
  },
});
```

The generated params type is `{post: {slug: string; title: string}}`. One object
path segment is supported today; nested paths such as `:post.author.id` are
intentionally rejected until the type shape is designed.

Use `:tupleList(...)` for bulk row tuples.

```sql
/** @name insertPosts */
insert into posts (slug, title)
values :posts:tupleList(slug, title)
returning id, slug, title;
```

```ts
await insertPosts(client, {
  posts: [
    {slug: 'first', title: 'First'},
    {slug: 'second', title: 'Second'},
  ],
});
```

At runtime sqlfu executes `values (?, ?), (?, ?)` and flattens the values in the
field order declared in `tupleList`. Empty arrays throw.

## Limits

- Runtime-expanded params, currently `:list` and `:tupleList(...)`, can appear only
  once in a query. Reusing the same expanded array in two places would require
  duplicating the driver arguments, so sqlfu rejects that shape for now.
- Typed JSON params are not supported yet. A JSON column is still usable as a
  regular scalar param, but sqlfu does not infer or enforce the TypeScript object
  shape inside SQLite JSON text/blob values.
- Parameter modifiers are part of the SQL placeholder, not comment metadata.
  `@name` names queries; `:ids:list` and `:posts:tupleList(...)` describe runtime
  placeholder expansion where the SQL shape changes.
