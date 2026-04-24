import fs from 'node:fs/promises';
import path from 'node:path';

import type {Locator, Page} from '@playwright/test';

import {expect, test} from './fixture.ts';

test('shows a helpful startup error page when the local backend is unreachable', async ({page}) => {
  await page.goto('http://127.0.0.1:3218?apiOrigin=http://127.0.0.1:9');

  await expect(page.getByRole('heading', {name: 'sqlfu', exact: true})).toBeVisible();
  await expect(page.getByText('Connecting to the sqlfu backend on 127.0.0.1:9')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Chrome Local Network Access'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'npx sqlfu?'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Retry connection'})).toBeVisible();
});

test('shows a version-mismatch upgrade screen when the local backend is older than the floor', async ({page}) => {
  await page.route('**/api/rpc/project/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        json: {
          initialized: true,
          projectRoot: '/tmp/fake',
          serverVersion: '0.0.0',
        },
      }),
    });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', {name: 'Please upgrade the local sqlfu server'})).toBeVisible();
  await expect(page.getByText(/Your local backend is running/u)).toContainText('0.0.0');
  await expect(page.getByText(/npm install -g sqlfu@latest/u)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Retry connection'})).toBeVisible();
});

test('shows the upgrade screen when the local backend does not report a version at all', async ({page}) => {
  await page.route('**/api/rpc/project/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        json: {
          initialized: true,
          projectRoot: '/tmp/fake',
        },
      }),
    });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', {name: 'Please upgrade the local sqlfu server'})).toBeVisible();
  await expect(page.getByText(/does not satisfy/u)).toContainText('>=0.0.2-3');
  await expect(page.getByText(/pre-dates the version-reporting RPC field/u)).toBeVisible();
});

test('schema page shows mismatch cards and can run the recommended sqlfu draft command', async ({page, projectDir}) => {
  const migrationsDir = path.join(projectDir, 'migrations');

  await page.goto('/#schema');

  await expect(page.getByRole('heading', {name: 'Schema', exact: true})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Repo Drift'})).toBeVisible();
  await expect(page.getByText('Desired Schema does not match Migrations.')).toBeVisible();
  await expect(page.getByText('No Pending Migrations')).toBeVisible();
  await expect(page.getByText('No History Drift')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Schema Drift'})).toBeVisible();
  await expect(page.getByText('Live Schema exists, but Migration History is empty.')).toBeVisible();
  await expect(page.getByText('No Sync Drift')).toBeVisible();
  await expect
    .poll(() => page.locator('.authority-card > summary').allTextContents())
    .toEqual(['Desired Schema▾', 'Migrations▾', 'Migration History▾', 'Live Schema▾']);

  await confirmAndRunSchemaCommand(page, page.getByRole('button', {name: 'sqlfu draft'}));

  await expect
    .poll(async () => {
      try {
        return (await fs.readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).length;
      } catch {
        return 0;
      }
    })
    .toBe(1);

  await expect(page.getByRole('button', {name: 'Desired Schema'})).toBeVisible();
  await expect(await readCodeMirrorText(page, 'Desired Schema editor')).toContain('create table posts');

  await expect(page.getByRole('button', {name: 'Migrations'})).toBeVisible();
  const migrationToggle = page.locator('.authority-migrations .migration-item').first().getByRole('button').first();
  await expect(migrationToggle).toBeVisible();
  await expect(migrationToggle).toContainText('Pending');
  await migrationToggle.click();
  const firstMigrationDetail = page
    .locator('.authority-migrations .migration-item')
    .first()
    .locator('.migration-detail');
  await expect(firstMigrationDetail.getByRole('tab', {name: 'Content'})).toHaveAttribute('aria-selected', 'true');
  await expect(await readCodeMirrorText(firstMigrationDetail, 'Migration content')).toContain(
    'create view post_cards as',
  );

  await expect(page.getByRole('button', {name: 'Migration History'})).toBeVisible();
  await expect(page.getByText('No applied migrations.')).toBeVisible();

  await expect(page.getByRole('button', {name: 'Live Schema'})).toBeVisible();
  await expect(await readCodeMirrorText(page, 'Live Schema editor')).toContain('create table posts');
});

test('migration details show content and metadata tabs in the migrations card', async ({page}) => {
  await page.goto('/#schema');

  await confirmAndRunSchemaCommand(page, page.getByRole('button', {name: 'sqlfu draft'}));

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
  await page.goto('/#schema');

  await confirmAndRunSchemaCommand(page, page.getByRole('button', {name: 'sqlfu draft'}));

  const migrationDetail = page.locator('.authority-migrations .migration-item').first().locator('.migration-detail');
  await page.locator('.authority-migrations .migration-item').first().getByRole('button').first().click();

  const [resultantSchemaResponse] = await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes('/api/rpc/schema/authorities/resultantSchema') && response.ok(),
    ),
    migrationDetail.getByRole('tab', {name: 'Resultant Schema'}).click(),
  ]);
  expect(resultantSchemaResponse.ok()).toBe(true);
  await expect(await readCodeMirrorText(migrationDetail, 'Migration resultant schema')).toContain('create table posts');
});

