Focused edge cases for the inline source scanner and style-preserving edits.

## class config inserts metadata when migrations is omitted

<details>
<summary>input</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

export class PostObject {
  static db = defineConfig({
    definitions: sql`
      create table posts (slug text primary key);
    `,
    queries: {
      listPosts: {
        query: sql`
          select slug
          from posts
        `,
      },
    },
  });
}
```

</details>

<details>
<summary>edits</summary>

```json (edits.json)
{
  "types": [
    {
      "className": "PostObject",
      "configName": "db",
      "queryName": "listPosts",
      "type": "{ result: { slug: string } }",
      "mode": "many"
    }
  ]
}
```

</details>

<details>
<summary>output</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

export class PostObject {
  static db = defineConfig({
    definitions: sql`
      create table posts (slug text primary key);
    `,
    queries: {
      listPosts: {
        query: sql`
          select slug
          from posts
        `,
        mode: 'many',
        $type: {} as { result: { slug: string } },
      },
    },
  });
}
```

</details>

## class config preserves compact query source when generated properties are out of order

<details>
<summary>input</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

export class PostObject {
  static db = defineConfig({
    definitions: sql`create table posts (slug text primary key);`,
    migrations: [],
    queries: {
      listPosts: { query: sql`select slug from posts`, $type: {} as { result: { oldSlug: string } }, mode: 'one' },
    },
  });
}
```

</details>

<details>
<summary>edits</summary>

```json (edits.json)
{
  "types": [
    {
      "className": "PostObject",
      "configName": "db",
      "queryName": "listPosts",
      "type": "{ result: { slug: string } }",
      "mode": "many"
    }
  ]
}
```

</details>

<details>
<summary>output</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

export class PostObject {
  static db = defineConfig({
    definitions: sql`create table posts (slug text primary key);`,
    migrations: [],
    queries: {
      listPosts: { query: sql`select slug from posts`, $type: {} as { result: { slug: string } }, mode: 'many' },
    },
  });
}
```

</details>

## class config ignores nested template expressions elsewhere in the module

<details>
<summary>input</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

const ignored = `outer ${sql`select { as harmless_template_text`} rest`;

export class PostObject {
  static db = defineConfig({
    definitions: sql`
      create table posts (slug text primary key);
    `,
    migrations: [],
    queries: {
      listPosts: {
        query: sql`
          select slug
          from posts
        `,
      },
    },
  });
}
```

</details>

<details>
<summary>edits</summary>

```json (edits.json)
{
  "types": [
    {
      "className": "PostObject",
      "configName": "db",
      "queryName": "listPosts",
      "type": "{ result: { slug: string } }",
      "mode": "many"
    }
  ]
}
```

</details>

<details>
<summary>output</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

const ignored = `outer ${sql`select { as harmless_template_text`} rest`;

export class PostObject {
  static db = defineConfig({
    definitions: sql`
      create table posts (slug text primary key);
    `,
    migrations: [],
    queries: {
      listPosts: {
        query: sql`
          select slug
          from posts
        `,
        mode: 'many',
        $type: {} as { result: { slug: string } },
      },
    },
  });
}
```

</details>

## class config inserts metadata without trailing commas when the module avoids them

<details>
<summary>input</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu'

export class PostObject {
  static db = defineConfig({
    definitions: sql`
      create table posts (slug text primary key)
    `,
    migrations: [],
    queries: {
      listPosts: {
        query: sql`
          select slug
          from posts
        `
      }
    }
  })
}
```

</details>

<details>
<summary>edits</summary>

```json (edits.json)
{
  "types": [
    {
      "className": "PostObject",
      "configName": "db",
      "queryName": "listPosts",
      "type": "{ result: { slug: string } }",
      "mode": "many"
    }
  ],
  "migration": {
    "app": "PostObject.db",
    "name": "0001_add_title",
    "content": "alter table posts add column title text;\nupdate posts set title = 'untitled';"
  }
}
```

</details>

<details>
<summary>output</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu'

export class PostObject {
  static db = defineConfig({
    definitions: sql`
      create table posts (slug text primary key)
    `,
    migrations: [
      {
        name: '0001_add_title',
        content: sql`
          alter table posts add column title text;
          update posts set title = 'untitled';
        `
      }
    ],
    queries: {
      listPosts: {
        query: sql`
          select slug
          from posts
        `,
        mode: 'many',
        $type: {} as { result: { slug: string } }
      }
    }
  })
}
```

</details>
