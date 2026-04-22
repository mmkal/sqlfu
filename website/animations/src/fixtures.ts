/**
 * Real fixtures captured by running `sqlfu generate` and `sqlfu draft` against
 * a tiny users/posts scratch project. Keeping them inline (rather than
 * imported from a live generate at build time) because:
 *
 *   1. these compositions get read as *stills* inside a video, so there is no
 *      benefit to re-running the generator on every render;
 *   2. we want the animation to be honest about what sqlfu emits today. If
 *      the generator output format changes substantively, regenerate.
 *
 * Provenance:
 *   - `definitionsBeforeFK` / `definitionsAfterFK` are the two halves of the
 *     animation-1 refactor beat.
 *   - `userByIdSql` is `sql/user-by-id.sql`.
 *   - `userByIdGeneratedTs` was the literal file emitted at
 *     `sql/.generated/user-by-id.sql.ts` by `sqlfu generate` on 2026-04-19.
 *   - `addEmailMigration` is the SQL body written by `sqlfu draft` when the
 *     schema added `email text not null default ''`.
 */

export const definitionsBeforeUsers = `create table users (
  id integer primary key,
  name text
);
`;

export const definitionsAfterUsers = `create table users (
  id integer primary key,
  name text
);

create table posts (
  id integer primary key,
  author_name text,
  content text
);
`;

export const definitionsAfterFK = `create table users (
  id integer primary key,
  name text
);

create table posts (
  id integer primary key,
  author_id integer references users (id),
  content text
);
`;

export const userByIdSql = `select id, name, email
from users
where id = :id;
`;

// Emitted verbatim by \`sqlfu generate\` — see note at top of file.
export const userByIdGeneratedTs = `import type {Client, SqlQuery} from 'sqlfu';

export type UserByIdParams = {
\tid: number;
}

export type UserByIdResult = {
\tid: number;
\tname: string;
\temail: string;
}

const UserByIdSql = \`
select id, name, email
from users
where id = ?;
\`

export async function userById(client: Client, params: UserByIdParams): Promise<UserByIdResult[]> {
\tconst query: SqlQuery = { sql: UserByIdSql, args: [params.id], name: "user-by-id" };
\treturn client.all<UserByIdResult>(query);
}
`;

export const appTsSnippet = `import {userById} from './sql/.generated';

const rows = await userById(client, {id: 1});
const user = rows[0];
console.log(user.`;

export const appTsCompletion = ['id', 'name', 'email'] as const;

// Schema for the animation-3 beat: start with users(id, name), add email.
export const definitionsBeforeEmail = `create table users (
  id integer primary key,
  name text not null
);
`;

export const definitionsAfterEmail = `create table users (
  id integer primary key,
  name text not null,
  email text not null default ''
);
`;

// Emitted verbatim by \`sqlfu draft\` on 2026-04-19 with the above diff.
export const addEmailMigration = `alter table users add column email text not null default '';
`;

export const draftCommand = 'sqlfu draft --name add_email';
export const generateCommand = 'sqlfu generate';

export const migrationsTreeBefore = [
  {name: 'migrations/', kind: 'dir' as const},
  {name: '  20260101000000_init.sql', kind: 'file' as const},
];

export const migrationsTreeAfter = [
  {name: 'migrations/', kind: 'dir' as const},
  {name: '  20260101000000_init.sql', kind: 'file' as const},
  {name: '  20260419000000_add_email.sql', kind: 'file' as const, highlight: true},
];