test('migration history rows use the same migration detail view', async ({page}) => {
  await page.goto('/#schema');

  await confirmAndRunSchemaCommand(page, page.getByRole('button', {name: 'sqlfu draft'}));
  await confirmAndRunSchemaCommand(page, page.getByRole('button', {name: /sqlfu baseline /}).first());

  const historyItem = page.locator('.authority-history .migration-item').first();
  await historyItem.getByRole('button').first().click();

  const migrationDetail = historyItem.locator('.migration-detail');
  await expect(migrationDetail.getByRole('tab', {name: 'Content'})).toHaveAttribute('aria-selected', 'true');
  await migrationDetail.getByRole('tab', {name: 'Metadata'}).click();
  const metadata = await readCodeMirrorText(migrationDetail, 'Migration metadata');
  expect(metadata).toContain('name: create_table_posts');
  expect(metadata).toContain('applied_at: ');
  expect(metadata).not.toContain('applied_at: null');
  expect(metadata).toContain('integrity: ok');
  await expect(historyItem).toContainText(/ago/);
  await expect(historyItem).not.toContainText('Applied');
});

test('schema commands use server-provided confirmation text', async ({page, projectDir}) => {
  const migrationsDir = path.join(projectDir, 'migrations');

  await page.goto('/#schema');

  await confirmAndRunSchemaCommand(
    page,
    page.getByRole('button', {name: 'sqlfu draft'}),
    'create table manual_posts (id integer primary key);',
    'Create migration file?',
  );

  await expect
    .poll(async () => {
      const [migrationFileName] = (await fs.readdir(migrationsDir)).filter((name) => name.endsWith('.sql'));
      if (!migrationFileName) {
        return '';
      }
      return await fs.readFile(path.join(migrationsDir, migrationFileName), 'utf8');
    })
    .toContain('create table manual_posts');
});

test('migration history shows an integrity warning when applied content no longer matches the repo', async ({
  page,
  projectDir,
}) => {
  const migrationsDir = path.join(projectDir, 'migrations');

  await page.goto('/#schema');

  await confirmAndRunSchemaCommand(page, page.getByRole('button', {name: 'sqlfu draft'}));
  await confirmAndRunSchemaCommand(page, page.getByRole('button', {name: /sqlfu baseline /}).first());

  const [migrationFileName] = (await fs.readdir(migrationsDir)).filter((name) => name.endsWith('.sql'));
  await fs.appendFile(path.join(migrationsDir, migrationFileName!), `\n-- drifted after apply\n`);

  await page.reload();

  const historyItem = page.locator('.authority-history .migration-item').first();
  await expect(historyItem).toContainText('⚠');
  await historyItem.getByRole('button').first().click();

  const migrationDetail = historyItem.locator('.migration-detail');
  await migrationDetail.getByRole('tab', {name: 'Metadata'}).click();
  await expect(await readCodeMirrorText(migrationDetail, 'Migration metadata')).toContain(
    'integrity: checksum mismatch',
  );
});

test('desired schema can be edited and saved, and sync is disabled while it is dirty', async ({page, projectDir}) => {
  const definitionsPath = path.join(projectDir, 'definitions.sql');

  await page.goto('/#schema');

  await confirmAndRunSchemaCommand(page, page.getByRole('button', {name: 'sqlfu draft'}));
  await confirmAndRunSchemaCommand(page, page.getByRole('button', {name: /sqlfu baseline /}).first());
  await expect(page.getByText('No Repo Drift')).toBeVisible();

  await expect(page.getByRole('button', {name: 'Save Desired Schema'})).toHaveCount(0);

  await replaceCodeMirrorText(
    page,
    'Desired Schema editor',
    `
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
  `,
  );

  await expect(page.getByRole('button', {name: 'Save Desired Schema'})).toBeVisible();
  await expect
    .poll(() => readCodeMirrorText(page, 'Desired Schema editor'))
    .toContain('create view published_posts as');

  await page.getByRole('button', {name: 'Save Desired Schema'}).click();
  await expect.poll(() => fs.readFile(definitionsPath, 'utf8')).toContain('create view published_posts as');
  await expect(page.getByRole('heading', {name: 'Repo Drift'})).toBeVisible();
});

