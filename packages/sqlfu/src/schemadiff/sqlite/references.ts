/*
 * Parser-backed reference extraction for SQLite stored SQL bodies.
 * Keep `sqlite3-parser` behind this module so planner code consumes sqlfu-owned facts.
 */
import {parseStmt} from 'sqlite3-parser';
import type {
  CreateIndexStmt,
  CreateTableStmt,
  CreateTriggerStmt,
  CreateViewStmt,
  Expr,
  FromClause,
  FunctionCallOrder,
  FunctionTail,
  Limit,
  OneSelect,
  QualifiedName,
  ResultColumn,
  Select,
  SelectTable,
  Stmt,
  TriggerCmd,
  UpdateTriggerCmd,
  Window,
} from 'sqlite3-parser';

import {splitTopLevelCommaList, sqlIdentifierTokens} from './sqltext.js';

export type SqliteReferenceFacts = {
  referencedTables: string[];
  referencedColumns: string[];
};

export type SqliteIndexWhereReferenceFacts = {
  referencedColumns: string[];
};

export function viewReferenceFacts(createSql: string): SqliteReferenceFacts {
  const stmt = parseSingleStmt(createSql);
  if (stmt?.type !== 'CreateViewStmt') {
    return fallbackReferenceFacts(createSql);
  }
  return sortedFacts(collectViewReferences(stmt));
}

export function triggerReferenceFacts(createSql: string, subjectName: string): SqliteReferenceFacts {
  const stmt = parseSingleStmt(createSql);
  if (stmt?.type !== 'CreateTriggerStmt') {
    const fallback = fallbackReferenceFacts(createSql);
    return {
      referencedTables: sortedStrings([subjectName, ...fallback.referencedTables]),
      referencedColumns: fallback.referencedColumns,
    };
  }
  return sortedFacts(collectTriggerReferences(stmt, subjectName));
}

export function createTableCheckReferencesDroppedColumns(createSql: string, columnNames: ReadonlySet<string>): boolean {
  const stmt = parseSingleStmt(createSql);
  if (stmt?.type !== 'CreateTableStmt') {
    return fallbackCheckReferencesDroppedColumns(createSql, columnNames);
  }

  const facts = collectCreateTableCheckReferences(stmt);
  return [...columnNames].some((columnName) => facts.referencedColumns.has(normalizeName(columnName)));
}

export function indexWhereReferenceFacts(createSql: string, whereSql: string | null): SqliteIndexWhereReferenceFacts {
  const stmt = parseSingleStmt(createSql);
  if (stmt?.type !== 'CreateIndexStmt') {
    return fallbackIndexWhereReferenceFacts(whereSql);
  }
  return sortedIndexWhereFacts(collectCreateIndexWhereReferences(stmt));
}

export function indexWhereReferencesDroppedColumns(input: {
  createSql: string;
  whereSql: string | null;
  columnNames: ReadonlySet<string>;
}): boolean {
  const facts = indexWhereReferenceFacts(input.createSql, input.whereSql);
  return [...input.columnNames].some((columnName) => facts.referencedColumns.includes(normalizeName(columnName)));
}

function parseSingleStmt(sql: string): Stmt | null {
  const result = parseStmt(sql);
  return result.status === 'ok' ? result.root : null;
}

function collectViewReferences(stmt: CreateViewStmt): MutableReferenceFacts {
  return collectSelect(stmt.select, emptyScope());
}

function collectTriggerReferences(stmt: CreateTriggerStmt, subjectName: string): MutableReferenceFacts {
  const subject = normalizeName(subjectName);
  const facts = mutableFacts();
  facts.referencedTables.add(subject);

  if (stmt.event.type === 'UpdateOfTriggerEvent') {
    for (const column of stmt.event.columns) {
      facts.referencedColumns.add(normalizeName(column.text));
    }
  }

  if (stmt.whenClause) {
    mergeFacts(facts, collectTriggerSubjectExprReferences(stmt.whenClause));
  }

  for (const command of stmt.commands) {
    mergeFacts(facts, collectTriggerCommandReferences(command, subject));
  }

  return facts;
}

