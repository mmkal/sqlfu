import dedent from 'dedent';

import {expect, test} from 'vitest';

import {createMigrationsFixture} from './fixture.js';

// Each test below keeps definitions.sql, migrations, and the live database in sync
// for every *schema-changing* statement, so the only possible mismatch in
// `sqlfu check` is `Spurious Definitions`. That keeps each expectation focused.

test('flags an insert statement in definitions.sql as spurious', async () => {
  await using fixture = await createMigrationsFixture('spurious-definitions-insert', {
    desiredSchema: dedent`
      create table posts(id int, slug text, title text, body text);

      insert into posts(id, slug, title, body)
      values (1, 'hello-world', 'Hello World', 'How is everybody doing');
    `,
    migrations: {
      create_posts: `create table posts(id int, slug text, title text, body text)`,
    },
  });

  await fixture.api.migrate();

  await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
    [Error: Spurious Definitions
    definitions.sql contains statements that do not affect the declared schema. They will be silently discarded. Move them to a migration or delete them.
    - insert into posts(id, slug, title, body) values (1, 'hello-world', 'Hello World', 'How is everybody doing');]
  `);
});

test('flags update and delete statements in definitions.sql as spurious', async () => {
  await using fixture = await createMigrationsFixture('spurious-definitions-mutations', {
    desiredSchema: dedent`
      create table posts(id int, title text);
      insert into posts(id, title) values (1, 'seed');
      update posts set title = 'renamed' where id = 1;
      delete from posts where id = 1;
    `,
    migrations: {
      create_posts: `create table posts(id int, title text)`,
    },
  });

  await fixture.api.migrate();

  await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
    [Error: Spurious Definitions
    definitions.sql contains statements that do not affect the declared schema. They will be silently discarded. Move them to a migration or delete them.
    - insert into posts(id, title) values (1, 'seed');
    - update posts set title = 'renamed' where id = 1;
    - delete from posts where id = 1;]
  `);
});

test('passes when definitions.sql is pure ddl', async () => {
  await using fixture = await createMigrationsFixture('spurious-definitions-pure-ddl', {
    desiredSchema: dedent`
      create table posts(id integer primary key, title text);
      create index posts_title_idx on posts(title);
      create view posts_summary as select id, title from posts;
    `,
    migrations: {
      create_schema: dedent`
        create table posts(id integer primary key, title text);
        create index posts_title_idx on posts(title);
        create view posts_summary as select id, title from posts;
      `,
    },
  });

  await fixture.api.migrate();

  await expect(fixture.api.check.all()).resolves.toBeUndefined();
});

test('does not flag an alter table add column that builds on a prior create table', async () => {
  await using fixture = await createMigrationsFixture('spurious-definitions-alter-table', {
    desiredSchema: dedent`
      create table posts(id integer primary key);
      alter table posts add column title text;
    `,
    migrations: {
      create_posts: dedent`
        create table posts(id integer primary key);
        alter table posts add column title text;
      `,
    },
  });

  await fixture.api.migrate();

  await expect(fixture.api.check.all()).resolves.toBeUndefined();
});

test('does not flag a drop that cancels a prior create', async () => {
  await using fixture = await createMigrationsFixture('spurious-definitions-drop', {
    desiredSchema: dedent`
      create table posts(id integer primary key);
      create table scratch(x int);
      drop table scratch;
    `,
    migrations: {
      create_posts_then_scratch: dedent`
        create table posts(id integer primary key);
        create table scratch(x int);
        drop table scratch;
      `,
    },
  });

  await fixture.api.migrate();

  await expect(fixture.api.check.all()).resolves.toBeUndefined();
});

test('flags a pragma statement as spurious because pragmas are not part of the declared schema', async () => {
  await using fixture = await createMigrationsFixture('spurious-definitions-pragma', {
    desiredSchema: dedent`
      create table posts(id integer primary key);
      pragma foreign_keys = on;
    `,
    migrations: {
      create_posts: `create table posts(id integer primary key)`,
    },
  });

  await fixture.api.migrate();

  await expect(fixture.api.check.all()).rejects.toMatchInlineSnapshot(`
    [Error: Spurious Definitions
    definitions.sql contains statements that do not affect the declared schema. They will be silently discarded. Move them to a migration or delete them.
    - pragma foreign_keys = on;]
  `);
});
