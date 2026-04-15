the ui uses a fetchJson to hit its API. let's move it to an orpc backend.

make sure you use idiomatic orpc with tanstack query. can't remember what's considered the best way to do it, i think there's a queryOptions() helper? check docs.

- [x] add a typed ui oRPC router on the server
  note: the Bun UI server now mounts a dedicated `/api/rpc` handler instead of hand-written JSON route branches
- [x] switch the React client to oRPC TanStack Query utilities
  note: the UI now uses `createORPCClient` + `createTanstackQueryUtils` with `.queryOptions()` / `.mutationOptions()`
- [x] keep schema/query/table flows working across the migration
  note: updated the focused Playwright waits to the RPC procedure paths and kept the existing user-visible behavior green

## Log

- I used the current oRPC docs for the client shape: `RPCLink`, `createORPCClient`, and `createTanstackQueryUtils(...).queryOptions()` / `.mutationOptions()`.
- I kept the UI endpoints as a separate router instead of trying to force the existing `sqlfu` CLI router into the browser surface.
