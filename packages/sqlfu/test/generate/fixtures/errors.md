Error-case fixtures: `sqlfu generate` should refuse to run and throw a specific message. The
`error` block inside each test is treated as a regular expression that must match the thrown
error message.

Every test here overrides `sqlfu.config.ts` with a broken config — the `default config` block
below is the one they're comparing against, and isn't used directly by any test.

<details>
<summary>default config</summary>

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
};
```

</details>

## rejects unknown validator values at config load

<details>
<summary>input</summary>

```sql (definitions.sql)
create table posts (id integer primary key);
```

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
  generate: {validator: 'not-a-real-validator' as any},
};
```

```sql (sql/list-posts.sql)
select id from posts;
```

</details>

<details>
<summary>error</summary>

"generate\.validator" must be one of 'arktype', 'valibot', 'zod', 'zod-mini', null, or undefined

</details>

## rejects the legacy generate.zod flag with a migration hint

<details>
<summary>input</summary>

```sql (definitions.sql)
create table posts (id integer primary key);
```

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
  generate: {zod: true} as any,
};
```

```sql (sql/list-posts.sql)
select id from posts;
```

</details>

<details>
<summary>error</summary>

"generate\.zod" is no longer supported[\s\S]+generate\.validator

</details>
