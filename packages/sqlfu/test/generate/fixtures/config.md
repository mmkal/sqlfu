Fixtures for configuration knobs that shape what `sqlfu generate` emits: `sync`,
`importExtension`, tsconfig-driven `.ts`-import detection, nested query directories, and the
runtime query catalog that drives the form UI.

No `default config` block on this page — every test here exercises a different
`sqlfu.config.ts`, so each one spells its config out in full.

## sync: true emits SyncClient wrappers without async/await

<details>
<summary>input</summary>

```sql (definitions.sql)
create table posts (id integer primary key, slug text not null, title text);
```

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
  generate: {sync: true},
};
```

```sql (sql/list-posts.sql)
select id, slug, title from posts;
```

```sql (sql/find-post.sql)
select id, slug, title from posts where slug = :slug limit 1;
```

```sql (sql/insert-post.sql)
insert into posts (slug, title) values (:slug, :title);
```

</details>

<details>
<summary>output</summary>

```ts (sql/.generated/list-posts.sql.ts)
import type {SyncClient} from 'sqlfu';

const sql = `select id, slug, title from posts;`

export const listPosts = Object.assign(
	function listPosts(client: SyncClient): listPosts.Result[] {
		const query = { sql, args: [], name: "list-posts" };
		return client.all<listPosts.Result>(query);
	},
	{ sql },
);

export namespace listPosts {
	export type Result = {
		id: number;
		slug: string;
		title?: string;
	};
}
```

```ts (sql/.generated/find-post.sql.ts)
import type {SyncClient} from 'sqlfu';

const sql = `select id, slug, title from posts where slug = ? limit 1;`

export const findPost = Object.assign(
	function findPost(client: SyncClient, params: findPost.Params): findPost.Result | null {
		const query = { sql, args: [params.slug], name: "find-post" };
		const rows = client.all<findPost.Result>(query);
		return rows.length > 0 ? rows[0] : null;
	},
	{ sql },
);

export namespace findPost {
	export type Params = {
		slug: string;
	};
	export type Result = {
		id: number;
		slug: string;
		title?: string;
	};
}
```

```ts (sql/.generated/insert-post.sql.ts)
import type {SyncClient} from 'sqlfu';

const sql = `insert into posts (slug, title) values (?, ?);`

export const insertPost = Object.assign(
	function insertPost(client: SyncClient, params: insertPost.Params) {
		const query = { sql, args: [params.slug, params.title], name: "insert-post" };
		return client.run(query);
	},
	{ sql },
);

export namespace insertPost {
	export type Params = {
		slug: string;
		title: string | null;
	};
}
```

</details>

## importExtension: '.ts' emits .ts-suffixed barrel imports

<details>
<summary>input</summary>

```sql (definitions.sql)
create table posts (id integer primary key, slug text not null);
```

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
  generate: {importExtension: '.ts'},
};
```

```sql (sql/list-posts.sql)
select id, slug from posts;
```

</details>

<details>
<summary>output</summary>

```ts (sql/.generated/index.ts)
export * from "./tables.ts";
export * from "./list-posts.sql.ts";
```

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

## tsconfig allowImportingTsExtensions switches the barrel to .ts by default

<details>
<summary>input</summary>

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

```json (tsconfig.json)
{"compilerOptions": {"allowImportingTsExtensions": true}}
```

```sql (sql/list-posts.sql)
select id, slug from posts;
```

</details>

<details>
<summary>output</summary>

```ts (sql/.generated/index.ts)
export * from "./tables.ts";
export * from "./list-posts.sql.ts";
```

</details>

## explicit generate.importExtension overrides tsconfig detection

<details>
<summary>input</summary>

```sql (definitions.sql)
create table posts (id integer primary key, slug text not null);
```

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
  generate: {importExtension: '.js'},
};
```

```json (tsconfig.json)
{"compilerOptions": {"allowImportingTsExtensions": true}}
```

```sql (sql/list-posts.sql)
select id, slug from posts;
```

</details>

<details>
<summary>output</summary>

```ts (sql/.generated/index.ts)
export * from "./tables.js";
export * from "./list-posts.sql.js";
```

</details>

## preserves nested query directories in output, name, and functionName

<details>
<summary>input</summary>

```sql (definitions.sql)
create table profiles (id integer primary key, name text not null);
create table orders (id integer primary key, total integer not null);
```

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
};
```

```sql (sql/users/list-profiles.sql)
select id, name from profiles;
```

```sql (sql/orders/list-orders.sql)
select id, total from orders;
```

</details>

<details>
<summary>output</summary>

```ts (sql/.generated/index.ts)
export * from "./tables.js";
export * from "./orders/list-orders.sql.js";
export * from "./users/list-profiles.sql.js";
```

```ts (sql/.generated/users/list-profiles.sql.ts)
import type {Client} from 'sqlfu';

const sql = `select id, name from profiles;`

export const usersListProfiles = Object.assign(
	async function usersListProfiles(client: Client): Promise<usersListProfiles.Result[]> {
		const query = { sql, args: [], name: "users/list-profiles" };
		return client.all<usersListProfiles.Result>(query);
	},
	{ sql },
);

export namespace usersListProfiles {
	export type Result = {
		id: number;
		name: string;
	};
}
```

