import MySQLParser from '../../typesql-parser/mysql/index.js'
import { TerminalNode, ParseTree, ParserRuleContext } from '../../typesql-parser/index.js';
import {
	type QueryContext,
	QuerySpecificationContext,
	type SelectStatementContext,
	type SubqueryContext,
	type QueryExpressionBodyContext,
	type InsertQueryExpressionContext,
	type SelectItemContext,
	SumExprContext,
	SimpleExprWindowingFunctionContext,
	WindowingClauseContext,
	FunctionCallContext
} from '../../typesql-parser/mysql/MySQLParser.js';
import { getVarType } from './collect-constraints.js';
import type {
	ColumnSchema,
	TypeInferenceResult,
	QueryInfoResult,
	InsertInfoResult,
	UpdateInfoResult,
	DeleteInfoResult,
	ParameterInfo,
	ColumnInfo,
	ColumnDef,
	SubstitutionHash
} from './types.js';
import { inferParamNullabilityQuery } from './infer-param-nullability.js';
import { hasAnnotation, preprocessSql, verifyNotInferred } from '../describe-query.js';
import { verifyMultipleResult } from './verify-multiple-result.js';
import { unify } from './unify.js';
import { type SelectStatementResult, traverseQueryContext } from './traverse.js';
import type { ParameterDef } from '../types.js';
import { generateNestedInfo } from '../describe-nested-query.js';
import { describeDynamicQuery } from '../describe-dynamic-query.js';
import { SqlMode } from '../../typesql-parser/mysql/common.js';

const parser = new MySQLParser({
	version: '8.0.17',
	mode: SqlMode.NoMode
});

export function parse(sql: string): QueryContext {
	const parseResult = parser.parse(sql);
	return parseResult.tree as QueryContext;
}

//TODO - withSchema DEFAULT VALUE []
export function parseAndInfer(sql: string, dbSchema: ColumnSchema[]): TypeInferenceResult {
	const result = extractQueryInfo(sql, dbSchema);
	if (result.kind === 'Select') {
		return {
			columns: result.columns.map((p) => p.type),
			parameters: result.parameters.map((p) => p.type)
		};
	}
	if (result.kind === 'Insert') {
		return {
			columns: [],
			parameters: result.parameters.map((p) => p.columnType)
		};
	}
	if (result.kind === 'Update') {
		return {
			columns: [],
			parameters: result.data.map((p) => p.columnType)
		};
	}
	throw Error(`parseAndInfer: ${sql}`);
}

export function parseAndInferParamNullability(sql: string): boolean[] {
	const queryContext = parse(sql);
	const selectStatement = queryContext.simpleStatement()?.selectStatement()!;
	return inferParamNullabilityQuery(selectStatement);
}

export function extractOrderByParameters(selectStatement: SelectStatementContext) {
	return (
		selectStatement
			.queryExpression()
			?.orderClause()
			?.orderList()
			.orderExpression_list()
			.filter((orderExpr) => orderExpr.getText() === '?')
			.map((orderExpr) => orderExpr.getText()) || []
	);
}

export function extractLimitParameters(selectStatement: SelectStatementContext): ParameterInfo[] {
	return (
		getLimitOptions(selectStatement)
			.filter((limit) => limit.PARAM_MARKER())
			.map(() => {
				const paramInfo: ParameterInfo = {
					type: 'bigint',
					notNull: true
				};
				return paramInfo;
			}) || []
	);
}

export function isMultipleRowResult(selectStatement: SelectStatementContext, fromColumns: ColumnDef[]) {
	const querySpecs = getAllQuerySpecificationsFromSelectStatement(selectStatement);
	if (querySpecs.length === 1) {
		//UNION queries are multipleRowsResult = true
		const fromClause = querySpecs[0].fromClause();
		if (!fromClause) {
			return false;
		}
		if (querySpecs[0].selectItemList().getChildCount() === 1) {
			const selectItem = <SelectItemContext>querySpecs[0].selectItemList().getChild(0);
			//if selectItem = * (TerminalNode) childCount = 0; selectItem.expr() throws exception
			const expr = selectItem.getChildCount() > 0 ? selectItem.expr() : null;
			if (expr) {
				//SUM, MAX... WITHOUT GROUP BY are multipleRowsResult = false
				const groupBy = querySpecs[0].groupByClause();
				if (!groupBy && isSumExpressContext(expr)) {
					return false;
				}
			}
		}
		const joinedTable = fromClause.tableReferenceList()?.tableReference(0).joinedTable_list();
		if (joinedTable && joinedTable.length > 0) {
			return true;
		}

		const whereClauseExpr = querySpecs[0].whereClause()?.expr();
		const isMultipleRowResult = whereClauseExpr && verifyMultipleResult(whereClauseExpr, fromColumns);
		if (isMultipleRowResult === false) {
			return false;
		}
	}

	const limitOptions = getLimitOptions(selectStatement);
	if (limitOptions.length === 1 && limitOptions[0].getText() === '1') {
		return false;
	}
	if (limitOptions.length === 2 && limitOptions[1].getText() === '1') {
		return false;
	}

	return true;
}

