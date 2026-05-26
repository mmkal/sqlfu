// Pg-flavored playwright fixture. Mirrors `fixture.ts` but copies the
// `template-project-pg` template into the per-test project directory
// and creates / drops a unique pg scratch database for each test.
//
// Each test's project gets a database named after its slug. The
// project's `sqlfu.config.ts` derives the dbname from `path.basename
// (projectRoot)`, so the chain is automatic: hostname → slug →
// projects/<slug>/ → sqlfu_ui_<slug> database.
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {Client} from 'pg';
import {test as base} from '@playwright/test';

const currentDir = import.meta.dirname;
const projectsRoot = path.join(currentDir, 'projects');
const templateRoot = path.join(currentDir, 'template-project-pg');
const serverOrigin = `http://localhost:${process.env.SQLFU_UI_TEST_PORT || '3218'}`;

const ADMIN_URL =
  process.env.SQLFU_UI_PG_ADMIN_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5544/postgres';

export const test = base.extend<{
  slug: string;
  projectDir: string;
  dbName: string;
  projectUrl: string;
}>({
  slug: async ({}, use, testInfo) => {
    await use(slugify(testInfo.titlePath.join(' > ')));
  },
  projectDir: async ({slug}, use) => {
    const projectDir = path.join(projectsRoot, slug);
    await removeDir(projectDir);
    await fs.cp(templateRoot, projectDir, {recursive: true});
    try {
      await use(projectDir);
    } finally {
      await removeDir(projectDir);
    }
  },
  dbName: async ({slug}, use) => {
    const dbName = `sqlfu_ui_${slug.replaceAll(/[^a-z0-9_]/g, '_')}`;
    await runOnAdmin(`drop database if exists "${dbName}" with (force)`);
    await runOnAdmin(`create database "${dbName}"`);
    try {
      await use(dbName);
    } finally {
      await runOnAdmin(`drop database if exists "${dbName}" with (force)`);
    }
  },
  projectUrl: async ({slug, projectDir, dbName}, use) => {
    void projectDir;
    void dbName;
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

async function runOnAdmin(sql: string) {
  const client = new Client({connectionString: ADMIN_URL});
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

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

  if (!slug) throw new Error(`Could not derive slug from test title: ${value}`);
  return slug;
}

function removeDir(dir: string) {
  return fs.rm(dir, {recursive: true, force: true, maxRetries: 10, retryDelay: 50});
}
