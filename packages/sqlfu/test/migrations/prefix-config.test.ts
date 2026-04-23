import dedent from 'dedent';

import {expect, test} from 'vitest';

import {createMigrationsFixture} from './fixture.js';

test('four-digit prefix in a fresh dir starts at 0000', async () => {
  await using fixture = await createMigrationsFixture('four-digit-empty', {
    desiredSchema: `create table person(name text)`,
    migrationPrefix: 'four-digit',
  });

  await fixture.api.draft();

  expect(await fixture.listMigrationFiles()).toEqual(['migrations/0000_create_table_person.sql']);
});

test('four-digit prefix continues at next integer after the max existing four-digit file', async () => {
  await using fixture = await createMigrationsFixture('four-digit-increment', {
    desiredSchema: dedent`
      create table person(name text);
      create table pet(name text);
    `,
    migrations: {
      create_person: `create table person(name text)`,
    },
    migrationPrefix: 'four-digit',
  });

  await fixture.api.draft();

  expect(await fixture.listMigrationFiles()).toEqual([
    'migrations/0000_create_person.sql',
    'migrations/0001_create_table_pet.sql',
  ]);
});

test('four-digit numbering uses max+1, not first missing, when there are gaps', async () => {
  await using fixture = await createMigrationsFixture('four-digit-max-plus-one', {
    desiredSchema: dedent`
      create table existing_one(id int);
      create table existing_two(id int);
      create table person(name text);
    `,
    migrations: {
      existing_one: `create table existing_one(id int)`,
      // seeded as 0001 by the fixture's sequential numbering — we then manually add 0007 below
    },
    migrationPrefix: 'four-digit',
  });

  await fixture.writeFile('migrations/0007_existing_two.sql', `create table existing_two(id int);\n`);

  await fixture.api.draft();

  const files = await fixture.listMigrationFiles();
  expect(files).toContain('migrations/0008_create_table_person.sql');
});

test('four-digit numbering ignores files that do not start with four digits', async () => {
  await using fixture = await createMigrationsFixture('four-digit-mixed', {
    desiredSchema: dedent`
      create table legacy_kept(id int);
      create table person(name text);
    `,
    migrationPrefix: 'four-digit',
  });

  // a stray non-four-digit file already in the dir should not push the new number up
  await fixture.writeFile('migrations/2024-01-01T00.00.00.000Z_legacy.sql', `create table legacy_kept(id int);\n`);

  await fixture.api.draft();

  const files = await fixture.listMigrationFiles();
  expect(files.filter((f) => /\/0\d{3}_/.test(f))).toEqual(['migrations/0000_create_table_person.sql']);
});

test('object config with prefix: "iso" behaves the same as the bare-string shorthand', async () => {
  await using fixture = await createMigrationsFixture('iso-object-form', {
    desiredSchema: `create table person(name text)`,
    migrationPrefix: 'iso',
  });

  await fixture.api.draft();

  expect(await fixture.listMigrationFiles()).toEqual(['migrations/2026-04-10T00.00.00.000Z_create_table_person.sql']);
});
