# UI

Run `npx sqlfu` in your project directory and open `https://sqlfu.dev/ui`. The hosted UI connects to the local backend that sqlfu just started, on `localhost:56081`. No separate install needed.

What the UI gives you:

- table browser -- inspect rows, column types, and indexes for every table in your database
- ad hoc SQL runner -- run queries directly against your dev database, see results inline
- generated query runner -- execute your checked-in `.sql` queries with typed param input, backed by the same `sqlfu` query metadata that powers the TypeScript wrappers

The hosted UI runs on `sqlfu.dev/ui` as a static shell; all data stays on your machine. The local backend serves the API and has the CORS, private-network-access, and optional `mkcert` handling required for a public HTTPS page to talk to localhost. See [CLAUDE.md](./CLAUDE.md) for the architecture detail.

## Demo

`https://sqlfu.dev/ui?demo=1` runs fully in the browser against an in-memory SQLite database -- no backend, no install. The demo uses the same posts-table schema as the [Getting Started](https://sqlfu.dev/docs/getting-started) walkthrough.

## Advanced: self-host

You probably don't need this. The hosted UI at `sqlfu.dev/ui` is updated with every release and requires nothing beyond `npx sqlfu`.

If you need the UI bundle in your own build pipeline (embedded admin panel, offline-only environment, custom auth layer), install the package:

```sh
pnpm add @sqlfu/ui
```

Then wire the React bundle and start a local sqlfu backend server to serve the API:

```sh
pnpm --filter @sqlfu/ui dev
```

That starts the client against a sqlfu backend with Vite HMR, using `packages/ui/test/projects/dev-project`. Playwright uses the same entrypoint but starts a separate seeded `fixture-project`.

## Inspiration

The intended product shape -- a hosted UI at `sqlfu.dev/ui` talking to a locally running sqlfu backend -- is directly inspired by [Drizzle](https://orm.drizzle.team/)'s [`local.drizzle.studio`](https://local.drizzle.studio/).
