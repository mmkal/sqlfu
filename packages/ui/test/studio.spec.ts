import fs from 'node:fs/promises';
import path from 'node:path';

import {expect, test} from '@playwright/test';

test('schema page shows mismatch cards and can run the recommended sqlfu draft command', async ({page}) => {
  await using _project = await preserveSchemaProjectState(path.join(import.meta.dirname, 'projects', 'fixture-project'));
  const migrationsDir = path.join(import.meta.dirname, 'projects', 'fixture-project', 'migrations');

  await page.goto('/#schema');

  await expect(page.getByRole('heading', {name: 'Schema', exact: true})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Repo Drift'})).toBeVisible();
  await expect(page.getByText('Desired Schema does not match Migrations.')).toBeVisible();
  await expect(page.getByText('✅ No Pending Migrations')).toBeVisible();
  await expect(page.getByText('✅ No History Drift')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Schema Drift'})).toBeVisible();
  await expect(page.getByText('Live Schema matches Desired Schema, but not Migration History.')).toBeVisible();
  await expect(page.getByText('✅ No Sync Drift')).toBeVisible();
  await expect.poll(() => page.locator('.authority-card > summary').allTextContents()).toEqual([
    'Desired Schema▾',
    'Migrations▾',
    'Migration History▾',
    'Live Schema▾',
  ]);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', {name: 'sqlfu draft'}).click();

  await expect.poll(async () => {
    try {
      return (await fs.readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).length;
    } catch {
      return 0;
    }
  }).toBe(1);

  await expect(page.getByRole('button', {name: 'Desired Schema'})).toBeVisible();
  await expect(await readCodeMirrorText(page, 'Desired Schema editor')).toContain('create table posts');

  await expect(page.getByRole('button', {name: 'Migrations'})).toBeVisible();
  const migrationToggle = page.locator('.authority-migrations .migration-item').first().getByRole('button').first();
  await expect(migrationToggle).toBeVisible();
  await expect(migrationToggle).toContainText('Pending');
  await migrationToggle.click();
  const firstMigrationDetail = page.locator('.authority-migrations .migration-item').first().locator('.migration-detail');
  await expect(firstMigrationDetail.getByRole('tab', {name: 'Content'})).toHaveAttribute('aria-selected', 'true');
  await expect(await readCodeMirrorText(firstMigrationDetail, 'Migration content')).toContain('create view post_cards as');

  await expect(page.getByRole('button', {name: 'Migration History'})).toBeVisible();
  await expect(page.getByText('No applied migrations.')).toBeVisible();

  await expect(page.getByRole('button', {name: 'Live Schema'})).toBeVisible();
  await expect(await readCodeMirrorText(page, 'Live Schema editor')).toContain('create table posts');
});

test('migration details show content and metadata tabs in the migrations card', async ({page}) => {
  await using _project = await preserveSchemaProjectState(path.join(import.meta.dirname, 'projects', 'fixture-project'));

  await page.goto('/#schema');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', {name: 'sqlfu draft'}).click();

  const migrationItem = page.locator('.authority-migrations .migration-item').first();
  await migrationItem.getByRole('button').first().click();

  const migrationDetail = migrationItem.locator('.migration-detail');
  await expect(migrationDetail.getByRole('tab', {name: 'Content'})).toHaveAttribute('aria-selected', 'true');
  await expect(migrationDetail.getByRole('tab', {name: 'Metadata'})).toBeVisible();
  await expect(migrationDetail.getByRole('tab', {name: 'Resultant Schema'})).toBeVisible();
  await expect(await readCodeMirrorText(migrationDetail, 'Migration content')).toContain('create view post_cards as');

  await migrationDetail.getByRole('tab', {name: 'Metadata'}).click();
  await expect(migrationDetail.getByRole('tab', {name: 'Metadata'})).toHaveAttribute('aria-selected', 'true');
  await expect(await readCodeMirrorText(migrationDetail, 'Migration metadata')).toContain('name: create_table_posts');
  await expect(await readCodeMirrorText(migrationDetail, 'Migration metadata')).toContain('applied_at: null');
});

test('migration details lazily load the resultant schema tab', async ({page}) => {
  await using _project = await preserveSchemaProjectState(path.join(import.meta.dirname, 'projects', 'fixture-project'));

  await page.goto('/#schema');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', {name: 'sqlfu draft'}).click();

  const migrationDetail = page.locator('.authority-migrations .migration-item').first().locator('.migration-detail');
  await page.locator('.authority-migrations .migration-item').first().getByRole('button').first().click();

  const [resultantSchemaResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/schema/authorities/resultant-schema') && response.ok()),
    migrationDetail.getByRole('tab', {name: 'Resultant Schema'}).click(),
  ]);
  expect(await resultantSchemaResponse.json()).toMatchObject({
    sql: expect.stringContaining('create table posts'),
  });
  await expect(await readCodeMirrorText(migrationDetail, 'Migration resultant schema')).toContain('create table posts');
});

test('migration history rows use the same migration detail view', async ({page}) => {
  await using _project = await preserveSchemaProjectState(path.join(import.meta.dirname, 'projects', 'fixture-project'));

  await page.goto('/#schema');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', {name: 'sqlfu draft'}).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', {name: /sqlfu baseline /}).first().click();

  const historyItem = page.locator('.authority-history .migration-item').first();
  await historyItem.getByRole('button').first().click();

  const migrationDetail = historyItem.locator('.migration-detail');
  await expect(migrationDetail.getByRole('tab', {name: 'Content'})).toHaveAttribute('aria-selected', 'true');
  await migrationDetail.getByRole('tab', {name: 'Metadata'}).click();
  const metadata = await readCodeMirrorText(migrationDetail, 'Migration metadata');
  expect(metadata).toContain('name: create_table_posts');
  expect(metadata).toContain('applied_at: ');
  expect(metadata).not.toContain('applied_at: null');
});