export function isSumExpressContext(selectItem: ParseTree) {
	if (selectItem instanceof SimpleExprWindowingFunctionContext || selectItem instanceof TerminalNode) {
		return false;
	}

	if (selectItem instanceof SumExprContext) {
		if (selectItem.children) {
			//any of the children is WindowingClauseContext OVER()
			for (const child of selectItem.children) {
				if (child instanceof WindowingClauseContext) {
					return false;
				}
			}
		}
		return true;
	}
	//https://dev.mysql.com/doc/refman/8.0/en/aggregate-functions.html
	if (selectItem instanceof FunctionCallContext) {
		if (selectItem.qualifiedIdentifier()?.getText().toLowerCase() === 'avg') {
			return true;
		}
	}
	if (selectItem instanceof ParserRuleContext && selectItem.getChildCount() === 1) {
		return isSumExpressContext(selectItem.getChild(0));
	}
	return false;
}

export function getLimitOptions(selectStatement: SelectStatementContext) {
	return selectStatement.queryExpression()?.limitClause()?.limitOptions().limitOption_list() || [];
}

export function extractQueryInfo(
	sql: string,
	dbSchema: ColumnSchema[]
): QueryInfoResult | InsertInfoResult | UpdateInfoResult | DeleteInfoResult {
	const { sql: processedSql, namedParameters } = preprocessSql(sql, 'mysql');
	const paramNames = namedParameters.map(param => param.paramName);
	const gererateNested = hasAnnotation(sql, '@nested');
	const gererateDynamicQuery = hasAnnotation(sql, '@dynamicQuery');
	const tree = parse(processedSql);

	const traverseResult = traverseQueryContext(tree, dbSchema, paramNames);
	if (traverseResult.type === 'Select') {
		const queryInfoResult = extractSelectQueryInfo(traverseResult);
		if (gererateNested) {
			const nestedInfo = generateNestedInfo(tree, dbSchema, queryInfoResult.columns);
			queryInfoResult.nestedResultInfo = nestedInfo;
		}
		if (gererateDynamicQuery) {
			const dynamicQuery = describeDynamicQuery(traverseResult.dynamicSqlInfo, paramNames, queryInfoResult.orderByColumns || []);
			queryInfoResult.dynamicQuery = dynamicQuery;
		}

		return queryInfoResult;
	}
	if (traverseResult.type === 'Insert') {
		const newResult: InsertInfoResult = {
			kind: 'Insert',
			parameters: traverseResult.parameters
		};
		return newResult;
	}
	if (traverseResult.type === 'Update') {
		const substitutions: SubstitutionHash = {}; //TODO - DUPLICADO
		unify(traverseResult.constraints, substitutions);
		const columnResult = traverseResult.data.map((col) => {
			const columnType = getVarType(substitutions, col.type);
			const columnNotNull = col.notNull === true;
			const colInfo: ParameterDef = {
				name: col.name,
				columnType: verifyNotInferred(columnType),
				notNull: columnNotNull
			};
			return colInfo;
		});

		const paramResult = traverseResult.parameters.map((col) => {
			const columnType = getVarType(substitutions, col.type);
			const columnNotNull = col.notNull === true;
			const colInfo: ParameterDef = {
				name: col.name,
				columnType: verifyNotInferred(columnType),
				notNull: columnNotNull
			};
			return colInfo;
		});

		const newResult: UpdateInfoResult = {
			kind: 'Update',
			data: columnResult,
			parameters: paramResult
		};
		return newResult;
	}
	if (traverseResult.type === 'Delete') {
		const newResult: DeleteInfoResult = {
			kind: 'Delete',
			parameters: traverseResult.parameters
		};
		return newResult;
	}
	throw Error('Not supported');
}

function extractSelectQueryInfo(traverseResult: SelectStatementResult): QueryInfoResult {
	const substitutions: SubstitutionHash = {}; //TODO - DUPLICADO
	unify(traverseResult.constraints, substitutions);

	const columnResult = traverseResult.columns.map((col) => {
		const columnType = getVarType(substitutions, col.type);
		const columnNotNull = col.notNull === true;
		const colInfo: ColumnInfo = {
			name: col.name,
			type: verifyNotInferred(columnType),
			notNull: columnNotNull,
			table: col.table
		};
		return colInfo;
	});

	const paramsResult = traverseResult.parameters
		.map((param) => {
			const columnType = getVarType(substitutions, param.type);
			const columnNotNull = param.notNull === true;
			const colInfo: ParameterInfo = {
				// columnName: param.name,
				type: verifyNotInferred(columnType),
				notNull: columnNotNull
			};
			return colInfo;
		})
		.concat(traverseResult.limitParameters);

	const resultWithoutOrderBy: QueryInfoResult = {
		kind: 'Select',
		multipleRowsResult: traverseResult.isMultiRow,
		columns: columnResult,
		parameters: paramsResult
	};
	if (traverseResult.orderByColumns) {
		resultWithoutOrderBy.orderByColumns = traverseResult.orderByColumns;
	}

	return resultWithoutOrderBy;
}

export function getAllQuerySpecificationsFromSelectStatement(
	selectStatement: SelectStatementContext | QueryExpressionBodyContext | InsertQueryExpressionContext | SubqueryContext
) {
	const result: QuerySpecificationContext[] = [];

	collectAllQuerySpecifications(selectStatement, result);
	return result;
}

function collectAllQuerySpecifications(tree: ParserRuleContext, result: QuerySpecificationContext[]) {
	for (let i = 0; i < tree.getChildCount(); i++) {
		const child = tree.getChild(i);
		if (child instanceof QuerySpecificationContext) {
			result.push(child);
		} else if (child instanceof ParserRuleContext) {
			collectAllQuerySpecifications(child, result);
		}
	}
}
