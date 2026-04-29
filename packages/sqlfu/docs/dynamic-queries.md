# Dynamic queries

sqlfu generates typed wrappers from static `.sql` files, so it doesn't have the runtime query-composition story you'd get from a query builder like [Kysely](https://kysely.dev) or [Drizzle](https://orm.drizzle.team). Most of the time that's fine: real-world app queries are static, and composing-queries-at-runtime turns out to be rarer than it feels.

For the cases where you _do_ have optional filters, the trick is to push the "is this filter active" decision into the SQL itself. This is the same pattern [pgTyped recommends](https://pgtyped.dev/docs/dynamic-queries): a single static query with `:param IS NULL OR column = :param` clauses that short-circuit when the parameter is null.

## The pattern

Say you want to list posts with any combination of: filter by author, filter by a minimum published date, filter by a search substring in the title. All three are optional.

```sql (sql/list-posts.sql)
select id, title, author, published_at
from posts
where (:author is null or author = :author)
  and (:published_since is null or published_at >= :published_since)
  and (:title_contains is null or title like '%' || :title_contains || '%')
order by published_at desc
limit :limit;
```

`sqlfu generate` types the parameters as nullable:

```ts
await listPosts(client, {
  author: null,
  published_since: '2026-01-01',
  title_contains: null,
  limit: 20,
});
```

Pass `null` for "no filter", a value for "apply this filter". One compiled query plan covers all 2ⁿ combinations. SQLite's optimiser is generally smart enough to eliminate the always-true branches, but if the query gets slow you can always split it into N named queries and pick at runtime.

## When the pattern gets awkward

- **More than a handful of optional filters.** With 8 optional filters you've got 256 possible active-combinations collapsed into one query plan. The SQL stays readable but performance can degrade in the long tail of combinations. At that point, consider splitting into a few named-query variants, or reach for a query builder (sqlfu is happy to share an app with Kysely or Drizzle: wrap the dynamic bits in whichever one you prefer and keep the static 90% in `.sql` files).
- **Dynamic `order by` / column selection.** These don't fit the `IS NULL` trick at all. Users writing "build me a dashboard with sortable columns" is the canonical "you want a query builder" problem. No shame in using one.
- **`IN (:list)` with a variable-length list.** Use JSON: `where id in (select value from json_each(:ids))`, passing `ids` as a JSON-encoded string. SQLite's `json_each` makes this ergonomic.

## What sqlfu doesn't try to do

sqlfu won't build you a fluent API for composing SQL. That's a deliberate non-goal: if you want that, you want a query builder. Query builders are great at it, and there's no rule against mixing tools: a sqlfu app can import a query builder for the specific procedures that need runtime composition, and leave the rest of the queries as checked-in `.sql` files. The two models coexist cleanly.
