import { ColumnSchema, Table } from './shared-analyzer/types.js';
import { createSqliteClient, ForeignKeyInfo, loadDbSchema, selectSqliteTablesFromSchema } from './sqlite-query-analyzer/query-executor.js';
import { DatabaseClient, SQLiteClient, TypeSqlDialect, TypeSqlError } from './types.js';
import {Either, Result, err, ok, right} from '../small-utils.js';


export type SchemaInfo = {
	kind: SQLiteClient;
	columns: ColumnSchema[];
}

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

export async function loadSchemaInfo(databaseClient: DatabaseClient, _schemas?: string[]): Promise<Result<SchemaInfo, TypeSqlError>> {
	switch (databaseClient.type) {
		case 'sqlite':
		case 'better-sqlite3':
		case 'libsql':
		case 'bun:sqlite':
		case 'd1': {
			const columns = loadDbSchema(databaseClient.client);
			return columns.isErr()
				? err(columns.error)
				: ok({kind: databaseClient.type, columns: columns.value} satisfies SchemaInfo);
		}
		case 'mysql2':
		case 'pg':
			return err({
				name: 'Unsupported dialect',
				description: `Vendored TypeSQL is sqlite-only in sqlfu for now: ${databaseClient.type}`,
			});
	}
}

export async function loadTableSchema(databaseClient: DatabaseClient, _tableName: string): Promise<Result<ColumnSchema[], TypeSqlError>> {
	switch (databaseClient.type) {
		case 'sqlite':
		case 'better-sqlite3':
		case 'libsql':
		case 'bun:sqlite':
		case 'd1':
			return loadDbSchema(databaseClient.client);
		case 'mysql2':
		case 'pg':
			return err({
				name: 'Unsupported dialect',
				description: `Vendored TypeSQL is sqlite-only in sqlfu for now: ${databaseClient.type}`,
			});
	}
}

export async function closeClient(db: DatabaseClient) {
	switch (db.type) {
		case 'sqlite':
			db.client.close();
			return;
		case 'better-sqlite3':
			db.client.close();
			return;
		case 'libsql':
			db.client.close();
			return;
		case 'bun:sqlite':
			db.client.close();
			return;
		case 'd1':
			db.client.close();
			return;
		case 'mysql2':
		case 'pg':
			return;
	}
}


export async function selectTables(databaseClient: DatabaseClient): Promise<Either<TypeSqlError, Table[]>> {
	switch (databaseClient.type) {
		case 'sqlite':
		case 'better-sqlite3':
		case 'libsql':
		case 'bun:sqlite':
		case 'd1':
			return selectSqliteTablesFromSchema(databaseClient.client);
		case 'mysql2':
		case 'pg':
			return right([])
	}
}