test('invalid desired schema shows a check error without breaking the schema page', async ({page, projectDir}) => {
  const definitionsPath = path.join(projectDir, 'definitions.sql');
  await fs.writeFile(
    definitionsPath,
    `
    create table posts (
      id integer primary key
    );

    create tabl nope (
      id integer primary key
    );
  `,
  );

  await page.goto('/#schema');

  await expect(page.getByRole('heading', {name: 'Schema', exact: true})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Schema Check Failed'})).toBeVisible();
  await expect(page.getByText(/near "tabl": syntax error/i)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Desired Schema'})).toBeVisible();
  await expect(await readCodeMirrorText(page, 'Desired Schema editor')).toContain('create tabl nope');
});

test('history to live flow shows a baseline action when check recommends it', async ({page}) => {
  await page.goto('/#schema');

  await confirmAndRunSchemaCommand(page, page.getByRole('button', {name: 'sqlfu draft'}));

  const baselineButton = page.getByRole('button', {name: /sqlfu baseline /}).first();
  await expect(baselineButton).toBeVisible();

  await confirmAndRunSchemaCommand(page, baselineButton);
  await expect(page.getByText('No History Drift')).toBeVisible();
});

test('history to live flow shows a goto action when check recommends it', async ({page, projectDir}) => {
  const migrationsDir = path.join(projectDir, 'migrations');
  const definitionsPath = path.join(projectDir, 'definitions.sql');

  await page.goto('/#schema');

  await confirmAndRunSchemaCommand(page, page.getByRole('button', {name: 'sqlfu draft'}));
  await confirmAndRunSchemaCommand(page, page.getByRole('button', {name: /sqlfu baseline /}).first());

  const [migrationFileName] = (await fs.readdir(migrationsDir)).filter((name) => name.endsWith('.sql'));
  await fs.appendFile(
    path.join(migrationsDir, migrationFileName!),
    `

create view post_titles as
select title
from posts;
`,
  );
  await fs.appendFile(
    definitionsPath,
    `

create view post_titles as
select title
from posts;
`,
  );

  await page.reload();

  const gotoButton = page.getByRole('button', {name: /sqlfu goto /});
  await expect(gotoButton).toBeVisible();

  await confirmAndRunSchemaCommand(page, gotoButton);
  await expect.poll(() => readCodeMirrorText(page, 'Live Schema editor')).toContain('create view post_titles as');
  await expect(page.getByText('No History Drift')).toBeVisible();
});

test('schema command failures stay visible next to the failing command button', async ({page}) => {
  await page.goto('/#schema');

  await confirmAndRunSchemaCommand(page, page.getByRole('button', {name: 'sqlfu draft'}));
  await confirmAndRunSchemaCommand(page, page.getByRole('button', {name: /sqlfu baseline /}).first());

  await replaceCodeMirrorText(
    page,
    'Desired Schema editor',
    `
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
  `,
  );
  await expect.poll(() => readCodeMirrorText(page, 'Desired Schema editor')).toContain('birthdate text not null');
  await page.getByRole('button', {name: 'Save Desired Schema'}).click();

  await confirmAndRunSchemaCommand(page, page.getByRole('button', {name: 'sqlfu draft'}));

  const migrateButton = page.getByRole('button', {name: 'sqlfu migrate'});
  await expect(migrateButton).toBeVisible();
  await confirmAndRunSchemaCommand(page, migrateButton);

  await expect(
    page.locator('.schema-command-error').filter({hasText: 'Cannot add a NOT NULL column with default value NULL'}),
  ).toBeVisible();
  await expect(
    page.getByRole('status').filter({hasText: 'Cannot add a NOT NULL column with default value NULL'}),
  ).toBeVisible();
});

test('table browser, sql runner, and generated query form work against a live fixture project', async ({page}) => {
  await page.goto('/');

  await page.getByRole('link', {name: /^posts/}).click();
  await expect(page.getByRole('heading', {name: 'posts'})).toBeVisible();
  await expect(page.getByText('hello-world')).toBeVisible();

  await page.getByRole('link', {name: 'SQL runner'}).click();
  await page.getByRole('button', {name: 'Run SQL'}).click();
  await expect(page.getByText('sqlite_schema')).toBeVisible();

  await page.getByRole('link', {name: /find-post-by-slug/i}).click();
  await page.getByLabel('slug').fill('hello-world');
  await page.getByRole('button', {name: 'Run query'}).click();
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

test('clicking a relation cell surfaces the cell detail popover via the toolbar Cell button', async ({page}) => {
  await page.goto('/#table/posts');

  await page.locator('.reactgrid [data-cell-rowidx="1"][data-cell-colidx="4"]').click();
  const cellButton = page.getByRole('button', {name: 'Cell: body, row 1'});
  await expect(cellButton).toBeVisible();
  await cellButton.click();
  const dialog = page.getByRole('dialog', {name: 'Cell detail'});
  await expect(dialog).toContainText('Cell: body, row 1');
  await expect(dialog).toContainText('First post body');
});

test('clicking a sql runner result cell shows the full cell content below the table', async ({page}) => {
  await page.goto('/#sql');

  await replaceCodeMirrorText(
    page,
    'SQL editor',
    `
    select body
    from posts
    where slug = 'hello-world'
    limit 1;
  `,
  );
  await page.getByRole('button', {name: 'Run SQL'}).click();

  await page.locator('.reactgrid [data-cell-rowidx="1"][data-cell-colidx="1"]').click();
  const cellButton = page.getByRole('button', {name: 'Cell: body, row 1'});
  await expect(cellButton).toBeVisible();
  await cellButton.click();
  const dialog = page.getByRole('dialog', {name: 'Cell detail'});
  await expect(dialog).toContainText('First post body');
});

test('views created from the sql runner can be browsed without crashing the app', async ({page}) => {
  await page.goto('/#sql');

  await replaceCodeMirrorText(
    page,
    'SQL editor',
    `
    create view recent_migrations as
    select *
    from sqlfu_migrations;
  `,
  );
  await page.getByRole('button', {name: 'Run SQL'}).click();

  await page.getByRole('link', {name: 'recent_migrations view'}).click();
  await expect(page).toHaveURL(/#table\/recent_migrations$/);
  await expect(page.getByRole('heading', {name: 'recent_migrations'})).toBeVisible();
  await expect(page.getByText('No rows.')).toBeVisible();
});

test('clicking a saved query result cell shows the full cell content below the table', async ({page}) => {
  await page.goto('/#query/list-post-cards');

  await page.getByRole('button', {name: 'Run query'}).click();
  await page.locator('.reactgrid [data-cell-rowidx="1"][data-cell-colidx="3"]').click();

  const cellButton = page.getByRole('button', {name: 'Cell: title, row 1'});
  await expect(cellButton).toBeVisible();
  await cellButton.click();
  const dialog = page.getByRole('dialog', {name: 'Cell detail'});
  await expect(dialog).toContainText('Hello World');
});

test('relation rows can be edited and saved from the grid', async ({page}) => {
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
    page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/api/rpc/table/save'),
    ),
    page.getByRole('button', {name: 'Save changes'}).click(),
  ]);
  const saveResponseText = await saveResponse.text();
  expect(saveResponse.ok(), saveResponseText).toBe(true);

  await page.reload();
  await expect(page.locator('.reactgrid [data-cell-rowidx="1"][data-cell-colidx="3"]')).toContainText(
    'Hello World Revised',
  );
});

test('relation rows can be appended from the grid', async ({page}) => {
  await page.goto('/#table/posts');

  await page.locator('.reactgrid [data-cell-rowidx="3"][data-cell-colidx="2"]').click();
  await expect(page.getByRole('button', {name: 'Cell: slug, row 3'})).toBeVisible();
  await expect(page.locator('.reactgrid [data-cell-rowidx="3"][data-cell-colidx="2"]')).toBeVisible();

  const editor = page.locator('.rg-celleditor input');
  await page.keyboard.press('Enter');
  await expect(editor).toBeVisible();
  await editor.pressSequentially('brand-new-post');
  await page.keyboard.press('Tab');

  await expect(page.getByRole('button', {name: 'Cell: title, row 3'})).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(editor).toBeVisible();
  await editor.pressSequentially('Brand New Post');
  await page.keyboard.press('Tab');

  await expect(page.getByRole('button', {name: 'Cell: body, row 3'})).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(editor).toBeVisible();
  await editor.pressSequentially('Inserted from the relations grid');
  await page.keyboard.press('Tab');

  await expect(page.getByRole('button', {name: 'Cell: published, row 3'})).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(editor).toBeVisible();
  await editor.pressSequentially('0');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('button', {name: 'Save changes'})).toBeVisible();
  const [saveResponse] = await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/api/rpc/table/save'),
    ),
    page.getByRole('button', {name: 'Save changes'}).click(),
  ]);
  expect(saveResponse.ok(), await saveResponse.text()).toBe(true);

  await page.reload();
  await expect(page.locator('.reactgrid [data-cell-rowidx="3"][data-cell-colidx="2"]')).toContainText('brand-new-post');
  await expect(page.locator('.reactgrid [data-cell-rowidx="3"][data-cell-colidx="3"]')).toContainText('Brand New Post');
});

