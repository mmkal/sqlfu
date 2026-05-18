import {expect, test} from '@playwright/test';

test('demo mode runs fully in-browser', async ({page}) => {
  await page.goto('http://127.0.0.1:3218/?demo=1');

  await expect(page.getByText('Demo mode', {exact: true})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Back to sqlfu.dev/ui'})).toBeVisible();

  await expect(page.getByRole('link', {name: /^customers/})).toBeVisible();
  await expect(page.locator('.nav-link[href="#table/products"]')).toBeVisible();
  await expect(page.getByRole('link', {name: /^invoices/})).toBeVisible();

  await page.getByRole('link', {name: /^customers/}).click();
  await expect(page.getByText('Alfreds Futterkiste')).toBeVisible();

  await page.locator('.nav-link[href="#table/products"]').click();
  await expect(page.getByText('Chai')).toBeVisible();
  await expect(page.locator('.nav-link.active')).toContainText('products');

  await page.getByRole('link', {name: 'Schema'}).click();
  await expect(page.getByRole('heading', {name: 'Repo Drift'})).toBeVisible();
  await expect(page.getByText('No Sync Drift')).toBeVisible();
  await expect(page.getByRole('button', {name: 'sqlfu draft'})).toBeVisible();
});

test('demo mode keeps scrolling inside the sidebar and main panes', async ({page}) => {
  await page.setViewportSize({width: 900, height: 320});
  await page.goto('http://127.0.0.1:3218/?demo=1#schema');

  await expect(page.getByRole('heading', {name: 'Schema', exact: true})).toBeVisible();

  const layout = await page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>('.sidebar');
    const main = document.querySelector<HTMLElement>('.main');
    if (!sidebar || !main) {
      throw new Error('Expected sidebar and main panes to be present');
    }

    return {
      documentClientHeight: document.documentElement.clientHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
      mainClientHeight: main.clientHeight,
      mainOverflowY: getComputedStyle(main).overflowY,
      mainScrollHeight: main.scrollHeight,
      sidebarClientHeight: sidebar.clientHeight,
      sidebarOverflowY: getComputedStyle(sidebar).overflowY,
      sidebarScrollHeight: sidebar.scrollHeight,
    };
  });

  expect(layout.documentScrollHeight).toBeLessThanOrEqual(layout.documentClientHeight + 1);
  expect(layout.sidebarOverflowY).toBe('auto');
  expect(layout.sidebarScrollHeight).toBeGreaterThan(layout.sidebarClientHeight);
  expect(layout.mainOverflowY).toBe('auto');
  expect(layout.mainScrollHeight).toBeGreaterThan(layout.mainClientHeight);
});

test('demo mode collapses the sidebar on phone-sized screens', async ({page}) => {
  await page.setViewportSize({width: 390, height: 700});
  await page.goto('http://127.0.0.1:3218/?demo=1#schema');

  await expect(page.getByRole('heading', {name: 'Schema', exact: true})).toBeVisible();
  await expect(page.locator('.sidebar')).toBeHidden();

  const mainBox = await page.locator('.main').boundingBox();
  if (!mainBox) {
    throw new Error('Expected main pane to be visible');
  }
  expect(mainBox.y).toBeLessThan(150);
  expect(await page.locator('.main').evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
    Math.ceil(mainBox.width),
  );

  await page.locator('.sidebar-toggle').click();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.nav-link[href="#table/products"]')).toBeVisible();
});

