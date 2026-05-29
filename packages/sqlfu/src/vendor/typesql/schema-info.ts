/*
 * Vendored from https://github.com/wsporto/typesql at commit
 * f0356201d41f3f317824968a3f1c7a90fbafdc99 (MIT).
 *
 * Local modifications:
 * - keep file-backed sqlite client creation here
 * - re-export injected-client schema helpers from schema-info-client.ts so
 *   browser-safe analysis can avoid importing node sqlite constructors
 */
import {createSqliteClient} from './sqlite-query-analyzer/sqlite-client.js';
import type {DatabaseClient, TypeSqlDialect, TypeSqlError} from './types.js';
import {type Result, err} from '../small-utils.js';

export type {SchemaInfo} from './schema-info-client.js';
export {closeClient, loadSchemaInfo, loadTableSchema, selectTables} from './schema-info-client.js';

export async function createClient(databaseUri: string, dialect: TypeSqlDialect, attach?: string[], loadExtensions?: string[]): Promise<Result<DatabaseClient, TypeSqlError>> {
	switch (dialect) {
		case 'sqlite':
		case 'better-sqlite3':
		case 'bun:sqlite':
		case 'd1':
		case 'libsql':
			return createSqliteClient(dialect, databaseUri, attach || [], loadExtensions || []);
		case 'mysql2':
		case 'pg':
			return err({
				name: 'Unsupported dialect',
				description: `Vendored TypeSQL is sqlite-only in sqlfu for now: ${dialect}`,
			});
	}
}
