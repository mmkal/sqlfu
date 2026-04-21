Validator-integration fixtures: zod, valibot, zod/mini, arktype. Runtime-behaviour tests
(actually importing the transpiled module and calling it) stay in `generate.test.ts` — the
fixtures here just pin the emitted source shape. We also cover `prettyErrors: false` for each,
which changes the emitted file significantly (inline issue-throwing instead of the shared
runtime helper), and the plain-TS default when no validator is configured.

<details>
<summary>validator: zod emits zod schemas with namespace-merged exports</summary>

### input

```sql (definitions.sql)
create table posts (
  id integer primary key,
  slug text not null,
  title text,
  status text not null check (status in ('draft', 'published'))
);
```

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
  generate: {validator: 'zod'},
};
```

```sql (sql/find-post-by-slug.sql)
select id, slug, title, status from posts where slug = :slug limit 1;
```
### output

```ts (sql/.generated/find-post-by-slug.sql.ts)
import type {Client, SqlQuery} from 'sqlfu';
import {z} from 'zod';

const Params = z.object({
	slug: z.string(),
});
const Result = z.object({
	id: z.number(),
	slug: z.string(),
	title: z.string().nullable(),
	status: z.enum(["draft", "published"]),
});
const sql = `
select id, slug, title, status from posts where slug = ? limit 1;
`;

export const findPostBySlug = Object.assign(
	async function findPostBySlug(client: Client, rawParams: z.infer<typeof Params>): Promise<z.infer<typeof Result> | null> {
		const parsedParams = Params.safeParse(rawParams);
		if (!parsedParams.success) throw new Error(z.prettifyError(parsedParams.error));
		const params = parsedParams.data;
		const query: SqlQuery = { sql, args: [params.slug], name: "find-post-by-slug" };
		const rows = await client.all(query);
		if (rows.length === 0) return null;
		const parsed = Result.safeParse(rows[0]);
		if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
		return parsed.data;
	},
	{ Params, Result, sql },
);

export namespace findPostBySlug {
	export type Params = z.infer<typeof findPostBySlug.Params>;
	export type Result = z.infer<typeof findPostBySlug.Result>;
}
```
</details>

<details>
<summary>validator: valibot emits valibot schemas</summary>

### input

```sql (definitions.sql)
create table posts (
  id integer primary key,
  slug text not null,
  title text,
  status text not null check (status in ('draft', 'published'))
);
```

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
  generate: {validator: 'valibot'},
};
```

```sql (sql/find-post-by-slug.sql)
select id, slug, title, status from posts where slug = :slug limit 1;
```
### output

```ts (sql/.generated/find-post-by-slug.sql.ts)
import {prettifyStandardSchemaError, type Client, type SqlQuery} from 'sqlfu';
import * as v from 'valibot';

const Params = v.object({
	slug: v.string(),
});
const Result = v.object({
	id: v.number(),
	slug: v.string(),
	title: v.nullable(v.string()),
	status: v.picklist(["draft", "published"]),
});
const sql = `
select id, slug, title, status from posts where slug = ? limit 1;
`;

export const findPostBySlug = Object.assign(
	async function findPostBySlug(client: Client, rawParams: v.InferOutput<typeof Params>): Promise<v.InferOutput<typeof Result> | null> {
		const parsedParamsResult = Params['~standard'].validate(rawParams);
		if ('then' in parsedParamsResult) throw new Error('Unexpected async validation from Params.');
		if ('issues' in parsedParamsResult) throw new Error(prettifyStandardSchemaError(parsedParamsResult) || 'Validation failed');
		const params = parsedParamsResult.value;
		const query: SqlQuery = { sql, args: [params.slug], name: "find-post-by-slug" };
		const rows = await client.all(query);
		if (rows.length === 0) return null;
		const parsed = Result['~standard'].validate(rows[0]);
		if ('then' in parsed) throw new Error('Unexpected async validation from Result.');
		if ('issues' in parsed) throw new Error(prettifyStandardSchemaError(parsed) || 'Validation failed');
		return parsed.value;
	},
	{ Params, Result, sql },
);

export namespace findPostBySlug {
	export type Params = v.InferOutput<typeof findPostBySlug.Params>;
	export type Result = v.InferOutput<typeof findPostBySlug.Result>;
}
```
</details>

