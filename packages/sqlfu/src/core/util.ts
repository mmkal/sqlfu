/**
 * Tagged-template dedent. Strips the common leading whitespace from every
 * non-empty line so SQL and other multi-line strings can be indented in
 * source without that indentation landing in the runtime value.
 */
export function dedent(strings: TemplateStringsArray, ...values: readonly unknown[]): string {
  const raw = strings.reduce<string>((accumulator, part, index) => {
    const value = index < values.length ? String(values[index]) : '';
    return accumulator + part + value;
  }, '');
  return dedentString(raw);
}

function dedentString(value: string): string {
  const lines = value.split('\n');
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^[\t ]*/)?.[0].length ?? 0);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(minIndent)).join('\n');
}

/**
 * Normalize SQL for identity hashing. Dedents, trims, and collapses
 * internal whitespace so cosmetic formatting nudges don't change the
 * resulting hash.
 */
export function normalizeSqlForHash(sql: string): string {
  return dedentString(sql).trim().replace(/\s+/g, ' ');
}

/**
 * 7-character hex hash over the input. djb2 — deterministic, synchronous,
 * runtime-agnostic (works in node, bun, workerd, expo). Used to distinguish
 * ad-hoc queries in observability without overwhelming dashboard cardinality.
 */
export function shortHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash * 33) ^ value.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 7);
}