```ts (sql/.generated/orders/list-orders.sql.ts)
import type {Client} from 'sqlfu';

const sql = `select id, total from orders;`

export const ordersListOrders = Object.assign(
	async function ordersListOrders(client: Client): Promise<ordersListOrders.Result[]> {
		const query = { sql, args: [], name: "orders/list-orders" };
		return client.all<ordersListOrders.Result>(query);
	},
	{ sql },
);

export namespace ordersListOrders {
	export type Result = {
		id: number;
		total: number;
	};
}
```

</details>

## DDL wrappers: drop / alter / pragma / multi-statement / comments

<details>
<summary>input</summary>

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

```sql (sql/drop-posts.sql)
drop table posts;
```

```sql (sql/alter-posts-add-title.sql)
alter table posts add column title text;
```

```sql (sql/enable-foreign-keys.sql)
pragma foreign_keys = on;
```

```sql (sql/reset-posts.sql)
drop table if exists posts;
create table posts (id integer primary key, slug text not null);
```

```sql (sql/commented-create.sql)
-- ensure the drafts table exists before we import
/* multi-line
   comment */
create table if not exists drafts (id integer primary key, body text not null);
```

</details>

<details>
<summary>output</summary>

```ts (sql/.generated/drop-posts.sql.ts)
import type {Client} from 'sqlfu';

const sql = `drop table posts;`

export const dropPosts = Object.assign(
	async function dropPosts(client: Client) {
		const query = { sql, args: [], name: "drop-posts" };
		return client.run(query);
	},
	{ sql },
);
```

```ts (sql/.generated/alter-posts-add-title.sql.ts)
import type {Client} from 'sqlfu';

const sql = `alter table posts add column title text;`

export const alterPostsAddTitle = Object.assign(
	async function alterPostsAddTitle(client: Client) {
		const query = { sql, args: [], name: "alter-posts-add-title" };
		return client.run(query);
	},
	{ sql },
);
```

```ts (sql/.generated/enable-foreign-keys.sql.ts)
import type {Client} from 'sqlfu';

const sql = `pragma foreign_keys = on;`

export const enableForeignKeys = Object.assign(
	async function enableForeignKeys(client: Client) {
		const query = { sql, args: [], name: "enable-foreign-keys" };
		return client.run(query);
	},
	{ sql },
);
```

```ts (sql/.generated/reset-posts.sql.ts)
import type {Client} from 'sqlfu';

const sql = `
drop table if exists posts;
create table posts (id integer primary key, slug text not null);
`

export const resetPosts = Object.assign(
	async function resetPosts(client: Client) {
		const query = { sql, args: [], name: "reset-posts" };
		return client.run(query);
	},
	{ sql },
);
```

```ts (sql/.generated/commented-create.sql.ts)
import type {Client} from 'sqlfu';

const sql = `
-- ensure the drafts table exists before we import
/* multi-line
   comment */
create table if not exists drafts (id integer primary key, body text not null);
`

export const commentedCreate = Object.assign(
	async function commentedCreate(client: Client) {
		const query = { sql, args: [], name: "commented-create" };
		return client.run(query);
	},
	{ sql },
);
```

```json (.sqlfu/query-catalog.json)
{
  "queries": []
}
```

</details>

## writes a runtime query catalog with json schema for forms

<details>
<summary>input</summary>

```sql (definitions.sql)
create table posts (
  id integer primary key,
  slug text not null,
  title text,
  is_published boolean not null,
  status text not null check (status in ('draft', 'published'))
);
```

```ts (sqlfu.config.ts)
export default {
  db: './app.db',
  migrations: './migrations',
  definitions: './definitions.sql',
  queries: './sql',
};
```

```sql (sql/find-posts.sql)
select id, slug, title, is_published, status
from posts
where status = :status and is_published = :is_published
limit 10;
```

</details>

<details>
<summary>output</summary>

```json (.sqlfu/query-catalog.json)
{
  "queries": [
    {
      "kind": "query",
      "id": "find-posts",
      "sqlFile": "sql/find-posts.sql",
      "functionName": "findPosts",
      "queryType": "Select",
      "resultMode": "many",
      "args": [
        {
          "scope": "params",
          "name": "status",
          "tsType": "('draft' | 'published')",
          "driverEncoding": "identity"
        },
        {
          "scope": "params",
          "name": "is_published",
          "tsType": "number",
          "driverEncoding": "identity"
        }
      ],
      "paramsSchema": {
        "type": "object",
        "required": ["status", "is_published"],
        "properties": {
          "status": {
            "type": "string",
            "enum": ["draft", "published"]
          },
          "is_published": {
            "type": "number"
          }
        }
      },
      "resultSchema": {
        "type": "object",
        "properties": {
          "id": {"type": "number"},
          "slug": {"type": "string"},
          "title": {"anyOf": [{"type": "string"}, {"type": "null"}]},
          "is_published": {"type": "number"},
          "status": {"type": "string", "enum": ["draft", "published"]}
        }
      }
    }
  ]
}
```

</details>

## includes invalid queries in the runtime query catalog

<details>
<summary>input</summary>

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

```sql (sql/broken.sql)
select nope from missing_table;
```

</details>

<details>
<summary>output</summary>

```json (.sqlfu/query-catalog.json)
{
  "queries": [
    {
      "kind": "error",
      "id": "broken",
      "sqlFile": "sql/broken.sql",
      "functionName": "broken",
      "error": {
        "name": "Invalid sql"
      }
    }
  ]
}
```

</details>
