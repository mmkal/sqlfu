<!--
Error-case fixtures: `generate` should refuse to run and throw a specific message. The `### error`
section's content is treated as a regular expression that must match the thrown error message.
-->

<details>
<summary>rejects unknown validator values at config load</summary>

### input

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

### error

"generate\.validator" must be one of 'arktype', 'valibot', 'zod', 'zod-mini', null, or undefined

</details>

<details>
<summary>rejects the legacy generate.zod flag with a migration hint</summary>

### input

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

### error

"generate\.zod" is no longer supported[\s\S]+generate\.validator

</details>
