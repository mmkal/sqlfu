/*
 * Vendored from https://github.com/wsporto/typesql at commit
 * f0356201d41f3f317824968a3f1c7a90fbafdc99 (MIT).
 *
 * Local modifications:
 * - split node/bun sqlite database construction out of query-executor so
 *   browser-safe client analyzers can import schema helpers without node:*.
 */
import { ok, type Result } from '../../small-utils.js';
import type { DatabaseClient, TypeSqlError } from '../types.js';
import type { DatabaseType } from './query-executor.js';

async function loadDatabaseConstructor(): Promise<new (databaseUri: string) => DatabaseType> {
	const runtime = process.env.SQLFU_SQLITE_RUNTIME || ('Bun' in globalThis ? 'bun' : 'node');
	if (runtime === 'bun') {
		const { Database } = await import('bun:sqlite' as any);
		return Database as unknown as new (databaseUri: string) => DatabaseType;
	}

	const { DatabaseSync } = await import('node:sqlite');
	return DatabaseSync as unknown as new (databaseUri: string) => DatabaseType;
}

export async function createSqliteClient(client: 'sqlite' | 'better-sqlite3' | 'bun:sqlite' | 'd1' | 'libsql', databaseUri: string, attachList: string[], loadExtensions: string[]): Promise<Result<DatabaseClient, TypeSqlError>> {
	const DatabaseConstructor = await loadDatabaseConstructor();
	const db = new DatabaseConstructor(databaseUri);
	for (const attach of attachList) {
		db.exec(`attach database ${attach}`);
	}
	for (const extension of loadExtensions) {
		void extension;
	}
	return ok({
		type: client,
		client: db as DatabaseClient['client']
	});
}
