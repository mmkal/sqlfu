// sqlfu: trimmed to just the result types + `getOrderByColumns` that the
// sqlite path actually consumes. Upstream typesql's full MySQL traverse
// implementation (~2350 lines walking MySQL AST nodes) lived here; it was
// dead code for sqlite-only sqlfu.
import type { ColumnDef, Constraint, TypeAndNullInfer, TypeAndNullInferParam, DynamicSqlInfo2 } from './types.js';
import type { Relation2 } from '../sqlite-query-analyzer/sqlite-describe-nested-query.js';

export type QuerySpecificationResult = {
	columns: TypeAndNullInfer[];
	fromColumns: ColumnDef[];
};

export type TraverseResult2 = SelectResult | InsertResult | UpdateResult | DeleteResult | DdlResult;

// sqlfu divergence: upstream typesql throws on DDL / connection-control statements
// from `traverse_Sql_stmtContext`. We recognize them and return an empty descriptor so
// sqlfu can emit a trivial `client.run(sql)` wrapper without a regex pre-filter upstream.
export type DdlResult = {
	queryType: 'Ddl';
	constraints: Constraint[];
	parameters: TypeAndNullInferParam[];
	returningColumns: TypeAndNullInfer[];
};

export type SelectResult = {
	queryType: 'Select';
	constraints: Constraint[];
	parameters: TypeAndNullInferParam[];
	columns: TypeAndNullInfer[];
	multipleRowsResult: boolean;
	orderByColumns?: string[];
	relations: Relation2[];
	dynamicQueryInfo: DynamicSqlInfo2;
};
export type InsertResult = {
	queryType: 'Insert';
	constraints: Constraint[];
	parameters: TypeAndNullInferParam[];
	columns: TypeAndNullInfer[];
	returing: boolean;
};
export type UpdateResult = {
	queryType: 'Update';
	parameters: TypeAndNullInferParam[];
	constraints: Constraint[];
	columns: TypeAndNullInfer[];
	whereParams: TypeAndNullInferParam[];
	returningColumns: TypeAndNullInfer[];
	returing: boolean;
};
export type DeleteResult = {
	constraints: Constraint[];
	queryType: 'Delete';
	parameters: TypeAndNullInferParam[];
	returningColumns: TypeAndNullInfer[];
	returing: boolean;
};

export function getOrderByColumns(fromColumns: ColumnDef[], selectColumns: TypeAndNullInfer[]): string[] {
	const orderByColumns: string[] = [];
	fromColumns.forEach((col) => {
		const ambiguous = isAmbiguous(fromColumns, col.columnName);
		if (!ambiguous) {
			const exists = orderByColumns.find((orderBy) => orderBy === col.columnName);
			if (!exists) {
				orderByColumns.push(col.columnName);
			}
		}
		if (col.tableAlias && col.table) {
			orderByColumns.push(`${col.tableAlias}.${col.columnName}`);
		} else if (col.table) {
			orderByColumns.push(`${col.table}.${col.columnName}`);
		}
	});
	selectColumns.forEach((col) => {
		const duplicated = selectColumns.filter((orderBy) => orderBy.name === col.name);
		if (duplicated.length <= 1) {
			const exists = orderByColumns.find((orderBy) => orderBy === col.name);
			if (!exists) {
				orderByColumns.push(col.name);
			}
		}
	});

	return orderByColumns;
}

function isAmbiguous(columns: ColumnDef[], columnName: string) {
	return columns.filter((col) => col.columnName === columnName).length > 1;
}
