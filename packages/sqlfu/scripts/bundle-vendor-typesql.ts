import * as esbuild from 'esbuild';
import {rm} from 'node:fs/promises';
import {resolve} from 'node:path';

const pkgRoot = resolve(import.meta.dirname, '..');
const distVendor = resolve(pkgRoot, 'dist/vendor');

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

const toDelete = [
	'typesql-parser',
	'antlr4',
	'code-block-writer',
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
	'typesql/mysql-query-analyzer',
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

for (const p of toDelete) {
	await rm(resolve(distVendor, p), {recursive: true, force: true});
}
