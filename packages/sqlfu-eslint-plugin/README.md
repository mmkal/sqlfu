# @sqlfu/eslint-plugin

ESLint rules for sqlfu projects. Pushes authors toward named `.sql` files so queries keep their name, their generated types, and their observability identity.

**Status: alpha.** One rule today (`no-unnamed-inline-sql`). More candidates listed below.

## Install

```sh
pnpm add -D @sqlfu/eslint-plugin
```

## Use (ESLint flat config)

```js
// eslint.config.js
import sqlfu from '@sqlfu/eslint-plugin'

export default [
  sqlfu.configs.recommended,
]
```

Or wire the rule by hand:

```js
import sqlfu from '@sqlfu/eslint-plugin'

export default [
  {
    plugins: {sqlfu},
    rules: {
      'sqlfu/no-unnamed-inline-sql': 'error',
    },
  },
]
```

## Use (oxlint)

oxlint 1.x supports ESLint-compatible JS plugins (alpha). You should be able to load the same package:

```jsonc
// .oxlintrc.json
{
  "jsPlugins": ["@sqlfu/eslint-plugin"],
  "rules": {
    "sqlfu/no-unnamed-inline-sql": "error"
  }
}
```

The JS-plugin loader is alpha upstream, so if this doesn't resolve cleanly on your oxlint version, run the ESLint plugin directly for now.

## Rules

### `sqlfu/no-unnamed-inline-sql`

Flags inline SQL passed to `client.all` / `client.run` / `client.iterate` / `client.sql\`...\`` when the normalized text matches a checked-in `.sql` file under your project's `queries` glob.

```ts
// bad
client.all(`select id, name from users order by name`)

// good
import {listUsers} from '../sql/list-users.sql.js'
await listUsers(client)
```

Matches are normalized (whitespace collapsed, keywords lowercased), so cosmetic differences don't suppress the warning. Parameterized templates (`${foo}`) aren't flagged — the rule doesn't try to reconstruct them.

**Options.**

```ts
{
  'sqlfu/no-unnamed-inline-sql': ['error', {
    // Absolute path, or relative to the nearest sqlfu.config.*. Defaults to the
    // `queries` value parsed from the config file (or `./sql` if parsing fails).
    queriesDir: './sql',
    // Regex for identifiers treated as sqlfu clients. Default: client | db | sqlfu | *Client.
    clientIdentifierPattern: '^(client|db|sqlfu|.*Client)$',
  }],
}
```

## Not shipped yet

- `prefer-lowercase-sql` — enforce the "lowercase SQL keywords" convention across `.sql` files and inline strings.
- `no-stale-generation` — `.sql` file without a matching generated wrapper. Better served by `sqlfu check` today.
- `no-unknown-schema-ref` — raw SQL referencing tables/columns absent from `definitions.sql`. Needs a proper parse.

Open an issue if you'd use any of these.
