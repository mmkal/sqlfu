import { ShimParserRuleContext, ShimSelect_coreContextBase } from '../sqlite-query-analyzer/antlr-shim.js';
import type { ColumnDef, ColumnSchema, FieldName } from './types.js';
import { createColumnTypeFomColumnSchema } from './collect-constraints.js';

export function includeColumn(column: ColumnDef, table: string) {
	return column.table.toLowerCase() === table.toLowerCase() || column.tableAlias?.toLowerCase() === table.toLowerCase();
}

export function filterColumns(
	dbSchema: ColumnSchema[],
	withSchema: ColumnDef[],
	tableAlias: string | undefined,
	table: FieldName
): ColumnDef[] {
	const schemaName = table.prefix === '' ? dbSchema.find((col) => col.table === table.name)?.schema : table.prefix; //find first
	const tableColumns1 = dbSchema
		.filter((schema) => schema.table.toLowerCase() === table.name.toLowerCase() && schema.schema === schemaName)
		.map((tableColumn) => {
			const r: ColumnDef = {
				columnName: tableColumn.column,
				columnType: createColumnTypeFomColumnSchema(tableColumn),
				notNull: tableColumn.notNull,
				table: table.name,
				tableAlias: tableAlias || '',
				columnKey: tableColumn.columnKey,
				hidden: tableColumn.hidden
			};
			return r;
		});
	const result = tableColumns1.concat(withSchema.filter((schema) => schema.table.toLowerCase() === table.name.toLowerCase())).map((col) => {
		const r: ColumnDef = {
			...col,
			table: table.name,
			tableAlias: tableAlias,
			intrinsicNotNull: col.notNull
		};
		return r;
	});
	return result;
}

export function selectAllColumns(tablePrefix: string, fromColumns: ColumnDef[]) {
	const allColumns: ColumnDef[] = [];
	fromColumns.forEach((column) => {
		if (tablePrefix === '' || tablePrefix === column.tableAlias || tablePrefix === column.table) {
			allColumns.push(column);
		}
	});
	return allColumns;
}

export function splitName(fieldName: string): FieldName {
	const fieldNameSplit = fieldName.split('.');
	const result: FieldName = {
		name: fieldNameSplit.length === 2 ? fieldNameSplit[1] : fieldNameSplit[0],
		prefix: fieldNameSplit.length === 2 ? fieldNameSplit[0] : ''
	};
	return {
		name: removeBackStick(result.name),
		prefix: result.prefix
	};
}

export function splitTableName(fieldName: string): FieldName {
	const tableNameSplit = fieldName.split('.');
	const result: FieldName = {
		name: tableNameSplit.length === 2 ? tableNameSplit[1] : '*',
		prefix: tableNameSplit[0]
	};
	return {
		name: removeBackStick(result.name),
		prefix: result.prefix
	};
}

function removeBackStick(name: string) {
	return name.startsWith('`') && name.endsWith('`') ? name.slice(1, -1) : name;
}