function collectTriggerCommandReferences(command: TriggerCmd, subjectName: string): MutableReferenceFacts {
  const facts = mutableFacts();

  if (command.type === 'SelectTriggerCmd') {
    mergeFacts(facts, collectSelect(command.select, emptyScope()));
    mergeFacts(facts, collectTriggerSubjectSelectReferences(command.select));
    return facts;
  }

  if (command.type === 'InsertTriggerCmd') {
    const targetName = normalizeQualifiedObjectName(command.tblName);
    facts.referencedTables.add(targetName);
    if (targetName === subjectName) {
      for (const column of command.colNames || []) {
        facts.referencedColumns.add(normalizeName(column.text));
      }
    }
    mergeFacts(facts, collectSelect(command.select, emptyScope()));
    mergeFacts(facts, collectTriggerSubjectSelectReferences(command.select));
    if (command.upsert?.index?.whereClause) {
      mergeFacts(facts, collectTriggerSubjectExprReferences(command.upsert.index.whereClause));
    }
    if (command.upsert?.doClause.type === 'SetUpsertDo') {
      collectSubjectSetAssignments(facts, command.upsert.doClause.sets, targetName, subjectName);
      if (command.upsert.doClause.whereClause) {
        mergeFacts(facts, collectTriggerSubjectExprReferences(command.upsert.doClause.whereClause));
      }
    }
    return facts;
  }

  if (command.type === 'UpdateTriggerCmd') {
    collectTriggerTargetCommandReferences(facts, command, subjectName);
    return facts;
  }

  const targetName = normalizeQualifiedObjectName(command.tblName);
  facts.referencedTables.add(targetName);
  if (command.whereClause) {
    mergeFacts(facts, collectTriggerSubjectExprReferences(command.whereClause));
  }
  return facts;
}

function collectTriggerTargetCommandReferences(
  facts: MutableReferenceFacts,
  command: UpdateTriggerCmd,
  subjectName: string,
): void {
  const targetName = normalizeQualifiedObjectName(command.tblName);
  facts.referencedTables.add(targetName);
  collectSubjectSetAssignments(facts, command.sets, targetName, subjectName);
  if (command.from) {
    mergeFacts(facts, collectFromClause(command.from, emptyScope()));
  }
  if (command.whereClause) {
    mergeFacts(facts, collectTriggerSubjectExprReferences(command.whereClause));
  }
}

function collectSubjectSetAssignments(
  facts: MutableReferenceFacts,
  assignments: UpdateTriggerCmd['sets'],
  targetName: string,
  subjectName: string,
): void {
  if (targetName === subjectName) {
    for (const assignment of assignments) {
      for (const column of assignment.colNames) {
        facts.referencedColumns.add(normalizeName(column.text));
      }
    }
  }
  for (const assignment of assignments) {
    mergeFacts(facts, collectTriggerSubjectExprReferences(assignment.expr));
  }
}

function collectTriggerSubjectSelectReferences(select: Select): MutableReferenceFacts {
  const facts = mutableFacts();

  if (select.with) {
    for (const cte of select.with.ctes) {
      mergeFacts(facts, collectTriggerSubjectSelectReferences(cte.select));
    }
  }

  collectTriggerSubjectOneSelectReferences(facts, select.select);
  for (const compound of select.compounds || []) {
    collectTriggerSubjectOneSelectReferences(facts, compound.select);
  }
  for (const sortedColumn of select.orderBy || []) {
    mergeFacts(facts, collectTriggerSubjectExprReferences(sortedColumn.expr));
  }
  if (select.limit) {
    mergeFacts(facts, collectTriggerSubjectLimitReferences(select.limit));
  }

  return facts;
}

