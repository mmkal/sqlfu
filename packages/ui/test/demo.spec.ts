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
