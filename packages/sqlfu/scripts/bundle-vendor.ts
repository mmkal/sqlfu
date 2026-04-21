import * as esbuild from 'esbuild';
import {readdir, rm} from 'node:fs/promises';
import {resolve} from 'node:path';

const pkgRoot = resolve(import.meta.dirname, '..');
const distVendor = resolve(pkgRoot, 'dist/vendor');

// ------------------------------------------------------------------
// vendor/typesql bundle
// ------------------------------------------------------------------
// The sqlite path is the only consumer of vendored typesql; it imports
// `analyzeSqliteQueriesWithClient` from vendor/typesql/sqlfu.ts and goes from
// there. The esbuild pass below bundles that entry into a single file so the
// sqlite parser + our shared-analyzer helpers ship as one minified module.
//
// Previously there was a `gut-antlr-parsers` plugin here that rewrote the
// vendored MySQL parser at bundle time to strip its parse-table data. That
// plugin (and the entire typesql-parser/mysql + typesql/mysql-query-analyzer
// subtrees) were deleted once the sqlite analyzer was untangled from MySQL's
// AST — see tasks/slim-package.md for the history.
await esbuild.build({
	entryPoints: [resolve(pkgRoot, 'src/vendor/typesql/sqlfu.ts')],
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node20',
	outfile: resolve(distVendor, 'typesql/sqlfu.js'),
	treeShaking: true,
	minify: true,
	legalComments: 'inline',
	external: [
		'bun:sqlite',
		'better-sqlite3',
		'libsql',
		'@libsql/client',
		'@sqlite.org/sqlite-wasm',
		'node:*',
	],
	logLevel: 'warning',
});

const typesqlToDelete = [
	'code-block-writer',
	// `sqlfu-sqlite-parser` is compiled by `build:vendor-typesql` into the
	// parser's per-file dist output, but the esbuild pass above inlines all
	// of it into `typesql/sqlfu.js` — so we drop the unbundled copies.
	'sqlfu-sqlite-parser',
	'small-utils.js',
	'small-utils.js.map',
	'small-utils.d.ts',
	'small-utils.d.ts.map',
	'typesql/cli.js',
	'typesql/cli.js.map',
	'typesql/codegen',
	'typesql/describe-dynamic-query.js',
	'typesql/describe-dynamic-query.js.map',
	'typesql/describe-nested-query.js',
	'typesql/describe-nested-query.js.map',
	'typesql/describe-query.js',
	'typesql/describe-query.js.map',
	'typesql/drivers',
	'typesql/dialects',
	'typesql/load-config.js',
	'typesql/load-config.js.map',
	'typesql/mysql-mapping.js',
	'typesql/mysql-mapping.js.map',
	'typesql/shared-analyzer',
	'typesql/schema-info.js',
	'typesql/schema-info.js.map',
	'typesql/sql-generator.js',
	'typesql/sql-generator.js.map',
	'typesql/sqlfu.js.map',
	'typesql/sqlite-query-analyzer',
	'typesql/ts-dynamic-query-descriptor.js',
	'typesql/ts-dynamic-query-descriptor.js.map',
	'typesql/ts-nested-descriptor.js',
	'typesql/ts-nested-descriptor.js.map',
	'typesql/types.js',
	'typesql/types.js.map',
	'typesql/util.js',
	'typesql/util.js.map',
	'typesql/utility-types.js',
	'typesql/utility-types.js.map',
];

for (const p of typesqlToDelete) {
	await rm(resolve(distVendor, p), {recursive: true, force: true});
}