function collectTriggerSubjectOneSelectReferences(facts: MutableReferenceFacts, select: OneSelect): void {
  if (select.type === 'SelectValues') {
    for (const row of select.values) {
      for (const value of row.values) {
        mergeFacts(facts, collectTriggerSubjectExprReferences(value));
      }
    }
    return;
  }

  for (const column of select.columns) {
    if (column.type === 'ExprResultColumn') {
      mergeFacts(facts, collectTriggerSubjectExprReferences(column.expr));
    }
  }
  if (select.from) {
    mergeFacts(facts, collectTriggerSubjectFromReferences(select.from));
  }
  for (const expr of select.groupBy || []) {
    mergeFacts(facts, collectTriggerSubjectExprReferences(expr));
  }
  if (select.whereClause) {
    mergeFacts(facts, collectTriggerSubjectExprReferences(select.whereClause));
  }
  if (select.having) {
    mergeFacts(facts, collectTriggerSubjectExprReferences(select.having));
  }
  for (const windowDef of select.windowClause || []) {
    mergeFacts(facts, collectTriggerSubjectWindowReferences(windowDef.window));
  }
}

function collectTriggerSubjectFromReferences(from: FromClause): MutableReferenceFacts {
  const facts = mutableFacts();
  if (from.select) {
    mergeFacts(facts, collectTriggerSubjectSelectTableReferences(from.select));
  }
  for (const join of from.joins || []) {
    mergeFacts(facts, collectTriggerSubjectSelectTableReferences(join.table));
    if (join.constraint?.type === 'OnJoinConstraint') {
      mergeFacts(facts, collectTriggerSubjectExprReferences(join.constraint.expr));
    }
  }
  return facts;
}

function collectTriggerSubjectSelectTableReferences(selectTable: SelectTable): MutableReferenceFacts {
  if (selectTable.type === 'SelectSelectTable') {
    return collectTriggerSubjectSelectReferences(selectTable.select);
  }
  if (selectTable.type === 'SubSelectTable') {
    return collectTriggerSubjectFromReferences(selectTable.from);
  }
  const facts = mutableFacts();
  if (selectTable.type === 'TableCallSelectTable') {
    for (const arg of selectTable.args || []) {
      mergeFacts(facts, collectTriggerSubjectExprReferences(arg));
    }
  }
  return facts;
}

function collectCreateTableCheckReferences(stmt: CreateTableStmt): MutableReferenceFacts {
  const facts = mutableFacts();
  if (stmt.body.type !== 'ColumnsAndConstraintsCreateTableBody') {
    return facts;
  }

  for (const column of stmt.body.columns) {
    for (const namedConstraint of column.constraints) {
      const constraint = namedConstraint.constraint;
      if (constraint.type === 'CheckColumnConstraint') {
        mergeFacts(facts, collectExprReferences(constraint.expr, emptyScope()));
      }
    }
  }

  for (const namedConstraint of stmt.body.constraints || []) {
    const constraint = namedConstraint.constraint;
    if (constraint.type === 'CheckTableConstraint') {
      mergeFacts(facts, collectExprReferences(constraint.expr, emptyScope()));
    }
  }

  return facts;
}

function collectCreateIndexWhereReferences(stmt: CreateIndexStmt): MutableReferenceFacts {
  if (!stmt.whereClause) {
    return mutableFacts();
  }
  return collectExprReferences(stmt.whereClause, emptyScope());
}

function collectSelect(select: Select, scope: ReferenceScope): MutableReferenceFacts {
  const cteNames = new Set(scope.cteNames);
  for (const cte of select.with?.ctes || []) {
    cteNames.add(normalizeName(cte.tblName.text));
  }
  const selectScope = {cteNames};
  const facts = mutableFacts();

  for (const cte of select.with?.ctes || []) {
    mergeFacts(facts, collectSelect(cte.select, selectScope));
  }

  mergeFacts(facts, collectOneSelect(select.select, selectScope));
  for (const compound of select.compounds || []) {
    mergeFacts(facts, collectOneSelect(compound.select, selectScope));
  }
  for (const sortedColumn of select.orderBy || []) {
    mergeFacts(facts, collectExprReferences(sortedColumn.expr, selectScope));
  }
  if (select.limit) {
    mergeFacts(facts, collectLimitReferences(select.limit, selectScope));
  }

  return facts;
}