test('relation rows can be selected and deleted from the grid', async ({page}) => {
  await page.goto('/#table/posts');

  const firstRowHeader = page.locator('.reactgrid [data-cell-rowidx="1"][data-cell-colidx="0"]');
  await expect(firstRowHeader).toContainText('1');

  await firstRowHeader.getByRole('button', {name: 'Select row 1'}).click();
  await expect(firstRowHeader).toContainText('🗑');
  await expect(page.locator('.reactgrid [data-cell-rowidx="1"][data-cell-colidx="2"]')).toHaveClass(/selected-row/);

  await firstRowHeader.getByRole('button', {name: 'Delete row 1'}).click();
  const confirmDialog = page.getByRole('dialog');
  await expect(confirmDialog.getByText(/Delete row from "posts"\?/)).toBeVisible();
  await expect(confirmDialog).toContainText('delete from "posts"');
  await expect(confirmDialog).toContainText('where "id" = 1');
  const [deleteResponse] = await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/api/rpc/table/delete'),
    ),
    confirmDialog.getByRole('button', {name: 'Confirm'}).click(),
  ]);
  expect(deleteResponse.ok(), await deleteResponse.text()).toBe(true);

  await expect(page.locator('.reactgrid [data-cell-rowidx="1"][data-cell-colidx="2"]')).toContainText('draft-notes');
  await expect(page.getByText('hello-world')).toHaveCount(0);
});

test('appended rows focus the clicked cell and allow editing primary key columns', async ({page}) => {
  await page.goto('/#schema');
  await confirmAndRunSchemaCommand(page, page.getByRole('button', {name: 'sqlfu draft'}));
  await confirmAndRunSchemaCommand(page, page.getByRole('button', {name: /sqlfu baseline /}).first());

  await page.goto('/#table/sqlfu_migrations');
  await page.locator('.reactgrid [data-cell-rowidx="2"][data-cell-colidx="1"]').click();
  await expect(page.getByRole('button', {name: 'Cell: name, row 2'})).toBeVisible();

  await fillGridTextCell(page, 2, 1, 'manual_migration');

  await expect(page.locator('.reactgrid [data-cell-rowidx="2"][data-cell-colidx="1"]')).toContainText(
    'manual_migration',
  );
});