<details>
<summary>validator: zod-mini emits zod/mini schemas</summary>

### input

```sql (definitions.sql)
create table posts (id integer primary key, slug text not null, title text);
```

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
  generate: {validator: 'zod-mini'},
};
```

```sql (sql/find-post-by-slug.sql)
select id, slug, title from posts where slug = :slug limit 1;
```
### output

```ts (sql/.generated/find-post-by-slug.sql.ts)
import {prettifyStandardSchemaError, type Client, type SqlQuery} from 'sqlfu';
import * as z from 'zod/mini';

const Params = z.object({
	slug: z.string(),
});
const Result = z.object({
	id: z.number(),
	slug: z.string(),
	title: z.nullable(z.string()),
});
const sql = `
select id, slug, title from posts where slug = ? limit 1;
`;

export const findPostBySlug = Object.assign(
	async function findPostBySlug(client: Client, rawParams: z.infer<typeof Params>): Promise<z.infer<typeof Result> | null> {
		const parsedParamsResult = Params['~standard'].validate(rawParams);
		if ('then' in parsedParamsResult) throw new Error('Unexpected async validation from Params.');
		if ('issues' in parsedParamsResult) throw new Error(prettifyStandardSchemaError(parsedParamsResult) || 'Validation failed');
		const params = parsedParamsResult.value;
		const query: SqlQuery = { sql, args: [params.slug], name: "find-post-by-slug" };
		const rows = await client.all(query);
		if (rows.length === 0) return null;
		const parsed = Result['~standard'].validate(rows[0]);
		if ('then' in parsed) throw new Error('Unexpected async validation from Result.');
		if ('issues' in parsed) throw new Error(prettifyStandardSchemaError(parsed) || 'Validation failed');
		return parsed.value;
	},
	{ Params, Result, sql },
);

export namespace findPostBySlug {
	export type Params = z.infer<typeof findPostBySlug.Params>;
	export type Result = z.infer<typeof findPostBySlug.Result>;
}
```
</details>

<details>
<summary>validator: zod + prettyErrors: false drops the prettify helper and safeParse wrapper</summary>

### input

```sql (definitions.sql)
create table posts (id integer primary key, slug text not null);
```

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
  generate: {validator: 'zod', prettyErrors: false},
};
```

```sql (sql/find-post-by-slug.sql)
select id, slug from posts where slug = :slug limit 1;
```
### output

```ts (sql/.generated/find-post-by-slug.sql.ts)
import type {Client, SqlQuery} from 'sqlfu';
import {z} from 'zod';

const Params = z.object({
	slug: z.string(),
});
const Result = z.object({
	id: z.number(),
	slug: z.string(),
});
const sql = `
select id, slug from posts where slug = ? limit 1;
`;

export const findPostBySlug = Object.assign(
	async function findPostBySlug(client: Client, rawParams: z.infer<typeof Params>): Promise<z.infer<typeof Result> | null> {
		const params = Params.parse(rawParams);
		const query: SqlQuery = { sql, args: [params.slug], name: "find-post-by-slug" };
		const rows = await client.all(query);
		return rows.length > 0 ? Result.parse(rows[0]) : null;
	},
	{ Params, Result, sql },
);

export namespace findPostBySlug {
	export type Params = z.infer<typeof findPostBySlug.Params>;
	export type Result = z.infer<typeof findPostBySlug.Result>;
}
```
</details>

<details>
<summary>validator: valibot + prettyErrors: false throws raw issues inline</summary>

### input

```sql (definitions.sql)
create table posts (id integer primary key, slug text not null);
```

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
  generate: {validator: 'valibot', prettyErrors: false},
};
```

```sql (sql/find-post-by-slug.sql)
select id, slug from posts where slug = :slug limit 1;
```
### output

```ts (sql/.generated/find-post-by-slug.sql.ts)
import type {Client, SqlQuery} from 'sqlfu';
import * as v from 'valibot';

const Params = v.object({
	slug: v.string(),
});
const Result = v.object({
	id: v.number(),
	slug: v.string(),
});
const sql = `
select id, slug from posts where slug = ? limit 1;
`;

