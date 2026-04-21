import {createRequire} from 'node:module';
import path from 'node:path';

/**
 * Lookup result for a locally-installed `@sqlfu/ui`. `root` is the package's
 * install directory (contains `dist/`); `version` is its declared version.
 */
export type ResolvedSqlfuUi = {
  root: string;
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
        'The two must match so the UI speaks the server\'s RPC contract.',
        '',
        `Install the matching version:`,
        '',
        `  npm install @sqlfu/ui@${input.sqlfuVersion}`,
      ].join('\n'),
    );
    this.name = 'SqlfuUiVersionMismatchError';
  }
}

export function resolveSqlfuUi(input: {sqlfuVersion: string}): ResolvedSqlfuUi {
  const require = createRequire(import.meta.url);
  let packageJsonPath: string;
  try {
    packageJsonPath = require.resolve('@sqlfu/ui/package.json');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'MODULE_NOT_FOUND') {
      throw new SqlfuUiNotInstalledError({expectedVersion: input.sqlfuVersion});
    }
    throw error;
  }

  const packageJson = require(packageJsonPath) as {version: string};

  if (packageJson.version !== input.sqlfuVersion) {
    throw new SqlfuUiVersionMismatchError({
      sqlfuVersion: input.sqlfuVersion,
      uiVersion: packageJson.version,
    });
  }

  return {
    root: path.dirname(packageJsonPath),
    version: packageJson.version,
  };
}
