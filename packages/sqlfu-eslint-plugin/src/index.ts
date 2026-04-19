import type {ESLint, Linter} from 'eslint';

import noUnnamedInlineSql from './rules/no-unnamed-inline-sql.js';

import packageJson from '../package.json' with {type: 'json'};

const rules = {
  'no-unnamed-inline-sql': noUnnamedInlineSql,
};

const plugin: ESLint.Plugin = {
  meta: {
    name: packageJson.name,
    version: packageJson.version,
  },
  rules,
};

/**
 * Flat-config preset that enables every rule in this plugin at `error`.
 *
 *   import sqlfu from '@sqlfu/eslint-plugin'
 *   export default [sqlfu.configs.recommended]
 */
const recommended: Linter.Config = {
  plugins: {sqlfu: plugin},
  rules: {
    'sqlfu/no-unnamed-inline-sql': 'error',
  },
};

const exported: ESLint.Plugin & {configs: {recommended: Linter.Config}} = Object.assign(plugin, {
  configs: {recommended},
});

export default exported;
