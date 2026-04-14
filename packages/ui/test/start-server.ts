import fs from 'node:fs/promises';
import path from 'node:path';
import {Database} from 'bun:sqlite';

import {generateCatalogForProject, startSqlfuUiServer} from '../src/server.ts';

const projectName = Bun.argv[2] ?? 'dev-project';
const resetDb = Bun.argv.includes('--reset-db');
const port = Number(readOption('--port') ?? '3217');
const templateRoot = path.join(import.meta.dir, 'template-project');
const projectsRoot = path.join(import.meta.dir, 'projects');
const projectRoot = path.join(projectsRoot, projectName);
const dbPath = path.join(projectRoot, 'app.db');

await ensureProjectFiles(projectRoot);

await ensureDatabase(projectRoot, {resetDb});
await generateCatalogForProject(projectRoot);

const server = await startSqlfuUiServer({
  port,
  projectRoot,
});

console.log(`sqlfu/ui dev server listening on http://localhost:${server.port}`);
console.log(`project root: ${projectRoot}`);

await new Promise(() => {});

async function ensureProjectFiles(targetRoot: string) {
  await fs.mkdir(projectsRoot, {recursive: true});
  if (resetDb) {
    await fs.rm(targetRoot, {recursive: true, force: true});
  }
  try {
    await fs.access(targetRoot);
    return;
  } catch {}
  await fs.cp(templateRoot, targetRoot, {recursive: true});
}

async function ensureDatabase(
  targetRoot: string,
  input: {
    resetDb: boolean;
  },
) {
  if (input.resetDb) {
    await fs.rm(dbPath, {force: true});
  }

  try {
    await fs.access(dbPath);
    return;
  } catch {}

  const database = new Database(dbPath);
  try {
    const definitionsSql = await fs.readFile(path.join(targetRoot, 'definitions.sql'), 'utf8');
    database.exec(definitionsSql);
    database.exec(`
      insert into posts (slug, title, body, published) values
        ('hello-world', 'Hello World', 'First post body', 1),
        ('draft-notes', 'Draft Notes', 'Unpublished notes', 0);
    `);
  } finally {
    database.close();
  }
}

function readOption(name: string) {
  const index = Bun.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return Bun.argv[index + 1];
}
