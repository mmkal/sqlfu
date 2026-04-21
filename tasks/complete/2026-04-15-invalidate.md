size: small
---

whenever SQL runner or one of the saved queries runs, or whenever I edit a table directly from one of the "Relations", can we make it so th  Schema content gets invalidated? However is the best way to do this with orpc? (We are using orpc for API calls, right???)

- [x] invalidate schema queries after SQL runner execution
  note: wired through the existing TanStack Query client after successful `/api/sql` runs
- [x] invalidate schema queries after saved-query execution
  note: wired through the query execution mutation as well, so schema cards stay fresh after navigation back to `#schema`
- [x] invalidate schema queries after relation row saves
  note: table save success now invalidates `schema`, `schema-check`, and `schema-authorities`
- [x] add a browser spec covering all three invalidation paths
  note: waits for `/api/schema` to refetch after each action

## Log

- Not using orpc on the client side here yet; this UI is currently talking to JSON endpoints directly and invalidating via TanStack Query.
