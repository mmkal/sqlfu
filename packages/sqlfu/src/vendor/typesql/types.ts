// Local sqlfu divergence: upstream does `import type {DatabaseSync} from 'node:sqlite'`,
// but that module specifier fails ESM link on Node < 22 even though the import is type-only
// (tsx preserves the module reference for some paths). Since DatabaseSync is only used as the
// client field on a few dialect types (never constructed here), replacing with `unknown` is
// equivalent for the purposes of this file.
type DatabaseSync = unknown;

import type { DbType, MySqlType } from './mysql-mapping.js';
import type { Brand } from './utility-types.js';
import type { ColumnInfo, ColumnSchema, DynamicSqlInfoResult, DynamicSqlInfoResult2 } from './shared-analyzer/types.js';
import type { NestedResultInfo } from './describe-nested-query.js';
import type { RelationInfo2 } from './sqlite-query-analyzer/sqlite-describe-nested-query.js';

export type DBSchema = {
	columns: ColumnSchema[];
};

export type CrudQueryType = 'Select' | 'Insert' | 'Update' | 'Delete';
export type QueryType = CrudQueryType | 'Copy';

export type SchemaDef = {
	sql: string;
	queryType: QueryType;
	multipleRowsResult: boolean;
	returning?: true;
	columns: ColumnInfo[]; //TODO - ColumnDef and ParamterDef should be the same
	orderByColumns?: string[];
	parameters: ParameterDef[];
	data?: ParameterDef[];
	nestedResultInfo?: NestedResultInfo;
	dynamicSqlQuery?: DynamicSqlInfoResult;
	dynamicSqlQuery2?: DynamicSqlInfoResult2;
	nestedInfo?: RelationInfo2[];
};

export type FieldNullability = {
	name: string;
	notNull: boolean;
};

export type ColumnDef2 = {
	table: string;
	column: string;
	columnName: string;
	tableAlias?: string;
	notNull: boolean;
};

export type ParameterDef = {
	name: string;
	columnType: DbType;
	notNull: boolean;
	list?: boolean; //id in (?)
};

export type ParameterNameAndPosition = {
	name: string;
	paramPosition: number;
};

export type FunctionParamContext = {
	type: 'function';
	functionName: string;
	notNull: boolean;
};
export type ExpressionParamContext = {
	type: 'expression';
	expression: string;
	notNull: boolean;
	from?: string;
	list?: boolean;
};

export type ExpressionCompareParamContext = {
	type: 'expressionCompare';
	expressionLeft: string;
	expressionRight: string;
	notNull: boolean;
	from?: string;
	list?: boolean;
};

export type ResolvedParameter = {
	type: 'resolved';
	notNull: boolean;
	columnType: MySqlType | '?';
};

export type ParameterContext = ExpressionParamContext | FunctionParamContext | ResolvedParameter | ExpressionCompareParamContext;

export type FieldDescriptor = {
	name: string;
	column: string;
	columnType: MySqlType;
	notNull: boolean;
};

export type TsFieldDescriptor = {
	name: string;
	tsType: string;
	notNull: boolean;
	optional?: boolean;
};

export type TsParameterDescriptor = TsFieldDescriptor & {
	toDriver: string;
	isArray: boolean;
};

export type TypeSqlError = {
	name: string;
	description: string;
};

export type PreprocessedSql = {
	sql: string;
	namedParameters: NamedParamInfo[];
};

export type NamedParamInfo = { paramName: string; paramNumber: number };
export type NamedParamWithType = NamedParamInfo & { typeOid: number };

export type CamelCaseName = Brand<string, 'CamelCase'>;

export type DatabaseClient = MySqlDialect | NativeSqliteDialect | SQLiteDialect | LibSqlClient | BunDialect | D1Dialect | PgDielect;

export type TypeSqlDialect = DatabaseClient['type'];

export type SQLiteClient = NativeSqliteDialect['type'] | SQLiteDialect['type'] | LibSqlClient['type'] | BunDialect['type'] | D1Dialect['type'];
export type MySqlClient = MySqlDialect['type'];

export type MySqlDialect = {
	type: 'mysql2';
	client: unknown;
	databaseVersion: string;
	schema: string;
	isVersion8: boolean;
};

export type NativeSqliteDialect = {
	type: 'sqlite';
	client: DatabaseSync;
};

export type SQLiteDialect = {
	type: 'better-sqlite3';
	client: DatabaseSync;
};

export type BunDialect = {
	type: 'bun:sqlite';
	client: DatabaseSync;
};

export type LibSqlClient = {
	type: 'libsql';
	client: DatabaseSync;
};

export type D1Dialect = {
	type: 'd1';
	client: DatabaseSync;
};

export type PgDielect = {
	type: 'pg',
	client: unknown
}

export type TypeSqlConfig = {
	databaseUri: string;
	sqlDir: string;
	outDir?: string;
	client: TypeSqlDialect;
	authToken?: string;
	attach?: string[];
	loadExtensions?: string[];
	includeCrudTables: string[];
	moduleExtension?: 'js' | 'ts';
	/**
	 * Optional list of schemas to include during introspection.
	 * Defaults to ['public'] if not specified.
	 */
	schemas?: string[];
};

export type SqlGenOption = 'select' | 's' | 'insert' | 'i' | 'update' | 'u' | 'delete' | 'd';