test('relation rows can discard dirty cell changes', async ({page}) => {
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
    // Table drafts live in sessionStorage so they clear on tab close.
    window.sessionStorage.setItem(
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
  await page.getByRole('button', {name: 'Cell: title, row 1'}).click();

  const cellPopover = page.getByRole('dialog', {name: 'Cell detail'});
  await expect(cellPopover.getByRole('tab', {name: 'Diff'})).toHaveAttribute('aria-selected', 'true');
  await expect(cellPopover.getByRole('tab', {name: 'Original'})).toBeVisible();
  await expect(cellPopover.getByRole('tab', {name: 'Draft'})).toBeVisible();
  await expect(cellPopover).toContainText('Hello World');
  await expect(cellPopover).toContainText('Hello World Dirty');

  await cellPopover.getByRole('tab', {name: 'Original'}).click();
  await expect(cellPopover.getByRole('tab', {name: 'Original'})).toHaveAttribute('aria-selected', 'true');
  await expect(cellPopover).toContainText('Hello World');

  await cellPopover.getByRole('tab', {name: 'Draft'}).click();
  await expect(cellPopover.getByRole('tab', {name: 'Draft'})).toHaveAttribute('aria-selected', 'true');
  await expect(cellPopover).toContainText('Hello World Dirty');
});

test('switching between saved queries does not leak form state between schemas', async ({page}) => {
  await page.goto('/#query/find-post-by-slug');

  await page.getByLabel('slug').fill('hello-world');
  await page.getByRole('button', {name: 'Run query'}).click();
  await expect(page.getByText('Hello World')).toBeVisible();

  await page.getByRole('link', {name: /list-post-cards/i}).click();
  await expect(page.getByText("'findPostBySlug params' must NOT have additional properties")).toHaveCount(0);
  await page.getByRole('button', {name: 'Run query'}).click();
  await expect(page.getByText('Draft Notes')).toBeVisible();
});

test('saved queries can be renamed, edited, and deleted from the query view', async ({page, projectDir}) => {
  const projectSqlDir = path.join(projectDir, 'sql');
  const originalPath = path.join(projectSqlDir, 'list-post-cards.sql');
  const renamedPath = path.join(projectSqlDir, 'list-post-cards-renamed.sql');

  await fs.rm(renamedPath, {force: true});

  await page.goto('/#query/list-post-cards');

  await page.getByRole('button', {name: 'Rename query'}).click();
  await page.getByLabel('Query title').fill('list-post-cards-renamed');
  await page.getByRole('button', {name: 'Confirm query rename'}).click();

  await expect(page).toHaveURL(/#query\/list-post-cards-renamed$/);
  await expect(page.getByRole('heading', {name: 'list-post-cards-renamed'})).toBeVisible();
  await expect(
    fs.access(renamedPath).then(
      () => true,
      () => false,
    ),
  ).resolves.toBe(true);
  await expect(
    fs.access(originalPath).then(
      () => true,
      () => false,
    ),
  ).resolves.toBe(false);

  await page.getByRole('button', {name: 'Edit query SQL'}).click();
  await replaceCodeMirrorText(
    page,
    'Query SQL editor',
    `
    select id, slug, title
    from posts
    where slug = :slug
    limit 1;
  `,
  );
  await page.getByRole('button', {name: 'Confirm query SQL edit'}).click();

  await expect(page.getByLabel('slug')).toBeVisible();
  await page.getByLabel('slug').fill('hello-world');
  await page.getByRole('button', {name: 'Run query'}).click();
  await expect(page.getByText('Hello World')).toBeVisible();
  await expect(fs.readFile(renamedPath, 'utf8')).resolves.toContain('where slug = :slug');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', {name: 'Delete query'}).click();

  await expect(page).toHaveURL(/#query\/find-post-by-slug$/);
  await expect(page.getByRole('link', {name: /list-post-cards-renamed/i})).toHaveCount(0);
  await expect(
    fs.access(renamedPath).then(
      () => true,
      () => false,
    ),
  ).resolves.toBe(false);
});

test('invalid saved queries still show editable sql', async ({page, projectDir}) => {
  const queryPath = path.join(projectDir, 'sql', 'find-post-by-slug.sql');

  await fs.writeFile(
    queryPath,
    `
    select id, slug, title
    from posts_broken
    where slug = :slug
    limit 1;
  `,
  );

  await page.goto('/#query/find-post-by-slug');

  await expect(page.getByText('Query error')).toBeVisible();
  await expect(page.getByText('no such table: posts_broken')).toBeVisible();
  await expect(page.getByText('from posts_broken')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Edit query SQL'})).toBeVisible();

  await page.getByRole('button', {name: 'Edit query SQL'}).click();
  await replaceCodeMirrorText(
    page,
    'Query SQL editor',
    `
    select id, slug, title
    from posts
    where slug = :slug
    limit 1;
  `,
  );
  await page.getByRole('button', {name: 'Confirm query SQL edit'}).click();

  await expect(page.getByLabel('slug')).toBeVisible();
  await page.getByLabel('slug').fill('hello-world');
  await page.getByRole('button', {name: 'Run query'}).click();
  await expect(page.getByText('Hello World')).toBeVisible();
});

test('sql runner executes a named-parameter query and saves it to disk', async ({page, projectDir}) => {
  const savedQueryPath = path.join(projectDir, 'sql', 'find-hello-world.sql');
  await fs.rm(savedQueryPath, {force: true});

  await page.goto('/#sql');
  await replaceCodeMirrorText(
    page,
    'SQL editor',
    `
    select id, slug, title
    from posts
    where slug = :slug
    limit 1;
  `,
  );

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

test('schema queries are invalidated after sql runs, saved query runs, and relation saves', async ({page}) => {
  await page.goto('/#schema');
  await expect(page.getByRole('heading', {name: 'Schema', exact: true})).toBeVisible();

  await page.goto('/#sql');
  await replaceCodeMirrorText(
    page,
    'SQL editor',
    `
    select id, slug
    from posts
    limit 1;
  `,
  );
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/rpc/schema/') && response.ok()),
    page.getByRole('button', {name: 'Run SQL'}).click(),
  ]);

  await page.goto('/#query/list-post-cards');
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/rpc/schema/') && response.ok()),
    page.getByRole('button', {name: 'Run query'}).click(),
  ]);

  await page.goto('/#table/posts');
  const titleCell = page.locator('.reactgrid [data-cell-rowidx="1"][data-cell-colidx="3"]');
  await titleCell.click();
  await page.keyboard.press('Enter');
  const editor = page.locator('.rg-celleditor input');
  await expect(editor).toBeVisible();
  await editor.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`);
  await editor.press('Backspace');
  await editor.pressSequentially('Updated title');
  await editor.press('Enter');
  await page.locator('.reactgrid [data-cell-rowidx="2"][data-cell-colidx="3"]').click();
  await expect(page.getByRole('button', {name: 'Save changes'})).toBeVisible();
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/rpc/schema/') && response.ok()),
    page.getByRole('button', {name: 'Save changes'}).click(),
  ]);
});

test('sql runner draft survives a reload via local storage', async ({page}) => {
  await page.goto('/#sql');

  await replaceCodeMirrorText(
    page,
    'SQL editor',
    `
    select id, slug
    from posts
    where slug = :slug
    limit 1;
  `,
  );
  await expect(page.getByLabel('slug')).toBeVisible();
  await page.getByLabel('slug').fill('draft-notes');

  await page.reload();

  await expect(await readCodeMirrorText(page, 'SQL editor')).toContain('where slug = :slug');
  await expect(page.getByLabel('slug')).toHaveValue('draft-notes');
});

test('sql runner drops stale parameter values when the SQL parameter names change', async ({page}) => {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto('/#sql');

  await replaceCodeMirrorText(
    page,
    'SQL editor',
    `
    select id, slug
    from posts
    where slug = :slug
    limit 1;
  `,
  );
  await expect(page.getByLabel('slug')).toBeVisible();
  await page.getByLabel('slug').fill('hello-world');

  await replaceCodeMirrorText(
    page,
    'SQL editor',
    `
    select id, slug
    from posts
    where slug = :sluggggg
    limit 1;
  `,
  );
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
  const [lineNumberOneBox, firstLineBox] = await Promise.all([lineNumberOne.boundingBox(), firstLine.boundingBox()]);

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

  await replaceCodeMirrorText(
    page,
    'SQL editor',
    `
    select id, slug, title
    from posts
    where slug = :slug
    limit 1;
  `,
  );

  await page.getByLabel('slug').fill('hello-world');
  await page.locator('[aria-label="SQL editor"] .cm-content').click();
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Enter`);
  await expect(page.getByText('Hello World')).toBeVisible();
});

test('sql runner infers numeric parameter types from SQL analysis', async ({page}) => {
  await page.goto('/#sql');

  await replaceCodeMirrorText(
    page,
    'SQL editor',
    `
    select id, slug, title
    from posts
    where id = :id
    limit 1;
  `,
  );

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
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThan(1600);
});

test('sql runner surfaces duplicate ddl errors instead of a generic internal error', async ({page}) => {
  await page.goto('/#sql');

  await replaceCodeMirrorText(page, 'SQL editor', 'create view duplicate_view as select * from sqlfu_migrations;');
  await page.getByRole('button', {name: 'Run SQL'}).click();
  await page.getByRole('button', {name: 'Run SQL'}).click();

  await expect(page.locator('.code-block.error')).toContainText('view duplicate_view already exists');
  await expect(page.locator('.code-block.error')).not.toContainText('Internal server error');
});

test('sql runner suggests a generated name in the save prompt and does not save on cancel', async ({
  page,
  projectDir,
}) => {
  const cancelledSavePath = path.join(projectDir, 'sql', 'from-posts.sql');
  await fs.rm(cancelledSavePath, {force: true});

  await page.goto('/#sql');
  await replaceCodeMirrorText(
    page,
    'SQL editor',
    `
    select *
    from posts
    limit 1;
  `,
  );

  let promptMessage = '';
  let promptDefaultValue: string | undefined;
  page.once('dialog', async (dialog) => {
    promptMessage = dialog.message();
    promptDefaultValue = dialog.defaultValue();
    await dialog.dismiss();
  });
  await page.getByRole('button', {name: 'Save query'}).click();

  await expect
    .poll(async () =>
      fs.access(cancelledSavePath).then(
        () => true,
        () => false,
      ),
    )
    .toBe(false);
  expect({message: promptMessage, defaultValue: promptDefaultValue}).toMatchObject({
    message: 'Save query as',
    defaultValue: 'from-posts',
  });
  await expect(page).toHaveURL(/#sql$/);
});

async function confirmAndRunSchemaCommand(page: Page, button: Locator, confirmation?: string, title?: string) {
  await button.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  if (title) {
    await expect(dialog.getByRole('heading', {name: title})).toBeVisible();
  }
  if (confirmation != null) {
    await replaceCodeMirrorText(dialog, 'Confirmation body editor', confirmation);
  }
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/rpc/schema/submitConfirmation')),
    dialog.getByRole('button', {name: 'Confirm'}).click(),
  ]);
  await expect(dialog).not.toBeVisible();
}

