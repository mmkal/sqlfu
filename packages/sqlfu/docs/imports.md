# Import surface

Sqlfu has a few public import paths. Pick the narrowest path that matches what
the code is doing.

## `sqlfu`

Use `sqlfu` in application runtime code. It is the light, portable entrypoint:
client types, SQL tags, adapters, instrumentation, config typing, SQLite text
helpers, and the small migration runner for generated bundles.

```ts
import {createNodeSqliteClient, sql} from 'sqlfu';
import {DatabaseSync} from 'node:sqlite'

const client = createNodeSqliteClient(new DatabaseSync('app.db'));

client.run(sql`
  insert into posts(slug, title, body)
  values ('hello-world', 'Hi world', 'How are you all doing')
`);
```

This entrypoint is our precious baby, and because it's a precious baby, it is *small* and *fiercely protected*. There will never be any `node:*` imports and no heavy commands tooling.
It's what you should use for your app code, to pass into generated query wrappers, workers, and even browser-safe bundles. It will very rarely have breaking changes.

## `sqlfu/api`

Use `sqlfu/api` for programmatic access to the functionality behind `npx sqlfu` commands:

```ts
import {check, draft, format, migrate} from 'sqlfu/api';

await check();
await draft({name: 'add-posts', confirm: (params) => params.body});
await migrate({confirm: (params) => params.body});
const formatted = format('SELECT * FROM users WHERE id=1;');
```

Note: Mutating commands require a `confirm` callback anywhere the CLI would ask the
user to review SQL or generated file contents. Returning the body (or a modified body) accepts it;
returning `null` or empty string cancels. For "yolo" mode just return `params.body`, or you can insert your own approval/modification workflow.

`format('select foo from bar')` is slightly different to the `npx sqlfu format` command: instead of modifying files in place, it just formats the sql you pass to it.

`sqlfu/api` *does* import from some `node:*` modules. It uses simple filesystem and path functions, so can be used from Bun too. Right now, because of the filesystem access, it should not be used from the browser, or from Cloudflare Workers, even with nodejs_compat. See `sqlfu/api/core` below for that. Aside from `format()`, it loads project config from the current process, creates the default Node host, and may import command, server, typegen, and file system code.

## `sqlfu/api/core`

Use `sqlfu/api/core` when you are embedding sqlfu operations behind your own
host, UI, tests, or runtime boundary.

```ts
import {createSqlfuApi} from 'sqlfu/api/core';

const sqlfu = createSqlfuApi({projectRoot, config, host});
await sqlfu.check();
await sqlfu.draft({confirm});
```

This path has the same command-shaped methods as `sqlfu/api`, but you provide
the `SqlfuHost` and config/project loading context yourself.

## `sqlfu/api/sync`

Use `sqlfu/api/sync` when you only want the runtime `sync()` primitive, without
pulling in the full command facade from `sqlfu/api`.

```ts
import {sync} from 'sqlfu/api/sync';

sync(client, {
  definitions: `
    create table posts(slug text primary key, body text);
  `,
  scratchSchema: 'prefix',
});
```

Durable Objects should use `scratchSchema: 'prefix'` because they cannot create
normal scratch databases. Other sync SQLite clients use
`scratchSchema: 'scratch-db'` by default.

## `sqlfu/cloudflare`

Use `sqlfu/cloudflare` for config-time helpers that point sqlfu at a
Cloudflare D1 database: local sqlite for `wrangler dev` / alchemy v1's
Miniflare, or HTTP for deployed cloud D1 (alchemy v2, wrangler, Terraform,
manual provisioning).

```ts
import {defineConfig} from 'sqlfu';
import {findMiniflareD1Path} from 'sqlfu/cloudflare';

export default defineConfig({
  db: findMiniflareD1Path('my-dev-app-slug'),
  migrations: {path: './migrations', preset: 'd1'},
  definitions: './definitions.sql',
  queries: './sql',
});
```

`findMiniflareD1Path()` walks up from `process.cwd()` until it finds a supported
Miniflare v3 persist root. Today that means Alchemy's
`.alchemy/miniflare/v3` layout. It then derives the D1 sqlite filename from the
Alchemy app slug. If the config is evaluated from somewhere else, pass
`{miniflareV3Root: '/absolute/path/to/.alchemy/miniflare/v3'}`.

For deployed cloud D1, use `createAlchemyD1Client` (one-line combinator that
reads alchemy v2's local state) or compose your own factory from
`createD1HttpClient`, `readAlchemyD1State`, and `findCloudflareD1ByName`:

```ts
import {defineConfig} from 'sqlfu';
import {createAlchemyD1Client} from 'sqlfu/cloudflare';

export default defineConfig({
  db: () => createAlchemyD1Client({stack: 'my-app', stage: 'dev', fqn: 'database'}),
  migrations: {path: './migrations', preset: 'd1'},
});
```

See [Cloudflare D1](./cloudflare-d1.md) for the full guide.

## `sqlfu/analyze`

Use `sqlfu/analyze` for in-browser or worker analysis surfaces: schema
inspection, schema diff planning, and vendored TypeSQL query analysis. It avoids
`node:*`, but it intentionally includes heavier analysis code.

```ts
import {analyzeVendoredTypesqlQueriesWithClient, inspectSqliteSchema} from 'sqlfu/analyze';
```

## UI paths

Use `sqlfu/ui` only for the Node server entrypoint that starts or embeds the
local sqlfu backend. Use `sqlfu/ui/browser` for browser-side UI router types and
helpers.

```ts
import {startSqlfuServer} from 'sqlfu/ui';
import type {UiRouter} from 'sqlfu/ui/browser';
```

The two UI paths are explicit on purpose. Code should not rely on conditional
exports or bundler magic to choose between server and browser implementations.

## Feature subpaths

Some features keep their own entrypoints because they are meant to be consumed
independently:

- `sqlfu/outbox` for the transactional outbox/job queue.
- `sqlfu/lint-plugin` for the ESLint plugin.

If you are not sure where a symbol belongs, prefer the higher-level path first:
app/runtime code imports from `sqlfu`, command scripts import from `sqlfu/api`,
and config-time helpers for Cloudflare D1 import from `sqlfu/cloudflare`.
