/*
 * Vendored from https://github.com/wsporto/typesql at commit
 * f0356201d41f3f317824968a3f1c7a90fbafdc99 (MIT).
 *
 * Local modifications:
 * - route runtime database loading through `SQLFU_SQLITE_RUNTIME` so sqlfu can pick
 *   between bun:sqlite, node:sqlite, and better-sqlite3 at runtime
 * - import Either/Result helpers from sqlfu's vendored `small-utils` instead of neverthrow
 * - ESM-compatible relative import suffixes
 */
import { type Either, Result, err, left, ok, right } from '../../small-utils.js';
import type { DatabaseClient, TypeSqlError } from '../types.js';
import type { ColumnSchema, Table } from '../shared-analyzer/types.js';
import type { EnumColumnMap, EnumMap, SQLiteType } from './types.js';
import { enumParser } from './enum-parser.js';
import { virtualTablesSchema } from './virtual-tables.js';

type DatabaseType = {
	prepare(sql: string): {
		all(...args: unknown[]): unknown[];
	};
	exec(sql: string): void;
	close(): void;
};

async function loadDatabaseConstructor(): Promise<new (databaseUri: string) => DatabaseType> {
	const runtime = process.env.SQLFU_SQLITE_RUNTIME ?? ('Bun' in globalThis ? 'bun' : 'node');
	if (runtime === 'bun') {
		const {Database} = await import('bun:sqlite' as any);
		return Database as unknown as new (databaseUri: string) => DatabaseType;
	}

	// `node:sqlite` landed in Node 22. Fall back to better-sqlite3 on older Node so the vendored
	// typesql analyzer works across every Node version sqlfu supports. sqlfu divergence.
	try {
		const {DatabaseSync} = await import('node:sqlite');
		return DatabaseSync as unknown as new (databaseUri: string) => DatabaseType;
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code !== 'ERR_UNKNOWN_BUILTIN_MODULE') throw error;
		const {default: BetterSqlite3} = (await import('better-sqlite3' as any)) as {
			default: new (databaseUri: string) => DatabaseType;
		};
		return BetterSqlite3;
	}
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

export function loadDbSchema(db: DatabaseType): Result<ColumnSchema[], TypeSqlError> {
	const database_list = db
		//@ts-ignore
		.prepare('select name from pragma_database_list')
		.all()
		.map((col: any) => col.name) as string[];
	const result: ColumnSchema[] = [];
	for (const schema of database_list) {
		const schemaResult = loadDbSchemaForSchema(db, schema);
		if (schemaResult.isErr()) {
			return schemaResult;
		}
		result.push(...schemaResult.value);
	}

	return ok(result.concat(virtualTablesSchema));
}

type TableInfo = {
	name: string;
	type: string;
	notnull: number;
	dflt_value: string;
	pk: number;
	hidden: number;
};

type TableAndType = {
	name: string;
	type: 'T' | 'VT'
}

export function getTableInfo(db: DatabaseType, schema: string, table: string): TableInfo[] {
	const tableInfo = db
		//@ts-ignore
		.prepare(`PRAGMA ${schema}.table_xinfo('${table}')`)
		.all() as TableInfo[];
	return tableInfo;
}

export function getIndexInfo(db: DatabaseType, schema: string, table: string) {
	const map = new Map<string, true>();
	const indexList = db
		//@ts-ignore
		.prepare(`PRAGMA ${schema}.index_list('${table}')`)
		.all() as { name: string; unique: number }[];
	for (const index of indexList) {
		if (index.unique === 1) {
			const indexedColumns = db
				//@ts-ignore
				.prepare(`PRAGMA ${schema}.index_info('${index.name}')`)
				.all()
				.map((res: any) => res.name) as string[];
			for (const column of indexedColumns) {
				map.set(column, true);
			}
		}
	}
	return map;
}

export function getTables(db: DatabaseType, schema: string): TableAndType[] {
	const tables = db
		//@ts-ignore
		.prepare(`SELECT name, rootpage FROM ${schema}.sqlite_schema`)
		.all()
		.map((res: any) => ({ name: res.name, type: getTableType(res.rootpage) }));
	// sqlfu: sqlite's system tables aren't listed in sqlite_schema itself; add them
	// explicitly so the existing PRAGMA table_xinfo path populates their columns.
	if (schema === 'main') {
		tables.push({ name: 'sqlite_schema', type: 'T' }, { name: 'sqlite_master', type: 'T' });
	}
	return tables;
}

function getTableType(rootpage: number | null): TableAndType['type'] {
	return rootpage != null && rootpage !== 0 ? 'T' : 'VT';
}

function checkAffinity(type: string): SQLiteType {
	if (type.includes('INT')) {
		return 'INTEGER';
	}
	if (type.includes('CHAR') || type.includes('CLOB') || type.includes('TEXT')) {
		return 'TEXT';
	}
	if (type === '' || type.includes('BLOB')) {
		return 'BLOB';
	}
	if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB')) {
		return 'REAL';
	}
	return 'NUMERIC';
}

