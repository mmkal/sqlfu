import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {startSqlfuServer} from 'sqlfu/ui';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.join(currentDir, '..');
const port = Number(readOption('--port') ?? '3217');
const dev = process.argv.includes('--dev');
const projectsRoot = path.join(currentDir, 'projects');
const templateRoot = path.join(currentDir, 'template-project');

const server = await startSqlfuServer({
  port,
  dev,
  projectsRoot,
  templateRoot,
  defaultProjectName: 'dev-project',
  allowUnknownHosts: true,
  uiDev: {
    root: uiRoot,
  },
});

console.log(`sqlfu/ui client server listening on http://localhost:${server.port}`);
console.log(`projects root: ${projectsRoot}`);

await new Promise(() => {});

function readOption(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}