function collectOneSelect(select: OneSelect, scope: ReferenceScope): MutableReferenceFacts {
  const facts = mutableFacts();
  if (select.type === 'SelectValues') {
    for (const row of select.values) {
      for (const value of row.values) {
        mergeFacts(facts, collectExprReferences(value, scope));
      }
    }
    return facts;
  }

  for (const column of select.columns) {
    mergeFacts(facts, collectResultColumnReferences(column, scope));
  }
  if (select.from) {
    mergeFacts(facts, collectFromClause(select.from, scope));
  }
  if (select.whereClause) {
    mergeFacts(facts, collectExprReferences(select.whereClause, scope));
  }
  for (const expr of select.groupBy || []) {
    mergeFacts(facts, collectExprReferences(expr, scope));
  }
  if (select.having) {
    mergeFacts(facts, collectExprReferences(select.having, scope));
  }
  for (const windowDef of select.windowClause || []) {
    mergeFacts(facts, collectWindowReferences(windowDef.window, scope));
  }
  return facts;
}

function collectResultColumnReferences(column: ResultColumn, scope: ReferenceScope): MutableReferenceFacts {
  if (column.type === 'ExprResultColumn') {
    return collectExprReferences(column.expr, scope);
  }
  const facts = mutableFacts();
  if (column.type === 'TableStarResultColumn') {
    facts.referencedColumns.add('*');
  }
  return facts;
}

function collectFromClause(from: FromClause, scope: ReferenceScope): MutableReferenceFacts {
  const facts = mutableFacts();
  if (from.select) {
    mergeFacts(facts, collectSelectTableReferences(from.select, scope));
  }
  for (const join of from.joins || []) {
    mergeFacts(facts, collectSelectTableReferences(join.table, scope));
    if (join.constraint?.type === 'OnJoinConstraint') {
      mergeFacts(facts, collectExprReferences(join.constraint.expr, scope));
    }
    if (join.constraint?.type === 'UsingJoinConstraint') {
      for (const column of join.constraint.columns) {
        facts.referencedColumns.add(normalizeName(column.text));
      }
    }
  }
  return facts;
}

function collectSelectTableReferences(selectTable: SelectTable, scope: ReferenceScope): MutableReferenceFacts {
  if (selectTable.type === 'SelectSelectTable') {
    return collectSelect(selectTable.select, scope);
  }
  if (selectTable.type === 'SubSelectTable') {
    return collectFromClause(selectTable.from, scope);
  }

  const facts = mutableFacts();
  const name = normalizeQualifiedObjectName(selectTable.tblName);
  if (!scope.cteNames.has(name)) {
    facts.referencedTables.add(name);
  }
  if (selectTable.type === 'TableCallSelectTable') {
    for (const arg of selectTable.args || []) {
      mergeFacts(facts, collectExprReferences(arg, scope));
    }
  }
  return facts;
}