test('relation toolbar exposes Filter / Sort / Columns / Query / Definition buttons', async ({page}) => {
  await page.goto('/#table/posts');

  await expect(page.getByRole('heading', {name: 'posts'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Filter', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Sort', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: /Columns — \d+ of \d+ visible/})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Query SQL'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Table definition'})).toBeVisible();
  // The Query editor is not mounted until the popover is opened.
  await expect(page.getByLabel('Relation query editor')).toHaveCount(0);
});

test('opening the Query popover shows a CodeMirror with the generated SQL', async ({page}) => {
  await page.goto('/#table/posts');
  await page.getByRole('button', {name: 'Sort', exact: true}).click();
  await page.getByRole('button', {name: 'Sort by title'}).click();

  await page.getByRole('button', {name: 'Query SQL'}).click();
  await expect(page.getByLabel('Relation query editor')).toBeVisible();
  await expect(page.getByLabel('Relation query editor')).toContainText('order by "title" asc');
  await expect(page.getByLabel('Relation query editor')).toContainText('limit 100');
});

test('multi-column sort composes clauses in the order they were added', async ({page}) => {
  await page.goto('/#table/posts');

  // First sort: published asc
  await page.getByRole('button', {name: 'Sort', exact: true}).click();
  await page.getByRole('button', {name: 'Sort by published'}).click();
  await page.keyboard.press('Escape');
  // Second sort: title asc (appended)
  await page.getByRole('button', {name: /^Sort —/}).click();
  await page.getByRole('button', {name: 'Sort by title'}).click();
  await page.keyboard.press('Escape');

  await page.getByRole('button', {name: 'Query SQL'}).click();
  await expect(page.getByLabel('Relation query editor')).toContainText(
    'order by "published" asc, "title" asc',
  );
});

