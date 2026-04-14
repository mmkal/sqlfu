import fs from 'node:fs/promises';
import path from 'node:path';

import {expect, test} from '@playwright/test';

test('table browser, sql runner, and generated query form work against a live fixture project', async ({page}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', {name: 'posts'})).toBeVisible();
  await expect(page.getByText('hello-world')).toBeVisible();

  await page.getByRole('link', {name: 'SQL runner'}).click();
  await page.getByRole('button', {name: 'Run SQL'}).click();
  await expect(page.getByText('sqlite_schema')).toBeVisible();

  await page.getByRole('link', {name: /find-post-by-slug/i}).click();
  await page.getByLabel('slug').fill('hello-world');
  await page.getByRole('button', {name: 'Run generated query'}).click();
  await expect(page.getByText('Hello World')).toBeVisible();
});

test('sql runner executes a named-parameter query and saves it to disk', async ({page}) => {
  const savedQueryPath = path.join(import.meta.dirname, 'projects', 'fixture-project', 'sql', 'find-hello-world.sql');
  await fs.rm(savedQueryPath, {force: true});

  await page.goto('/#sql');

  await page.getByLabel('Query name').fill('find-hello-world');
  await page.getByLabel('SQL editor').fill(`
    select id, slug, title
    from posts
    where slug = :slug
    limit 1;
  `);

  await expect(page.getByLabel('slug')).toBeVisible();
  await page.getByLabel('slug').fill('hello-world');
  await page.getByRole('button', {name: 'Run SQL'}).click();
  await expect(page.getByText('Hello World')).toBeVisible();

  await page.getByRole('button', {name: 'Save query'}).click();
  await expect(page.getByText('Saved as sql/find-hello-world.sql')).toBeVisible();
  await expect(fs.readFile(savedQueryPath, 'utf8')).resolves.toContain('where slug = :slug');
});

test('sql runner draft survives a reload via local storage', async ({page}) => {
  await page.goto('/#sql');

  await page.getByLabel('Query name').fill('persisted-draft');
  await page.getByLabel('SQL editor').fill(`
    select id, slug
    from posts
    where slug = :slug
    limit 1;
  `);
  await expect(page.getByLabel('slug')).toBeVisible();
  await page.getByLabel('slug').fill('draft-notes');

  await page.reload();

  await expect(page.getByLabel('Query name')).toHaveValue('persisted-draft');
  await expect(page.getByLabel('SQL editor')).toContainText('where slug = :slug');
  await expect(page.getByLabel('slug')).toHaveValue('draft-notes');
});
