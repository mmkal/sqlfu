/**
 * ESLint config for this repo.
 *
 * Dogfoods the sqlfu lint plugin: all rule wiring lives in
 * `sqlfu.configs.recommended` (inline-SQL rules + `.sql` file processor +
 * test-file override). What we add on top here is repo-specific:
 *
 *   - Ignore globs for build/generated output and fixture files that
 *     intentionally contain malformed SQL.
 *   - A typescript-eslint parser block so ESLint can read our `.ts` / `.tsx`
 *     source. The plugin stays parser-agnostic; configuring one is the user's
 *     choice (typescript-eslint is the overwhelmingly common pick).
 *
 * oxfmt handles formatting; TypeScript handles type errors. No generic lint
 * rules layered on top — lint is scoped to sqlfu-specific checks.
 */

import tseslint from 'typescript-eslint';

import sqlfu from './scripts/dogfood-lint-plugin.js';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/.generated/**',
      '**/.sqlfu/**',
      '**/.typesql/**',
      '**/node_modules/**',
      'packages/sqlfu/src/vendor/**',
      // Fixture files contain intentionally-unformatted SQL (before/after
      // blocks, malformed input) — linting them would fight the fixtures.
      'packages/sqlfu/test/formatter/**',
      'packages/sqlfu/test/schemadiff/fixtures/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {ecmaVersion: 2022, sourceType: 'module'},
    },
  },
  ...sqlfu.configs.recommended,
];
