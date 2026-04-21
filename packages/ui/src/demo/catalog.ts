import type {QueryCatalogEntry} from 'sqlfu/browser';

import type {DemoVfs} from './vfs.js';

export type QueryCatalog = {
  readonly generatedAt: string;
  readonly queries: readonly QueryCatalogEntry[];
};

export function buildQueryCatalog(vfs: DemoVfs): QueryCatalog {
  return {
    generatedAt: new Date().toISOString(),
    queries: vfs.queries.map((file) => buildCatalogEntry(file.name, file.content)),
  };
}

function buildCatalogEntry(fileName: string, rawSql: string): QueryCatalogEntry {
  const id = fileName.replace(/\.sql$/, '');
  const sql = rawSql.trim();
  const queryType = detectQueryType(sql);
  const multipleRowsResult = queryType === 'Select';
  const resultMode = multipleRowsResult ? ('many' as const) : ('metadata' as const);
  const args = detectArgs(sql);

  const paramsProperties = Object.fromEntries(args.map((arg) => [arg.name, {type: 'string', title: arg.name}]));

  return {
    kind: 'query',
    id,
    sqlFile: `sql/${fileName}`,
    functionName: toCamelCase(id),
    sql,
    sqlFileContent: rawSql,
    queryType,
    multipleRowsResult,
    resultMode,
    args,
    paramsSchema:
      args.length > 0
        ? {type: 'object', properties: paramsProperties, additionalProperties: false, required: []}
        : undefined,
    resultSchema: {type: 'object', properties: {}, additionalProperties: false, required: []},
    columns: [],
  };
}

function detectQueryType(sql: string): 'Select' | 'Insert' | 'Update' | 'Delete' | 'Copy' {
  const firstWord = sql.trimStart().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (firstWord === 'insert') return 'Insert';
  if (firstWord === 'update') return 'Update';
  if (firstWord === 'delete') return 'Delete';
  return 'Select';
}

function detectArgs(sql: string) {
  const names = new Set<string>();
  for (const match of sql.matchAll(/[:@$]([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const name = match[1]!;
    if (!names.has(name)) {
      names.add(name);
    }
  }
  return Array.from(names).map((name) => ({
    scope: 'params' as const,
    name,
    tsType: 'unknown',
    notNull: false,
    optional: true,
    isArray: false,
    driverEncoding: 'identity' as const,
  }));
}

function toCamelCase(value: string) {
  return value.replace(/[-_]+(\w)/g, (_, char: string) => char.toUpperCase());
}