test('clicking the same sort column 3 times (asc → desc → off) does not freeze the page', async ({page}) => {
  await page.goto('/#table/posts');

  // Click 1: sort by id asc (default → SQL mode)
  await page.getByRole('button', {name: 'Sort', exact: true}).click();
  await page.getByRole('button', {name: 'Sort by id'}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: /^Sort — id asc/})).toBeVisible({timeout: 5000});

  // Click 2: flip to desc (still SQL mode)
  await page.getByRole('button', {name: /^Sort —/}).click();
  await page.getByRole('button', {name: /Sort by id/}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: /^Sort — id desc/})).toBeVisible({timeout: 5000});

  // Click 3: remove (SQL mode → default mode). Used to freeze on mode transition back.
  await page.getByRole('button', {name: /^Sort —/}).click();
  await page.getByRole('button', {name: /Sort by id/}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Sort', exact: true})).toBeVisible({timeout: 5000});

  // Grid should still show the seeded rows
  await expect(page.locator('.reactgrid').getByText('hello-world')).toBeVisible();
});

test('delete confirmation cancel leaves the row re-selectable', async ({page}) => {
  await page.goto('/#table/posts');

  const firstRowHeader = page.locator('.reactgrid [data-cell-rowidx="1"][data-cell-colidx="0"]');
  await firstRowHeader.getByRole('button', {name: 'Select row 1'}).click();
  await expect(firstRowHeader).toContainText('🗑');
  await firstRowHeader.getByRole('button', {name: 'Delete row 1'}).click();

  // Cancel the confirmation: the row must go back to its unselected state, not stay armed.
  await page.getByRole('dialog').getByRole('button', {name: 'Cancel'}).click();
  await expect(firstRowHeader).toContainText('1');
  await expect(firstRowHeader).not.toContainText('🗑');

  // And we can arm + cancel + arm again without anything getting stuck.
  await firstRowHeader.getByRole('button', {name: 'Select row 1'}).click();
  await expect(firstRowHeader).toContainText('🗑');
});

test('failed saves surface the underlying SQL error instead of a generic internal server error', async ({page}) => {
  await page.goto('/#table/posts');

  // Append a row that will violate the UNIQUE(slug) constraint against the seeded hello-world row.
  const appendCell = page.locator('.reactgrid [data-cell-rowidx="3"][data-cell-colidx="0"]');
  await appendCell.scrollIntoViewIfNeeded();
  await appendCell.click({position: {x: 8, y: 8}});
  await fillGridTextCell(page, 3, 1, '999');
  await fillGridTextCell(page, 3, 2, 'hello-world');
  await fillGridTextCell(page, 3, 3, 'dup');
  await fillGridTextCell(page, 3, 4, 'dup');
  await fillGridTextCell(page, 3, 5, '0');

  const [saveResponse] = await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/api/rpc/table/save'),
    ),
    page.getByRole('button', {name: 'Save changes'}).click(),
  ]);
  expect(saveResponse.ok()).toBe(false);

  const errorView = page.locator('.code-block.error');
  await expect(errorView).toBeVisible();
  // The underlying SQLite error should now bubble up, not a generic "Internal server error".
  await expect(errorView).toContainText(/unique|constraint|posts\.slug/i);
  await expect(errorView).not.toContainText('Internal server error');
});

test('after a failed insert, the grid stays editable so the user can fix the row', async ({page}) => {
  await page.goto('/#table/posts');

  // Trigger append by clicking the "+" cell in the append row.
  const appendCell = page.locator('.reactgrid [data-cell-rowidx="3"][data-cell-colidx="0"]');
  await appendCell.scrollIntoViewIfNeeded();
  await appendCell.click({position: {x: 8, y: 8}});

  // Fill only id (leave NOT NULL fields blank) then try to save — server errors out.
  await fillGridTextCell(page, 3, 1, '999');
  await expect(page.getByRole('button', {name: 'Save changes'})).toBeVisible();

  const [saveResponse] = await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/api/rpc/table/save'),
    ),
    page.getByRole('button', {name: 'Save changes'}).click(),
  ]);
  expect(saveResponse.ok()).toBe(false);
  await expect(page.locator('.code-block.error')).toBeVisible();

  // After the error the user should be able to correct the row. Click the slug cell.
  const slugCell = page.locator('.reactgrid [data-cell-rowidx="3"][data-cell-colidx="2"]');
  await slugCell.click({position: {x: 8, y: 8}});
  await expect(page.getByRole('button', {name: 'Cell: slug, row 3'})).toBeVisible();
});

