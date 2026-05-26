import type {QueryArg} from 'sqlfu';

export type RelationSubviewPage = {
  limit: number;
  offset: number;
};

const limitOffsetPattern = /\blimit\s+(\d+)(?:\s+offset\s+(\d+))?\s*;?\s*$/i;

export function buildRelationSubviewSql(relationName: string, column: string, value: QueryArg) {
  return `select * from ${quoteSqlIdentifier(relationName)} where ${quoteSqlIdentifier(column)} = ${formatSqlLiteral(value)} limit 100`;
}

export function readRelationSubviewPage(sql: string): RelationSubviewPage | null {
  const match = sql.match(limitOffsetPattern);
  if (!match) return null;
  return {
    limit: Number(match[1]),
    offset: match[2] ? Number(match[2]) : 0,
  };
}

export function rewriteRelationSubviewPage(sql: string, page: RelationSubviewPage) {
  const limit = Math.max(1, Math.trunc(page.limit));
  const offset = Math.max(0, Math.trunc(page.offset));
  const clause = offset > 0 ? `limit ${limit} offset ${offset}` : `limit ${limit}`;
  if (limitOffsetPattern.test(sql)) {
    return sql.replace(limitOffsetPattern, clause);
  }
  return `${sql.replace(/;?\s*$/, '')} ${clause}`;
}

export function quoteSqlIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function formatSqlLiteral(value: QueryArg) {
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Uint8Array)
    return `x'${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}'`;
  return 'null';
}