test('desired schema can be edited and saved, and sync is disabled while it is dirty', async ({page}) => {
  await using _project = await preserveSchemaProjectState(path.join(import.meta.dirname, 'projects', 'fixture-project'));
  const projectRoot = path.join(import.meta.dirname, 'projects', 'fixture-project');
  const definitionsPath = path.join(projectRoot, 'definitions.sql');

  await page.goto('/#schema');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', {name: 'sqlfu draft'}).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', {name: /sqlfu baseline /}).first().click();
  await expect(page.getByText('✅ No Repo Drift')).toBeVisible();

  await expect(page.getByRole('button', {name: 'Save Desired Schema'})).toHaveCount(0);

  await replaceCodeMirrorText(page, 'Desired Schema editor', `
    create table posts (
      id integer primary key,
      slug text not null unique,
      title text not null,
      body text not null,
      published integer not null
    );

    create view post_cards as
    select id, slug, title, published
    from posts;

    create view published_posts as
    select id, slug, title
    from posts
    where published = 1;
  `);

  await expect(page.getByRole('button', {name: 'Save Desired Schema'})).toBeVisible();
  await expect.poll(() => readCodeMirrorText(page, 'Desired Schema editor')).toContain('create view published_posts as');

  await page.getByRole('button', {name: 'Save Desired Schema'}).click();
  await expect(fs.readFile(definitionsPath, 'utf8')).resolves.toContain('create view published_posts as');
  await expect(page.getByText('Repo Drift')).toBeVisible();
});

test('history to live flow shows a baseline action when check recommends it', async ({page}) => {
  await using _project = await preserveSchemaProjectState(path.join(import.meta.dirname, 'projects', 'fixture-project'));

  await page.goto('/#schema');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', {name: 'sqlfu draft'}).click();

  const baselineButton = page.getByRole('button', {name: /sqlfu baseline /}).first();
  await expect(baselineButton).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await baselineButton.click();
  await expect(page.getByText('✅ No History Drift')).toBeVisible();
});

