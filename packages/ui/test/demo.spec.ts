import {expect, test} from '@playwright/test';

test('demo mode runs fully in-browser', async ({page}) => {
  await page.goto('http://127.0.0.1:3218/?demo=1');

  await expect(page.getByText('Demo mode', {exact: true})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Back to sqlfu.dev/ui'})).toBeVisible();

  await expect(page.getByRole('link', {name: /^posts/})).toBeVisible();
  await expect(page.getByRole('link', {name: /^post_cards/})).toBeVisible();

  await page.getByRole('link', {name: /^posts/}).click();
  await expect(page.getByText('hello-world')).toBeVisible();
  await expect(page.getByText('draft-notes')).toBeVisible();

  await page.getByRole('link', {name: 'Schema'}).click();
  await expect(page.getByRole('heading', {name: 'Repo Drift'})).toBeVisible();
  await expect(page.getByText('No Sync Drift')).toBeVisible();
  await expect(page.getByRole('button', {name: 'sqlfu draft'})).toBeVisible();
});

test('demo mode: clicking the same sort column 3 times (asc → desc → off) does not freeze', async ({page}) => {
  await page.goto('http://127.0.0.1:3218/?demo=1#table/posts');
  await expect(page.locator('.reactgrid').getByText('hello-world')).toBeVisible();

  // Click 1: sort by id asc (default → SQL mode)
  await page.getByRole('button', {name: 'Sort', exact: true}).click();
  await page.getByRole('button', {name: 'Sort by id'}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: /^Sort — id asc/})).toBeVisible({timeout: 5000});

  // Click 2: flip to desc
  await page.getByRole('button', {name: /^Sort —/}).click();
  await page.getByRole('button', {name: /Sort by id/}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: /^Sort — id desc/})).toBeVisible({timeout: 5000});

  // Click 3: remove. In demo mode this froze the page before the fix.
  await page.getByRole('button', {name: /^Sort —/}).click();
  await page.getByRole('button', {name: /Sort by id/}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Sort', exact: true})).toBeVisible({timeout: 5000});
  await expect(page.locator('.reactgrid').getByText('hello-world')).toBeVisible();
});