function collectExprReferences(expr: Expr, scope: ReferenceScope): MutableReferenceFacts {
  const facts = mutableFacts();

  switch (expr.type) {
    case 'Id':
      facts.referencedColumns.add(normalizeName(expr.name));
      return facts;
    case 'NameExpr':
      facts.referencedColumns.add(normalizeName(expr.name.text));
      return facts;
    case 'QualifiedExpr':
      facts.referencedColumns.add(normalizeName(expr.column.text));
      return facts;
    case 'BetweenExpr':
      mergeFacts(facts, collectExprReferences(expr.lhs, scope));
      mergeFacts(facts, collectExprReferences(expr.start, scope));
      mergeFacts(facts, collectExprReferences(expr.end, scope));
      return facts;
    case 'BinaryExpr':
      mergeFacts(facts, collectExprReferences(expr.left, scope));
      mergeFacts(facts, collectExprReferences(expr.right, scope));
      return facts;
    case 'CaseExpr':
      if (expr.base) {
        mergeFacts(facts, collectExprReferences(expr.base, scope));
      }
      for (const pair of expr.whenThenPairs) {
        mergeFacts(facts, collectExprReferences(pair.when, scope));
        mergeFacts(facts, collectExprReferences(pair.then, scope));
      }
      if (expr.elseExpr) {
        mergeFacts(facts, collectExprReferences(expr.elseExpr, scope));
      }
      return facts;
    case 'CastExpr':
    case 'CollateExpr':
    case 'IsNullExpr':
    case 'NotNullExpr':
    case 'UnaryExpr':
      mergeFacts(facts, collectExprReferences(expr.expr, scope));
      return facts;
    case 'ExistsExpr':
    case 'SubqueryExpr':
      mergeFacts(facts, collectSelect(expr.select, scope));
      return facts;
    case 'FunctionCallExpr':
      for (const arg of expr.args || []) {
        mergeFacts(facts, collectExprReferences(arg, scope));
      }
      if (expr.orderBy) {
        mergeFacts(facts, collectFunctionOrderReferences(expr.orderBy, scope));
      }
      if (expr.filterOver) {
        mergeFacts(facts, collectFunctionTailReferences(expr.filterOver, scope));
      }
      return facts;
    case 'FunctionCallStarExpr':
      facts.referencedColumns.add('*');
      if (expr.filterOver) {
        mergeFacts(facts, collectFunctionTailReferences(expr.filterOver, scope));
      }
      return facts;
    case 'InListExpr':
      mergeFacts(facts, collectExprReferences(expr.lhs, scope));
      for (const rhs of expr.rhs || []) {
        mergeFacts(facts, collectExprReferences(rhs, scope));
      }
      return facts;
    case 'InSelectExpr':
      mergeFacts(facts, collectExprReferences(expr.lhs, scope));
      mergeFacts(facts, collectSelect(expr.rhs, scope));
      return facts;
    case 'InTableExpr':
      mergeFacts(facts, collectExprReferences(expr.lhs, scope));
      facts.referencedTables.add(normalizeQualifiedObjectName(expr.rhs));
      for (const arg of expr.args || []) {
        mergeFacts(facts, collectExprReferences(arg, scope));
      }
      return facts;
    case 'LikeExpr':
      mergeFacts(facts, collectExprReferences(expr.lhs, scope));
      mergeFacts(facts, collectExprReferences(expr.rhs, scope));
      if (expr.escape) {
        mergeFacts(facts, collectExprReferences(expr.escape, scope));
      }
      return facts;
    case 'ParenthesizedExpr':
      for (const inner of expr.exprs) {
        mergeFacts(facts, collectExprReferences(inner, scope));
      }
      return facts;
    case 'RaiseExpr':
      if (expr.message) {
        mergeFacts(facts, collectExprReferences(expr.message, scope));
      }
      return facts;
    case 'BlobLiteral':
    case 'CurrentDateLiteral':
    case 'CurrentTimeLiteral':
    case 'CurrentTimestampLiteral':
    case 'KeywordLiteral':
    case 'NullLiteral':
    case 'NumericLiteral':
    case 'StringLiteral':
    case 'VariableExpr':
      return facts;
  }
}