export const findPostBySlug = Object.assign(
	async function findPostBySlug(client: Client, rawParams: v.InferOutput<typeof Params>): Promise<v.InferOutput<typeof Result> | null> {
		const parsedParamsResult = Params['~standard'].validate(rawParams);
		if ('then' in parsedParamsResult) throw new Error('Unexpected async validation from Params.');
		if ('issues' in parsedParamsResult) throw Object.assign(new Error('Validation failed'), {issues: parsedParamsResult.issues});
		const params = parsedParamsResult.value;
		const query: SqlQuery = { sql, args: [params.slug], name: "find-post-by-slug" };
		const rows = await client.all(query);
		if (rows.length === 0) return null;
		const parsed = Result['~standard'].validate(rows[0]);
		if ('then' in parsed) throw new Error('Unexpected async validation from Result.');
		if ('issues' in parsed) throw Object.assign(new Error('Validation failed'), {issues: parsed.issues});
		return parsed.value;
	},
	{ Params, Result, sql },
);

export namespace findPostBySlug {
	export type Params = v.InferOutput<typeof findPostBySlug.Params>;
	export type Result = v.InferOutput<typeof findPostBySlug.Result>;
}
```
</details>

<details>
<summary>validator: zod-mini + prettyErrors: false throws raw issues inline</summary>

### input

```sql (definitions.sql)
create table posts (id integer primary key, slug text not null);
```

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
  generate: {validator: 'zod-mini', prettyErrors: false},
};
```

```sql (sql/find-post-by-slug.sql)
select id, slug from posts where slug = :slug limit 1;
```
### output

```ts (sql/.generated/find-post-by-slug.sql.ts)
import type {Client, SqlQuery} from 'sqlfu';
import * as z from 'zod/mini';

const Params = z.object({
	slug: z.string(),
});
const Result = z.object({
	id: z.number(),
	slug: z.string(),
});
const sql = `
select id, slug from posts where slug = ? limit 1;
`;

export const findPostBySlug = Object.assign(
	async function findPostBySlug(client: Client, rawParams: z.infer<typeof Params>): Promise<z.infer<typeof Result> | null> {
		const parsedParamsResult = Params['~standard'].validate(rawParams);
		if ('then' in parsedParamsResult) throw new Error('Unexpected async validation from Params.');
		if ('issues' in parsedParamsResult) throw Object.assign(new Error('Validation failed'), {issues: parsedParamsResult.issues});
		const params = parsedParamsResult.value;
		const query: SqlQuery = { sql, args: [params.slug], name: "find-post-by-slug" };
		const rows = await client.all(query);
		if (rows.length === 0) return null;
		const parsed = Result['~standard'].validate(rows[0]);
		if ('then' in parsed) throw new Error('Unexpected async validation from Result.');
		if ('issues' in parsed) throw Object.assign(new Error('Validation failed'), {issues: parsed.issues});
		return parsed.value;
	},
	{ Params, Result, sql },
);

export namespace findPostBySlug {
	export type Params = z.infer<typeof findPostBySlug.Params>;
	export type Result = z.infer<typeof findPostBySlug.Result>;
}
```
</details>

<details>
<summary>validator: arktype emits arktype schemas</summary>

### input

```sql (definitions.sql)
create table posts (
  id integer primary key,
  slug text not null,
  title text,
  status text not null check (status in ('draft', 'published'))
);
```

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
  generate: {validator: 'arktype'},
};
```

```sql (sql/find-post-by-slug.sql)
select id, slug, title, status from posts where slug = :slug limit 1;
```
### output

```ts (sql/.generated/find-post-by-slug.sql.ts)
import {prettifyStandardSchemaError, type Client, type SqlQuery} from 'sqlfu';
import {type} from 'arktype';

const Params = type({
	slug: "string",
});
const Result = type({
	id: "number",
	slug: "string",
	title: "string | null",
	status: "\"draft\" | \"published\"",
});
const sql = `
select id, slug, title, status from posts where slug = ? limit 1;
`;

export const findPostBySlug = Object.assign(
	async function findPostBySlug(client: Client, rawParams: typeof Params.infer): Promise<typeof Result.infer | null> {
		const parsedParamsResult = Params['~standard'].validate(rawParams);
		if ('then' in parsedParamsResult) throw new Error('Unexpected async validation from Params.');
		if ('issues' in parsedParamsResult) throw new Error(prettifyStandardSchemaError(parsedParamsResult) || 'Validation failed');
		const params = parsedParamsResult.value;
		const query: SqlQuery = { sql, args: [params.slug], name: "find-post-by-slug" };
		const rows = await client.all(query);
		if (rows.length === 0) return null;
		const parsed = Result['~standard'].validate(rows[0]);
		if ('then' in parsed) throw new Error('Unexpected async validation from Result.');
		if ('issues' in parsed) throw new Error(prettifyStandardSchemaError(parsed) || 'Validation failed');
		return parsed.value;
	},
	{ Params, Result, sql },
);

