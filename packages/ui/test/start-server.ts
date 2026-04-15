import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {startSqlfuUiServer} from '../src/server.ts';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(readOption('--port') ?? '3217');
const dev = process.argv.includes('--dev');
const projectsRoot = path.join(currentDir, 'projects');
const templateRoot = path.join(currentDir, 'template-project');

const server = await startSqlfuUiServer({
  port,
  dev,
  projectsRoot,
  templateRoot,
  defaultProjectName: 'dev-project',
});

console.log(`sqlfu/ui dev server listening on http://localhost:${server.port}`);
console.log(`projects root: ${projectsRoot}`);

await new Promise(() => {});

function readOption(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}
