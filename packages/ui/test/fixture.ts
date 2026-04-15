import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {test as base} from '@playwright/test';

const currentDir = import.meta.dirname;
const projectsRoot = path.join(currentDir, 'projects');
const templateRoot = path.join(currentDir, 'template-project');
const serverOrigin = 'http://localhost:3218';

export const test = base.extend<{
  slug: string;
  projectDir: string;
  projectUrl: string;
}>({
  slug: async ({}, use, testInfo) => {
    const slug = slugify(testInfo.titlePath.join(' > '));
    await use(slug);
  },
  projectDir: async ({slug}, use) => {
    const projectDir = path.join(projectsRoot, slug);
    await removeProjectDir(projectDir);
    await fs.cp(templateRoot, projectDir, {recursive: true});
    try {
      await use(projectDir);
    } finally {
      await removeProjectDir(projectDir);
    }
  },
  projectUrl: async ({slug, projectDir}, use) => {
    void projectDir;
    await use(serverOrigin.replace('://localhost', `://${slug}.localhost`));
  },
  context: async ({browser, projectUrl, contextOptions}, use) => {
    const context = await browser.newContext({
      ...contextOptions,
      baseURL: projectUrl,
    });
    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
});

export {expect} from '@playwright/test';

function slugify(value: string) {
  const words = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 3);

  const prefix = words.join('-').replace(/^-+|-+$/g, '');
  const hash = createHash('sha1').update(value).digest('hex').slice(0, 7);
  const slug = `${prefix}-${hash}`.replace(/^-+|-+$/g, '');

  if (!slug) {
    throw new Error(`Could not derive slug from test title: ${value}`);
  }
  return slug;
}

function removeProjectDir(projectDir: string) {
  return fs.rm(projectDir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 50,
  });
}
