import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';

const root = new URL('..', import.meta.url).pathname;

test('root test gate includes every built package that has a package test script', () => {
  const workspace = readJson(join(root, 'package.json'));
  const packagesByName = workspacePackagesByName();
  const buildPackages = filterNamesFrom(workspace.scripts.build);
  const expandedTestScript = expandRootScript(workspace.scripts, 'test', new Set());
  const testedPackages = filterNamesFrom(expandedTestScript);

  const missing = buildPackages.filter((name) => {
    const packageJson = packagesByName.get(name);
    return packageJson && packageJson.scripts && packageJson.scripts.test && !testedPackages.includes(name);
  });

  assert.deepEqual(missing, []);
});

function workspacePackagesByName() {
  const packages = new Map();
  for (const directory of ['packages', 'website']) {
    for (const child of readdirSync(join(root, directory), {withFileTypes: true})) {
      if (!child.isDirectory()) continue;
      const packagePath = join(root, directory, child.name, 'package.json');
      try {
        const packageJson = readJson(packagePath);
        packages.set(packageJson.name, packageJson);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  return packages;
}

function expandRootScript(scripts, name, seen) {
  if (seen.has(name)) return '';
  seen.add(name);

  const command = scripts[name];
  const nested = [];
  for (const match of command.matchAll(/\bpnpm(?: run)?\s+([a-z][\w:-]*)\b/g)) {
    const scriptName = match[1];
    if (scripts[scriptName]) nested.push(expandRootScript(scripts, scriptName, seen));
  }

  return [command, ...nested].join('\n');
}

function filterNamesFrom(command) {
  return Array.from(command.matchAll(/\bpnpm\s+--filter\s+([^\s]+)\s+/g), (match) => match[1]);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