test('history to live flow shows a goto action when check recommends it', async ({page}) => {
  await using _project = await preserveSchemaProjectState(path.join(import.meta.dirname, 'projects', 'fixture-project'));
  const projectRoot = path.join(import.meta.dirname, 'projects', 'fixture-project');
  const migrationsDir = path.join(projectRoot, 'migrations');
  const definitionsPath = path.join(projectRoot, 'definitions.sql');

  await page.goto('/#schema');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', {name: 'sqlfu draft'}).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', {name: /sqlfu baseline /}).first().click();

  const [migrationFileName] = (await fs.readdir(migrationsDir)).filter((name) => name.endsWith('.sql'));
  await fs.appendFile(path.join(migrationsDir, migrationFileName!), `

create view post_titles as
select title
from posts;
`);
  await fs.appendFile(definitionsPath, `

create view post_titles as
select title
from posts;
`);

  await page.reload();

  const gotoButton = page.getByRole('button', {name: /sqlfu goto /});
  await expect(gotoButton).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await gotoButton.click();
  await expect.poll(() => readCodeMirrorText(page, 'Live Schema editor')).toContain('create view post_titles as');
  await expect(page.getByText('✅ No History Drift')).toBeVisible();
});

test('schema command failures stay visible next to the failing command button', async ({page}) => {
  await using _project = await preserveSchemaProjectState(path.join(import.meta.dirname, 'projects', 'fixture-project'));

  await page.goto('/#schema');

  await replaceCodeMirrorText(page, 'Desired Schema editor', `
    create table posts (
      id integer primary key,
      slug text not null unique,
      title text not null,
      body text not null,
      published integer not null,
      birthdate text not null
    );

    create view post_cards as
    select id, slug, title, published
    from posts;
  `);
  await expect.poll(() => readCodeMirrorText(page, 'Desired Schema editor')).toContain('birthdate text not null');
  await page.getByRole('button', {name: 'Save Desired Schema'}).click();

  page.once('dialog', (dialog) => dialog.accept());
  const syncButton = page.getByRole('button', {name: 'sqlfu sync'});
  await expect(syncButton).toBeVisible();
  await syncButton.click();

  await expect(page.getByText(/cannot add a not null column with default value null/i)).toBeVisible();
  await expect(page.locator('.schema-command-error').filter({hasText: 'Cannot add a NOT NULL column with default value NULL'})).toBeVisible();
});

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