test('demo mode table columns resize from the visible header edge', async ({page}) => {
  await page.setViewportSize({width: 1100, height: 640});
  await page.goto('http://127.0.0.1:3218/?demo=1#table/products');

  await expect(page.locator('.reactgrid').getByText('Chai')).toBeVisible();

  const productNameHeader = page.locator('.reactgrid [data-cell-rowidx="0"][data-cell-colidx="2"]');
  const initialBox = await productNameHeader.boundingBox();
  if (!initialBox) {
    throw new Error('Expected product_name header cell to be visible');
  }

  await page.mouse.move(initialBox.x + initialBox.width - 3, initialBox.y + initialBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(initialBox.x + initialBox.width + 80, initialBox.y + initialBox.height / 2, {steps: 8});
  await page.mouse.up();

  await expect
    .poll(async () => {
      const currentBox = await productNameHeader.boundingBox();
      return currentBox?.width || 0;
    })
    .toBeGreaterThan(initialBox.width + 40);
});

test('demo mode shows a readable column width hint below the header while resizing', async ({page}) => {
  await page.setViewportSize({width: 1100, height: 640});
  await page.goto('http://127.0.0.1:3218/?demo=1#table/products');

  await expect(page.locator('.reactgrid').getByText('Chai')).toBeVisible();

  const productNameHeader = page.locator('.reactgrid [data-cell-rowidx="0"][data-cell-colidx="2"]');
  const initialBox = await productNameHeader.boundingBox();
  if (!initialBox) {
    throw new Error('Expected product_name header cell to be visible');
  }

  await page.mouse.move(initialBox.x + initialBox.width - 3, initialBox.y + initialBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(initialBox.x + initialBox.width + 70, initialBox.y + initialBox.height / 2, {steps: 8});

  const hint = page.locator('.rg-column-resize-hint');
  await expect(hint).toHaveText(/Width: \d+px/);

  const hintBox = await hint.boundingBox();
  const headerBox = await productNameHeader.boundingBox();
  await page.mouse.up();
  if (!hintBox || !headerBox) {
    throw new Error('Expected resize hint and header boxes to be visible');
  }
  expect(hintBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
});

test('demo mode leaves drag room after the rightmost column', async ({page}) => {
  await page.setViewportSize({width: 1100, height: 640});
  await page.goto('http://127.0.0.1:3218/?demo=1#table/products');

  await expect(page.locator('.reactgrid').getByText('Chai')).toBeVisible();

  const tableScroll = page.locator('.table-scroll');
  await tableScroll.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });

  const discontinuedHeader = page.locator('.reactgrid [data-cell-rowidx="0"][data-cell-colidx="10"]');
  await expect(discontinuedHeader).toBeVisible();

  const scrollBox = await tableScroll.boundingBox();
  const initialBox = await discontinuedHeader.boundingBox();
  if (!scrollBox || !initialBox) {
    throw new Error('Expected table scroller and discontinued header to be visible');
  }

  expect(initialBox.x + initialBox.width).toBeLessThan(scrollBox.x + scrollBox.width - 80);

  await page.mouse.move(initialBox.x + initialBox.width - 3, initialBox.y + initialBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(initialBox.x + initialBox.width + 110, initialBox.y + initialBox.height / 2, {steps: 8});
  await page.mouse.up();

  await expect
    .poll(async () => {
      const currentBox = await discontinuedHeader.boundingBox();
      return currentBox?.width || 0;
    })
    .toBeGreaterThan(initialBox.width + 70);
});

test('demo mode default 100/page table view actually fetches 100 rows', async ({page}) => {
  await page.setViewportSize({width: 1100, height: 640});
  await page.goto('http://127.0.0.1:3218/?demo=1#table/customers');

  await expect(page.getByRole('button', {name: '100 rows per page'})).toBeVisible();

  const tableScroll = page.locator('.table-scroll');
  await tableScroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  await expect(page.locator('.reactgrid').getByText('Wolski  Zajazd')).toBeVisible();
});

test('demo mode: clicking the same sort column 3 times (asc → desc → off) does not freeze', async ({page}) => {
  await page.goto('http://127.0.0.1:3218/?demo=1#table/products');
  await expect(page.locator('.reactgrid').getByText('Chai')).toBeVisible();

  // Click 1: sort by product_id asc (default → SQL mode)
  await page.getByRole('button', {name: 'Sort', exact: true}).click();
  await page.getByRole('button', {name: 'Sort by product_id'}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: /^Sort — product_id asc/})).toBeVisible({timeout: 5000});

  // Click 2: flip to desc
  await page.getByRole('button', {name: /^Sort —/}).click();
  await page.getByRole('button', {name: /Sort by product_id/}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: /^Sort — product_id desc/})).toBeVisible({timeout: 5000});

  // Click 3: remove. In demo mode this froze the page before the fix.
  await page.getByRole('button', {name: /^Sort —/}).click();
  await page.getByRole('button', {name: /Sort by product_id/}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', {name: 'Sort', exact: true})).toBeVisible({timeout: 5000});
  await expect(page.locator('.reactgrid').getByText('Chai')).toBeVisible();
});