test('Query popover requires Apply before the query re-runs', async ({page}) => {
  await page.goto('/#table/posts');
  // Contribute a change so we're in SQL mode (otherwise the grid uses table.list, not our SQL).
  await page.getByRole('button', {name: 'Sort', exact: true}).click();
  await page.getByRole('button', {name: 'Sort by title'}).click();
  await page.keyboard.press('Escape');

  await page.getByRole('button', {name: 'Query SQL'}).click();
  await replaceCodeMirrorText(
    page,
    'Relation query editor',
    `select * from posts where slug = 'hello-world' limit 100`,
  );
  // Draft shows unapplied state. Grid still shows all rows.
  await expect(page.getByText(/Unapplied changes/)).toBeVisible();
  await expect(page.locator('.reactgrid').getByText('draft-notes')).toBeVisible();

  // Apply
  await page.getByRole('button', {name: 'Apply'}).click();
  await expect(page.locator('.reactgrid').getByText('draft-notes')).toHaveCount(0);
  await expect(page.locator('.reactgrid').getByText('hello-world')).toBeVisible();
});

test('Definition popover shows the relation DDL as read-only SQL', async ({page}) => {
  await page.goto('/#table/posts');
  await page.getByRole('button', {name: 'Table definition'}).click();
  const editor = page.getByLabel('Relation definition editor');
  await expect(editor).toBeVisible();
  await expect(editor).toContainText(/create table posts/i);
});

test('adding an equals filter writes a where clause and narrows the displayed rows', async ({page}) => {
  await page.goto('/#table/posts');
  await expect(page.locator('.reactgrid').getByText('hello-world')).toBeVisible();
  await expect(page.locator('.reactgrid').getByText('draft-notes')).toBeVisible();

  await page.getByRole('button', {name: 'Filter', exact: true}).click();
  const popover = page.getByRole('dialog', {name: 'Filters'});
  await popover.getByLabel('Filter column').selectOption('slug');
  await popover.getByLabel('Filter value').fill('hello-world');
  await popover.getByRole('button', {name: 'Apply'}).click();

  await page.getByRole('button', {name: 'Query SQL'}).click();
  await expect(page.getByLabel('Relation query editor')).toContainText(`where "slug" = 'hello-world'`);
  await expect(page.locator('.reactgrid').getByText('draft-notes')).toHaveCount(0);
  await expect(page.locator('.reactgrid').getByText('hello-world')).toBeVisible();
});

test('hiding a middle column commas out inside the comment so the SQL stays valid', async ({page}) => {
  await page.goto('/#table/posts');
  await page.getByRole('button', {name: /Columns — \d+ of \d+ visible/}).click();
  await page.getByRole('dialog', {name: 'Columns'}).getByLabel('Hide title').click();

  await page.getByRole('button', {name: 'Query SQL'}).click();
  await expect(page.getByLabel('Relation query editor')).toContainText('/* "title", */');
  // Smoke-test that the generated SQL actually executes against the backend: the grid should still show rows.
  await expect(page.locator('.reactgrid').getByText('hello-world')).toBeVisible();
});

test('removing the limit clause surfaces a hard error and refuses to execute', async ({page}) => {
  await page.goto('/#table/posts');
  await page.getByRole('button', {name: 'Sort', exact: true}).click();
  await page.getByRole('button', {name: 'Sort by id'}).click();

  await page.getByRole('button', {name: 'Query SQL'}).click();
  await expect(page.getByLabel('Relation query editor')).toContainText('limit 100');
  await replaceCodeMirrorText(page, 'Relation query editor', 'select * from posts');
  await expect(page.getByText(/Your query must end with a/)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Apply'})).toBeDisabled();
});

test('custom query that no longer targets this table shows an "Open in SQL Runner" hint', async ({page}) => {
  await page.goto('/#table/posts');
  await page.getByRole('button', {name: 'Sort', exact: true}).click();
  await page.getByRole('button', {name: 'Sort by id'}).click();

  await page.getByRole('button', {name: 'Query SQL'}).click();
  await replaceCodeMirrorText(page, 'Relation query editor', 'select name from sqlite_schema limit 100');

  await expect(page.getByText(/Your query is no longer a simple/)).toBeVisible();
  await expect(page.getByRole('link', {name: 'full SQL Runner'})).toBeVisible();
});

async function replaceCodeMirrorText(page: any, ariaLabel: string, value: string) {
  const content = page.locator(`[aria-label="${ariaLabel}"] .cm-content`);
  await content.click();
  await content.fill(value);
}

async function readCodeMirrorText(page: any, ariaLabel: string) {
  return (await page.locator(`[aria-label="${ariaLabel}"] .cm-content`).textContent()) ?? '';
}

async function fillGridTextCell(page: any, rowIndex: number, columnIndex: number, value: string) {
  const cell = page.locator(`.reactgrid [data-cell-rowidx="${rowIndex}"][data-cell-colidx="${columnIndex}"]`);
  const columnName = (
    await page.locator(`.reactgrid [data-cell-rowidx="0"][data-cell-colidx="${columnIndex}"]`).textContent()
  )?.trim();
  await cell.click({position: {x: 8, y: 8}});
  if (columnName) {
    await expect(page.getByRole('button', {name: `Cell: ${columnName}, row ${rowIndex}`})).toBeVisible();
  }
  await cell.dblclick({position: {x: 8, y: 8}});
  const editor = page.locator('.rg-celleditor input');
  if (await editor.isVisible()) {
    await editor.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`);
    await editor.press('Backspace');
    await editor.pressSequentially(value);
    await editor.press('Enter');
    await page.locator(`.reactgrid [data-cell-rowidx="${rowIndex}"][data-cell-colidx="0"]`).click();
    return;
  }

  await cell.click();
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
}
