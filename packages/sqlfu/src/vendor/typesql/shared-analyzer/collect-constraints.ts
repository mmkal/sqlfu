import type { ColumnSchema, ColumnDef, TypeVar, Type, Constraint, SubstitutionHash, TypeAndNullInfer } from './types.js';
import type { MySqlType, InferType } from '../mysql-mapping.js';
import { unify } from './unify.js';
import {isIsoDateLiteral, isIsoDateTimeLiteral, isIsoTimeLiteral} from '../../small-utils.js';

let counter = 0;
export function freshVar(name: string, typeVar: InferType, table?: string, list?: true): TypeVar {
	const param: TypeVar = {
		kind: 'TypeVar',
		id: (++counter).toString(),
		name,
		type: typeVar,
		table
	};
	if (list) {
		param.list = true;
	}
	return param;
}

export function createColumnType(col: ColumnDef) {
	const columnType: TypeVar = {
		kind: 'TypeVar',
		id: (++counter).toString(),
		name: col.columnName,
		type: col.columnType.type,
		table: col.tableAlias || col.table
	};
	return columnType;
}

export function createColumnTypeFomColumnSchema(col: ColumnSchema) {
	const columnType: TypeVar = {
		kind: 'TypeVar',
		id: col.column,
		name: col.column,
		type: col.column_type,
		table: col.table
	};
	return columnType;
}

export function generateTypeInfo(namedNodes: TypeAndNullInfer[], constraints: Constraint[]): InferType[] {
	const substitutions: SubstitutionHash = {};
	unify(constraints, substitutions);

	const parameters = namedNodes.map((param) => getVarType(substitutions, param.type));
	return parameters;
}

export function getVarType(substitutions: SubstitutionHash, typeVar: Type): InferType {
	if (typeVar.kind === 'TypeVar') {
		const subs = substitutions[typeVar.id];
		if (subs) {
			if (subs.id !== typeVar.id) {
				return getVarType(substitutions, subs);
			}
			const resultType = subs.list || typeVar.list ? `${subs.type}[]` : subs.type;
			return resultType as MySqlType;
		}
		const resultType = typeVar.list ? `${typeVar.type}[]` : typeVar.type;
		return resultType as MySqlType;
	}
	return '?';
}

export function verifyDateTypesCoercion(type: Type) {
	if (type.kind === 'TypeVar' && isDateTimeLiteral(type.name)) {
		type.type = 'datetime';
	}
	if (type.kind === 'TypeVar' && isDateLiteral(type.name)) {
		type.type = 'date';
	}
	if (type.kind === 'TypeVar' && isTimeLiteral(type.name)) {
		type.type = 'time';
	}
	return type;
}

export function isTimeLiteral(literal: string) {
	return isIsoTimeLiteral(literal);
}

export function isDateTimeLiteral(literal: string) {
	return isIsoDateTimeLiteral(literal);
}

export function isDateLiteral(literal: string) {
	return isIsoDateLiteral(literal);
}

export type VariableLengthParams = {
	kind: 'VariableLengthParams';
	paramType: InferType;
};

export type FixedLengthParams = {
	kind: 'FixedLengthParams';
	paramsType: TypeVar[];
};

export type FunctionParams = VariableLengthParams | FixedLengthParams;