function collectTriggerSubjectExprReferences(expr: Expr): MutableReferenceFacts {
  const facts = mutableFacts();

  switch (expr.type) {
    case 'QualifiedExpr': {
      const qualifier = normalizeName(expr.table.text);
      if (qualifier === 'new' || qualifier === 'old') {
        facts.referencedColumns.add(normalizeName(expr.column.text));
      }
      return facts;
    }
    case 'BetweenExpr':
      mergeFacts(facts, collectTriggerSubjectExprReferences(expr.lhs));
      mergeFacts(facts, collectTriggerSubjectExprReferences(expr.start));
      mergeFacts(facts, collectTriggerSubjectExprReferences(expr.end));
      return facts;
    case 'BinaryExpr':
      mergeFacts(facts, collectTriggerSubjectExprReferences(expr.left));
      mergeFacts(facts, collectTriggerSubjectExprReferences(expr.right));
      return facts;
    case 'CaseExpr':
      if (expr.base) {
        mergeFacts(facts, collectTriggerSubjectExprReferences(expr.base));
      }
      for (const pair of expr.whenThenPairs) {
        mergeFacts(facts, collectTriggerSubjectExprReferences(pair.when));
        mergeFacts(facts, collectTriggerSubjectExprReferences(pair.then));
      }
      if (expr.elseExpr) {
        mergeFacts(facts, collectTriggerSubjectExprReferences(expr.elseExpr));
      }
      return facts;
    case 'CastExpr':
    case 'CollateExpr':
    case 'IsNullExpr':
    case 'NotNullExpr':
    case 'UnaryExpr':
      mergeFacts(facts, collectTriggerSubjectExprReferences(expr.expr));
      return facts;
    case 'ExistsExpr':
    case 'SubqueryExpr':
      mergeFacts(facts, collectTriggerSubjectSelectReferences(expr.select));
      return facts;
    case 'FunctionCallExpr':
      for (const arg of expr.args || []) {
        mergeFacts(facts, collectTriggerSubjectExprReferences(arg));
      }
      if (expr.filterOver) {
        mergeFacts(facts, collectTriggerSubjectFunctionTailReferences(expr.filterOver));
      }
      return facts;
    case 'FunctionCallStarExpr':
      if (expr.filterOver) {
        mergeFacts(facts, collectTriggerSubjectFunctionTailReferences(expr.filterOver));
      }
      return facts;
    case 'InListExpr':
      mergeFacts(facts, collectTriggerSubjectExprReferences(expr.lhs));
      for (const rhs of expr.rhs || []) {
        mergeFacts(facts, collectTriggerSubjectExprReferences(rhs));
      }
      return facts;
    case 'InSelectExpr':
      mergeFacts(facts, collectTriggerSubjectExprReferences(expr.lhs));
      mergeFacts(facts, collectTriggerSubjectSelectReferences(expr.rhs));
      return facts;
    case 'InTableExpr':
      mergeFacts(facts, collectTriggerSubjectExprReferences(expr.lhs));
      for (const arg of expr.args || []) {
        mergeFacts(facts, collectTriggerSubjectExprReferences(arg));
      }
      return facts;
    case 'LikeExpr':
      mergeFacts(facts, collectTriggerSubjectExprReferences(expr.lhs));
      mergeFacts(facts, collectTriggerSubjectExprReferences(expr.rhs));
      if (expr.escape) {
        mergeFacts(facts, collectTriggerSubjectExprReferences(expr.escape));
      }
      return facts;
    case 'ParenthesizedExpr':
      for (const inner of expr.exprs) {
        mergeFacts(facts, collectTriggerSubjectExprReferences(inner));
      }
      return facts;
    case 'RaiseExpr':
      if (expr.message) {
        mergeFacts(facts, collectTriggerSubjectExprReferences(expr.message));
      }
      return facts;
    case 'BlobLiteral':
    case 'CurrentDateLiteral':
    case 'CurrentTimeLiteral':
    case 'CurrentTimestampLiteral':
    case 'Id':
    case 'KeywordLiteral':
    case 'NameExpr':
    case 'NullLiteral':
    case 'NumericLiteral':
    case 'StringLiteral':
    case 'VariableExpr':
      return facts;
  }
}

function collectFunctionOrderReferences(order: FunctionCallOrder, scope: ReferenceScope): MutableReferenceFacts {
  const facts = mutableFacts();
  if (order.type === 'WithinGroupFunctionCallOrder') {
    mergeFacts(facts, collectExprReferences(order.expr, scope));
    return facts;
  }
  for (const column of order.columns) {
    mergeFacts(facts, collectExprReferences(column.expr, scope));
  }
  return facts;
}

function collectFunctionTailReferences(tail: FunctionTail, scope: ReferenceScope): MutableReferenceFacts {
  const facts = mutableFacts();
  if (tail.filterClause) {
    mergeFacts(facts, collectExprReferences(tail.filterClause, scope));
  }
  if (tail.overClause?.type === 'WindowOver') {
    mergeFacts(facts, collectWindowReferences(tail.overClause.window, scope));
  }
  return facts;
}

function collectTriggerSubjectFunctionTailReferences(tail: FunctionTail): MutableReferenceFacts {
  const facts = mutableFacts();
  if (tail.filterClause) {
    mergeFacts(facts, collectTriggerSubjectExprReferences(tail.filterClause));
  }
  if (tail.overClause?.type === 'WindowOver') {
    mergeFacts(facts, collectTriggerSubjectWindowReferences(tail.overClause.window));
  }
  return facts;
}

