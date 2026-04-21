// sqlfu: rewritten for phase 3 of tasks/drop-antlr.md.
//
// Was: parsed CREATE TABLE SQL via ANTLR, then walked the ANTLR AST to
// extract CHECK (col IN ('a', 'b')) enum constraints.
//
// Now: parses CREATE TABLE SQL via the hand-rolled sqlfu-sqlite-parser's
// `ddl_stmt.ts`, then walks the plain-data AST to find the same patterns.
// No ANTLR shim here — enum-parser only reads CREATE TABLE shape, which we
// can surface with a plain-data API.

import {parseCreateTableStmts, type ParsedCreateTableStmt, type ParsedColumnDef} from '../../sqlfu-sqlite-parser/ddl_stmt.js';
import type {ParsedExpr} from '../../sqlfu-sqlite-parser/select_stmt.js';
import {EnumColumnMap, EnumMap, EnumType} from './types.js';

export function enumParser(createStmts: string): EnumMap {
	const enumMap: EnumMap = {};
	let stmts: ParsedCreateTableStmt[];
	try {
		stmts = parseCreateTableStmts(createStmts);
	} catch {
		// Upstream behaviour: if the input contains non-CREATE-TABLE noise and
		// we can't parse it, fall back to "no enums detected". The DDL parser
		// already tolerates non-CREATE-TABLE top-level statements, so reaching
		// here implies something more broken — log nothing and move on.
		return enumMap;
	}
	for (const stmt of stmts) {
		collect_enum_create_table_stmt(stmt, enumMap);
	}
	return enumMap;
}

function collect_enum_create_table_stmt(create_table_stmt: ParsedCreateTableStmt, enumMap: EnumMap) {
	const table_name = create_table_stmt.table;
	const enumColumnMap: EnumColumnMap = {};
	for (const column_def of create_table_stmt.columns) {
		const enum_column = enum_column_def(column_def);
		if (enum_column) enumColumnMap[column_def.name] = enum_column;
	}
	enumMap[table_name] = enumColumnMap;
}

function enum_column_def(column_def: ParsedColumnDef): EnumType | null {
	for (const constraint of column_def.constraints) {
		if (constraint.check && constraint.expr) {
			const enum_type = enum_from_check_expr(constraint.expr);
			if (enum_type) return enum_type;
		}
	}
	return null;
}

function enum_from_check_expr(expr: ParsedExpr): EnumType | null {
	if (expr.kind !== 'InList') return null;
	if (expr.items.length === 0) return null;
	// All items must be string literals for this to be an enum.
	const strs: string[] = [];
	for (const item of expr.items) {
		if (item.kind !== 'StringLiteral') return null;
		strs.push(item.value);
	}
	return `ENUM(${strs.join(',')})`;
}