export namespace findPostBySlug {
	export type Params = typeof findPostBySlug.Params.infer;
	export type Result = typeof findPostBySlug.Result.infer;
}
```
</details>

<details>
<summary>validator: arktype + prettyErrors: false throws raw issues inline</summary>

### input

```sql (definitions.sql)
create table posts (id integer primary key, slug text not null);
```

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
  generate: {validator: 'arktype', prettyErrors: false},
};
```

```sql (sql/find-post-by-slug.sql)
select id, slug from posts where slug = :slug limit 1;
```
### output

```ts (sql/.generated/find-post-by-slug.sql.ts)
import type {Client, SqlQuery} from 'sqlfu';
import {type} from 'arktype';

const Params = type({
	slug: "string",
});
const Result = type({
	id: "number",
	slug: "string",
});
const sql = `
select id, slug from posts where slug = ? limit 1;
`;

export const findPostBySlug = Object.assign(
	async function findPostBySlug(client: Client, rawParams: typeof Params.infer): Promise<typeof Result.infer | null> {
		const parsedParamsResult = Params['~standard'].validate(rawParams);
		if ('then' in parsedParamsResult) throw new Error('Unexpected async validation from Params.');
		if ('issues' in parsedParamsResult) throw Object.assign(new Error('Validation failed'), {issues: parsedParamsResult.issues});
		const params = parsedParamsResult.value;
		const query: SqlQuery = { sql, args: [params.slug], name: "find-post-by-slug" };
		const rows = await client.all(query);
		if (rows.length === 0) return null;
		const parsed = Result['~standard'].validate(rows[0]);
		if ('then' in parsed) throw new Error('Unexpected async validation from Result.');
		if ('issues' in parsed) throw Object.assign(new Error('Validation failed'), {issues: parsed.issues});
		return parsed.value;
	},
	{ Params, Result, sql },
);

export namespace findPostBySlug {
	export type Params = typeof findPostBySlug.Params.infer;
	export type Result = typeof findPostBySlug.Result.infer;
}
```
</details>

<details>
<summary>validator: zod + insert metadata skips result validation but keeps Params</summary>

### input

```sql (definitions.sql)
create table posts (id integer primary key, slug text not null);
```

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
  generate: {validator: 'zod'},
};
```

```sql (sql/insert-post.sql)
insert into posts (slug) values (:slug);
```
### output

```ts (sql/.generated/insert-post.sql.ts)
import type {Client, SqlQuery} from 'sqlfu';
import {z} from 'zod';

const Params = z.object({
	slug: z.string(),
});
const sql = `
insert into posts (slug) values (?);
`;

export const insertPost = Object.assign(
	async function insertPost(client: Client, rawParams: z.infer<typeof Params>) {
		const parsedParams = Params.safeParse(rawParams);
		if (!parsedParams.success) throw new Error(z.prettifyError(parsedParams.error));
		const params = parsedParams.data;
		const query: SqlQuery = { sql, args: [params.slug], name: "insert-post" };
		return client.run(query);
	},
	{ Params, sql },
);

export namespace insertPost {
	export type Params = z.infer<typeof insertPost.Params>;
}
```
</details>

<details>
<summary>no validator: plain-TS output matches the default wrapper shape</summary>

### input

```sql (definitions.sql)
create table posts (id integer primary key, slug text not null);
```

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
};
```

```sql (sql/list-posts.sql)
select id, slug from posts;
```
### output

```ts (sql/.generated/list-posts.sql.ts)
import type {Client} from 'sqlfu';

const sql = `select id, slug from posts;`

export const listPosts = Object.assign(
	async function listPosts(client: Client): Promise<listPosts.Result[]> {
		const query = { sql, args: [], name: "list-posts" };
		return client.all<listPosts.Result>(query);
	},
	{ sql },
);

export namespace listPosts {
	export type Result = {
		id: number;
		slug: string;
	};
}
```
</details>
