One test per query "shape" the generator recognizes: insert, insert-returning, update, delete,
aggregate, user-defined function, and CTE. Shapes the analyzer can't type fall through to the
`//Invalid SQL` wrapper — those are here too so we see them diff when the analyzer improves.

<details>
<summary>snapshots insert queries</summary>

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

```sql (sql/insert-post.sql)
insert into posts (slug) values (:slug);
```
### output

```ts (sql/.generated/insert-post.sql.ts)
import type {Client} from 'sqlfu';

const sql = `insert into posts (slug) values (?);`

export const insertPost = Object.assign(
	async function insertPost(client: Client, params: insertPost.Params) {
		const query = { sql, args: [params.slug], name: "insert-post" };
		return client.run(query);
	},
	{ sql },
);

export namespace insertPost {
	export type Params = {
		slug: string;
	};
}
```
</details>

<details>
<summary>treats insert returning queries as single-row results</summary>

### input

```sql (definitions.sql)
create table users (id integer primary key, name text not null, email text not null);
```

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
};
```

```sql (sql/add-user.sql)
insert into users (name, email) values (:fullName, :emailAddress) returning *;
```
### output

```ts (sql/.generated/add-user.sql.ts)
import type {Client} from 'sqlfu';

const sql = `insert into users (name, email) values (?, ?) returning *;`

export const addUser = Object.assign(
	async function addUser(client: Client, params: addUser.Params): Promise<addUser.Result> {
		const query = { sql, args: [params.fullName, params.emailAddress], name: "add-user" };
		const rows = await client.all<addUser.Result>(query);
		return rows[0];
	},
	{ sql },
);

export namespace addUser {
	export type Params = {
		fullName: string;
		emailAddress: string;
	};
	export type Result = {
		id: number;
		name: string;
		email: string;
	};
}
```
</details>

<details>
<summary>snapshots update queries</summary>

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

```sql (sql/update-post.sql)
update posts set slug = :slug where id = :id;
```
### output

```ts (sql/.generated/update-post.sql.ts)
import type {Client} from 'sqlfu';

const sql = `update posts set slug = ? where id = ?;`

export const updatePost = Object.assign(
	async function updatePost(client: Client, data: updatePost.Data, params: updatePost.Params) {
		const query = { sql, args: [data.slug, params.id], name: "update-post" };
		return client.run(query);
	},
	{ sql },
);

export namespace updatePost {
	export type Data = {
		slug: string;
	};
	export type Params = {
		id: number;
	};
}
```
</details>

<details>
<summary>snapshots delete queries</summary>

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

```sql (sql/delete-post.sql)
delete from posts where id = :id;
```
### output

```ts (sql/.generated/delete-post.sql.ts)
import type {Client} from 'sqlfu';

const sql = `delete from posts where id = ?;`

export const deletePost = Object.assign(
	async function deletePost(client: Client, params: deletePost.Params) {
		const query = { sql, args: [params.id], name: "delete-post" };
		return client.run(query);
	},
	{ sql },
);

export namespace deletePost {
	export type Params = {
		id: number;
	};
}
```
</details>

<details>
<summary>snapshots aggregate function queries (count)</summary>

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

```sql (sql/count-posts.sql)
select count(*) as total from posts;
```
### output

```ts (sql/.generated/count-posts.sql.ts)
import type {Client} from 'sqlfu';

const sql = `select count(*) as total from posts;`

export const countPosts = Object.assign(
	async function countPosts(client: Client): Promise<countPosts.Result | null> {
		const query = { sql, args: [], name: "count-posts" };
		const rows = await client.all<countPosts.Result>(query);
		return rows.length > 0 ? rows[0] : null;
	},
	{ sql },
);

export namespace countPosts {
	export type Result = {
		total: number;
	};
}
```
</details>

<details>
<summary>falls back to invalid-sql for user-defined function queries</summary>

### input

```sql (definitions.sql)
create table posts (slug text not null);
```

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
};
```

```sql (sql/list-normalized-slugs.sql)
select my_slugify(slug) as normalized_slug from posts;
```
### output

```ts (sql/.generated/list-normalized-slugs.sql.ts)
//Invalid SQL
export {};
```
</details>

<details>
<summary>falls back to invalid-sql for CTE queries with the works in one query</summary>

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

```sql (sql/sync-post-from-cte.sql)
with incoming as (select :id as id, :slug as slug),
inserted as (
  insert into posts (id, slug)
  select id, slug from incoming
  where not exists (select 1 from posts where posts.id = incoming.id)
  returning id, slug
),
updated as (
  update posts
  set slug = (select slug from incoming where incoming.id = posts.id)
  where id in (select id from incoming)
  returning id, slug
)
select id, slug from updated
union all
select id, slug from inserted;
```
### output

```ts (sql/.generated/sync-post-from-cte.sql.ts)
//Invalid SQL
export {};
```
</details>
