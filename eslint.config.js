/**
 * ESLint config for this repo. Exists ONLY to lint standalone `.sql` files
 * via sqlfu's `sql-file` processor — oxlint (used for TS/JS) doesn't support
 * custom processors yet (known limitation of the jsPlugins alpha as of March
 * 2026: https://oxc.rs/docs/guide/usage/linter/js-plugins.html).
 *
 * TS/JS files are linted by oxlint via `.oxlintrc.json`; this config should
 * not duplicate those rules. If oxlint ships processor support later, we can
 * fold everything back into one tool and delete this file.
 */

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
  ...sqlfu.configs.sqlFiles,
];