// ------------------------------------------------------------------
// vendor/sql-formatter bundle
// ------------------------------------------------------------------
// Upstream sql-formatter ships 20 dialects (~1.3 MB of keyword/function data).
// sqlfu is sqlite-only, so src/formatter.ts calls `formatDialect` directly with
// the sqlite dialect and imports nothing from `allDialects`. Bundling
// vendor/sql-formatter/sqlFormatter.ts lets esbuild tree-shake every non-sqlite
// dialect module.
//
// Nothing outside vendor/sql-formatter imports sub-paths from this subtree
// (only src/formatter.ts, which imports sqlFormatter.ts and the sqlite dialect
// module). We preserve those two export paths, then delete the rest of the
// subtree.
// Rewrite `allDialects.ts` at bundle time to only export `sqlite`. Upstream's
// sqlFormatter.ts uses `import * as allDialects` to build a name→dialect lookup
// for its `format(query, {language})` entry; that namespace import drags every
// dialect (~1.3 MB of keyword/function data) into the bundle. src/formatter.ts
// calls `formatDialect` directly with the sqlite dialect, never `format`, so
// dropping the other dialects from the namespace has no runtime effect.
const sqliteOnlyDialectsPlugin: esbuild.Plugin = {
	name: 'sqlite-only-dialects',
	setup(build) {
		build.onLoad({filter: /vendor\/sql-formatter\/allDialects\.ts$/}, () => ({
			contents: `export { sqlite } from './languages/sqlite/sqlite.formatter.js';`,
			loader: 'ts',
		}));
	},
};

// Use a stdin entry that re-exports only `formatDialect` from sqlFormatter.ts.
// Combined with the plugin above this gives esbuild enough to drop upstream's
// `format` function, the `supportedDialects` list, and every non-sqlite
// dialect module.
await esbuild.build({
	stdin: {
		contents: `export { formatDialect } from './sqlFormatter.js';`,
		resolveDir: resolve(pkgRoot, 'src/vendor/sql-formatter'),
		sourcefile: 'sqlFormatter-entry.ts',
		loader: 'ts',
	},
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node20',
	outfile: resolve(distVendor, 'sql-formatter/sqlFormatter.js'),
	treeShaking: true,
	minify: true,
	legalComments: 'inline',
	external: ['node:*'],
	plugins: [sqliteOnlyDialectsPlugin],
	logLevel: 'warning',
});

await esbuild.build({
	entryPoints: [resolve(pkgRoot, 'src/vendor/sql-formatter/languages/sqlite/sqlite.formatter.ts')],
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node20',
	outfile: resolve(distVendor, 'sql-formatter/languages/sqlite/sqlite.formatter.js'),
	treeShaking: true,
	minify: true,
	legalComments: 'inline',
	external: ['node:*'],
	logLevel: 'warning',
});

const sqlFormatterToDelete = [
	'sql-formatter/allDialects.js',
	'sql-formatter/allDialects.js.map',
	'sql-formatter/dialect.js',
	'sql-formatter/dialect.js.map',
	'sql-formatter/expandPhrases.js',
	'sql-formatter/expandPhrases.js.map',
	'sql-formatter/FormatOptions.js',
	'sql-formatter/FormatOptions.js.map',
	'sql-formatter/index.js',
	'sql-formatter/index.js.map',
	'sql-formatter/sqlFormatter.js.map',
	'sql-formatter/utils.js',
	'sql-formatter/utils.js.map',
	'sql-formatter/validateConfig.js',
	'sql-formatter/validateConfig.js.map',
	'sql-formatter/formatter',
	'sql-formatter/lexer',
	'sql-formatter/parser',
];

for (const p of sqlFormatterToDelete) {
	await rm(resolve(distVendor, p), {recursive: true, force: true});
}

const dialectsDir = resolve(distVendor, 'sql-formatter/languages');
for (const entry of await readdir(dialectsDir)) {
	if (entry === 'sqlite') continue;
	await rm(resolve(dialectsDir, entry), {recursive: true, force: true});
}
const sqliteDir = resolve(dialectsDir, 'sqlite');
for (const entry of await readdir(sqliteDir)) {
	if (entry === 'sqlite.formatter.js') continue;
	await rm(resolve(sqliteDir, entry), {recursive: true, force: true});
}