function loadDbSchemaForSchema(db: DatabaseType, schema: '' | string = ''): Result<ColumnSchema[], TypeSqlError> {
	const tables = getTables(db, schema);
	const createTableStmtsResult = loadCreateTableStmtWithCheckConstraint(db);
	if (createTableStmtsResult.isErr()) {
		return err(createTableStmtsResult.error);
	}
	const createTableStmts = createTableStmtsResult.value;
	const enumMap: EnumMap = createTableStmts ? enumParser(createTableStmtsResult.value) : {};

	const result = tables.flatMap(({ name, type }) => {
		const tableInfoList = getTableInfo(db, schema, name);
		const tableIndexInfo = getIndexInfo(db, schema, name);
		const columnSchema = tableInfoList.map((tableInfo) => {
			const isUni = tableIndexInfo.get(tableInfo.name) != null;
			const isVT = type == 'VT';
			const enumColumnMap = enumMap[name] || {};
			const col: ColumnSchema = {
				column: tableInfo.name,
				column_type: checkType(tableInfo.name, tableInfo.type as SQLiteType, isVT, enumColumnMap),
				columnKey: getColumnKey(tableInfo.pk, isUni, isVT),
				notNull: tableInfo.notnull === 1 || tableInfo.pk >= 1 || (isVT && tableInfo.name === 'rank'),
				schema,
				table: name,
				hidden: tableInfo.hidden
			};
			if (tableInfo.dflt_value != null) {
				col.defaultValue = tableInfo.dflt_value;
			}
			return col;
		});
		return columnSchema;
	});
	return ok(result);
}

function checkType(columnName: string, columnType: SQLiteType, isVT: boolean, enumColumnMap: EnumColumnMap): SQLiteType | '?' {
	if (isVT) {
		return columnName === 'rank' ? 'REAL' : '?';
	}
	if (columnType === 'TEXT' && enumColumnMap[columnName] != null) {
		return enumColumnMap[columnName];
	}
	return checkAffinity(columnType);
}

function getColumnKey(pk: number, isUni: boolean, isVT: boolean): ColumnSchema['columnKey'] {
	if (pk >= 1) {
		return 'PRI';
	}
	if (isUni) {
		return 'UNI';
	}
	if (isVT) {
		return 'VT';
	}
	return '';
}

export function selectSqliteTablesFromSchema(db: DatabaseType): Either<TypeSqlError, Table[]> {
	const sql = `
    SELECT 
		'' as schema,
		name as 'table'
	FROM sqlite_schema 
	WHERE type='table' 
	ORDER BY name
    `;

	try {
		//@ts-ignore
		const result = db.prepare(sql).all() as Table[];
		return right(result);
	} catch (e) {
		const err = e as Error;
		return left({
			name: err.name,
			description: err.message
		});
	}
}

export function explainSql(db: DatabaseType, sql: string): Either<TypeSqlError, boolean> {
	try {
		//@ts-ignore
		db.prepare(sql);
		return right(true);
	} catch (err_) {
		const err = err_ as Error;
		return left({
			name: err.name,
			description: err.message
		});
	}
}

export type ForeignKeyInfo = {
	fromTable: string;
	toTable: string;
	fromColumn: string;
	toColumn: string;
}

type CreateTableStatement = {
	sql: string;
}

export function loadForeignKeys(db: DatabaseType): Result<ForeignKeyInfo[], TypeSqlError> {
	const sql = `
    SELECT 
		tab.name as fromTable, 
		fk.'table' as toTable, 
		fk.'from' as fromColumn, 
		fk.'to' as toColumn 
	FROM sqlite_schema tab
	INNER JOIN pragma_foreign_key_list(tab.name) fk
	WHERE type = 'table'`;

	try {
		//@ts-ignore
		const result = db.prepare(sql).all() as ForeignKeyInfo[];
		return ok(result);
	} catch (e) {
		const error = e as Error;
		return err({
			name: error.name,
			description: error.message
		});
	}
}

export function loadCreateTableStmt(db: DatabaseType, tableName: string): Either<TypeSqlError, string> {
	const sql = `
    SELECT 
		sql
	FROM sqlite_schema tab
	WHERE type = 'table' and tbl_name = ?`;

	try {
		//@ts-ignore
		const result = db.prepare(sql).all([tableName]) as CreateTableStatement[];
		return right(result[0].sql);
	} catch (e) {
		const err = e as Error;
		return left({
			name: err.name,
			description: err.message
		});
	}
}

export function loadCreateTableStmtWithCheckConstraint(db: DatabaseType | LibSqlDatabase): Result<string | null, TypeSqlError> {
	const sql = `
    SELECT 
		GROUP_CONCAT(sql, ';') as sql
	FROM sqlite_schema tab
	WHERE type = 'table' and upper(sql) GLOB '*CHECK[ (]*)*'`;

	try {
		//@ts-ignore
		const result = db.prepare(sql).all() as CreateTableStatement[];
		return ok(result[0].sql);
	} catch (e) {
		const error = e as Error;
		return err({
			name: error.name,
			description: error.message
		});
	}
}
