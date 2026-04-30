import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

/**
 * Lookup result for a locally-installed `@sqlfu/ui`. `version` is its declared version.
 */
export type ResolvedSqlfuUi = {
  assets: Record<string, string>;
  version: string;
};

export class SqlfuUiNotInstalledError extends Error {
  constructor(input: {expectedVersion: string}) {
    super(
      [
        '`sqlfu --ui` requires the companion `@sqlfu/ui` package, which is not installed.',
        '',
        `Install it next to sqlfu (versions must match so the UI speaks the server's RPC contract):`,
        '',
        `  npm install @sqlfu/ui@${input.expectedVersion}`,
        '',
        'Then re-run `sqlfu --ui`.',
      ].join('\n'),
    );
    this.name = 'SqlfuUiNotInstalledError';
  }
}

export class SqlfuUiVersionMismatchError extends Error {
  constructor(input: {sqlfuVersion: string; uiVersion: string}) {
    super(
      [
        `\`@sqlfu/ui\` is installed at v${input.uiVersion}, but this sqlfu server is v${input.sqlfuVersion}.`,
        "The two must match so the UI speaks the server's RPC contract.",
        '',
        `Install the matching version:`,
        '',
        `  npm install @sqlfu/ui@${input.sqlfuVersion}`,
      ].join('\n'),
    );
    this.name = 'SqlfuUiVersionMismatchError';
  }
}

export async function resolveSqlfuUi(input: {sqlfuVersion: string}): Promise<ResolvedSqlfuUi> {
  const require = createRequire(import.meta.url);
  const packageName = '@sqlfu/ui';
  let packageJsonPath: string;
  try {
    packageJsonPath = require.resolve(`${packageName}/package.json`);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'MODULE_NOT_FOUND') {
      throw new SqlfuUiNotInstalledError({expectedVersion: input.sqlfuVersion});
    }
    throw error;
  }

  const workspaceBuildEntry = path.join(path.dirname(packageJsonPath), 'dist/lib/index.js');
  const importPath = existsSync(workspaceBuildEntry) ? pathToFileURL(workspaceBuildEntry).href : packageName;
  const {assets, version} = (await import(importPath)) as ResolvedSqlfuUi;

  if (version !== input.sqlfuVersion) {
    throw new SqlfuUiVersionMismatchError({
      sqlfuVersion: input.sqlfuVersion,
      uiVersion: version,
    });
  }

  return {
    assets,
    version,
  };
}
