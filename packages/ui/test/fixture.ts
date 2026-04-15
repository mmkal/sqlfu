import fs from 'node:fs/promises';
import path from 'node:path';

import {test as base} from '@playwright/test';

const currentDir = import.meta.dirname;
const projectsRoot = path.join(currentDir, 'projects');
const templateRoot = path.join(currentDir, 'template-project');

export const test = base.extend<{
  projectName: string;
  projectRoot: string;
  projectUrl: string;
}>({
  projectName: async ({}, use, testInfo) => {
    const slug = slugify([
      testInfo.title,
      String(testInfo.workerIndex),
      String(Date.now()),
      Math.random().toString(36).slice(2, 8),
    ].join('-'));
    await use(`test-${slug}`);
  },
  projectRoot: async ({projectName}, use) => {
    const projectRoot = path.join(projectsRoot, projectName);
    await removeProjectRoot(projectRoot);
    await fs.cp(templateRoot, projectRoot, {recursive: true});
    try {
      await use(projectRoot);
    } finally {
      await removeProjectRoot(projectRoot);
    }
  },
  projectUrl: async ({projectName, projectRoot}, use) => {
    void projectName;
    void projectRoot;
    await use('http://localhost:3218');
  },
  page: async ({browser, projectName}, use) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'x-sqlfu-project': projectName,
      },
    });
    const page = await context.newPage();
    try {
      await use(page);
    } finally {
      await context.close();
    }
  },
});

export {expect} from '@playwright/test';

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function removeProjectRoot(projectRoot: string) {
  return fs.rm(projectRoot, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 50,
  });
}