test('relation page is data-first with foldable secondary panels', async ({page}) => {
  await page.goto('/#table/posts');

  await expect(page.getByRole('heading', {name: 'posts'})).toBeVisible();
  await expect(page.getByText('hello-world')).toBeVisible();
  await expect(page.getByText('Columns', {exact: true})).toHaveCount(0);
  await expect(page.getByText('Sample rows', {exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Definition'})).toBeVisible();
  await expect(page.getByLabel('Relation definition editor')).toBeHidden();

  await page.getByRole('button', {name: 'Definition'}).click();
  await expect(page.getByLabel('Relation definition editor')).toBeVisible();
});

test('relation rows render in a sheet-style grid', async ({page}) => {
  await page.goto('/#table/posts');

  await expect(page.locator('.reactgrid')).toBeVisible();
  await expect(page.locator('.reactgrid [data-cell-rowidx="1"][data-cell-colidx="2"]')).toContainText('hello-world');
});

test('clicking a relation cell shows the full cell content below the table', async ({page}) => {
  await page.goto('/#table/posts');

  await page.locator('.reactgrid [data-cell-rowidx="1"][data-cell-colidx="4"]').click();
  const selectedCellPanel = page.locator('.selected-cell-panel');
  await expect(selectedCellPanel.getByText('Cell', {exact: true})).toBeVisible();
  await expect(selectedCellPanel).toContainText('body');
  await expect(selectedCellPanel).toContainText('First post body');
});

test('relation rows can be edited and saved from the grid', async ({page}) => {
  await using _project = await preserveSchemaProjectState(path.join(import.meta.dirname, 'projects', 'fixture-project'));

  await page.goto('/#table/posts');

  const titleCell = page.locator('.reactgrid [data-cell-rowidx="1"][data-cell-colidx="3"]');
  await titleCell.click();
  await page.keyboard.press('Enter');
  const editor = page.locator('.rg-celleditor input');
  await expect(editor).toBeVisible();
  await editor.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`);
  await editor.press('Backspace');
  await editor.pressSequentially('Hello World Revised');
  await editor.press('Enter');
  await page.locator('.reactgrid [data-cell-rowidx="2"][data-cell-colidx="3"]').click();

  await expect(page.getByRole('button', {name: 'Save changes'})).toBeVisible();
  const [saveResponse] = await Promise.all([
    page.waitForResponse((response) =>
      response.request().method() === 'PUT'
      && response.url().includes('/api/table/posts?page=0'),
    ),
    page.getByRole('button', {name: 'Save changes'}).click(),
  ]);
  const saveResponseText = await saveResponse.text();
  expect(saveResponse.ok(), saveResponseText).toBe(true);

  await page.reload();
  await expect(page.locator('.reactgrid [data-cell-rowidx="1"][data-cell-colidx="3"]')).toContainText('Hello World Revised');
});

test('relation rows can discard dirty cell changes', async ({page}) => {
  await using _project = await preserveSchemaProjectState(path.join(import.meta.dirname, 'projects', 'fixture-project'));

  await page.goto('/#table/posts');

  const titleCell = page.locator('.reactgrid [data-cell-rowidx="1"][data-cell-colidx="3"]');
  await titleCell.click();
  await page.keyboard.press('Enter');
  const editor = page.locator('.rg-celleditor input');
  await expect(editor).toBeVisible();
  await editor.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`);
  await editor.press('Backspace');
  await editor.pressSequentially('Hello World Dirty');
  await editor.press('Enter');
  await page.locator('.reactgrid [data-cell-rowidx="2"][data-cell-colidx="3"]').click();

  await expect(page.getByRole('button', {name: 'Save changes'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Discard changes'})).toBeVisible();
  await expect(page.locator('.reactgrid [data-cell-rowidx="1"][data-cell-colidx="3"]')).toHaveClass(/dirty/);

  await page.getByRole('button', {name: 'Discard changes'}).click();

  await expect(page.getByRole('button', {name: 'Save changes'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Discard changes'})).toHaveCount(0);
  await expect(page.locator('.reactgrid [data-cell-rowidx="1"][data-cell-colidx="3"]')).toContainText('Hello World');
  await expect(page.locator('.reactgrid [data-cell-rowidx="1"][data-cell-colidx="3"]')).not.toHaveClass(/dirty/);
});

test('stale relation draft state is ignored when it does not match the fetched table shape', async ({page}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'sqlfu-ui/table-draft/posts/0',
      JSON.stringify([{bb: 'stale draft from another table'}]),
    );
  });

  await page.goto('/#table/posts');

  await expect(page.locator('.reactgrid [data-cell-rowidx="1"][data-cell-colidx="2"]')).toContainText('hello-world');
  await expect(page.getByRole('button', {name: 'Save changes'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Discard changes'})).toHaveCount(0);
});

test('dirty relation cells show original, draft, and diff modes in the cell panel', async ({page}) => {
  await using _project = await preserveSchemaProjectState(path.join(import.meta.dirname, 'projects', 'fixture-project'));

  await page.goto('/#table/posts');

  const titleCell = page.locator('.reactgrid [data-cell-rowidx="1"][data-cell-colidx="3"]');
  await titleCell.click();
  await page.keyboard.press('Enter');
  const editor = page.locator('.rg-celleditor input');
  await expect(editor).toBeVisible();
  await editor.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`);
  await editor.press('Backspace');
  await editor.pressSequentially('Hello World Dirty');
  await editor.press('Enter');
  await titleCell.click();

  const selectedCellPanel = page.locator('.selected-cell-panel');
  await expect(selectedCellPanel.getByRole('tab', {name: 'Diff'})).toHaveAttribute('aria-selected', 'true');
  await expect(selectedCellPanel.getByRole('tab', {name: 'Original'})).toBeVisible();
  await expect(selectedCellPanel.getByRole('tab', {name: 'Draft'})).toBeVisible();
  await expect(selectedCellPanel).toContainText('Hello World');
  await expect(selectedCellPanel).toContainText('Hello World Dirty');

  await selectedCellPanel.getByRole('tab', {name: 'Original'}).click();
  await expect(selectedCellPanel.getByRole('tab', {name: 'Original'})).toHaveAttribute('aria-selected', 'true');
  await expect(selectedCellPanel).toContainText('Hello World');

  await selectedCellPanel.getByRole('tab', {name: 'Draft'}).click();
  await expect(selectedCellPanel.getByRole('tab', {name: 'Draft'})).toHaveAttribute('aria-selected', 'true');
  await expect(selectedCellPanel).toContainText('Hello World Dirty');
});

test('switching between saved queries does not leak form state between schemas', async ({page}) => {
  await page.goto('/#query/find-post-by-slug');

  await page.getByLabel('slug').fill('hello-world');
  await page.getByRole('button', {name: 'Run generated query'}).click();
  await expect(page.getByText('Hello World')).toBeVisible();

  await page.getByRole('link', {name: /list-post-cards/i}).click();
  await expect(page.getByText("'findPostBySlug params' must NOT have additional properties")).toHaveCount(0);
  await page.getByRole('button', {name: 'Run generated query'}).click();
  await expect(page.getByText('Draft Notes')).toBeVisible();
});

test('saved queries can be renamed, edited, and deleted from the query view', async ({page}) => {
  const projectSqlDir = path.join(import.meta.dirname, 'projects', 'fixture-project', 'sql');
  const originalPath = path.join(projectSqlDir, 'list-post-cards.sql');
  const renamedPath = path.join(projectSqlDir, 'list-post-cards-renamed.sql');

  await fs.rm(renamedPath, {force: true});

  await page.goto('/#query/list-post-cards');

  await page.getByRole('button', {name: 'Rename query'}).click();
  await page.getByLabel('Query title').fill('list-post-cards-renamed');
  await page.getByRole('button', {name: 'Confirm query rename'}).click();

  await expect(page).toHaveURL(/#query\/list-post-cards-renamed$/);
  await expect(page.getByRole('heading', {name: 'list-post-cards-renamed'})).toBeVisible();
  await expect(fs.access(renamedPath).then(() => true, () => false)).resolves.toBe(true);
  await expect(fs.access(originalPath).then(() => true, () => false)).resolves.toBe(false);

  await page.getByRole('button', {name: 'Edit query SQL'}).click();
  await replaceCodeMirrorText(page, 'Query SQL editor', `
    select id, slug, title
    from posts
    where slug = :slug
    limit 1;
  `);
  await page.getByRole('button', {name: 'Confirm query SQL edit'}).click();

  await expect(page.getByLabel('slug')).toBeVisible();
  await page.getByLabel('slug').fill('hello-world');
  await page.getByRole('button', {name: 'Run generated query'}).click();
  await expect(page.getByText('Hello World')).toBeVisible();
  await expect(fs.readFile(renamedPath, 'utf8')).resolves.toContain('where slug = :slug');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', {name: 'Delete query'}).click();

  await expect(page).toHaveURL(/#query\/find-post-by-slug$/);
  await expect(page.getByRole('link', {name: /list-post-cards-renamed/i})).toHaveCount(0);
  await expect(fs.access(renamedPath).then(() => true, () => false)).resolves.toBe(false);
});

test('sql runner executes a named-parameter query and saves it to disk', async ({page}) => {
  const savedQueryPath = path.join(import.meta.dirname, 'projects', 'fixture-project', 'sql', 'find-hello-world.sql');
  await fs.rm(savedQueryPath, {force: true});

  await page.goto('/#sql');
  await replaceCodeMirrorText(page, 'SQL editor', `
    select id, slug, title
    from posts
    where slug = :slug
    limit 1;
  `);

  await expect(page.getByLabel('slug')).toBeVisible();
  await page.getByLabel('slug').fill('hello-world');
  await page.getByRole('button', {name: 'Run SQL'}).click();
  await expect(page.getByText('Hello World')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept('find-hello-world'));
  await page.getByRole('button', {name: 'Save query'}).click();
  await expect(page).toHaveURL(/#query\/find-hello-world$/);
  await expect(page.getByRole('heading', {name: 'find-hello-world'})).toBeVisible();
  await expect(page.getByText('sql/find-hello-world.sql')).toBeVisible();
  await expect(fs.readFile(savedQueryPath, 'utf8')).resolves.toContain('where slug = :slug');
});

test('sql runner draft survives a reload via local storage', async ({page}) => {
  await page.goto('/#sql');

  await replaceCodeMirrorText(page, 'SQL editor', `
    select id, slug
    from posts
    where slug = :slug
    limit 1;
  `);
  await expect(page.getByLabel('slug')).toBeVisible();
  await page.getByLabel('slug').fill('draft-notes');

  await page.reload();

  await expect(await readCodeMirrorText(page, 'SQL editor')).toContain('where slug = :slug');
  await expect(page.getByLabel('slug')).toHaveValue('draft-notes');
});

test('sql runner drops stale parameter values when the SQL parameter names change', async ({page}) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/#sql');

  await replaceCodeMirrorText(page, 'SQL editor', `
    select id, slug
    from posts
    where slug = :slug
    limit 1;
  `);
  await expect(page.getByLabel('slug')).toBeVisible();
  await page.getByLabel('slug').fill('hello-world');

  await replaceCodeMirrorText(page, 'SQL editor', `
    select id, slug
    from posts
    where slug = :sluggggg
    limit 1;
  `);
  await expect(page.getByText("'sqlRunner params' must NOT have additional properties")).toHaveCount(0);
  await expect(page.getByLabel('sluggggg')).toBeVisible();
});

test('sql runner provides syntax highlighting and schema autocomplete', async ({page}) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/#sql');

  const editor = page.locator('.cm-editor');
  await expect(editor).toBeVisible();
  await expect.poll(() => editor.locator('.cm-content span').count()).toBeGreaterThan(0);

  await replaceCodeMirrorText(page, 'SQL editor', 'select * from po');
  await page.keyboard.press('Control+Space');

  const completion = page.locator('.cm-tooltip-autocomplete');
  await expect(completion).toBeVisible();
  await expect(completion).toContainText('posts');
  const selectedOption = page.locator('.cm-tooltip-autocomplete [aria-selected="true"]').first();
  const selectedLabel = (await selectedOption.textContent())?.trim() ?? '';
  await page.keyboard.press('Tab');
  await expect(await readCodeMirrorText(page, 'SQL editor')).toContain(`select * from ${selectedLabel}`);
});

test('sql runner shows inline analysis diagnostics before execution', async ({page}) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/#sql');

  await replaceCodeMirrorText(page, 'SQL editor', 'select * fro posts');

  await expect.poll(() => page.locator('.cm-lintRange-error').count()).toBeGreaterThan(0);
});

test('saved query edit mode shows inline analysis diagnostics before saving', async ({page}) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/#query/list-post-cards');

  await page.getByRole('button', {name: 'Edit query SQL'}).click();
  await replaceCodeMirrorText(page, 'Query SQL editor', 'select * fro posts');

  await expect.poll(() => page.locator('.cm-lintRange-error').count()).toBeGreaterThan(0);
});

test('sql runner keeps line numbers aligned with editor lines', async ({page}) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/#sql');

  await replaceCodeMirrorText(page, 'SQL editor', 'select *\nfrom posts\nwhere posts.slug like :slug');

  const lineNumberOne = page.locator('.cm-lineNumbers .cm-gutterElement').filter({hasText: /^1$/}).first();
  const firstLine = page.locator('.cm-line').first();
  await expect.poll(() => page.locator('.cm-lineNumbers .cm-gutterElement').count()).toBeGreaterThan(0);
  await expect.poll(async () => Boolean(await lineNumberOne.boundingBox())).toBe(true);
  const [lineNumberOneBox, firstLineBox] = await Promise.all([
    lineNumberOne.boundingBox(),
    firstLine.boundingBox(),
  ]);

  expect({
    lineNumberOneBox,
    firstLineBox,
  }).toMatchObject({
    lineNumberOneBox: expect.anything(),
    firstLineBox: expect.anything(),
  });
  expect(Math.abs((lineNumberOneBox?.y ?? 0) - (firstLineBox?.y ?? 0))).toBeLessThanOrEqual(4);
});

test('sql runner executes from the editor with cmd-or-ctrl-enter', async ({page}) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/#sql');

  await replaceCodeMirrorText(page, 'SQL editor', `
    select id, slug, title
    from posts
    where slug = :slug
    limit 1;
  `);

  await page.getByLabel('slug').fill('hello-world');
  await page.locator('[aria-label="SQL editor"] .cm-content').click();
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Enter`);
  await expect(page.getByText('Hello World')).toBeVisible();
});

test('sql runner infers numeric parameter types from SQL analysis', async ({page}) => {
  await page.goto('/#sql');

  await replaceCodeMirrorText(page, 'SQL editor', `
    select id, slug, title
    from posts
    where id = :id
    limit 1;
  `);

  await expect(page.getByRole('spinbutton', {name: 'id'})).toBeVisible();
  await page.getByRole('spinbutton', {name: 'id'}).fill('1');
  await page.getByRole('button', {name: 'Run SQL'}).click();
  await expect(page.getByText('Hello World')).toBeVisible();
});

test('sql runner surfaces clean errors without blowing out page width', async ({page}) => {
  await page.goto('/#sql');

  await replaceCodeMirrorText(page, 'SQL editor', `select '${'x'.repeat(4000)}' as payload;`);
  page.once('dialog', (dialog) => dialog.accept('   '));
  await page.getByRole('button', {name: 'Save query'}).click();

  const error = page.locator('.code-block.error');
  await expect(error).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThan(1600);
});

test('sql runner suggests a generated name in the save prompt and does not save on cancel', async ({page}) => {
  const cancelledSavePath = path.join(import.meta.dirname, 'projects', 'fixture-project', 'sql', 'from-posts.sql');
  await fs.rm(cancelledSavePath, {force: true});

  await page.goto('/#sql');
  await replaceCodeMirrorText(page, 'SQL editor', `
    select *
    from posts
    limit 1;
  `);

  let promptMessage = '';
  let promptDefaultValue: string | undefined;
  page.once('dialog', async (dialog) => {
    promptMessage = dialog.message();
    promptDefaultValue = dialog.defaultValue();
    await dialog.dismiss();
  });
  await page.getByRole('button', {name: 'Save query'}).click();

  await expect.poll(async () => fs.access(cancelledSavePath).then(() => true, () => false)).toBe(false);
  expect({message: promptMessage, defaultValue: promptDefaultValue}).toMatchObject({
    message: 'Save query as',
    defaultValue: 'from-posts',
  });
  await expect(page).toHaveURL(/#sql$/);
});

async function replaceCodeMirrorText(page: any, ariaLabel: string, value: string) {
  const content = page.locator(`[aria-label="${ariaLabel}"] .cm-content`);
  await content.click();
  await content.fill(value);
}

async function readCodeMirrorText(page: any, ariaLabel: string) {
  return (await page.locator(`[aria-label="${ariaLabel}"] .cm-content`).textContent()) ?? '';
}

async function preserveSchemaProjectState(projectRoot: string) {
  const snapshotRoot = path.join(import.meta.dirname, '.tmp', `${path.basename(projectRoot)}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const targets = [
    'definitions.sql',
    'migrations',
    'app.db',
    '.sqlfu',
  ] as const;

  await fs.mkdir(path.dirname(snapshotRoot), {recursive: true});
  await fs.mkdir(snapshotRoot, {recursive: true});
  for (const target of targets) {
    const sourcePath = path.join(projectRoot, target);
    try {
      await fs.cp(sourcePath, path.join(snapshotRoot, target), {recursive: true});
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return {
    async [Symbol.asyncDispose]() {
      for (const target of targets) {
        await fs.rm(path.join(projectRoot, target), {recursive: true, force: true});
        try {
          await fs.cp(path.join(snapshotRoot, target), path.join(projectRoot, target), {recursive: true});
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
        }
      }
      await fs.rm(snapshotRoot, {recursive: true, force: true});
    },
  };
}
