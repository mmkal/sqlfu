Cases for rewriting inline query metadata and appending inline migrations in the module
that owns inline `defineConfig(...)` calls. The test runner writes the input files to a real temp
directory, applies the `edits` block, and compares the rewritten module with the `output` block.

## class config inserts query metadata into a worker module

<details>
<summary>input</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

export class PostObject {
  static db = defineConfig({
    definitions: sql`
      create table posts (slug text primary key, title text not null);
    `,
    migrations: [
      {
        name: '0001_create_posts',
        content: sql`
          create table posts (slug text primary key, title text not null);
        `,
      },
    ],
    queries: {
      listPosts: sql`
        select slug, title
        from posts
        order by slug
      `,
      createPost: sql`
        insert into posts (slug, title)
        values (:slug, :title)
      `,
    },
  });

  db: typeof PostObject.db.$type;
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
      "type": "{ parameters: { limit: number }; result: { slug: string; title: string } }",
      "mode": "many"
    },
    {
      "className": "PostObject",
      "configName": "db",
      "queryName": "createPost",
      "type": "{ parameters: { slug: string; title: string } }",
      "mode": "metadata"
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
      create table posts (slug text primary key, title text not null);
    `,
    migrations: [
      {
        name: '0001_create_posts',
        content: sql`
          create table posts (slug text primary key, title text not null);
        `,
      },
    ],
    queries: {
      listPosts: sql.many<{ parameters: { limit: number }; result: { slug: string; title: string } }>`
        select slug, title
        from posts
        order by slug
      `,
      createPost: sql.run<{ parameters: { slug: string; title: string } }>`
        insert into posts (slug, title)
        values (:slug, :title)
      `,
    },
  });

  db: typeof PostObject.db.$type;
}
```

</details>

## class config keeps formatter-split query type tags when metadata is unchanged

<details>
<summary>input</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

export class PostObject {
  static db = defineConfig({
    definitions: sql`
      create table posts (
        slug text primary key,
        title text not null,
        published_at text
      );
    `,
    queries: {
      listPosts: sql.many<{
        parameters: {limit: number; offset: number};
        result: {slug: string; title: string; published_at: string | null};
      }>`
        select slug, title, published_at
        from posts
        order by published_at desc
        limit :limit
        offset :offset
      `,
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
      "type": "{ parameters: { limit: number; offset: number }; result: { slug: string; title: string; published_at: string | null } }",
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
      create table posts (
        slug text primary key,
        title text not null,
        published_at text
      );
    `,
    queries: {
      listPosts: sql.many<{
        parameters: {limit: number; offset: number};
        result: {slug: string; title: string; published_at: string | null};
      }>`
        select slug, title, published_at
        from posts
        order by published_at desc
        limit :limit
        offset :offset
      `,
    },
  });
}
```

</details>

## class configs edit two inline configs in one module

<details>
<summary>input</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

export class ProjectObject {
  static db = defineConfig({
    definitions: sql`
      create table projects (slug text primary key);
    `,
    migrations: [],
    queries: {
      list: sql`
        select slug
        from projects
      `,
    },
  });
}

export class OrganizationObject {
  static db = defineConfig({
    definitions: sql`
      create table organizations (slug text primary key);
    `,
    migrations: [],
    queries: {
      list: sql`
        select slug
        from organizations
      `,
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
      "className": "ProjectObject",
      "configName": "db",
      "queryName": "list",
      "type": "{ result: { slug: string } }",
      "mode": "many"
    },
    {
      "className": "OrganizationObject",
      "configName": "db",
      "queryName": "list",
      "type": "{ result: { slug: string } }",
      "mode": "many"
    }
  ],
  "migration": {
    "app": "OrganizationObject.db",
    "name": "0001_create_organizations",
    "content": "create table organizations (slug text primary key);"
  }
}
```

</details>

<details>
<summary>output</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

export class ProjectObject {
  static db = defineConfig({
    definitions: sql`
      create table projects (slug text primary key);
    `,
    migrations: [],
    queries: {
      list: sql.many<{ result: { slug: string } }>`
        select slug
        from projects
      `,
    },
  });
}

export class OrganizationObject {
  static db = defineConfig({
    definitions: sql`
      create table organizations (slug text primary key);
    `,
    migrations: [
      { name: '0001_create_organizations', content: sql`create table organizations (slug text primary key);` },
    ],
    queries: {
      list: sql.many<{ result: { slug: string } }>`
        select slug
        from organizations
      `,
    },
  });
}
```

</details>

## class config ignores defineConfig references outside code

<details>
<summary>input</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

const example = "defineConfig({ definitions: sql`nope`, migrations: [], queries: {} })";
/*
const ignored = defineConfig({
  definitions: sql`select 1;`,
  migrations: [],
  queries: {ignored: sql`select 1;`},
});
*/
const fileBacked = defineConfig({
  definitions: './schema.sql',
  migrations: './migrations',
  queries: './sql',
});

export class CounterObject {
  static db = defineConfig(
    // The parser has to skip trivia before the object literal.
    {
      definitions: sql`
        create table counters (name text primary key, value integer not null);
      `,
      migrations: [],
      queries: {
        getCounter: sql`
          select value
          from counters
          where name = :name
        `,
      },
    }
  );
}

void fileBacked;
```

</details>

<details>
<summary>edits</summary>

```json (edits.json)
{
  "types": [
    {
      "className": "CounterObject",
      "configName": "db",
      "queryName": "getCounter",
      "type": "{ parameters: { name: string }; result: { value: number } }",
      "mode": "nullableOne"
    }
  ]
}
```

</details>

<details>
<summary>output</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

const example = "defineConfig({ definitions: sql`nope`, migrations: [], queries: {} })";
/*
const ignored = defineConfig({
  definitions: sql`select 1;`,
  migrations: [],
  queries: {ignored: sql`select 1;`},
});
*/
const fileBacked = defineConfig({
  definitions: './schema.sql',
  migrations: './migrations',
  queries: './sql',
});

export class CounterObject {
  static db = defineConfig(
    // The parser has to skip trivia before the object literal.
    {
      definitions: sql`
        create table counters (name text primary key, value integer not null);
      `,
      migrations: [],
      queries: {
        getCounter: sql.nullableOne<{ parameters: { name: string }; result: { value: number } }>`
          select value
          from counters
          where name = :name
        `,
      },
    }
  );
}

void fileBacked;
```

</details>

## class config rewrites quoted query names and nested existing generated properties

<details>
<summary>input</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

export class EventObject {
  static db = defineConfig({
    definitions: sql`
      create table events (
        id integer primary key,
        payload text not null
      );
    `,
    migrations: [
      { name: `0001_events`, content: sql`create table events(id integer primary key, payload text not null);` },
    ],
    queries: {
      "eventById": {
        query: sql`
          select id, payload
          from events
          where id = :id
        `,
        $type: {} as {parameters: { id: number }; result: Array<{ oldPayload: string }>},
        mode: 'one',
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
      "className": "EventObject",
      "configName": "db",
      "queryName": "eventById",
      "type": "{ parameters: { id: number }; result: { id: number; payload: string } }",
      "mode": "nullableOne"
    }
  ]
}
```

</details>

<details>
<summary>output</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

export class EventObject {
  static db = defineConfig({
    definitions: sql`
      create table events (
        id integer primary key,
        payload text not null
      );
    `,
    migrations: [
      { name: `0001_events`, content: sql`create table events(id integer primary key, payload text not null);` },
    ],
    queries: {
      "eventById": {
        query: sql`
          select id, payload
          from events
          where id = :id
        `,
        mode: 'nullableOne',
        $type: {} as { parameters: { id: number }; result: { id: number; payload: string } },
      },
    },
  });
}
```

</details>

## class config appends migration using existing tab indentation and double quotes

<details>
<summary>input</summary>

```ts (worker.ts)
import {defineConfig, sql} from "sqlfu";

export class PostObject {
	static db = defineConfig({
		definitions: sql`
			create table posts (slug text primary key);
		`,
		migrations: [],
		queries: {
			getPost: sql`
				select slug
				from posts
			`,
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
      "queryName": "getPost",
      "type": "{ result: { slug: string } }",
      "mode": "many"
    }
  ],
  "migration": {
    "app": "PostObject.db",
    "name": "0002_add_title",
    "content": "alter table posts add column title text;\nupdate posts set title = \"untitled\";"
  }
}
```

</details>

<details>
<summary>output</summary>

```ts (worker.ts)
import {defineConfig, sql} from "sqlfu";

export class PostObject {
	static db = defineConfig({
		definitions: sql`
			create table posts (slug text primary key);
		`,
		migrations: [
			{
				name: "0002_add_title",
				content: sql`
					alter table posts add column title text;
					update posts set title = "untitled";
				`,
			},
		],
		queries: {
			getPost: sql.many<{ result: { slug: string } }>`
				select slug
				from posts
			`,
		},
	});
}
```

</details>

## class config appends migration after existing entries using existing space indentation and single quotes

<details>
<summary>input</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

export class PostObject {
    static db = defineConfig({
        definitions: sql`
            create table posts (slug text primary key);
        `,
        migrations: [
            { name: '0001_posts', content: sql`create table posts(slug text primary key);` }
        ],
        queries: {},
    });
}
```

</details>

<details>
<summary>edits</summary>

```json (edits.json)
{
  "migration": {
    "app": "PostObject.db",
    "name": "0002_add_body",
    "content": "alter table posts add column body text;"
  }
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
        migrations: [
            { name: '0001_posts', content: sql`create table posts(slug text primary key);` },
            { name: '0002_add_body', content: sql`alter table posts add column body text;` },
        ],
        queries: {},
    });
}
```

</details>

## top-level const config inserts query metadata into a worker module

<details>
<summary>input</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

const app = defineConfig({
  definitions: sql`
    create table posts (slug text primary key, title text not null);
  `,
  migrations: [
    {
      name: '0001_create_posts',
      content: sql`
        create table posts (slug text primary key, title text not null);
      `,
    },
  ],
  queries: {
    listPosts: sql`
      select slug, title
      from posts
      order by slug
    `,
    createPost: sql`
      insert into posts (slug, title)
      values (:slug, :title)
    `,
  },
});

export type App = typeof app.$type;
```

</details>

<details>
<summary>edits</summary>

```json (edits.json)
{
  "types": [
    {
      "configName": "app",
      "queryName": "listPosts",
      "type": "{ parameters: { limit: number }; result: { slug: string; title: string } }",
      "mode": "many"
    },
    {
      "configName": "app",
      "queryName": "createPost",
      "type": "{ parameters: { slug: string; title: string } }",
      "mode": "metadata"
    }
  ]
}
```

</details>

<details>
<summary>output</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

const app = defineConfig({
  definitions: sql`
    create table posts (slug text primary key, title text not null);
  `,
  migrations: [
    {
      name: '0001_create_posts',
      content: sql`
        create table posts (slug text primary key, title text not null);
      `,
    },
  ],
  queries: {
    listPosts: sql.many<{ parameters: { limit: number }; result: { slug: string; title: string } }>`
      select slug, title
      from posts
      order by slug
    `,
    createPost: sql.run<{ parameters: { slug: string; title: string } }>`
      insert into posts (slug, title)
      values (:slug, :title)
    `,
  },
});

export type App = typeof app.$type;
```

</details>

## top-level const configs edit two inline configs in one module

<details>
<summary>input</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

const projectDb = defineConfig({
  definitions: sql`
    create table projects (slug text primary key);
  `,
  migrations: [],
  queries: {
    list: sql`
      select slug
      from projects
    `,
  },
});

const organizationDb = defineConfig({
  definitions: sql`
    create table organizations (slug text primary key);
  `,
  migrations: [],
  queries: {
    list: sql`
      select slug
      from organizations
    `,
  },
});

void projectDb;
void organizationDb;
```

</details>

<details>
<summary>edits</summary>

```json (edits.json)
{
  "types": [
    {
      "configName": "projectDb",
      "queryName": "list",
      "type": "{ result: { slug: string } }",
      "mode": "many"
    },
    {
      "configName": "organizationDb",
      "queryName": "list",
      "type": "{ result: { slug: string } }",
      "mode": "many"
    }
  ],
  "migration": {
    "app": "organizationDb",
    "name": "0001_create_organizations",
    "content": "create table organizations (slug text primary key);"
  }
}
```

</details>

<details>
<summary>output</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

const projectDb = defineConfig({
  definitions: sql`
    create table projects (slug text primary key);
  `,
  migrations: [],
  queries: {
    list: sql.many<{ result: { slug: string } }>`
      select slug
      from projects
    `,
  },
});

const organizationDb = defineConfig({
  definitions: sql`
    create table organizations (slug text primary key);
  `,
  migrations: [
    { name: '0001_create_organizations', content: sql`create table organizations (slug text primary key);` },
  ],
  queries: {
    list: sql.many<{ result: { slug: string } }>`
      select slug
      from organizations
    `,
  },
});

void projectDb;
void organizationDb;
```

</details>

## top-level const config ignores defineConfig references outside code

<details>
<summary>input</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

const example = "defineConfig({ definitions: sql`nope`, migrations: [], queries: {} })";
/*
const ignored = defineConfig({
  definitions: sql`select 1;`,
  migrations: [],
  queries: {ignored: sql`select 1;`},
});
*/
const fileBacked = defineConfig({
  definitions: './schema.sql',
  migrations: './migrations',
  queries: './sql',
});

const app = defineConfig(
  // The parser has to skip trivia before the object literal.
  {
    definitions: sql`
      create table counters (name text primary key, value integer not null);
    `,
    migrations: [],
    queries: {
      getCounter: sql`
        select value
        from counters
        where name = :name
      `,
    },
  }
);

void app;
```

</details>

<details>
<summary>edits</summary>

```json (edits.json)
{
  "types": [
    {
      "configName": "app",
      "queryName": "getCounter",
      "type": "{ parameters: { name: string }; result: { value: number } }",
      "mode": "nullableOne"
    }
  ]
}
```

</details>

<details>
<summary>output</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

const example = "defineConfig({ definitions: sql`nope`, migrations: [], queries: {} })";
/*
const ignored = defineConfig({
  definitions: sql`select 1;`,
  migrations: [],
  queries: {ignored: sql`select 1;`},
});
*/
const fileBacked = defineConfig({
  definitions: './schema.sql',
  migrations: './migrations',
  queries: './sql',
});

const app = defineConfig(
  // The parser has to skip trivia before the object literal.
  {
    definitions: sql`
      create table counters (name text primary key, value integer not null);
    `,
    migrations: [],
    queries: {
      getCounter: sql.nullableOne<{ parameters: { name: string }; result: { value: number } }>`
        select value
        from counters
        where name = :name
      `,
    },
  }
);

void app;
```

</details>

## top-level const config rewrites quoted query names and nested existing generated properties

<details>
<summary>input</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

const app = defineConfig({
  definitions: sql`
    create table events (
      id integer primary key,
      payload text not null
    );
  `,
  migrations: [
    { name: `0001_events`, content: sql`create table events(id integer primary key, payload text not null);` },
  ],
  queries: {
    "eventById": {
      query: sql`
        select id, payload
        from events
        where id = :id
      `,
      $type: {} as {parameters: { id: number }; result: Array<{ oldPayload: string }>},
      mode: 'one',
    },
  },
});

void app;
```

</details>

<details>
<summary>edits</summary>

```json (edits.json)
{
  "types": [
    {
      "configName": "app",
      "queryName": "eventById",
      "type": "{ parameters: { id: number }; result: { id: number; payload: string } }",
      "mode": "nullableOne"
    }
  ]
}
```

</details>

<details>
<summary>output</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

const app = defineConfig({
  definitions: sql`
    create table events (
      id integer primary key,
      payload text not null
    );
  `,
  migrations: [
    { name: `0001_events`, content: sql`create table events(id integer primary key, payload text not null);` },
  ],
  queries: {
    "eventById": {
      query: sql`
        select id, payload
        from events
        where id = :id
      `,
      mode: 'nullableOne',
      $type: {} as { parameters: { id: number }; result: { id: number; payload: string } },
    },
  },
});

void app;
```

</details>

## top-level const config appends migration using existing tab indentation and double quotes

<details>
<summary>input</summary>

```ts (worker.ts)
import {defineConfig, sql} from "sqlfu";

const app = defineConfig({
	definitions: sql`
		create table posts (slug text primary key);
	`,
	migrations: [],
	queries: {
		getPost: sql`
			select slug
			from posts
		`,
	},
});

void app;
```

</details>

<details>
<summary>edits</summary>

```json (edits.json)
{
  "types": [
    {
      "configName": "app",
      "queryName": "getPost",
      "type": "{ result: { slug: string } }",
      "mode": "many"
    }
  ],
  "migration": {
    "name": "0002_add_title",
    "content": "alter table posts add column title text;\nupdate posts set title = \"untitled\";"
  }
}
```

</details>

<details>
<summary>output</summary>

```ts (worker.ts)
import {defineConfig, sql} from "sqlfu";

const app = defineConfig({
	definitions: sql`
		create table posts (slug text primary key);
	`,
	migrations: [
		{
			name: "0002_add_title",
			content: sql`
				alter table posts add column title text;
				update posts set title = "untitled";
			`,
		},
	],
	queries: {
		getPost: sql.many<{ result: { slug: string } }>`
			select slug
			from posts
		`,
	},
});

void app;
```

</details>

## top-level const config appends migration after existing entries using existing space indentation and single quotes

<details>
<summary>input</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

const app = defineConfig({
    definitions: sql`
        create table posts (slug text primary key);
    `,
    migrations: [
        { name: '0001_posts', content: sql`create table posts(slug text primary key);` }
    ],
    queries: {},
});

void app;
```

</details>

<details>
<summary>edits</summary>

```json (edits.json)
{
  "migration": {
    "name": "0002_add_body",
    "content": "alter table posts add column body text;"
  }
}
```

</details>

<details>
<summary>output</summary>

```ts (worker.ts)
import {defineConfig, sql} from 'sqlfu';

const app = defineConfig({
    definitions: sql`
        create table posts (slug text primary key);
    `,
    migrations: [
        { name: '0001_posts', content: sql`create table posts(slug text primary key);` },
        { name: '0002_add_body', content: sql`alter table posts add column body text;` },
    ],
    queries: {},
});

void app;
```

</details>
