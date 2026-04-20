// Browser-safe re-export of the vendored TypeSQL client-level analyzer.
//
// Intentionally `.js` (with a sibling `.d.ts`): the main tsconfig has
// `allowJs: false`, so TypeScript resolves consumers against the sibling
// declaration file instead of walking into `src/vendor/typesql/**`. That
// tree has its own looser tsconfig with `noCheck: true`, so pulling it
// into the main typecheck surfaces real errors we don't want to fix at
// the vendored-code layer. Bundlers (Vite, esbuild) follow this `.js`
// file and statically bundle the vendor import — no dynamic-import dance.

export {analyzeSqliteQueriesWithClient as analyzeVendoredTypesqlQueriesWithClient} from '../vendor/typesql/sqlfu.js';
