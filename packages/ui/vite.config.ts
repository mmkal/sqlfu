import fs from 'node:fs/promises';
import path from 'node:path';

import {defineConfig, type Plugin, type ResolvedConfig} from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react(), sqlfuPartialFetchBundle()],
  server: {
    allowedHosts: ['.ngrok.app', '.ngrok.dev'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});

function sqlfuPartialFetchBundle(): Plugin {
  let resolvedConfig: ResolvedConfig;

  return {
    name: 'sqlfu-partial-fetch-bundle',
    apply: 'build',
    configResolved(config) {
      resolvedConfig = config;
    },
    async closeBundle() {
      const distDir = path.resolve(resolvedConfig.root, resolvedConfig.build.outDir);
      const files = await listTextAssetFiles(distDir);
      const entries = await Promise.all(
        files.map(async (filePath) => {
          const relativePath = path.relative(distDir, filePath).split(path.sep).join('/');
          return {
            assetPath: `/${relativePath}`,
            contents: await fs.readFile(filePath, 'utf8'),
          };
        }),
      );

      await Promise.all([
        fs.writeFile(path.join(distDir, 'sqlfu-ui-assets.generated.js'), renderAssetsModule(entries)),
        fs.writeFile(path.join(distDir, 'sqlfu-ui-assets.generated.d.ts'), renderAssetsTypes()),
        fs.writeFile(path.join(distDir, 'partial-fetch.js'), renderPartialFetchModule()),
        fs.writeFile(path.join(distDir, 'partial-fetch.d.ts'), renderPartialFetchTypes()),
      ]);
    },
  };
}

async function listTextAssetFiles(dir: string): Promise<string[]> {
  const files = await Array.fromAsync(fs.glob('**/*.{html,js,css}', {cwd: dir}));
  return files
    .filter((filePath) => filePath !== 'partial-fetch.js')
    .filter((filePath) => filePath !== 'sqlfu-ui-assets.generated.js')
    .map((filePath) => path.join(dir, filePath))
    .sort();
}

function renderAssetsModule(entries: Array<{assetPath: string; contents: string}>) {
  const lines = ['export const sqlfuUiAssets = {'];
  for (const entry of entries) {
    lines.push(`  ${JSON.stringify(entry.assetPath)}: ${JSON.stringify(entry.contents)},`);
  }
  lines.push('};');
  return `${lines.join('\n')}\n`;
}

function renderAssetsTypes() {
  return [
    "import type {SqlfuUiAssets} from 'sqlfu/ui/browser';",
    '',
    'export declare const sqlfuUiAssets: SqlfuUiAssets;',
    '',
  ].join('\n');
}

function renderPartialFetchModule() {
  return [
    "import {createSqlfuUiPartialFetch as createPartialFetchWithAssets} from 'sqlfu/ui/browser';",
    "import {sqlfuUiAssets} from './sqlfu-ui-assets.generated.js';",
    '',
    'export {sqlfuUiAssets};',
    '',
    'export function createSqlfuUiPartialFetch(input) {',
    '  return createPartialFetchWithAssets({',
    '    ...input,',
    '    assets: input.assets || sqlfuUiAssets,',
    '  });',
    '}',
    '',
  ].join('\n');
}

function renderPartialFetchTypes() {
  return [
    'import type {',
    '  CreateSqlfuUiPartialFetchInput as BaseCreateSqlfuUiPartialFetchInput,',
    '  SqlfuUiAsset,',
    '  SqlfuUiAssetBody,',
    '  SqlfuUiAssets,',
    '  SqlfuUiPartialFetch,',
    "} from 'sqlfu/ui/browser';",
    '',
    "export type CreateSqlfuUiPartialFetchInput = Omit<BaseCreateSqlfuUiPartialFetchInput, 'assets'> & {",
    '  assets?: SqlfuUiAssets;',
    '};',
    '',
    'export type {SqlfuUiAsset, SqlfuUiAssetBody, SqlfuUiAssets, SqlfuUiPartialFetch};',
    "export {sqlfuUiAssets} from './sqlfu-ui-assets.generated.js';",
    '',
    'export declare function createSqlfuUiPartialFetch(input: CreateSqlfuUiPartialFetchInput): SqlfuUiPartialFetch;',
    '',
  ].join('\n');
}
