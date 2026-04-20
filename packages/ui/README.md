# sqlfu/ui

Client-only UI for `sqlfu`.

The backend API now lives in `packages/sqlfu`. This package owns the React bundle plus local dev/test glue for running that client against a sqlfu backend server.

Current scope:

- table browser
- ad hoc SQL runner
- generated query runner backed by `sqlfu` query metadata

Development:

```sh
pnpm --filter @sqlfu/ui dev
```

That starts the client against a sqlfu backend server with Vite HMR, using `packages/ui/test/projects/dev-project`. If the project does not exist yet, it is seeded from the template project.

Playwright uses the same entrypoint, but starts a separate seeded `fixture-project`.

## Inspiration

The intended product shape - a hosted UI at `local.sqlfu.dev` talking to a locally running sqlfu backend - is directly inspired by [Drizzle](https://orm.drizzle.team/)'s [`local.drizzle.studio`](https://local.drizzle.studio/). See [CLAUDE.md](./CLAUDE.md) for more detail, including why "public HTTPS page talks to localhost" needs the CORS, private-network, and `mkcert` handling that lives in `packages/sqlfu`.
