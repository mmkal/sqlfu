/**
 * Normalize SQL for identity comparison. Dedents, trims, collapses
 * internal whitespace, and lowercases keywords so cosmetic edits
 * don't break equality.
 *
 * Duplicated from packages/sqlfu/src/core/util.ts deliberately — the
 * lint plugin shouldn't take a runtime dep on the whole of sqlfu.
 */
export function normalizeSqlForMatch(sql: string): string {
  const lines = sql.split('\n');
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^[\t ]*/)?.[0].length || 0);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
  const dedented = lines.map((line) => line.slice(minIndent)).join('\n');
  return dedented.trim().replace(/\s+/g, ' ').toLowerCase();
}