function collectWindowReferences(window: Window, scope: ReferenceScope): MutableReferenceFacts {
  const facts = mutableFacts();
  for (const expr of window.partitionBy || []) {
    mergeFacts(facts, collectExprReferences(expr, scope));
  }
  for (const column of window.orderBy || []) {
    mergeFacts(facts, collectExprReferences(column.expr, scope));
  }
  if (
    window.frameClause?.start.type === 'FollowingFrameBound' ||
    window.frameClause?.start.type === 'PrecedingFrameBound'
  ) {
    mergeFacts(facts, collectExprReferences(window.frameClause.start.expr, scope));
  }
  const end = window.frameClause?.end;
  if (end?.type === 'FollowingFrameBound' || end?.type === 'PrecedingFrameBound') {
    mergeFacts(facts, collectExprReferences(end.expr, scope));
  }
  return facts;
}

function collectTriggerSubjectWindowReferences(window: Window): MutableReferenceFacts {
  const facts = mutableFacts();
  for (const expr of window.partitionBy || []) {
    mergeFacts(facts, collectTriggerSubjectExprReferences(expr));
  }
  for (const column of window.orderBy || []) {
    mergeFacts(facts, collectTriggerSubjectExprReferences(column.expr));
  }
  return facts;
}

function collectLimitReferences(limit: Limit, scope: ReferenceScope): MutableReferenceFacts {
  const facts = collectExprReferences(limit.expr, scope);
  if (limit.offset) {
    mergeFacts(facts, collectExprReferences(limit.offset, scope));
  }
  return facts;
}

function collectTriggerSubjectLimitReferences(limit: Limit): MutableReferenceFacts {
  const facts = collectTriggerSubjectExprReferences(limit.expr);
  if (limit.offset) {
    mergeFacts(facts, collectTriggerSubjectExprReferences(limit.offset));
  }
  return facts;
}

function fallbackReferenceFacts(sql: string): SqliteReferenceFacts {
  const identifiers = sqlIdentifierTokens(sql);
  return {
    referencedTables: [...identifiers].sort((left, right) => left.localeCompare(right)),
    referencedColumns: [...identifiers].sort((left, right) => left.localeCompare(right)),
  };
}

function fallbackIndexWhereReferenceFacts(whereSql: string | null): SqliteIndexWhereReferenceFacts {
  return {
    referencedColumns: whereSql ? sortedStrings(sqlIdentifierTokens(whereSql)) : [],
  };
}

function fallbackCheckReferencesDroppedColumns(createSql: string, columnNames: ReadonlySet<string>): boolean {
  const match = createSql.match(/\(([\s\S]*)\)$/u);
  if (!match) {
    return false;
  }

  for (const definition of splitTopLevelCommaList(match[1]!)) {
    const normalizedDefinition = definition.trim();
    if (!/\bcheck\s*\(/iu.test(normalizedDefinition)) {
      continue;
    }

    const referencedIdentifiers = sqlIdentifierTokens(normalizedDefinition);
    for (const columnName of columnNames) {
      if (referencedIdentifiers.has(normalizeName(columnName))) {
        return true;
      }
    }
  }

  return false;
}

function sortedFacts(facts: MutableReferenceFacts): SqliteReferenceFacts {
  return {
    referencedTables: sortedStrings(facts.referencedTables),
    referencedColumns: sortedStrings(facts.referencedColumns),
  };
}

function sortedIndexWhereFacts(facts: MutableReferenceFacts): SqliteIndexWhereReferenceFacts {
  return {
    referencedColumns: sortedStrings(facts.referencedColumns),
  };
}

function sortedStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function mutableFacts(): MutableReferenceFacts {
  return {
    referencedTables: new Set(),
    referencedColumns: new Set(),
  };
}

function mergeFacts(target: MutableReferenceFacts, source: MutableReferenceFacts): void {
  for (const table of source.referencedTables) {
    target.referencedTables.add(table);
  }
  for (const column of source.referencedColumns) {
    target.referencedColumns.add(column);
  }
}

function normalizeQualifiedObjectName(name: QualifiedName): string {
  return normalizeName(name.objName.text);
}

function normalizeName(name: string): string {
  return name.toLowerCase();
}

function emptyScope(): ReferenceScope {
  return {cteNames: new Set()};
}

type MutableReferenceFacts = {
  referencedTables: Set<string>;
  referencedColumns: Set<string>;
};

type ReferenceScope = {
  cteNames: Set<string>;
};
