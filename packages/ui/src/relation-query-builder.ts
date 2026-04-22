export const DEFAULT_LIMIT = 100;

export type FilterOperator =
  | '='
  | '!='
  | 'like'
  | 'not like'
  | '>'
  | '>='
  | '<'
  | '<='
  | 'is null'
  | 'is not null'
  | 'in';

export const FILTER_OPERATORS: FilterOperator[] = [
  '=',
  '!=',
  'like',
  'not like',
  '>',
  '>=',
  '<',
  '<=',
  'is null',
  'is not null',
  'in',
];

export function operatorTakesValue(op: FilterOperator): boolean {
  return op !== 'is null' && op !== 'is not null';
}

export type RelationQueryFilter = {
  column: string;
  operator: FilterOperator;
  value?: string;
};

export type RelationQuerySort = {
  column: string;
  direction: 'asc' | 'desc';
};

export type RelationQueryState = {
  tableName: string;
  allColumns: string[];
  hiddenColumns: string[];
  filters: RelationQueryFilter[];
  sorts: RelationQuerySort[];
  limit: number;
  offset: number;
};

export function defaultRelationQueryState(input: {tableName: string; allColumns: string[]}): RelationQueryState {
  return {
    tableName: input.tableName,
    allColumns: input.allColumns,
    hiddenColumns: [],
    filters: [],
    sorts: [],
    limit: DEFAULT_LIMIT,
    offset: 0,
  };
}

export function isDefaultRelationQueryState(state: RelationQueryState): boolean {
  return (
    state.hiddenColumns.length === 0 &&
    state.filters.length === 0 &&
    state.sorts.length === 0 &&
    state.limit === DEFAULT_LIMIT &&
    state.offset === 0
  );
}

export function buildRelationQuery(state: RelationQueryState): string {
  const lines: string[] = [];
  lines.push(`select ${buildSelectClause(state)}`);
  lines.push(`from ${quoteIdent(state.tableName)}`);
  if (state.filters.length > 0) {
    lines.push(`where ${state.filters.map(buildFilterClause).join(' and ')}`);
  }
  if (state.sorts.length > 0) {
    lines.push(
      `order by ${state.sorts.map((s) => `${quoteIdent(s.column)} ${s.direction}`).join(', ')}`,
    );
  }
  lines.push(state.offset > 0 ? `limit ${state.limit} offset ${state.offset}` : `limit ${state.limit}`);
  return lines.join('\n');
}

function buildSelectClause(state: RelationQueryState): string {
  if (state.hiddenColumns.length === 0) {
    return '*';
  }
  const hidden = new Set(state.hiddenColumns);
  const lastIndex = state.allColumns.length - 1;
  return state.allColumns
    .map((col, index) => {
      const isLast = index === lastIndex;
      const ident = quoteIdent(col);
      if (hidden.has(col)) {
        return isLast ? `/* ${ident} */` : `/* ${ident}, */`;
      }
      return isLast ? ident : `${ident},`;
    })
    .join(' ');
}

function buildFilterClause(filter: RelationQueryFilter): string {
  const col = quoteIdent(filter.column);
  if (filter.operator === 'is null' || filter.operator === 'is not null') {
    return `${col} ${filter.operator}`;
  }
  const raw = filter.value ?? '';
  if (filter.operator === 'in') {
    return `${col} in (${raw})`;
  }
  return `${col} ${filter.operator} ${quoteLiteral(raw)}`;
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