export const functionAlias: ColumnSchema[] = [
	{ column: 'CURRENT_DATE',      column_type: 'date',      columnKey: '', notNull: true, schema: '', table: '', hidden: 0 },
	{ column: 'CURRENT_TIME',      column_type: 'time',      columnKey: '', notNull: true, schema: '', table: '', hidden: 0 },
	{ column: 'CURRENT_TIMESTAMP', column_type: 'timestamp', columnKey: '', notNull: true, schema: '', table: '', hidden: 0 },
	{ column: 'LOCALTIME',         column_type: 'datetime',  columnKey: '', notNull: true, schema: '', table: '', hidden: 0 },
	{ column: 'LOCALTIMESTAMP',    column_type: 'datetime',  columnKey: '', notNull: true, schema: '', table: '', hidden: 0 },
	{ column: 'MICROSECOND',       column_type: 'bigint',    columnKey: '', notNull: true, schema: '', table: '', hidden: 0 },
	{ column: 'SECOND',            column_type: 'bigint',    columnKey: '', notNull: true, schema: '', table: '', hidden: 0 },
	{ column: 'MINUTE',            column_type: 'bigint',    columnKey: '', notNull: true, schema: '', table: '', hidden: 0 },
	{ column: 'HOUR',              column_type: 'bigint',    columnKey: '', notNull: true, schema: '', table: '', hidden: 0 },
	{ column: 'DAY',               column_type: 'bigint',    columnKey: '', notNull: true, schema: '', table: '', hidden: 0 },
	{ column: 'WEEK',              column_type: 'bigint',    columnKey: '', notNull: true, schema: '', table: '', hidden: 0 },
	{ column: 'MONTH',             column_type: 'bigint',    columnKey: '', notNull: true, schema: '', table: '', hidden: 0 },
	{ column: 'QUARTER',           column_type: 'bigint',    columnKey: '', notNull: true, schema: '', table: '', hidden: 0 },
	{ column: 'YEAR',              column_type: 'year',      columnKey: '', notNull: true, schema: '', table: '', hidden: 0 }
];

export function findColumnSchema(tableName: string, columnName: string, dbSchema: ColumnSchema[]) {
	return dbSchema.find(
		(col) => col.table.toLowerCase() === tableName.toLowerCase() && col.column.toLowerCase() === columnName.toLowerCase()
	);
}

export function findColumn(fieldName: FieldName, columns: ColumnDef[]): ColumnDef {
	const found = findColumnOrNull(fieldName, columns);
	if (!found) {
		throw Error(`no such column: ${formatField(fieldName)}`);
	}
	return found;
}

function formatField(fieldName: FieldName) {
	return fieldName.prefix === '' ? fieldName.name : `${fieldName.prefix}.${fieldName.name}`;
}

export function findColumnOrNull(fieldName: FieldName, columns: ColumnDef[]): ColumnDef | undefined {
	const found = columns.find(
		(col) =>
			col.columnName.toLowerCase() === fieldName.name.toLowerCase() &&
			(fieldName.prefix === '' || fieldName.prefix === col.tableAlias || fieldName.prefix === col.table)
	);
	if (found) {
		return found;
	}

	const functionType = functionAlias.find((col) => col.column.toLowerCase() === fieldName.name.toLowerCase());
	if (functionType) {
		const colDef: ColumnDef = {
			columnName: functionType.column,
			columnType: createColumnTypeFomColumnSchema(functionType),
			columnKey: functionType.columnKey,
			notNull: functionType.notNull,
			table: '',
			hidden: 0
		};
		return colDef;
	}

	return found;
}

type Expr = {
	expr: ShimParserRuleContext;
	isSubQuery: boolean;
};

// sqlfu: upstream also checked `child instanceof SimpleExprSubQueryContext` here
// (MySQL's subquery AST node). After dropping ANTLR entirely (phase 5 of
// `tasks/drop-antlr.md`), `ShimParserRuleContext` is the shared identity for
// every rule-level shim node, and `ShimSelect_coreContextBase` is the
// `Select_coreContext` stand-in for the subquery-depth flag.
export function getExpressions(ctx: ShimParserRuleContext, exprType: any): Expr[] {
	const tokens: Expr[] = [];
	collectExpr(tokens, ctx, exprType);
	return tokens;
}

function collectExpr(tokens: Expr[], parent: ShimParserRuleContext, exprType: any, isSubQuery = false) {
	if (parent instanceof exprType) {
		tokens.push({ expr: parent, isSubQuery });
	}
	const count = (parent as any).getChildCount();
	for (let i = 0; i < count; i++) {
		const child = (parent as any).getChild(i);
		if (child instanceof ShimParserRuleContext) {
			collectExpr(tokens, child, exprType, isSubQuery || child instanceof ShimSelect_coreContextBase);
		}
	}
}
