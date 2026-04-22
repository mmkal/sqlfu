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

import tseslint from 'typescript-eslint'

import sqlfu from './scripts/dogfood-lint-plugin.js'

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
  {
    plugins: {
      /** @type {import('eslint').ESLint.Plugin} */
      repolocal: {
        rules: {
          'no-readonly': {
            meta: {
              fixable: 'code',
            },
            create(context) {
              return {
                'TSPropertySignature[readonly=true],TSTypeOperator[operator="readonly"],PropertyDefinition[readonly=true]': node => {
                  context.report({
                    message: "Don't use `readonly`",
                    node,
                    fix: fixer => fixer.replaceText(node, context.sourceCode.getText(node).replace(/^readonly /, '')),
                  });
                }
              }
            }
          },
          'no-blunder': {
            meta: {
              docs: {
                description: `The ?? operator (a "blunder" in chess) is almost-always worse than ||. Exceptions are when the left side can legitimately be 0 or ''. But '' is a hack anyway and usually whatever default value is better. For non-primitive types it should make no difference - but || will recover from "whoops i returned '' when i was supposed to return an array" better anyway.`
              },
            },
            create: context => {
              return {
                'LogicalExpression[operator="??"]': node => {
                  context.report({
                    message: `Use || in most cases instead of ??. If you are SURE ?? is ACTUALLY BETTER, fine. Add an eslint-disable.`,
                    node,
                    suggest: [
                      {
                        desc: 'Use || instead of ??',
                        fix: fixer => {
                          const text = context.sourceCode.getText(node)
                          const parts = text.split('??')
                          if (parts.length !== 2) return
                          fixer.replaceText(node, parts.join(' || '))
                        }
                      },
                    ]
                  })
                }
              }
            }
          }
        }
      }
    }
  },
  {
    rules: {
      'repolocal/no-readonly': 'error',
      // 'repolocal/no-blunder': 'error', // fine we can leave this for now
    }
  },
  ...sqlfu.configs.recommended,
]
