import {expect, test} from '@playwright/test';

test('demo mode shows inline analysis diagnostics for syntax errors', async ({page}) => {
  await page.goto('http://localhost:3218/?demo=1#sql');

  const editor = page.locator('[aria-label="SQL editor"] .cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.fill('selet * from posts');

  await expect.poll(() => page.locator('.cm-lintRange-error').count()).toBeGreaterThan(0);
});

test('demo mode shows inline analysis diagnostics for unknown columns', async ({page}) => {
  await page.goto('http://localhost:3218/?demo=1#sql');

  const editor = page.locator('[aria-label="SQL editor"] .cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.fill('select nosuchcol from posts');

  await expect.poll(() => page.locator('.cm-lintRange-error').count()).toBeGreaterThan(0);
});
